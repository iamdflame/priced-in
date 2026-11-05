// Shots of the clarity design: home, article and post, before and after a bet, at 1440x900 and
// 390x844, each from a fresh browser profile. Prints console errors per shot.
//   node web/e2e/shoot-clarity.mjs <site url> <out dir> [--query recorded=1] [--only a,b] [--full]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(here, "../../.apex/design/tools"));
const { chromium } = createRequire(path.join(pwDir, "package.json"))("playwright");
const [site, out] = process.argv.slice(2);
const opt = (f) => { const i = process.argv.indexOf(`--${f}`); return i > 0 ? process.argv[i + 1] : null; };
const query = opt("query");
const only = opt("only")?.split(",") ?? null;
const full = process.argv.includes("--full");
const post = opt("post") ?? "/sample/status/1851";
fs.mkdirSync(out, { recursive: true });
const url = (p) => `${site}${p}${query ? (p.includes("?") ? "&" : "?") + query : ""}`;

const VP = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const settledStory = (p) => p.waitForFunction(() => ["rewritten", "answered", "failed"].includes(document.querySelector("#doubt-state")?.getAttribute("data-stage")), null, { timeout: 40000 }).catch(() => {});
const shots = [
  { name: "home", path: "/", wait: 2500 },
  { name: "home-after", path: "/", wait: 2500, act: async (p) => { await p.locator("[data-bet='no']").first().click(); await settledStory(p); await p.waitForTimeout(2500); }, el: "#sheet" },
  { name: "home-below", path: "/", wait: 2500, act: async (p) => { await p.evaluate(() => document.getElementById("how")?.scrollIntoView()); await p.waitForTimeout(1200); } },
  { name: "article", path: "/p/tether", wait: 3000 },
  { name: "article-open", path: "/p/tether", wait: 3000, act: async (p) => { const s = p.locator(".sheet [data-chip-for]").nth(2); await s.scrollIntoViewIfNeeded(); await s.click(); await p.waitForTimeout(800); } },
  { name: "article-after", path: "/p/tether", wait: 3000, act: async (p) => { const s = p.locator(".sheet [data-chip-for]").nth(2); await s.scrollIntoViewIfNeeded(); await s.click(); await p.locator("[data-bet='no']").first().click(); await settledStory(p); await p.waitForTimeout(2500); } },
  { name: "post", path: post, wait: 6000 },
  { name: "post-after", path: post, wait: 6000, act: async (p) => { const b = p.locator("[data-bet='no']").first(); if (await b.count()) { await b.click(); await settledStory(p); await p.waitForTimeout(2500); } } },
  { name: "agents", path: "/agents", wait: 2500 },
  { name: "audit", path: "/audit", wait: 1500 },
  { name: "notfound", path: "/nope/really/not", wait: 1500 },
];

const browser = await chromium.launch();
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  for (const vp of ["desktop", "phone"]) {
    const ctx = await browser.newContext(VP[vp]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    try {
      await page.goto(url(s.path), { waitUntil: "load" });
      await page.waitForTimeout(s.wait);
      if (s.act) await s.act(page);
      await page.screenshot({ path: path.join(out, `${s.name}-${vp}.png`), fullPage: full });
      if (s.el) await page.locator(s.el).screenshot({ path: path.join(out, `${s.name}-${vp}-sheet.png`) }).catch(() => {});
      console.log(`ok ${s.name}-${vp}${errs.length ? `  ERRORS: ${errs.slice(0, 3).join(" | ")}` : ""}`);
    } catch (e) {
      console.log(`FAIL ${s.name}-${vp}: ${e.message.split("\n")[0]}${errs.length ? `  ERRORS: ${errs.slice(0, 3).join(" | ")}` : ""}`);
    }
    await ctx.close();
  }
}
await browser.close();
