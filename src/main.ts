import { createIcons, icons } from "lucide";
import QRCode from "qrcode";
import "./styles.css";
import { runZsign, saveOutput, signIpa, splitCliArgs } from "./zsign-api";
import type { OutputFile, SignIpaOptions, VirtualInputFile } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <header class="topbar">
    <div>
      <h1>zsign WASM</h1>
      <p>Local IPA signing for desktop Chromium</p>
    </div>
    <div class="status" id="status">Idle</div>
  </header>

  <main class="workspace">
    <section class="panel sign-panel">
      <div class="panel-head">
        <h2>Signer</h2>
        <button class="ghost" id="clear-form" type="button" title="Clear">
          <i data-lucide="trash-2"></i><span>Clear</span>
        </button>
      </div>

      <form id="sign-form">
        <div class="grid two">
          <label>IPA
            <input id="ipa" type="file" accept=".ipa,.zip" />
          </label>
          <label>P12
            <input id="p12" type="file" accept=".p12,.pfx" />
          </label>
          <label>Provisioning profiles
            <input id="profiles" type="file" accept=".mobileprovision,.provisionprofile" multiple />
          </label>
          <label>Dylib
            <input id="dylibs" type="file" accept=".dylib" multiple />
          </label>
        </div>

        <div class="grid two">
          <label>Password
            <input id="password" type="password" autocomplete="off" />
          </label>
          <label>Output IPA
            <input id="output-name" type="text" value="signed.ipa" />
          </label>
          <label>Bundle ID
            <input id="bundle-id" type="text" placeholder="Leave blank for original" />
          </label>
        </div>

        <div class="action-row">
          <button id="sign-button" type="submit">
            <i data-lucide="play"></i><span>Sign</span>
          </button>
          <label class="cache-toggle">
            <input id="cache-cert-info" type="checkbox" />
            <span>Cache cert info</span>
          </label>
          <button class="ghost compact" id="clear-cert-cache" type="button" hidden title="Forget cached cert info">
            <i data-lucide="key-round"></i><span>Forget</span>
          </button>
          <span class="hint" id="cache-state"></span>
          <span class="hint">Peak memory can exceed IPA size.</span>
        </div>
      </form>
    </section>

    <section class="panel cli-panel" hidden>
      <div class="panel-head">
        <h2>CLI</h2>
        <button class="ghost" id="run-cli" type="button" title="Run CLI">
          <i data-lucide="terminal"></i><span>Run</span>
        </button>
      </div>
      <label>Arguments
        <textarea id="cli-args" rows="4">-v</textarea>
      </label>
      <label>Files
        <input id="cli-files" type="file" multiple />
      </label>
      <pre class="mounts" id="mounts"></pre>
    </section>

    <section class="panel logs-panel">
      <div class="panel-head">
        <h2>Logs</h2>
        <button class="ghost" id="download-first" type="button" disabled title="Download">
          <i data-lucide="download"></i><span>Download</span>
        </button>
      </div>
      <pre id="logs"></pre>
      <div id="outputs" class="outputs"></div>

      <div class="install-card">
        <div class="install-head">
          <div>
            <h3>Install QR</h3>
            <p>Manifest plist via palera.in</p>
          </div>
          <button class="ghost" id="generate-install-qr" type="button" title="Generate install QR">
            <i data-lucide="qr-code"></i><span>QR</span>
          </button>
        </div>
        <div class="grid install-grid">
          <label>IPA fetch URL
            <input id="install-fetch-url" type="url" placeholder="https://example.com/app_signed.ipa" />
          </label>
          <label>Install bundle ID
            <input id="install-bundle-id" type="text" />
          </label>
          <label>App name
            <input id="install-name" type="text" />
          </label>
          <label>Version
            <input id="install-version" type="text" value="1.0" />
          </label>
        </div>
        <div id="install-result" class="install-result" hidden>
          <img id="install-qr" alt="Install QR code" />
          <div class="install-links">
            <a id="install-link" href="#" target="_blank" rel="noreferrer">Open install link</a>
            <div>
              <span class="mini-label">Manifest plist</span>
              <code id="manifest-url"></code>
            </div>
          </div>
        </div>
        <p class="hint">Use an HTTPS IPA URL reachable from the iPhone.</p>
      </div>
    </section>
  </main>
`;

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const status = $("status");
const logs = $("logs");
const outputs = $("outputs");
const downloadFirst = $("download-first") as HTMLButtonElement;
let lastOutputs: OutputFile[] = [];
let outputNameTouched = false;

type AppMetadata = {
  AppName?: string;
  AppVersion?: string;
  AppBundleIdentifier?: string;
  FileName?: string;
};

type CachedFileData = {
  name: string;
  type: string;
  lastModified: number;
  data: ArrayBuffer;
};

type CachedCertInfo = {
  p12?: CachedFileData;
  profiles: CachedFileData[];
  password?: string;
  savedAt: number;
};

let lastInstallMetadata: AppMetadata | null = null;
let cachedCertInfo: CachedCertInfo | null = null;
const textDecoder = new TextDecoder();
const certCacheDbName = "zsign-wasm-cert-cache";
const certCacheStore = "cert-info";
const certCacheKey = "default";

function maybeInput(id: string) {
  return document.querySelector<HTMLInputElement>(`#${id}`);
}

function file(id: string) {
  return maybeInput(id)?.files?.[0];
}

function fileList(id: string) {
  return Array.from(maybeInput(id)?.files ?? []);
}

function value(id: string) {
  return maybeInput(id)?.value.trim() ?? "";
}

function checked(id: string) {
  return maybeInput(id)?.checked ?? false;
}

function openCertCacheDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(certCacheDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(certCacheStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open cert cache."));
  });
}

async function withCertCacheStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
) {
  const db = await openCertCacheDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(certCacheStore, mode);
      const request = callback(transaction.objectStore(certCacheStore));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cert cache request failed."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Cert cache transaction failed."));
    });
  } finally {
    db.close();
  }
}

async function readCachedCertInfo() {
  return (await withCertCacheStore("readonly", (store) => store.get(certCacheKey))) as CachedCertInfo | null;
}

async function writeCachedCertInfo(value: CachedCertInfo) {
  await withCertCacheStore("readwrite", (store) => store.put(value, certCacheKey));
}

async function deleteCachedCertInfo() {
  await withCertCacheStore("readwrite", (store) => store.delete(certCacheKey));
}

async function fileToCachedData(nextFile: File): Promise<CachedFileData> {
  return {
    name: nextFile.name,
    type: nextFile.type,
    lastModified: nextFile.lastModified,
    data: await nextFile.arrayBuffer()
  };
}

function cachedDataToFile(nextFile: CachedFileData) {
  return new File([nextFile.data], nextFile.name, {
    type: nextFile.type,
    lastModified: nextFile.lastModified
  });
}

function cachedProfiles() {
  return cachedCertInfo?.profiles.map(cachedDataToFile) ?? [];
}

function cachedP12() {
  return cachedCertInfo?.p12 ? cachedDataToFile(cachedCertInfo.p12) : undefined;
}

function updateCertCacheUi() {
  const cacheCheckbox = maybeInput("cache-cert-info");
  const clearButton = $("clear-cert-cache") as HTMLButtonElement;
  const cacheState = $("cache-state");
  const hasCache = Boolean(cachedCertInfo?.p12 || cachedCertInfo?.profiles.length || cachedCertInfo?.password);

  if (cacheCheckbox && hasCache && !cacheCheckbox.dataset.userTouched) {
    cacheCheckbox.checked = true;
  }

  clearButton.hidden = !hasCache;
  cacheState.textContent = hasCache ? "Cached cert ready" : "";
}

async function loadCertCache() {
  try {
    cachedCertInfo = await readCachedCertInfo();
  } catch {
    cachedCertInfo = null;
  }
  updateCertCacheUi();
}

async function saveCertCacheFromInputs() {
  const selectedP12 = file("p12");
  const selectedProfiles = fileList("profiles");
  const password = value("password");

  const next: CachedCertInfo = {
    p12: selectedP12 ? await fileToCachedData(selectedP12) : cachedCertInfo?.p12,
    profiles: selectedProfiles.length
      ? await Promise.all(selectedProfiles.map(fileToCachedData))
      : cachedCertInfo?.profiles ?? [],
    password: password || cachedCertInfo?.password,
    savedAt: Date.now()
  };

  if (!next.p12 && next.profiles.length === 0 && !next.password) return;
  await writeCachedCertInfo(next);
  cachedCertInfo = next;
  updateCertCacheUi();
}

function setStatus(text: string, tone: "idle" | "busy" | "ok" | "error" = "idle") {
  status.textContent = text;
  status.dataset.tone = tone;
}

function renderLogs(lines: string[], exitCode: number) {
  logs.textContent = [...lines, "", `exit: ${exitCode}`].join("\n");
}

function renderOutputs(files: OutputFile[]) {
  lastOutputs = files;
  const fileMetadata = parseMetadata(files);
  if (fileMetadata) {
    lastInstallMetadata = fileMetadata;
  } else if (files.length === 0) {
    lastInstallMetadata = null;
  }
  if (files.length > 0) fillInstallDefaults();
  downloadFirst.disabled = files.length === 0;
  outputs.innerHTML = files
    .map(
      (output, index) => {
        const installButton = output.name.toLowerCase().endsWith(".ipa")
          ? `
          <button class="ghost" type="button" data-install-output="${index}" title="Prepare install QR for ${output.name}">
            <i data-lucide="qr-code"></i><span>QR</span>
          </button>`
          : "";
        return `
        <div class="output-row">
          <span>${output.name}</span>
          <div class="output-actions">
            ${installButton}
            <button type="button" data-output="${index}" title="Download ${output.name}">
              <i data-lucide="download"></i><span>Download</span>
            </button>
          </div>
        </div>
      `;
      }
    )
    .join("");
  createIcons({ icons });
}

function cleanLogLine(line: string) {
  return line.replace(/\x1b\[[0-9;]*m/g, "").trim();
}

function parseMetadataFromLogs(lines: string[]): AppMetadata | null {
  const metadata: AppMetadata = {};

  for (const rawLine of lines) {
    const line = cleanLogLine(rawLine);
    const appName = line.match(/^>>>\s*AppName:\s*(.+)$/);
    const bundleId = line.match(/^>>>\s*BundleId:\s*(.+)$/);
    const version = line.match(/^>>>\s*Version:\s*(.+)$/);

    if (appName) metadata.AppName = appName[1].trim();
    if (bundleId) metadata.AppBundleIdentifier = bundleId[1].trim();
    if (version) metadata.AppVersion = version[1].trim();
  }

  return metadata.AppName || metadata.AppBundleIdentifier || metadata.AppVersion ? metadata : null;
}

function parseMetadata(files: OutputFile[]): AppMetadata | null {
  const metadata = files.find(
    (output) => output.name === "metadata.json" || output.path.endsWith("/metadata.json")
  );
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(textDecoder.decode(metadata.data)) as AppMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setInputValue(id: string, nextValue: string | undefined, force = false) {
  const input = maybeInput(id);
  if (!input || !nextValue) return;
  if (!force && input.value.trim()) return;
  input.value = nextValue;
}

function installNameFromOutput(output?: OutputFile) {
  const explicitName = output?.name || value("output-name") || file("ipa")?.name;
  return explicitName?.replace(/\.(ipa|zip)$/i, "") || undefined;
}

function fillInstallDefaults(output?: OutputFile, force = false) {
  const metadata = lastInstallMetadata ?? {};
  setInputValue("install-bundle-id", metadata.AppBundleIdentifier || value("bundle-id"), force);
  setInputValue("install-name", metadata.AppName || installNameFromOutput(output), force);
  setInputValue("install-version", metadata.AppVersion || "1.0", force);

  const fetchInput = maybeInput("install-fetch-url");
  if (fetchInput && output) {
    fetchInput.placeholder = `https://example.com/${encodeURIComponent(output.name)}`;
  }
}

function clearInstallResult() {
  $("install-result").hidden = true;
  ($("install-link") as HTMLAnchorElement).href = "#";
  $("manifest-url").textContent = "";
  ($("install-qr") as HTMLImageElement).removeAttribute("src");
}

function requiredInstallValue(id: string, label: string) {
  const nextValue = value(id);
  if (!nextValue) throw new Error(`Enter ${label} first.`);
  return nextValue;
}

function buildPaleraManifestUrl() {
  const fetchUrl = requiredInstallValue("install-fetch-url", "an IPA fetch URL");
  const ipaUrl = new URL(fetchUrl);
  if (ipaUrl.protocol !== "https:") {
    throw new Error("The IPA fetch URL must use HTTPS for iOS OTA install.");
  }

  const params = new URLSearchParams({
    bundleid: requiredInstallValue("install-bundle-id", "a bundle ID"),
    name: requiredInstallValue("install-name", "an app name"),
    version: requiredInstallValue("install-version", "an app version"),
    fetchurl: ipaUrl.toString()
  });
  return `https://api.palera.in/genPlist?${params.toString()}`;
}

function buildInstallUrl(manifestUrl: string) {
  const finalEncodedUrl = encodeURIComponent(encodeURIComponent(manifestUrl));
  return `itms-services://?action=download-manifest&url=${finalEncodedUrl}`;
}

async function generateInstallQr() {
  try {
    fillInstallDefaults();
    const manifestUrl = buildPaleraManifestUrl();
    const installUrl = buildInstallUrl(manifestUrl);
    const qrDataUrl = await QRCode.toDataURL(installUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6
    });

    ($("install-qr") as HTMLImageElement).src = qrDataUrl;
    ($("install-link") as HTMLAnchorElement).href = installUrl;
    $("manifest-url").textContent = manifestUrl;
    $("install-result").hidden = false;
    setStatus("QR Ready", "ok");
  } catch (error) {
    clearInstallResult();
    const message = error instanceof Error ? error.message : String(error);
    logs.textContent = message;
    setStatus("Error", "error");
  }
}

function defaultOutputName(ipa?: File) {
  if (!ipa) return "signed.ipa";
  const base = ipa.name.replace(/\.(ipa|zip)$/i, "");
  return `${base || "app"}_signed.ipa`;
}

function syncOutputName(force = false) {
  const outputName = maybeInput("output-name");
  if (!outputName) return;
  if (!force && outputNameTouched) return;
  outputName.value = defaultOutputName(file("ipa"));
}

function buildSignOptions(): SignIpaOptions {
  const ipa = file("ipa");
  if (!ipa) throw new Error("Choose an IPA first.");

  const useCertCache = checked("cache-cert-info");
  const selectedProfiles = fileList("profiles");
  const p12 = file("p12") ?? (useCertCache ? cachedP12() : undefined);
  const profiles = selectedProfiles.length > 0 ? selectedProfiles : useCertCache ? cachedProfiles() : [];
  const password = value("password") || (useCertCache ? cachedCertInfo?.password ?? "" : "");
  const adhoc = checked("adhoc");
  if (!adhoc && !p12) {
    throw new Error("Choose a P12/private key or enable ad-hoc.");
  }
  if (!adhoc && profiles.length === 0) {
    throw new Error("Choose at least one provisioning profile or enable ad-hoc.");
  }

  return {
    ipa,
    p12,
    certificate: file("cert"),
    profiles,
    entitlements: file("entitlements"),
    dylibs: fileList("dylibs"),
    password,
    outputName: value("output-name") || defaultOutputName(ipa),
    zipLevel: Number(value("zip-level") || 0),
    adhoc,
    debug: checked("debug"),
    force: checked("force"),
    quiet: checked("quiet"),
    sha256Only: checked("sha256-only"),
    weakDylib: checked("weak-dylib"),
    checkSignature: checked("check-signature"),
    install: checked("install"),
    removeProvision: checked("remove-provision"),
    enableDocuments: checked("enable-documents"),
    removeExtensions: checked("remove-extensions"),
    removeWatch: checked("remove-watch"),
    removeUISupportedDevices: checked("remove-uisd"),
    bundleId: value("bundle-id"),
    bundleName: value("bundle-name"),
    bundleVersion: value("bundle-version"),
    minimumVersion: value("minimum-version"),
    metadata: checked("metadata"),
    removeDylibs: value("remove-dylibs")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function safeBlobName(name: string) {
  return name.replace(/[^\w.-]+/g, "_") || "file";
}

function updateMounts() {
  const mounted = fileList("cli-files").map((item) => `/blob/${safeBlobName(item.name)}`);
  $("mounts").textContent = mounted.length ? mounted.join("\n") : "";
}

$("sign-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Signing", "busy");
  renderOutputs([]);
  try {
    const options = buildSignOptions();
    if (checked("cache-cert-info")) {
      await saveCertCacheFromInputs();
    }
    const result = await signIpa(options);
    renderLogs(result.logs, result.exitCode);
    lastInstallMetadata = parseMetadataFromLogs(result.logs);
    renderOutputs(result.outputs);
    setStatus(result.exitCode === 0 ? "Signed" : "Failed", result.exitCode === 0 ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.textContent = message;
    setStatus("Error", "error");
  }
});

$("run-cli").addEventListener("click", async () => {
  setStatus("Running", "busy");
  renderOutputs([]);
  const cliFiles: VirtualInputFile[] = fileList("cli-files").map((item) => ({
    path: `/blob/${safeBlobName(item.name)}`,
    file: item,
    mode: "workerfs"
  }));

  try {
    const result = await runZsign(splitCliArgs(($("cli-args") as HTMLTextAreaElement).value), cliFiles, {
      collectDirectories: ["/output"],
      persistCache: true
    });
    renderLogs(result.logs, result.exitCode);
    renderOutputs(result.outputs);
    setStatus(result.exitCode === 0 ? "Done" : "Failed", result.exitCode === 0 ? "ok" : "error");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.textContent = message;
    setStatus("Error", "error");
  }
});

outputs.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const installButton = target.closest<HTMLButtonElement>("[data-install-output]");
  if (installButton) {
    const output = lastOutputs[Number(installButton.dataset.installOutput)];
    if (output) {
      fillInstallDefaults(output, true);
      clearInstallResult();
      if (value("install-fetch-url")) {
        void generateInstallQr();
      } else {
        logs.textContent = "Enter an HTTPS IPA fetch URL reachable from the iPhone, then click QR.";
        setStatus("Needs URL");
      }
    }
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-output]");
  if (!button) return;
  const index = Number(button.dataset.output);
  const output = lastOutputs[index];
  if (output) saveOutput(output);
});

downloadFirst.addEventListener("click", () => {
  if (lastOutputs[0]) saveOutput(lastOutputs[0]);
});

$("clear-form").addEventListener("click", () => {
  ($("sign-form") as HTMLFormElement).reset();
  maybeInput("install-fetch-url")!.value = "";
  maybeInput("install-bundle-id")!.value = "";
  maybeInput("install-name")!.value = "";
  maybeInput("install-version")!.value = "1.0";
  outputNameTouched = false;
  lastInstallMetadata = null;
  syncOutputName(true);
  renderOutputs([]);
  clearInstallResult();
  logs.textContent = "";
  updateCertCacheUi();
  setStatus("Idle");
});

$("ipa").addEventListener("change", () => {
  syncOutputName();
  fillInstallDefaults(undefined, true);
  clearInstallResult();
});
$("output-name").addEventListener("input", () => {
  outputNameTouched = true;
  clearInstallResult();
});
$("cli-files").addEventListener("change", updateMounts);
$("generate-install-qr").addEventListener("click", generateInstallQr);
$("cache-cert-info").addEventListener("change", () => {
  maybeInput("cache-cert-info")!.dataset.userTouched = "true";
  updateCertCacheUi();
});
$("clear-cert-cache").addEventListener("click", async () => {
  try {
    await deleteCachedCertInfo();
    cachedCertInfo = null;
    const cacheCheckbox = maybeInput("cache-cert-info");
    if (cacheCheckbox) {
      cacheCheckbox.checked = false;
      delete cacheCheckbox.dataset.userTouched;
    }
    updateCertCacheUi();
    setStatus("Cache Cleared", "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.textContent = message;
    setStatus("Error", "error");
  }
});
["install-fetch-url", "install-bundle-id", "install-name", "install-version"].forEach((id) => {
  maybeInput(id)?.addEventListener("input", clearInstallResult);
});

createIcons({ icons });
syncOutputName(true);
updateMounts();
loadCertCache();
