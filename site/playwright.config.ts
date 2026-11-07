import { defineConfig, devices } from "@playwright/test";

// E2E against a production build (npm run build first). Never spends money: the free-bet key request
// and every NEAR RPC call are intercepted in the live flow, and the replay sends nothing at all.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "e2e-results",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", actionTimeout: 20_000 },
  webServer: { command: "npm run start", url: BASE_URL, reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /flow.spec/ },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, testMatch: /layout\.spec/ },
    { name: "pages", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /pages\.spec/ },
    { name: "navigation", use: { ...devices["Desktop Chrome"] }, testMatch: /navigation.spec/ },
    { name: "widths", use: { ...devices["Desktop Chrome"] }, testMatch: /widths.spec/ },
    { name: "click", use: { ...devices["Desktop Chrome"] }, testMatch: /click.spec/ },
    // today's claims, picks, the board and reports (off by default; E2E_NEWS=on with tests/mock/api.mjs),
    // and the free $1's score, in either state
    // the official pages (off by default; E2E_PAGES=on with tests/mock/api.mjs and MOCK_PAGES=on), in either state
    { name: "official", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /official.spec/ },
    { name: "today", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /(today|score)\.spec/ },
    // judges use Safari: the main flows again in every engine
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } }, testMatch: /(flow|browsers).spec/ },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } }, testMatch: /(flow|browsers).spec/ },
    { name: "iphone", use: { ...devices["iPhone 14"] }, testMatch: /browsers.spec/ },
  ],
});
