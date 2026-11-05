// Screenshots of every page and state, at 1440x900 and 390x844, for design review.
//   node web/e2e/shoot.mjs <site url> <out dir> [--only name,name] [--query recorded=1]
// Prints console errors per shot. Playwright from PLAYWRIGHT_DIR (default .apex/design/tools).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(repo, ".apex/design/tools"));
const { chromium } = createRequire(path.join(pwDir, "package.json"))("playwright");

const [site, out] = process.argv.slice(2);
const opt = (f) => { const i = process.argv.indexOf(`--${f}`); return i > 0 ? process.argv[i + 1] : null; };
const only = opt("only")?.split(",") ?? null;
const query = opt("query");
const vps = (opt("viewports") ?? "desktop,phone").split(",");
fs.mkdirSync(out, { recursive: true });
const url = (p) => `${site}${p}${query ? (p.includes("?") ? "&" : "?") + query : ""}`;

const VP = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 },
};

const shots = [
  { name: "home", path: "/", wait: 6500 },
  { name: "home-mid", path: "/", wait: 1150 },
  { name: "home-below", path: "/", wait: 4000, act: async (p) => { await p.evaluate(() => document.getElementById("the-page")?.scrollIntoView()); await p.waitForTimeout(800); } },
  { name: "doubt-mid", path: "/", wait: 5000, act: async (p) => { await p.locator(".ps .doubt").click(); await p.waitForTimeout(500); } },
  { name: "doubt-done", path: "/", wait: 5000, act: async (p) => { await p.locator(".ps .doubt").click(); await p.waitForFunction(() => ["final", "rewritten", "answered", "failed"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000 }); await p.waitForTimeout(1600); } },
  { name: "rewrite", path: "/", wait: 5000, act: async (p) => {
    await p.locator(".ps .doubt").click();
    await p.waitForFunction(() => ["rewritten", "answered", "failed"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1300);
  } },
  // the answered state: an agent's reply, injected by hand as a test event (the offline stack runs no agents)
  { name: "answered", path: "/", wait: 5000, act: async (p) => {
    await p.locator(".ps .doubt").click();
    await p.waitForFunction(() => ["final", "rewritten"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000 }).catch(() => {});
    await p.evaluate(() => {
      const st = window.__pricedin.store.state;
      const c = st.doubt.ctx;
      window.__pricedin.store.ingest({ seq: 99999, uid: "test-answer", event: "agent_rationale", source: "ai", data: { agent: "archivist", label: "archivist", house: true, account_id: "archivist.test", model: "test", claim_id: c.claimId, page: st.page.slug, side: "agree", size_usd: 0, text: "test", price_before: 0.2, price_after: null, credence: 0.2, rationale: "Test event for the screenshot: the attestation report lists a larger T-Bill figure.", source_url: "https://example.org/test", source_title: "example.org (test)", at: Date.now() } });
    });
    await p.waitForTimeout(1500);
  } },
  // a rewrite whose wording changes band, on a sentence that opens at 65%: the struck and printed words at hero size
  { name: "rewrite-claim", path: "/c/1", wait: 5000, act: async (p) => {
    await p.locator(".ps .doubt").click();
    await p.waitForFunction(() => ["rewritten", "answered", "failed"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2400);
  } },
  { name: "rewrite-mid", path: "/c/2", wait: 5000, act: async (p) => {
    await p.locator(".ps .doubt").click();
    await p.waitForFunction(() => ["rewritten", "answered", "failed"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(650);
  } },
  { name: "card-open", path: "/", wait: 4000, act: async (p) => {
    await p.evaluate(() => document.getElementById("the-page")?.scrollIntoView());
    const s = p.locator(".running .s[role=button]").nth(1);
    await s.click();
    await p.waitForTimeout(600);
  } },
  { name: "verify-panel", path: "/", wait: 5000, act: async (p) => {
    // live: doubt, then open the new rewrite's mark; recorded: the recorded rewrite's mark in the page
    let c = p.locator('.ps [data-chip="signed"]');
    if (!(await p.evaluate(() => window.__pricedin.mode === "recorded"))) {
      await p.locator(".ps .doubt").click();
      await c.waitFor({ timeout: 20000 });
    } else {
      c = p.locator('.running [data-chip="signed"]').first();
      await c.scrollIntoViewIfNeeded();
    }
    await c.click();
    await p.locator(".panel [data-verified]").waitFor({ timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(400);
  } },
  { name: "page", path: "/p/tether", wait: 6000 },
  { name: "page-text", path: "/p/tether", wait: 4000, act: async (p) => { await p.evaluate(() => document.getElementById("the-page")?.scrollIntoView()); await p.waitForTimeout(600); } },
  { name: "claim", path: "/c/6", wait: 6000 },
  { name: "post", path: "/sample/status/1851", wait: 6000 },
  { name: "post-gone", path: "/jack/status/20", wait: 3000 },
  { name: "agents", path: "/agents", wait: 2500 },
  { name: "audit", path: "/audit", wait: 2500 },
  { name: "verify", path: "/verify/tether%3A2%3Av4?page=tether", wait: 8000 },
  { name: "notfound", path: "/nope/really/not", wait: 1500 },
  { name: "reduced", path: "/", wait: 1500, reduced: true },
];

const browser = await chromium.launch();
// shot by shot, both sizes together: every doubt moves the shared stack, so desktop and phone see the same state
for (const s of shots) {
  for (const vp of vps) {
    if (only && !only.includes(s.name)) continue;
    const ctx = await browser.newContext({ ...VP[vp], reducedMotion: s.reduced ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    try {
      await page.goto(url(s.path), { waitUntil: "load" });
      await page.waitForTimeout(s.wait);
      if (s.act) await s.act(page);
      const file = path.join(out, `${s.name}-${vp}.png`);
      await page.screenshot({ path: file });
      console.log(`ok ${s.name}-${vp}${errs.length ? `  ERRORS: ${errs.slice(0, 3).join(" | ")}` : ""}`);
    } catch (e) {
      console.log(`FAIL ${s.name}-${vp}: ${e.message.split("\n")[0]}${errs.length ? `  ERRORS: ${errs.slice(0, 3).join(" | ")}` : ""}`);
    }
    await ctx.close();
  }
}
// the share cards, at 1200x630
for (const [name, p] of [["og-home", "/?card=1"], ["og-page", "/p/tether?card=1"], ["og-claim", "/c/18?card=1"], ["og-post", "/sample/status/1851?card=1"]]) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await ctx.newPage();
  await page.goto(url(p));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`ok ${name}`);
  await ctx.close();
}
await browser.close();
