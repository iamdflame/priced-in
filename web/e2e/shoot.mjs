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
  { name: "card-open", path: "/", wait: 4000, act: async (p) => {
    await p.evaluate(() => document.getElementById("the-page")?.scrollIntoView());
    const s = p.locator(".running .s[role=button]").nth(1);
    await s.click();
    await p.waitForTimeout(600);
  } },
  { name: "verify-panel", path: "/p/tether", wait: 4000, act: async (p) => {
    const c = p.locator('.running [data-chip="signed"]').first();
    await c.scrollIntoViewIfNeeded();
    await c.click();
    await p.locator("[data-verified]").waitFor({ timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(400);
  } },
  { name: "page", path: "/p/tether", wait: 6000 },
  { name: "page-text", path: "/p/tether", wait: 4000, act: async (p) => { await p.evaluate(() => document.getElementById("the-page")?.scrollIntoView()); await p.waitForTimeout(600); } },
  { name: "claim", path: "/c/6", wait: 6000 },
  { name: "post", path: "/jack/status/20", wait: 6000 },
  { name: "agents", path: "/agents", wait: 2500 },
  { name: "audit", path: "/audit", wait: 2500 },
  { name: "verify", path: "/verify/tether%3A2%3Av1?page=tether", wait: 8000 },
  { name: "notfound", path: "/nope/really/not", wait: 1500 },
  { name: "reduced", path: "/", wait: 1500, reduced: true },
];

const browser = await chromium.launch();
for (const vp of vps) {
  for (const s of shots) {
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
for (const [name, p] of [["og-home", "/?card=1"], ["og-page", "/p/tether?card=1"], ["og-claim", "/c/18?card=1"], ["og-post", "/jack/status/20?card=1"]]) {
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
