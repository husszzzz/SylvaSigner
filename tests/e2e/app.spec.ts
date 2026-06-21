import { devices, expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import forge from "node-forge";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter
} from "@zip.js/zip.js";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = new Uint8Array()) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.length + 8);
  return chunk;
}

function syntheticCgbiIcon() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const bgraPixel = Buffer.from([0, 20, 90, 200, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("CgBI"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateRawSync(bgraPixel)),
    pngChunk("IEND")
  ]);
}

async function syntheticIpa() {
  const writer = new Uint8ArrayWriter();
  const zip = new ZipWriter(writer, { level: 1, useWebWorkers: false });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Sylva Test</string>
<key>CFBundleExecutable</key><string>SylvaTest</string>
<key>CFBundleIdentifier</key><string>dev.sylva.test</string>
<key>CFBundleName</key><string>SylvaTest</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFiles</key><array><string>AppIcon60x60</string></array>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`;
  await zip.add("Payload/SylvaTest.app/Info.plist", new TextReader(plist));
  await zip.add(
    "Payload/SylvaTest.app/AppIcon60x60@2x.png",
    new Uint8ArrayReader(syntheticCgbiIcon())
  );
  await zip.add(
    "Payload/SylvaTest.app/SylvaTest",
    new Uint8ArrayReader(readFileSync("vendor/zsign/test/dylib/bin/demo1.dylib")),
    { executable: true }
  );
  return zip.close();
}

function syntheticSigningFiles() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date("2026-01-01T12:00:00Z");
  certificate.validity.notAfter = new Date("2030-06-22T12:00:00Z");
  certificate.setSubject([{ name: "commonName", value: "Sylva Test Certificate" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], "sylva-test");
  const p12Bytes = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
  const profile = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>Sylva Development Profile</string>
<key>ExpirationDate</key><date>2030-07-23T12:00:00Z</date>
</dict></plist>`);
  return { p12Bytes, profile };
}

test("loads the exact Sylva signing work surface without external network requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hey there 👋" })).toBeVisible();
  await expect(page.getByText("June 21st, 2026")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Sylva Signer" })).toBeVisible();
  await expect(page.getByText("Fully local IPA signing in your browser")).toBeVisible();
  await expect(page.getByText("Private by design")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous IPAs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign IPA" })).toBeDisabled();
  await expect(page.locator("#ipa")).toBeAttached();
  await expect(page.locator("#p12")).toBeAttached();
  await expect(page.locator("#profiles")).toHaveAttribute("multiple", "");
  await expect(page.locator("#dylibs")).toHaveAttribute("multiple", "");
  await expect(page.getByText("Cache certificate locally")).toBeVisible();
  await expect(page.locator("#bundle-id")).toBeVisible();
  await expect(page.getByText("Console")).toBeVisible();
  await expect(page.getByText("Sylva Signer runs zsign as WebAssembly inside a dedicated browser worker.")).toBeVisible();
  await expect(page.getByText("Install QR")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("derives output name from selected IPA and keeps live logs visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.setInputFiles("#ipa", "tests/fixtures/Example.ipa");
  await expect(page.locator("#output-name")).toHaveValue("Example_signed.ipa");
  await expect(page.getByText("Waiting for input. Drop your files and press Sign.")).toBeVisible();
});

test("extracts app metadata and fills the bundle ID when an IPA is selected", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  const ipa = await syntheticIpa();
  await page.setInputFiles("#ipa", {
    name: "SylvaTest.ipa",
    mimeType: "application/zip",
    buffer: Buffer.from(ipa)
  });

  await expect(page.getByRole("heading", { name: "Sylva Test" })).toBeVisible();
  await expect(page.getByText("dev.sylva.test", { exact: true })).toBeVisible();
  await expect(page.locator("#bundle-id")).toHaveValue("dev.sylva.test");
  const icon = page.getByAltText("Sylva Test icon");
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("1.0", { exact: true })).toBeVisible();
});

test("shows certificate and provisioning expiration details locally", async ({ page }) => {
  const { p12Bytes, profile } = syntheticSigningFiles();
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  const ipa = await syntheticIpa();
  await page.setInputFiles("#ipa", {
    name: "SylvaTest.ipa",
    mimeType: "application/zip",
    buffer: Buffer.from(ipa)
  });
  await page.setInputFiles("#p12", {
    name: "sylva-test.p12",
    mimeType: "application/x-pkcs12",
    buffer: p12Bytes
  });
  await page.setInputFiles("#profiles", {
    name: "sylva-test.mobileprovision",
    mimeType: "application/octet-stream",
    buffer: profile
  });
  await page.locator("#cert-password").fill("sylva-test");

  await expect(page.getByText("Sylva Test Certificate", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jun 22, 2030", { exact: true })).toBeVisible();
  await expect(page.getByText("Sylva Development Profile", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jul 23, 2030", { exact: true })).toBeVisible();

  await page.locator("#cert-password").fill("temporarily-wrong");
  await expect(page.getByText("Sylva Test Certificate", { exact: true })).toBeVisible();
  await expect(page.getByText("Expires Jun 22, 2030", { exact: true })).toBeVisible();
});

test("opens privacy and legal pages from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("does not intentionally upload")).toBeVisible();

  await page.getByRole("link", { name: "Legal" }).click();
  await expect(page.getByRole("heading", { name: "Legal" })).toBeVisible();
  await expect(page.getByText("made by AntonP29")).toBeVisible();
  await expect(page.getByRole("link", { name: "Visit AntonP29 on GitHub" })).toBeVisible();
});

test("opens previous IPA history from the header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Previous IPAs" }).click();
  await expect(page.getByRole("heading", { name: "Previous IPAs" })).toBeVisible();
  await expect(page.getByText("No signed IPA history yet.")).toBeVisible();
});

test("retains an active install QR and app icon in previous IPAs", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("sylva-signer-ipa-history", JSON.stringify([{
      id: "active-entry",
      name: "SylvaTest_signed.ipa",
      signedAt: new Date().toISOString(),
      metadata: { appName: "Sylva Test", bundleId: "dev.sylva.test", version: "1.0" },
      iconDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      provider: "litterbox",
      uploadExpiry: "1h",
      uploadedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ipaUrl: "https://litter.catbox.moe/example.ipa",
      manifestUrl: "https://api.palera.in/example",
      installUrl: "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.test"
    }]));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Previous IPAs" }).click();

  await expect(page.getByText("Sylva Test", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Install Sylva Test QR code")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test.describe("mobile availability", () => {
  const iphone = devices["iPhone 13"];
  test.use({
    viewport: iphone.viewport,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
    userAgent: iphone.userAgent
  });

  test("shows the desktop requirement and signing workflow", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Desktop access required" })).toBeVisible();
    await expect(page.getByText("Sylva Signer is currently available only on desktop devices.")).toBeVisible();
    await expect(page.getByText("Select signing files")).toBeVisible();
    await expect(page.getByText("Sign locally in the browser")).toBeVisible();
    await expect(page.getByText("Optional iPhone installation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign IPA" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Legal" })).toBeVisible();
  });
});

test("initializes the low-memory OPFS zsign runtime in a worker", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const project = await root.getDirectoryHandle("sylva-zsign", { create: true });
    const work = await project.getDirectoryHandle("work", { create: true });
    await work.getDirectoryHandle(".zsign_cache", { create: true });

    const wasmBase = `${location.origin}/wasm`;
    const source = `
      self.onmessage = async () => {
        const logs = [];
        try {
          const imported = await import('${wasmBase}/zsign-opfs.mjs');
          const module = await imported.default({
            noInitialRun: true,
            locateFile: (file) => '${wasmBase}/' + file,
            print: (...parts) => logs.push(parts.map(String).join(' ')),
            printErr: (...parts) => logs.push(parts.map(String).join(' ')),
          });
          const exitCode = await module.ccall(
            'zsign_run_args',
            'number',
            ['string'],
            ['-a\\x1f/opfs/sylva-zsign/work/missing.ipa'],
            { async: true },
          );
          self.postMessage({ exitCode, logs });
        } catch (error) {
          self.postMessage({ error: error instanceof Error ? error.stack : String(error), logs });
        }
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), {
      type: "module"
    });
    return await new Promise<{ exitCode?: number; logs: string[]; error?: string }>((resolve) => {
      worker.onmessage = (event) => {
        worker.terminate();
        resolve(event.data);
      };
      worker.postMessage(null);
    });
  });

  expect(result.error).toBeUndefined();
  expect(result.exitCode).toBe(-1);
  expect(result.logs.join("\n")).toContain("Invalid path!");
});

test("streams IPA extraction before native zsign archiving", async ({ page }) => {
  await page.goto("/");
  const workerAsset = readdirSync("dist/assets").find((name) => name.startsWith("zsign-worker-"));
  expect(workerAsset).toBeTruthy();
  const ipa = await syntheticIpa();
  const result = await page.evaluate(
    async ({ workerUrl, bytes }) => {
      const worker = new Worker(workerUrl, { type: "module" });
      const file = new File([new Uint8Array(bytes)], "Synthetic.ipa", { type: "application/zip" });
      return new Promise<{
        exitCode?: number;
        logs: string[];
        outputSize?: number;
        outputIsBlob?: boolean;
        outputBytes?: number[];
        progress: string[];
        error?: string;
      }>((resolve) => {
        const logs: string[] = [];
        const progress: string[] = [];
        worker.onmessage = async (event) => {
          const message = event.data;
          if (message.type === "log") logs.push(message.line);
          if (message.type === "progress") progress.push(message.progress.phase);
          if (message.type !== "done") return;
          worker.terminate();
          const output = message.result?.outputs?.[0];
          const outputBytes =
            output?.data instanceof Blob
              ? Array.from(new Uint8Array(await output.data.arrayBuffer()))
              : output?.data instanceof ArrayBuffer
                ? Array.from(new Uint8Array(output.data))
                : undefined;
          resolve({
            exitCode: message.result?.exitCode,
            logs,
            outputSize: output?.data instanceof Blob ? output.data.size : output?.data?.byteLength,
            outputIsBlob: output?.data instanceof Blob,
            outputBytes,
            progress,
            error: message.error
          });
        };
        worker.postMessage({
          id: 1,
          type: "run",
          args: ["-a", "-z", "1", "-o", "/output/Synthetic_signed.ipa", "/blob/input.ipa"],
          files: [{ path: "/blob/input.ipa", file, mode: "workerfs" }],
          options: {
            outputPaths: ["/output/Synthetic_signed.ipa"],
            persistCache: false,
            storageMode: "memory"
          }
        });
      });
    },
    { workerUrl: `/assets/${workerAsset}`, bytes: Array.from(ipa) }
  );

  expect(result.error).toBeUndefined();
  expect(result.exitCode).toBe(0);
  expect(result.outputIsBlob).toBe(false);
  expect(result.outputSize).toBeGreaterThan(0);
  expect(result.logs.join("\n")).toContain("Unzip OK!");
  expect(result.logs.join("\n")).toContain("Archive OK!");
  expect(result.progress).toContain("extract");
  expect(result.progress).not.toContain("archive");

  const archive = new ZipReader(new Uint8ArrayReader(new Uint8Array(result.outputBytes!)));
  const entries = await archive.getEntries();
  await archive.close();
  expect(entries[0]).toMatchObject({ filename: "Payload/", directory: true });
  expect(entries.some((entry) => entry.directory)).toBe(true);
  expect(entries.every((entry) => !entry.zip64)).toBe(true);
  expect(entries.every((entry) => entry.msDosCompatible)).toBe(true);
  expect(entries.every((entry) => !entry.filenameUTF8)).toBe(true);
  const firstHeader = new DataView(new Uint8Array(result.outputBytes!).buffer);
  expect(firstHeader.getUint32(0, true)).toBe(0x04034b50);
  expect(firstHeader.getUint16(6, true) & 0x808).toBe(0);
});
