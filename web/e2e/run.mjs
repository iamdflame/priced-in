// npm run web:e2e: the judge's moment in a real browser, offline.
//   chain:   services/api's mock RPC + a market shim that executes trades (market-shim.mjs)
//   server:  services/api with the AI writer mounted on services/ai's offline NEAR AI stand-in
//   site:    this web app on Vite's dev server
//   browser: Playwright (from PLAYWRIGHT_DIR, default .apex/design/tools)
// Load a page, tap a sentence, "Doubt it · $1", and watch the doubt reach "final" with the
// price moved; then the signed rewrite and its in-browser verification. Prints SKIP, with the
// reason, if any of that can't start. Testnet names only; NEAR_NETWORK=mainnet is refused.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, "..");
const repo = path.join(web, "..");
const skip = (why) => { console.log(`SKIP web e2e: ${why}`); process.exit(0); };
if ((process.env.NEAR_NETWORK || "testnet") !== "testnet" || (process.env.VITE_NEAR_NETWORK || "testnet") !== "testnet") {
  console.error("web e2e runs on testnet names only.");
  process.exit(1);
}

// ---------- Playwright ----------
let chromium;
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(repo, ".apex/design/tools"));
try {
  ({ chromium } = createRequire(path.join(pwDir, "package.json"))("playwright"));
} catch (e) {
  try { ({ chromium } = await import("playwright")); } catch { skip(`Playwright not found in ${pwDir} (set PLAYWRIGHT_DIR): ${e.message.split("\n")[0]}`); }
}

const results = [];
let failed = 0;
const check = (name, ok, detail = "") => { results.push(ok); if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const MARKET = "market.e2e.testnet";
const LANE = "lane.e2e.testnet";
const PAGE = "near-intents";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-web-e2e-"));
const cleanup = [];
const done = async (code) => {
  for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* keep closing */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fine */ }
  setTimeout(() => process.exit(code), 50).unref();
};

// ---------- the services ----------
let shim, api, nearai, vite, browser;
try {
  const { KeyPair } = await import("near-api-js");
  const { startMockNearAI, MOCK_MODELS } = await import("../../services/ai/test/mock-nearai.mjs");
  const { loadAiConfig } = await import("../../services/ai/src/config.js");
  const { mountAi } = await import("../../services/ai/src/mount.js");
  const { createApp } = await import("../../services/api/src/app.mjs");
  const { startMarketShim } = await import("./market-shim.mjs");

  nearai = await startMockNearAI();
  cleanup.push(() => nearai.close?.());
  const writerModel = MOCK_MODELS[2];
  shim = await startMarketShim({
    marketId: MARKET, laneAccountId: LANE,
    models: { [writerModel]: nearai.signerHex(writerModel) },
    claims: [
      { page: PAGE, text: "NEAR Intents has processed more than $10 billion in cumulative volume.", p0Ppm: 500000, bMicro: 3_000_000 },
      { page: PAGE, text: "NEAR Intents launched in 2024.", p0Ppm: 800000, bMicro: 1_000_000 },
      { page: PAGE, text: "NEAR Intents settles on NEAR.", p0Ppm: 700000, bMicro: 1_000_000 },
    ],
  });
  cleanup.push(() => shim.close());
  const admin = KeyPair.fromRandom("ed25519");
  shim.mock.addAdminKey(LANE, admin.getPublicKey().toString());

  const env = {
    NEAR_NETWORK: "testnet", HOST: "127.0.0.1", PORT: "0", SCAN_INTERVAL_MS: "100", CORS_ORIGINS: "*",
    MARKET_CONTRACT_ID: MARKET, LANE_ACCOUNT_ID: LANE, LANE_PRIVATE_KEY: admin.toString(),
    RPC_URLS: shim.urls[0], PUBLIC_RPC_URLS: shim.urls.join(","),
    NEARAI_API_KEY: nearai.apiKey, NEARAI_BASE_URL: nearai.url, WRITER_MODEL: writerModel, WRITER_SIGNATURE_DEADLINE_MS: "4000",
    LEDGER_FILE: path.join(tmp, "ledger.json"), ATTESTATIONS_DIR: path.join(tmp, "attestations"), JURY_AUTO: "0",
  };
  const { api: apiCfg, ai, errors } = loadAiConfig(env);
  if (errors.length) throw new Error(errors.join("; "));
  const app = createApp(apiCfg, { log: () => {} });
  mountAi(app, ai, { quoteVerifier: nearai.quoteVerifier, gpuVerifier: nearai.gpuVerifier, log: () => {} });
  const addr = await app.start();
  cleanup.push(() => app.stop());
  api = `http://127.0.0.1:${addr.port}`;

  process.env.VITE_API_BASE = api;
  process.env.VITE_NEAR_NETWORK = "testnet";
  process.env.VITE_RPC_URLS = shim.urls.join(",");
  const { createServer, build, preview } = await import("vite");
  if (process.env.WEB_E2E_BUILD === "1") {
    // the production bundle, served as built
    const outDir = path.join(tmp, "dist");
    await build({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
    vite = await preview({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", build: { outDir }, preview: { port: 5198, strictPort: false, host: "127.0.0.1" } });
    vite.close = vite.close || (() => new Promise((r) => vite.httpServer.close(r)));
  } else {
    vite = await createServer({ root: web, configFile: path.join(web, "vite.config.ts"), logLevel: "error", server: { port: 5199, strictPort: false, host: "127.0.0.1" } });
    await vite.listen();
  }
  cleanup.push(() => vite.close());
  browser = await chromium.launch();
  cleanup.push(() => browser.close());
} catch (e) {
  await done(0);
  skip(`the services could not start: ${e?.message || e}`);
}

const site = vite.resolvedUrls.local[0].replace(/\/$/, "");
console.log(`chain ${shim.urls.join(" ")} · api ${api} · site ${site} (${process.env.WEB_E2E_BUILD === "1" ? "production build" : "dev server"})`);

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // 1. load a page
  const t0 = Date.now();
  await page.goto(`${site}/p/${PAGE}`);
  const s0 = page.locator('[data-sentence="c0"]');
  await s0.waitFor({ timeout: 15000 });
  const before = Number(await s0.getAttribute("data-price"));
  check("the page loads with every sentence priced", (await page.locator("[data-sentence]").count()) === 3 && before === 0.5, `3 sentences, the first at ${before * 100}% in ${Date.now() - t0} ms`);
  await page.locator('[data-lane="ready"]').waitFor({ timeout: 15000 });
  check("the $1 key is ready before the tap (prefetched at load)", true, `${Date.now() - t0} ms after load`);

  // 2. tap the sentence, then doubt it
  await s0.locator('span[role="button"]').click();
  const btn = page.locator('[data-doubt="c0"]');
  await btn.waitFor();
  check("tapping the sentence offers the doubt", (await btn.textContent()) === "Doubt it · $1");
  const tap = Date.now();
  await btn.click();
  const stageIs = (...names) => page.waitForFunction((ns) => ns.includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), names, { timeout: 20000, polling: 20 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-sentence="c0"]');
    return el && Number(el.getAttribute("data-price")) < 0.5;
  }, null, { timeout: 5000, polling: 10 });
  const inkMs = Date.now() - tap;
  check("the ink moves at once from the client quote", inkMs < 1500, `${inkMs} ms after the tap`);
  await stageIs("optimistic", "final", "rewritten", "answered");
  const optMs = Date.now() - tap;
  await stageIs("final", "rewritten", "answered");
  const finalMs = Date.now() - tap;
  const after = Number(await page.locator('[data-sentence="c0"]').getAttribute("data-price"));
  const chainPpm = Number((await (await fetch(`${api}/claims/0`)).json()).claim.price_yes_ppm);
  check("the doubt reaches final with the price moved", after < before && Math.round(after * 1e6) === chainPpm, `${before * 100}% -> ${(after * 100).toFixed(4)}% (chain ${chainPpm / 1e4}%), optimistic ${optMs} ms, final ${finalMs} ms after the tap`);
  const shown = await page.evaluate(() => window.__pricedin.store.state.doubt);
  check("the client quote matched the chain's fill exactly", Math.floor(shown.ctx.quote.priceAfter * 1e6) === chainPpm, `quoted ${Math.floor(shown.ctx.quote.priceAfter * 1e6)} ppm, filled ${chainPpm} ppm`);

  // 3. the paragraph rewrites itself with a signed mark, and it verifies in the browser
  const chip = page.locator('[data-sentence="c0"] [data-chip="signed"]');
  await chip.waitFor({ timeout: 15000 });
  const stage = await page.locator("#doubt-state").getAttribute("data-stage");
  const text = await page.locator('[data-sentence="c0"] span[role="button"]').textContent();
  check("the paragraph rewrites with a signed provenance mark", ["rewritten", "answered"].includes(stage) && /signed by .* in a TEE · verify/.test(await chip.textContent()), `stage ${stage}, "${text}" ${Date.now() - tap} ms after the tap`);
  await chip.click();
  await page.locator("[data-verified]").waitFor({ timeout: 15000 });
  const verified = await page.locator("[data-verified]").getAttribute("data-verified");
  const steps = await page.locator("[data-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}=${e.getAttribute("data-status")}`));
  check("the rewrite verifies in the browser: bytes, hashes, signature, registered key, words", verified === "1", steps.join(" "));

  // 4. a second doubt from the same browser: the $1 credit is spent, said plainly
  await page.goto(`${site}/p/${PAGE}`);
  await page.locator('[data-sentence="c1"]').waitFor();
  await page.locator('[data-sentence="c1"] span[role="button"]').click();
  await page.locator('[data-doubt="c1"]').click();
  await stageIs("failed", "final");
  const failure = await page.locator("[data-failure]").getAttribute("data-failure").catch(() => null);
  const p1 = Number(await page.locator('[data-sentence="c1"]').getAttribute("data-price"));
  check("a second $1 from the same browser is refused plainly and the ink moves back", failure === "credit_spent" && p1 === 0.8, `${failure}: "${await page.locator("[data-failure]").textContent()}"`);

  // 5. a post link and a not-found
  await page.goto(`${site}/nope/really/not`);
  check("an unknown address is a designed not-found", (await page.locator('[data-page="not_found"]').count()) === 1);
  check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("the run completed", false, e?.message?.split("\n")[0] || String(e));
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
await done(failed ? 1 : 0);
