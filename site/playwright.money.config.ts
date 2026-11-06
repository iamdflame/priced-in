import { defineConfig, devices } from "@playwright/test";

// The real-money e2e (tests/e2e/money): a mock wallet and a pretend chain, so nothing is signed and no
// money moves. Its own config so the money suite runs alone: npm run e2e:money (after npm run build).
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e/money",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e-results/money",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: { command: "npm run start", url: BASE_URL, reuseExistingServer: true, timeout: 60_000 },
});
