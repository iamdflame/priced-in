// The judge's path on the hosted site (site/), in a fresh browser profile, with a time for each step
// and a screenshot of each stage:
//   the home page says what it is and leads with a fact and its odds; the fact's page quotes what a
//   free $1 gets back; the $1 settles on NEAR and the odds move; the sentence is rewritten and its
//   signature checks out in the browser; an AI trader replies; a post on X opens priced.
//   SITE_URL=https://isitpriced.com node scripts/vercel/judge-path.mjs [--phone] [--shots <dir>] [--no-bet]
// The selectors are the ones the site's own e2e uses (site/tests/e2e/flow.spec.ts): the confirm,
// settled and sig-ok test ids, the lead's .feature a.bet links, and the receipt dialog.
// Each run without --no-bet spends one free $1 lane credit (a fresh key) on the network the site runs
// on: real USDC on mainnet, so run it sparingly there. --no-bet stops at the quote and sends nothing.
// With Today's claims on, the tap is a free pick first, so every run, --no-bet included, also saves
// one free pick (no money) from its fresh key on the lead fact: it shows in that fact's pick count.
// Playwright is the site's own (npm run site:install, then npx --prefix site playwright install
// chromium); PLAYWRIGHT_DIR points at another install.
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
const pwDir = path.resolve(process.env.PLAYWRIGHT_DIR || path.join(ROOT, "site"));
const pwReq = createRequire(path.join(pwDir, "package.json"));
const { chromium, devices } = (() => { try { return pwReq("@playwright/test"); } catch { return pwReq("playwright"); } })();
const DEMO_POST = "/ilblackdragon/status/2118027843980366222";
let failed = 0;
// FAIL counts against the run; NOTE is a real state of the product worth reading (no rewrite this time)
const step = (name, ok, ms, detail = "") => {
  const st = ok === "note" ? "NOTE" : ok ? "PASS" : "FAIL";
  if (st === "FAIL") failed++;
  console.log(`${st} ${name} · ${ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`}${detail ? ` · ${detail}` : ""}`);
};
const squash = (s) => (s || "").replace(/\s+/g, " ").trim();

const browser = await chromium.launch();
// the same viewports as the site's e2e: Desktop Chrome at 1440 x 900, Pixel 7 at 390 x 844
const ctx = await browser.newContext(phone ? { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const tag = phone ? "phone" : "desktop";
const shot = async (name, locator = null) => {
  if (!shots) return;
  const file = path.join(shots, `${name}-${tag}.png`);
  if (locator) await locator.first().screenshot({ path: file }).catch(() => page.screenshot({ path: file }));
  else await page.screenshot({ path: file });
};

try {
  // 1. the home page says what it is, and leads with a fact and its odds (Today's claims, when news is
  //    on, sit above it in their own .feature.tlead; the encyclopedia's lead is the other .feature)
  let t0 = Date.now();
  await page.goto(`${site}/`, { waitUntil: "domcontentloaded" });
  const h1 = page.getByRole("heading", { level: 1, name: "Bet on whether facts are true." });
  await h1.waitFor({ timeout: 30000 });
  const lead = page.locator("section.feature:not(.tlead)").first();
  const question = squash(await lead.locator("#lead-q").textContent());
  const odds = (await lead.getByRole("img", { name: /% chance it’s true$/ }).first().getAttribute("aria-label")) || "";
  const no = lead.locator("a.bet.no").first();
  const canBet = await no.isVisible();
  step("the home page says what it is and leads with a fact and its odds", /^\d+% chance/.test(odds) && canBet, Date.now() - t0, `"${question}" at ${odds.replace(" chance it’s true", "")}`);
  await shot("1-home");

  // 2. the fact's page: No is picked, and it says what the free $1 gets back
  t0 = Date.now();
  await no.click();
  // with Today's claims on, a tap is a free pick first, and its tray leads to the same ticket with the
  // side picked (site/tests/e2e/flow.spec.ts); with news off, the tap is the ticket's own link
  const toTicket = page.waitForURL(/\/c\/\d+\?side=no$/, { timeout: 30000 });
  const back = page.getByRole("complementary", { name: "Your pick" }).getByRole("link", { name: "Back it with your free $1" });
  const tray = back.waitFor({ state: "visible", timeout: 30000 }).then(() => "tray", () => null);
  if ((await Promise.race([toTicket.then(() => "ticket"), tray])) === "tray") await back.click();
  await toTicket;
  const claimId = Number(/\/c\/(\d+)/.exec(page.url())[1]);
  const pickNo = page.getByRole("button", { name: /No, it’s false/ }).first();
  await page.waitForFunction(() => document.querySelector(".ticket .seg .n")?.getAttribute("aria-pressed") === "true", null, { timeout: 20000 }).catch(() => {});
  const picked = (await pickNo.getAttribute("aria-pressed")) === "true";
  // the quote is the contract's fill (site/lib/core/lmsr.ts), on the No button at every width
  const quoted = await page.waitForFunction(() => /\$1 becomes \$\d+\.\d\d/.test(document.querySelector(".ticket .seg .n")?.textContent || ""), null, { timeout: 20000 }).then(() => true, () => false);
  const confirm = page.getByTestId("confirm");
  const ready = quoted && await confirm.isEnabled().catch(() => false);
  step("the fact's page quotes what a free $1 gets back, no wallet", picked && ready, Date.now() - t0, `/c/${claimId}: ${squash(await confirm.textContent().catch(() => ""))}; ${squash(await page.locator(".ticket .seg .n").textContent().catch(() => "")).replace("false", "false: ")}`);
  await shot("2-market");

  if (!NO_BET) {
    // 3. the $1 settles on NEAR, and the odds move
    t0 = Date.now();
    await confirm.click();
    const receipt = page.getByRole("dialog", { name: /You bet \$1 that it’s false/ });
    await receipt.waitFor({ timeout: 60000 });
    await receipt.getByTestId("settled").waitFor({ timeout: 90000 });
    const fin = Date.now() - t0;
    const settled = squash(await receipt.getByTestId("settled").textContent());
    const move = (await receipt.locator(".big-move").getAttribute("aria-label")) || "";
    const [, from, to] = /(\d+)% to (\d+)%/.exec(move) || [];
    const tx = await receipt.locator("a.hashv").getAttribute("href").catch(() => null);
    step("the $1 bet settles on NEAR and the odds move", Boolean(tx) && Number(to) <= Number(from), fin, `${settled}; ${from}% -> ${to}%; ${tx}`);
    await shot("3-receipt", receipt);

    // 4. the sentence is rewritten, and its signature checks out in this browser
    const rewrite = await Promise.race([
      receipt.getByTestId("sig-ok").waitFor({ timeout: 150000 }).then(() => "signed"),
      receipt.getByText(/No rewrite this time/).waitFor({ timeout: 150000 }).then(() => "none"),
    ]).catch(() => "timeout");
    const panel = squash(await receipt.getByRole("region", { name: "The sentence, rewritten" }).textContent().catch(() => ""));
    step("the sentence is rewritten, and its signature checks out in the browser", rewrite === "signed" ? true : rewrite === "none" ? "note" : false, Date.now() - t0, panel.slice(0, 220));
    await shot("4-rewrite", receipt);

    // 5. an AI trader replies
    const reply = await Promise.race([
      receipt.getByRole("heading", { name: /an AI trader, replied/ }).waitFor({ timeout: 120000 }).then(() => "replied"),
      receipt.getByText(/No AI trader has answered yet/).waitFor({ timeout: 120000 }).then(() => "none"),
    ]).catch(() => "timeout");
    const said = squash(await receipt.getByRole("region", { name: "An AI trader’s reply" }).textContent().catch(() => ""));
    step("an AI trader replies", reply === "replied" ? true : reply === "none" ? "note" : false, Date.now() - t0, said.slice(0, 220));
    await shot("5-reply", receipt);
    await receipt.getByRole("button", { name: "Close the receipt" }).click().catch(() => {});
  }

  // 6. a post on X opens priced: x.com changed to the site's domain
  t0 = Date.now();
  await page.goto(`${site}${DEMO_POST}`, { waitUntil: "domcontentloaded" });
  const head = page.getByRole("heading", { level: 2, name: /checkable lines?, priced$|Nothing here to bet on/ });
  const opened = await head.waitFor({ timeout: 45000 }).then(() => true, () => false);
  const said = opened ? squash(await head.textContent()) : squash(await page.locator("main").textContent().catch(() => "")).slice(0, 160);
  step("the demo post opens priced", opened && /priced$/.test(said), Date.now() - t0, said);
  await shot("6-post");
} catch (e) {
  step("the path completed", false, null, String(e.message || e).split("\n")[0]);
  await shot("x-failure");
}
step("no errors in the browser console", errors.length === 0, null, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `${failed} step(s) failed` : `every step passed${NO_BET ? " (--no-bet: nothing was sent)" : ""}`);
process.exit(failed ? 1 : 0);
