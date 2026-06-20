import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("June 17th, 2026")).toBeVisible();
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
