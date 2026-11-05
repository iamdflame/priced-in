// The judge's path on the hosted site, in a fresh browser profile, with a time for each step:
// the page loads with prices, a no-wallet $1 doubt goes final, the signed rewrite appears and
// verifies in the browser, a house agent answers, and a post link opens priced.
//   SITE_URL=https://isitpriced.com node scripts/vercel/judge-path.mjs [--phone]
// Each run spends one free $1 lane credit on testnet (a fresh key). Playwright comes from
// PLAYWRIGHT_DIR (default .apex/design/tools), as in web/e2e.
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./env.mjs";

const site = (process.env.SITE_URL || "https://isitpriced.com").replace(/\/+$/, "");
const phone = process.argv.includes("--phone");
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(ROOT, ".apex/design/tools"));
const { chromium, devices } = createRequire(path.join(pwDir, "package.json"))("playwright");
const out = [];
let failed = 0;
const step = (name, ok, ms, detail = "") => { out.push({ name, ok, ms, detail }); if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name} · ${ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`}${detail ? ` · ${detail}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const net = [];
const started = Date.now();
page.on("response", (r) => { if (/\/api\/(lane|after-trade|health)/.test(r.url())) net.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()} at ${((Date.now() - started) / 1000).toFixed(1)} s`); });
page.on("requestfailed", (r) => { if (/\/api\//.test(r.url())) net.push(`FAILED ${new URL(r.url()).pathname} ${r.failure()?.errorText}`); });
const stageOf = () => page.evaluate(() => document.querySelector("#doubt-state")?.getAttribute("data-stage") ?? window.__pricedin?.store.state.doubt?.stage ?? null);
const waitStage = (names, timeout) => page.waitForFunction((ns) => ns.includes(document.querySelector("#doubt-state")?.getAttribute("data-stage") ?? window.__pricedin?.store.state.doubt?.stage), names, { timeout, polling: 100 });
console.log(`${site} · ${phone ? "phone (iPhone 13)" : "desktop 1440x900"} · fresh profile`);
try {
  // 1. the page loads with prices
  const t0 = Date.now();
  await page.goto(`${site}/`, { waitUntil: "commit", timeout: 90000 });
  const hero = page.locator(".ps[data-hero]");
  await hero.waitFor({ timeout: 90000 });
  const key = await hero.getAttribute("data-hero");
  await page.locator(`.running [data-sentence="${key}"][data-price]`).waitFor({ timeout: 30000 });
  const before = Number(await page.locator(`.running [data-sentence="${key}"]`).getAttribute("data-price"));
  const mode = await page.evaluate(() => window.__pricedin?.mode);
  const priced = await page.locator(".running [data-sentence][data-price]").count();
  step("the page loads with prices, live", mode === "live" && before > 0 && before < 1, Date.now() - t0, `${priced} priced sentences, the first screen's at ${(before * 100).toFixed(1)}%, mode ${mode}`);
  await page.waitForFunction(() => window.__pricedin?.store.state.lane.state === "ready", null, { timeout: 30000 });
  step("the free $1 key is ready (no wallet)", true, Date.now() - t0);

  // 2. a no-wallet $1 doubt goes final
  const btn = page.locator(`.ps [data-doubt="${key}"]`);
  await page.waitForFunction(() => document.querySelector(".ps .doubt")?.style.opacity === "1", null, { timeout: 15000 }).catch(() => {});
  const tap = Date.now();
  if (phone) await btn.tap(); else await btn.click();
  await waitStage(["optimistic", "final", "rewritten", "answered"], 30000);
  const opt = Date.now() - tap;
  await waitStage(["final", "rewritten", "answered"], 45000);
  const fin = Date.now() - tap;
  const doubt = await page.evaluate(() => window.__pricedin.store.state.doubt);
  const after = Number(await page.locator(`.running [data-sentence="${key}"]`).getAttribute("data-price"));
  step("the $1 doubt goes final", after < before, fin, `optimistic ${(opt / 1000).toFixed(1)} s; ${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%; tx ${doubt?.ctx?.txHash ?? doubt?.txHash ?? "?"}`);

  // 3. the signed rewrite appears and verifies
  // this doubt's own rewrite (the paragraph may already show an older signed one)
  await page.waitForFunction(() => window.__pricedin.store.state.doubt?.ctx?.rewrite?.status === "signed", null, { timeout: 150000, polling: 200 });
  const signedMs = Date.now() - tap;
  const rw = await page.evaluate(() => { const r = window.__pricedin.store.state.doubt.ctx.rewrite; return `${r.id} (${r.provenance?.model}): "${(r.sentences?.find((x) => x.claim_id === window.__pricedin.store.state.doubt.ctx.claimId)?.text ?? r.text).slice(0, 90)}"`; });
  step("this doubt's rewrite appears, signed in a TEE", true, signedMs, rw);
  // the verify panel from the visible "signed in a TEE · verify" mark; else the same check the panel runs (store.verify)
  const chip = page.locator('[data-chip="signed"]:visible').first();
  let verified = null, steps = [];
  if (await chip.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    if (phone) await chip.tap(); else await chip.click();
    if (await page.locator(".panel [data-verified]").waitFor({ timeout: 60000 }).then(() => true, () => false)) {
      verified = await page.locator(".panel [data-verified]").getAttribute("data-verified");
      steps = await page.locator(".panel [data-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-step")}=${e.getAttribute("data-status")}`));
    }
  }
  if (verified === null) {
    const r = await page.evaluate(async () => { const s = window.__pricedin.store; const rw = s.state.doubt.ctx.rewrite; const v = await s.verify(rw.page, rw.id); return v ? { ok: v.ok, steps: v.steps.map((x) => `${x.name ?? x.step ?? x.id}=${x.status}`) } : null; });
    verified = r?.ok ? "1" : "0"; steps = ["(store.verify)", ...(r?.steps || [])];
  }
  step("the rewrite verifies in the browser", verified === "1", Date.now() - tap, steps.join(" "));
  await page.keyboard.press("Escape").catch(() => {});

  // 4. a house agent answers
  await page.waitForFunction(() => window.__pricedin.store.state.doubt?.answer || window.__pricedin.store.state.doubt?.ctx?.answer || document.querySelector("#doubt-state")?.getAttribute("data-stage") === "answered", null, { timeout: 150000, polling: 250 });
  const ans = await page.evaluate(() => { const d = window.__pricedin.store.state.doubt; const r = d?.ctx?.answer ?? d?.answer; return r ? `${r.agent} (${r.model}): ${r.text}; source ${r.source_url}` : null; });
  step("a house agent answers", Boolean(ans), Date.now() - tap, ans ?? "");

  // 5. a post link opens priced
  const tp = Date.now();
  await page.goto(`${site}/jack/status/20`, { waitUntil: "commit", timeout: 90000 });
  await page.waitForFunction(() => { const s = window.__pricedin?.store.state.page; return s?.kind === "post" && !s.loading && s.sentences?.length > 0; }, null, { timeout: 45000, polling: 200 });
  const post = await page.evaluate(() => { const s = window.__pricedin.store.state.page; return s.sentences.map((x) => `${x.status}${x.chainPpm ? ` ${(x.chainPpm / 1e4).toFixed(1)}%` : x.receipt ? ` opens at ${(x.receipt.args.p0_ppm / 1e4).toFixed(0)}%` : ""}: ${x.original ?? x.text}`).join(" | "); });
  step("a post link (/jack/status/20) opens, each line priced or plainly not", post.length > 0, Date.now() - tp, post.slice(0, 200));
  step("no errors in the browser console", errors.length === 0, null, errors.slice(0, 2).join(" | "));
} catch (e) {
  step("the run completed", false, null, `${String(e.message).split("\n")[0]} (stage ${await stageOf().catch(() => "?")})`);
}
console.log(`\n${out.length - failed}/${out.length} steps passed`);
await page.screenshot({ path: path.join(ROOT, `.apex-test/judge-path-${phone ? "phone" : "desktop"}.png`) }).catch(() => {});
await browser.close();
process.exit(failed ? 1 : 0);
