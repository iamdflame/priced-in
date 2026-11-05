// The judge's path on the hosted site, in a fresh browser profile, with a time for each step and a
// screenshot of each stage of the story:
//   the page says what it is and shows a flagged sentence with its odds; a no-wallet $1 bet goes
//   final on NEAR; the odds move; the page rewrites the sentence and the signature checks out in
//   the browser; an AI agent answers; the demo post link opens priced.
//   SITE_URL=https://isitpriced.com node scripts/vercel/judge-path.mjs [--phone] [--shots <dir>] [--no-bet]
// Each run without --no-bet spends one free $1 lane credit (a fresh key) on the network the site
// runs on: real USDC on mainnet, so run it sparingly there. Playwright comes from PLAYWRIGHT_DIR
// (default .apex/design/tools), as in web/e2e.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./env.mjs";

const site = (process.env.SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
const phone = process.argv.includes("--phone");
const NO_BET = process.argv.includes("--no-bet");
const si = process.argv.indexOf("--shots");
const shots = si > 0 ? path.resolve(process.argv[si + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(ROOT, ".apex/design/tools"));
const { chromium, devices } = createRequire(path.join(pwDir, "package.json"))("playwright");
const DEMO_POST = "/ilblackdragon/status/2118027843980366222";
let failed = 0;
const step = (name, ok, ms, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name} · ${ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`}${detail ? ` · ${detail}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const tag = phone ? "phone" : "desktop";
const shot = async (name, selector = null) => {
  if (!shots) return;
  const file = path.join(shots, `${name}-${tag}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path: file }).catch(() => page.screenshot({ path: file }));
  else await page.screenshot({ path: file });
};
const stage = () => page.evaluate(() => document.querySelector("#doubt-state")?.getAttribute("data-stage") ?? window.__pricedin?.store.state.doubt?.stage ?? null);
const stepState = (id) => page.evaluate((i) => document.querySelector(`[data-step-id="${i}"]`)?.getAttribute("data-state") ?? null, id);
const stepText = (id) => page.evaluate((i) => (document.querySelector(`[data-step-id="${i}"]`)?.textContent || "").replace(/\s+/g, " ").trim(), id);

try {
  // 1. the page says what it is, with a flagged sentence and its odds
  let t0 = Date.now();
  await page.goto(`${site}/`, { waitUntil: "domcontentloaded" });
  const flag = page.locator(".sheet .s.flag[data-sentence]");
  await flag.waitFor({ timeout: 30000 });
  const key = await flag.getAttribute("data-sentence");
  await page.waitForFunction(() => window.__pricedin?.mode === "live", null, { timeout: 20000 }).catch(() => {});
  const mode = await page.evaluate(() => window.__pricedin?.mode);
  const pill = (await page.locator("#netpill").textContent().catch(() => "")).trim();
  const h1 = (await page.locator(".hero h1").textContent()).trim();
  const headline = (await page.locator(".callout .headline").first().textContent()).trim();
  const before = Number(await page.locator(`.sheet [data-sentence="${key}"]`).first().getAttribute("data-price"));
  step("the page says what it is and flags a sentence with its odds", mode === "live" && /odds of being true/.test(h1) && before > 0, Date.now() - t0, `${mode}; "${pill}"; "${headline}"`);
  await shot("1-home");

  if (!NO_BET) {
    // 2. the free $1 key, asked for on the first sign of a person
    t0 = Date.now();
    await page.mouse.wheel(0, 30);
    await page.waitForFunction(() => window.__pricedin?.store.state.lane.state === "ready", null, { timeout: 30000 });
    step("the free $1 key is ready, no wallet", true, Date.now() - t0);

    // 3. the bet goes final, and the odds move
    t0 = Date.now();
    await page.locator('.callout [data-bet="no"]').first().click();
    await page.waitForFunction(() => ["optimistic", "final"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000, polling: 50 }).catch(() => {});
    const opt = Date.now() - t0;
    await page.waitForFunction(() => document.querySelector("#doubt-state")?.getAttribute("data-stage") === "final", null, { timeout: 60000, polling: 100 });
    const fin = Date.now() - t0;
    const after = Number(await page.locator(`.sheet [data-sentence="${key}"]`).first().getAttribute("data-price"));
    const tx = await page.evaluate(() => window.__pricedin.store.state.doubt?.ctx?.txHash ?? null);
    step("the $1 bet goes final on NEAR and the odds move", after < before, fin, `optimistic ${(opt / 1000).toFixed(1)} s; ${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%; tx ${tx}`);
    step("story step 1 and 2 read in plain words", /bet is in/i.test(await stepText("bet")) && /odds moved/i.test(await stepText("odds")), null, (await stepText("odds")).slice(0, 140));
    await shot("2-after-bet", ".sheet");

    // 4. the page rewrites the sentence; the signature checks out in the browser
    await page.waitForFunction(() => /Signature checks out/.test(document.querySelector('[data-step-id="rewrite"]')?.textContent || ""), null, { timeout: 150000, polling: 250 });
    step("the page rewrites the sentence, and the signature checks out", true, Date.now() - t0, (await stepText("rewrite")).slice(0, 220));
    await shot("3-after-rewrite", ".sheet");

    // 5. an AI agent answers
    const answered = await page.waitForFunction(() => { const s = document.querySelector('[data-step-id="answer"]'); return s && s.getAttribute("data-state") === "done"; }, null, { timeout: 120000, polling: 500 }).then(() => true, () => false);
    step("an AI agent answers", answered, answered ? Date.now() - t0 : null, (await stepText("answer")).slice(0, 220));
    await shot("4-after-answer", ".sheet");
  }

  // 6. the demo post opens priced
  t0 = Date.now();
  await page.goto(`${site}${DEMO_POST}`, { waitUntil: "domcontentloaded" });
  const pricedPost = await page.waitForFunction(() => document.querySelectorAll(".sheet [data-sentence][data-price]").length > 0, null, { timeout: 45000 }).then(() => true, () => false);
  step("the demo post opens priced", pricedPost, Date.now() - t0, `${await page.locator(".sheet [data-sentence][data-price]").count()} priced line(s)`);
  await shot("5-post");
} catch (e) {
  step("the path completed", false, null, String(e.message || e).split("\n")[0]);
  await shot("x-failure");
}
step("no errors in the browser console", errors.length === 0, null, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `${failed} step(s) failed` : "every step passed");
process.exit(failed ? 1 : 0);
