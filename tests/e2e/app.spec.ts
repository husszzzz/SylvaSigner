import { expect, test } from "@playwright/test";

test("loads the local signing work surface without external network requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "zsign WASM" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign" })).toBeVisible();
  await expect(page.locator("#ipa")).toBeVisible();
  await expect(page.getByLabel("P12")).toBeVisible();
  await expect(page.getByLabel("Provisioning profiles")).toBeVisible();
  await expect(page.getByLabel("Dylib")).toBeVisible();
  await expect(page.locator("#profiles")).toHaveAttribute("multiple", "");
  await expect(page.locator("#dylibs")).toHaveAttribute("multiple", "");
  await expect(page.getByLabel("Cache cert info")).toBeVisible();
  await expect(page.locator("#bundle-id")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Install QR" })).toBeVisible();
  await expect(page.getByLabel("IPA fetch URL")).toBeVisible();
  await expect(page.locator("#run-cli")).toBeHidden();
  await expect(page.locator("#logs")).toBeVisible();
  expect(external).toEqual([]);
});

test("derives output name from selected IPA and keeps logs visible", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#ipa", "tests/fixtures/Example.ipa");
  await expect(page.locator("#output-name")).toHaveValue("Example_signed.ipa");

  await page.getByRole("button", { name: "Sign" }).click();
  await expect(page.locator("#logs")).toContainText("Choose a P12");
  await expect(page.locator("#status")).toContainText("Error");
});

test("generates palera install QR locally", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      external.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByLabel("IPA fetch URL").fill("https://files.example.com/Example_signed.ipa");
  await page.getByLabel("Install bundle ID").fill("com.example.local");
  await page.getByLabel("App name").fill("Example");
  await page.getByLabel("Version").fill("1.2.3");
  await page.locator("#generate-install-qr").click();

  await expect(page.locator("#install-qr")).toHaveAttribute("src", /^data:image\/png/);
  await expect(page.locator("#manifest-url")).toContainText(
    "https://api.palera.in/genPlist?bundleid=com.example.local&name=Example&version=1.2.3&fetchurl=https%3A%2F%2Ffiles.example.com%2FExample_signed.ipa"
  );
  await expect(page.locator("#install-link")).toHaveAttribute(
    "href",
    /itms-services:\/\/\?action=download-manifest&url=https%253A%252F%252Fapi\.palera\.in%252FgenPlist/
  );
  expect(external).toEqual([]);
});
