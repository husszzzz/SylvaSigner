import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:45680"
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 45680 --strictPort",
    url: "http://127.0.0.1:45680",
    reuseExistingServer: false
  }
});
