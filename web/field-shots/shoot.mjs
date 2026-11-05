// Screenshots of web/field.html in every state, at 1440x900 and 390x844.
//   node field-shots/shoot.mjs [baseUrl] [only-prefix]
// Needs the Vite dev server (npx vite) and Playwright (PLAYWRIGHT_DIR, default .apex/design/tools).
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(repo, ".apex/design/tools"));
const { chromium } = createRequire(path.join(pwDir, "package.json"))("playwright");
const base = process.argv[2] || "http://localhost:5191";
const only = process.argv[3] || "";

const SIZES = [
  { tag: "desktop", w: 1440, h: 900, dpr: 1 },
  { tag: "phone", w: 390, h: 844, dpr: 2 },
];
// name, query, then a script run after load, then wait ms
const STATES = [
  ["stare", "state=stare", null, 300],
  ["aim", "state=aim", null, 300],
  ["mid-wheel", "", "act.names(); act.stare(0); act.aim(3)", 700],
  ["pulse-yes", "state=aim", "act.yes()", 520],
  ["pulse-no", "state=aim", "act.no()", 520],
  ["construction", "state=construction", null, 300],
  ["red", "state=red", null, 300],
  ["your-doubt", "state=red", "act.yoursno()", 600],
  ["flinch", "state=aim", "act.flinch()", 330],
  ["reduced", "state=aim&reduced=1", "act.no()", 300],
  ["still", "state=aim", "act.still()", 200],
];

const browser = await chromium.launch();
const errors = [];
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dpr });
  for (const [name, query, script, wait] of STATES) {
    const file = `field-${s.tag}-${name}.png`;
    if (only && !file.includes(only)) continue;
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${file}: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`${file}: ${e.message}`));
    await page.goto(`${base}/field.html?ui=0&${query}`);
    await page.waitForFunction(() => window.ready === true);
    await page.waitForTimeout(250);
    if (script) await page.evaluate(script);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(here, file) });
    console.log("shot", file);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
if (errors.length) { console.log("console errors:\n" + errors.join("\n")); process.exitCode = 1; }
else console.log("console errors: none");
