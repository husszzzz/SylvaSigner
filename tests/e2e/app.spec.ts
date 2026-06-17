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
  await expect(page.getByRole("heading", { name: "Sylva Signer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign IPA files locally with your own certificate." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign IPA" })).toBeDisabled();
  await expect(page.locator("#ipa")).toBeAttached();
  await expect(page.locator("#p12")).toBeAttached();
  await expect(page.locator("#profiles")).toHaveAttribute("multiple", "");
  await expect(page.locator("#dylibs")).toHaveAttribute("multiple", "");
  await expect(page.getByText("Cache certificate locally")).toBeVisible();
  await expect(page.locator("#bundle-id")).toBeVisible();
  await expect(page.getByText("Console")).toBeVisible();
  await expect(page.getByText("Install QR")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("derives output name from selected IPA and keeps live logs visible", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#ipa", "tests/fixtures/Example.ipa");
  await expect(page.locator("#output-name")).toHaveValue("Example_signed.ipa");
  await expect(page.getByText("Waiting for input. Drop your files and press Sign.")).toBeVisible();
});

test("opens privacy and legal pages from the footer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText("does not intentionally upload")).toBeVisible();

  await page.getByRole("link", { name: "Legal" }).click();
  await expect(page.getByRole("heading", { name: "Legal" })).toBeVisible();
  await expect(page.getByText("made by AntonP29")).toBeVisible();
  await expect(page.getByRole("link", { name: "Visit AntonP29 on GitHub" })).toBeVisible();
});
