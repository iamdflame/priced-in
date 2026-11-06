import { defineConfig, devices } from "@playwright/test";

// E2E against a production build (npm run build first). Never spends money: the free-bet key request
// and every NEAR RPC call are intercepted in the live flow, and the replay sends nothing at all.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e-results",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: { command: "npm run start", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /flow.spec/ },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, testMatch: /layout\.spec/ },
  ],
});
