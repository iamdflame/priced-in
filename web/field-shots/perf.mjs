// Frame times of the field at 390x844 (dpr 2) under 4x CPU throttling, through one load
// sequence: stare, wheel to the bowl, names, trades, a doubt, a flinch, idle breathing.
//   node field-shots/perf.mjs [baseUrl]
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(repo, ".apex/design/tools"));
const { chromium } = createRequire(path.join(pwDir, "package.json"))("playwright");
const base = process.argv[2] || "http://localhost:5191";
const W = Number(process.env.W || 390), H = Number(process.env.H || 844), DPR = Number(process.env.DPR || 2);
const RATE = Number(process.env.RATE || 4);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
await page.goto(`${base}/field.html?ui=0&state=stare`);
await page.waitForFunction(() => window.ready === true);
await page.waitForTimeout(500);
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
const out = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now(), on = true;
  const tick = (t) => { frames.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const marks = {};
  const phase = async (name, fn, ms) => { const a = frames.length; fn && fn(); await wait(ms); marks[name] = frames.slice(a); };
  await phase("idle (stare, breathing)", null, 2000);
  await phase("wheel to the bowl (aimAt, 3 beats)", () => act.aim(), 1600);
  await phase("trades (pulse yes, pulse no)", () => { act.yes(); setTimeout(() => act.no(), 400); }, 2000);
  await phase("your doubt (red, beam)", () => act.yoursno(), 1600);
  await phase("flinch", () => act.flinch(), 1200);
  await phase("idle (aimed, breathing)", null, 2000);
  on = false;
  return { all: frames, marks };
});
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) }; };
console.log(`viewport ${W}x${H} dpr ${DPR}, CPU throttle ${RATE}x`);
for (const [k, v] of Object.entries(out.marks)) console.log(k.padEnd(40), JSON.stringify(stat(v)));
console.log("whole sequence".padEnd(40), JSON.stringify(stat(out.all)));
await browser.close();
