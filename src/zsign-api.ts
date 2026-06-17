import type { OutputFile, RunZsignOptions, RunZsignResult, SignIpaOptions, VirtualInputFile } from "./types";

type PendingRun = {
  resolve: (value: RunZsignResult) => void;
  reject: (reason?: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRun>();

function getWorker() {
  if (worker) return worker;

  worker = new Worker(new URL("./zsign-worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as {
      id: number;
      ok: boolean;
      result?: RunZsignResult;
      error?: string;
    };
    const run = pending.get(message.id);
    if (!run) return;
    pending.delete(message.id);
    if (message.ok && message.result) {
      run.resolve(message.result);
    } else {
      run.reject(new Error(message.error ?? "zsign worker failed"));
    }
  });
  worker.addEventListener("error", (event) => {
    for (const run of pending.values()) {
      run.reject(event.error ?? new Error(event.message));
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

export function runZsign(
  args: string[],
  files: VirtualInputFile[] = [],
  options: RunZsignOptions = {}
): Promise<RunZsignResult> {
  const id = nextId++;
  const request = { id, type: "run", args, files, options };

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

function safeName(name: string, fallback: string) {
  const cleaned = name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function pushIf(args: string[], condition: unknown, flag: string, value?: string) {
  if (!condition) return;
  args.push(flag);
  if (value !== undefined) args.push(value);
}

export function signIpa(options: SignIpaOptions): Promise<RunZsignResult> {
  const outputName = safeName(options.outputName || `signed-${options.ipa.name}`, "signed.ipa");
  const outputPath = `/output/${outputName.endsWith(".ipa") ? outputName : `${outputName}.ipa`}`;
  const metadataPath = "/output/metadata";
  const files: VirtualInputFile[] = [];
  const args: string[] = [];

  const ipaPath = "/blob/input.ipa";
  files.push({ path: ipaPath, file: options.ipa, mode: "workerfs" });

  pushIf(args, options.debug, "-d");
  pushIf(args, options.force, "-f");
  pushIf(args, options.quiet, "-q");
  pushIf(args, options.adhoc, "-a");
  pushIf(args, options.sha256Only, "-2");
  pushIf(args, options.weakDylib, "-w");
  pushIf(args, options.checkSignature, "-C");
  pushIf(args, options.install, "-i");
  pushIf(args, options.removeProvision, "-R");
  pushIf(args, options.enableDocuments, "-S");
  pushIf(args, options.removeExtensions, "-E");
  pushIf(args, options.removeWatch, "-W");
  pushIf(args, options.removeUISupportedDevices, "-U");

  if (!options.adhoc) {
    if (options.p12) {
      const path = "/blob/signing.p12";
      files.push({ path, file: options.p12, mode: "workerfs" });
      args.push("-k", path);
    } else if (options.privateKey) {
      const path = "/blob/private-key.pem";
      files.push({ path, file: options.privateKey, mode: "workerfs" });
      args.push("-k", path);
    }

    if (options.certificate) {
      const path = "/blob/certificate.cer";
      files.push({ path, file: options.certificate, mode: "workerfs" });
      args.push("-c", path);
    }

    options.profiles?.forEach((profile, index) => {
      const path = `/blob/profile-${index}.mobileprovision`;
      files.push({ path, file: profile, mode: "workerfs" });
      args.push("-m", path);
    });
  }

  if (options.entitlements) {
    const path = "/blob/entitlements.plist";
    files.push({ path, file: options.entitlements, mode: "workerfs" });
    args.push("-e", path);
  }

  options.dylibs?.forEach((dylib, index) => {
    const path = `/blob/dylib-${index}.dylib`;
    files.push({ path, file: dylib, mode: "workerfs" });
    args.push("-l", path);
  });

  options.removeDylibs?.filter(Boolean).forEach((name) => args.push("-D", name));

  pushIf(args, options.bundleId, "-b", options.bundleId);
  pushIf(args, options.bundleName, "-n", options.bundleName);
  pushIf(args, options.bundleVersion, "-r", options.bundleVersion);
  pushIf(args, options.minimumVersion, "-M", options.minimumVersion);
  pushIf(args, options.metadata, "-x", metadataPath);

  args.push("-z", String(options.zipLevel ?? 0));
  args.push("-o", outputPath);
  pushIf(args, options.password, "-p", options.password);
  args.push(ipaPath);

  return runZsign(args, files, {
    outputPaths: [outputPath],
    collectDirectories: options.metadata ? [metadataPath] : [],
    persistCache: true
  });
}

export function saveOutput(file: OutputFile) {
  const blob = new Blob([file.data], { type: file.type || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function splitCliArgs(input: string) {
  const args: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    args.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'])/g, "$1"));
  }
  return args;
}

