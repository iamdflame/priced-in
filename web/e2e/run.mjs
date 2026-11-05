// npm run web:e2e: the judge's path through the real UI in a real browser, offline.
//   chain:   services/api's mock RPC + a market shim that executes trades (market-shim.mjs)
//   server:  services/api with the AI writer mounted on services/ai's offline NEAR AI stand-in
//   site:    this web app on Vite's dev server (WEB_E2E_BUILD=1: the production bundle)
//   browser: Playwright (from PLAYWRIGHT_DIR, default .apex/design/tools)
// Load the front page, doubt its sentence with "Doubt it · $1", watch the ink move, the bet reach
// final, the paragraph rewrite itself with a signed mark, and that mark verify in the browser.
// Prints SKIP, with the reason, if any of that can't start. Testnet names only.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startStack } from "./stack.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const skip = (why) => { console.log(`SKIP web e2e: ${why}`); process.exit(0); };
if ((process.env.NEAR_NETWORK || "testnet") !== "testnet" || (process.env.VITE_NEAR_NETWORK || "testnet") !== "testnet") {
  console.error("web e2e runs on testnet names only.");
  process.exit(1);
}

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

const PAGE = "near-intents";
let stack, browser;
try {
  stack = await startStack({
    build: process.env.WEB_E2E_BUILD === "1",
    claims: [
      { page: PAGE, text: "NEAR Intents has processed more than $10 billion in cumulative volume.", p0Ppm: 500000, bMicro: 3_000_000 },
      { page: PAGE, text: "NEAR Intents launched in 2024.", p0Ppm: 800000, bMicro: 1_000_000 },
      { page: PAGE, text: "NEAR Intents settles on NEAR.", p0Ppm: 700000, bMicro: 1_000_000 },
    ],
  });
  browser = await chromium.launch();
} catch (e) {
  await stack?.stop();
  skip(`the services could not start: ${e?.message || e}`);
}
const { site, api } = stack;
console.log(`chain ${stack.shim.urls.join(" ")} · api ${api} · site ${site} (${process.env.WEB_E2E_BUILD === "1" ? "production build" : "dev server"})`);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const priceOf = (key) => page.locator(`.running [data-sentence="${key}"]`).getAttribute("data-price").then(Number);
  const stage = () => page.locator("#doubt-state").getAttribute("data-stage");
  const stageIs = (...names) => page.waitForFunction((ns) => ns.includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), names, { timeout: 20000, polling: 20 });

  // 1. the front page: the Point Source first screen on the live page, every sentence priced
  const t0 = Date.now();
  await page.goto(`${site}/`);
  await page.locator('.ps[data-hero="c0"]').waitFor({ timeout: 15000 });
  await page.locator('.running [data-sentence="c0"]').waitFor({ timeout: 15000 });
  const before = await priceOf("c0");
  const label = await page.locator(".ps .sr-text").textContent();
  // the page shows each line's latest wording: the writer may already have rewritten it
  // the first screen shows the line as written
  const c0Text = await page.evaluate(() => window.__pricedin.store.state.page.sentences.find((x) => x.key === "c0").original);
  check("the front page opens on the sentence, priced, with the page below", (await page.locator(".running [data-sentence]").count()) === 3 && before === 0.5 && /NEAR Intents has processed/i.test(label) && label.startsWith(c0Text),
    `hero c0 "${label.slice(0, 60)}…", 3 sentences, the first at ${before * 100}% in ${Date.now() - t0} ms`);
  await page.waitForFunction(() => window.__pricedin?.store.state.lane.state === "ready", null, { timeout: 15000 });
  check("the $1 key is ready before the tap (prefetched at load)", true, `${Date.now() - t0} ms after load`);
  check("the site is live, not recorded", (await page.evaluate(() => window.__pricedin.mode)) === "live" && !(await page.locator(".ps .label .rec").count()));

  // 2. the action is reachable by keyboard and offers the doubt
  const btn = page.locator('.ps [data-doubt="c0"]');
  await page.waitForFunction(() => document.querySelector(".ps .doubt")?.style.opacity === "1", null, { timeout: 8000 });
  let tabs = 0;
  while (tabs < 12 && !(await btn.evaluate((b) => b === document.activeElement))) { await page.keyboard.press("Tab"); tabs++; }
  check("“Doubt it · $1” sits beside the price and is reachable by keyboard", (await btn.textContent()) === "Doubt it · $1" && (await btn.evaluate((b) => b === document.activeElement)), `${tabs} tabs`);

  // 3. doubt it: the ink moves at once, then the chain's price
  const tap = Date.now();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => Number(document.querySelector('.running [data-sentence="c0"]')?.getAttribute("data-price")) < 0.5, null, { timeout: 5000, polling: 10 });
  const inkMs = Date.now() - tap;
  check("the ink moves at once from the client quote", inkMs < 1500, `${inkMs} ms after the tap`);
  await stageIs("optimistic", "final", "rewritten", "answered");
  const optMs = Date.now() - tap;
  await stageIs("final", "rewritten", "answered");
  const finalMs = Date.now() - tap;
  const after = await priceOf("c0");
  const chainPpm = Number((await (await fetch(`${api}/claims/0`)).json()).claim.price_yes_ppm);
  const words = await page.locator("#doubt-state").textContent();
  check("the doubt reaches final, the price moved, said in plain words", after < before && Math.round(after * 1e6) === chainPpm && /You moved this line from 50% to 36%/.test(words) && (await btn.textContent()) === "Priced.",
    `${before * 100}% -> ${(after * 100).toFixed(4)}% (chain ${chainPpm / 1e4}%), optimistic ${optMs} ms, final ${finalMs} ms; "${words.trim().slice(0, 70)}"`);
  const shown = await page.evaluate(() => window.__pricedin.store.state.doubt);
  check("the client quote matched the chain's fill exactly", Math.floor(shown.ctx.quote.priceAfter * 1e6) === chainPpm, `quoted ${Math.floor(shown.ctx.quote.priceAfter * 1e6)} ppm, filled ${chainPpm} ppm`);
  check("the numeral and the bowl follow the price", (await page.locator(".ps .price .pn").textContent()).trim() === "36");

  // 4. the paragraph rewrites itself with a signed mark, on the first screen and in the page
  const chip = page.locator('.ps [data-chip="signed"]');
  await chip.waitFor({ timeout: 15000 });
  await stageIs("rewritten", "answered");
  await page.waitForTimeout(1600); // the strike, then the new words (the same words when the band didn't change)
  const st = await stage();
  const heroText = await page.locator(".ps .sr-text").textContent();
  const rewritten = await page.evaluate(() => window.__pricedin.store.state.doubt.ctx.rewrite.sentences.find((x) => x.claim_id === 0)?.text);
  check("the sentence rewrites with a signed provenance mark", ["rewritten", "answered"].includes(st) && heroText.startsWith(rewritten) && /^signed in a TEE · verify, by .+/.test(await chip.textContent()) && (await page.locator('.running [data-chip="signed"]').count()) === 1,
    `stage ${st}, "${heroText.slice(0, 90)}" ${Date.now() - tap} ms after the tap`);

  // 5. the mark opens the verify panel: every check runs in the browser
  await chip.click();
  await page.locator(".panel [data-verified]").waitFor({ timeout: 15000 });
  const verified = await page.locator(".panel [data-verified]").getAttribute("data-verified");
  const steps = await page.locator(".panel [data-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}=${e.getAttribute("data-status")}`));
  check("the rewrite verifies in the browser: bytes, hashes, signature, registered key, words", verified === "1", steps.join(" "));
  await page.keyboard.press("Escape");
  check("Escape closes the panel and focus returns to the mark", await page.locator(".panel").evaluate((p) => p.hidden) && await chip.evaluate((c) => c === document.activeElement));

  // 6. a second doubt from the same browser, from the page's reading card: refused plainly, rolled back
  await page.goto(`${site}/p/${PAGE}`);
  const c1 = page.locator('.running [data-sentence="c1"]');
  await c1.waitFor();
  await c1.click();
  const cardBtn = page.locator('.card [data-doubt="c1"]');
  await cardBtn.waitFor();
  const cardText = await page.locator(".card").textContent();
  check("tapping a sentence opens its reading card: price, cost to move 10 points, the doubt", /80/.test(cardText) && /to move it 10 points/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 90));
  await cardBtn.click();
  await page.waitForFunction(() => ["failed", "final"].includes(document.querySelector(".card .status")?.getAttribute("data-stage")), null, { timeout: 20000 });
  const failure = await page.locator(".card .status").getAttribute("data-failure");
  const p1 = await priceOf("c1");
  check("a second $1 from the same browser is refused plainly and the ink moves back", failure === "credit_spent" && p1 === 0.8, `${failure}: "${(await page.locator(".card .status").textContent()).trim()}"`);

  // 7. a designed not-found, the recorded mode, and no console errors
  await page.goto(`${site}/nope/really/not`);
  await page.locator('[data-page="not_found"]').waitFor({ timeout: 5000 });
  check("an unknown address is a designed not-found", (await page.locator('[data-page="not_found"] h1').textContent()) === "Nothing here to price.");
  await page.goto(`${site}/?recorded=1`);
  await page.locator(".ps[data-hero]").waitFor({ timeout: 15000 });
  const rec = await page.locator(".ps .label").textContent();
  check("recorded mode says so plainly, and shows the recorded testnet page", /Recorded on NEAR testnet/.test(rec) && /Tether/.test(rec) && (await page.evaluate(() => window.__pricedin.mode)) === "recorded", rec.trim().slice(0, 90));
  check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("the run completed", false, e?.message?.split("\n")[0] || String(e));
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser?.close().catch(() => {});
await stack.stop();
setTimeout(() => process.exit(failed ? 1 : 0), 50).unref();
