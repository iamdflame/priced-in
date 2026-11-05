// npm run web:e2e: the judge's path through the real UI in a real browser, offline.
//   chain:   services/api's mock RPC + a market shim that executes trades (market-shim.mjs)
//   server:  services/api with the AI writer mounted on services/ai's offline NEAR AI stand-in
//   site:    this web app on Vite's dev server (WEB_E2E_BUILD=1: the production bundle)
//   browser: Playwright (from PLAYWRIGHT_DIR, default .apex/design/tools)
// Load the front page, bet $1 that its flagged sentence is wrong, and watch the four-step story:
// the bet final on NEAR, the odds moved, the signed rewrite verified in the browser, an agent waited for.
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
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  const priceOf = (key) => page.locator(`.sheet [data-sentence="${key}"]`).first().getAttribute("data-price").then(Number);
  const stageIs = (...names) => page.waitForFunction((ns) => ns.includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), names, { timeout: 20000, polling: 20 });

  // 1. the front page: what this is, and the flagged sentence with its odds and the two bets
  const t0 = Date.now();
  await page.goto(`${site}/`);
  await page.locator('.sheet .s.flag[data-sentence="c0"]').waitFor({ timeout: 15000 });
  const before = await priceOf("c0");
  const h1 = (await page.locator(".hero h1").textContent()).trim();
  const headline = (await page.locator(".callout .headline").textContent()).trim();
  check("the front page says what this is, flags a sentence and shows its odds", h1 === "Every sentence here has odds of being true." && before === 0.5 && headline === "A coin flip: 50% chance this is true.",
    `"${h1}" · "${headline}" in ${Date.now() - t0} ms`);
  const wins = (await page.locator(".callout .wins").first().textContent()).trim();
  check("the button says what $1 wins, from the contract's own quote", /^If it’s ruled wrong, you win \$\d+\.\d\d\. If not, you lose the free dollar\.$/.test(wins), wins);
  await page.waitForTimeout(1500);
  const idle = await page.evaluate(() => window.__pricedin?.store.state.lane.state);
  check("a page load alone spends no free key (it is asked for on the first sign of a person)", idle === "idle", `lane ${idle} 1.5 s after load, nothing touched`);
  await page.mouse.wheel(0, 40);
  await page.waitForFunction(() => window.__pricedin?.store.state.lane.state === "ready", null, { timeout: 15000 });
  check("the $1 key is ready before the tap (asked for on the first scroll)", true, `${Date.now() - t0} ms after load`);
  const pill = (await page.locator("#netpill").textContent()).trim();
  check("the site is live, and the pill names the network", (await page.evaluate(() => window.__pricedin.mode)) === "live" && pill === "Test money · NEAR testnet", pill);

  // 2. the bet is reachable by keyboard
  const btn = page.locator('.callout [data-bet="no"]');
  let tabs = 0;
  while (tabs < 30 && !(await btn.evaluate((b) => b === document.activeElement))) { await page.keyboard.press("Tab"); tabs++; }
  check("“Bet $1 it’s wrong” is reachable by keyboard", (await btn.evaluate((b) => b === document.activeElement)) && /Bet \$1 it’s wrong/.test(await btn.textContent()), `${tabs} tabs`);

  // 3. bet: the odds move at once, then the chain's price; the story says each step
  const tap = Date.now();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => Number(document.querySelector('.sheet [data-sentence="c0"]')?.getAttribute("data-price")) < 0.5, null, { timeout: 5000, polling: 10 });
  const inkMs = Date.now() - tap;
  check("the odds move at once from the client quote", inkMs < 1500, `${inkMs} ms after the tap`);
  await stageIs("optimistic", "final", "rewritten", "answered");
  const optMs = Date.now() - tap;
  await stageIs("final", "rewritten", "answered");
  const finalMs = Date.now() - tap;
  const after = await priceOf("c0");
  const chainPpm = Number((await (await fetch(`${api}/claims/0`)).json()).claim.price_yes_ppm);
  const s1 = (await page.locator('[data-step-id="bet"]').textContent()).replace(/\s+/g, " ");
  const s2 = (await page.locator('[data-step-id="odds"]').textContent()).replace(/\s+/g, " ");
  check("step 1, the bet is in: settled on NEAR, with the explorer link", /Your \$1 bet is in/.test(s1) && /settled on NEAR in \d+\.\d seconds/.test(s1) && (await page.locator('[data-step-id="bet"] a[href*="nearblocks.io/txns/"]').count()) === 1, `optimistic ${optMs} ms, final ${finalMs} ms`);
  check("step 2, the odds moved, with the shares in dollars, ending on the chip's number", after < before && Math.round(after * 1e6) === chainPpm && /50%→36%/.test(s2) && /you’d get \$\d+\.\d\d/.test(s2) && (await page.locator('[data-chip-for="c0"]').textContent()) === "36%",
    `${before * 100}% -> ${(after * 100).toFixed(4)}% (chain ${chainPpm / 1e4}%)`);
  const shown = await page.evaluate(() => window.__pricedin.store.state.doubt);
  check("the client quote matched the chain's fill exactly", Math.floor(shown.ctx.quote.priceAfter * 1e6) === chainPpm, `quoted ${Math.floor(shown.ctx.quote.priceAfter * 1e6)} ppm, filled ${chainPpm} ppm`);

  // 4. the rewrite, its diff, and its signature checked in this browser
  await page.locator('[data-step-id="rewrite"][data-state="done"]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /Signature checks out ✓/.test(document.querySelector('[data-step-id="rewrite"]')?.textContent || ""), null, { timeout: 15000 });
  const s3 = (await page.locator('[data-step-id="rewrite"]').textContent()).replace(/\s+/g, " ");
  check("step 3, the page rewrote the sentence: a diff, a model, and its signature checks out", (await page.locator('[data-step-id="rewrite"] .diff ins, [data-step-id="rewrite"] .diff del').count()) > 0 && /an AI model running on a sealed chip/.test(s3), s3.slice(0, 120));
  const chip = page.locator('[data-step-id="rewrite"] [data-chip="signed"]');
  await chip.click();
  await page.locator(".panel [data-verified]").waitFor({ timeout: 15000 });
  const verified = await page.locator(".panel [data-verified]").getAttribute("data-verified");
  const steps = await page.locator(".panel [data-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}=${e.getAttribute("data-status")}`));
  check("“verify it yourself” runs every check in the browser: bytes, hashes, signature, registered key, words", verified === "1", steps.join(" "));
  await page.keyboard.press("Escape");
  check("Escape closes the panel and focus returns to the link", await page.locator(".panel").evaluate((p) => p.hidden) && await chip.evaluate((c) => c === document.activeElement));
  const s4 = (await page.locator('[data-step-id="answer"]').textContent()).replace(/\s+/g, " ");
  check("step 4 waits for an agent in plain words", /is reading the sources…|answered/.test(s4), s4.slice(0, 80));

  // 5. a second $1 from the same browser, from the article: refused plainly, rolled back
  await page.goto(`${site}/p/${PAGE}`);
  const c1 = page.locator('.sheet [data-chip-for="c1"]');
  await c1.waitFor({ timeout: 15000 });
  await c1.click();
  await page.locator('.callout [data-bet="no"]').click();
  await stageIs("failed", "final");
  const failure = await page.locator("#doubt-state").getAttribute("data-failure");
  const p1 = await priceOf("c1");
  check("a second $1 from the same browser is refused plainly and the odds move back", failure === "credit_spent" && p1 === 0.8, `${failure}: "${(await page.locator('[data-step-id="bet"]').textContent()).replace(/\s+/g, " ").trim().slice(0, 90)}"`);

  // 6. a designed not-found, the recorded mode, and no console errors
  await page.goto(`${site}/nope/really/not`);
  await page.locator('[data-page="not_found"]').waitFor({ timeout: 5000 });
  check("an unknown address is a designed not-found", (await page.locator('[data-page="not_found"] h1').textContent()) === "Nothing here to price.");
  await page.goto(`${site}/?recorded=1`);
  await page.locator(".sheet .s.flag").waitFor({ timeout: 15000 });
  const rec = (await page.locator("#netpill").textContent()).trim();
  check("recorded mode says so plainly, and shows the recorded testnet page", /^Recorded/.test(rec) && (await page.locator(".sheet-title h2").textContent()) === "Tether" && (await page.evaluate(() => window.__pricedin.mode)) === "recorded", rec);
  check("no errors in the browser console", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("the run completed", false, e?.message?.split("\n")[0] || String(e));
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser?.close().catch(() => {});
await stack.stop();
setTimeout(() => process.exit(failed ? 1 : 0), 50).unref();
