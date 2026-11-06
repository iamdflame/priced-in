// Shoots the receipt (the screenshot moment) in the replay, which sends nothing: desktop 1440x900 and
// phone 390x844, dark and light, after the signed rewrite and the AI trader's reply have arrived.
//   node scripts/shoot-receipt.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] || "receipt-shots";
const base = process.argv[3] || "http://localhost:3100";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const views = { desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
for (const theme of ["dark", "light"]) {
  for (const [name, v] of Object.entries(views)) {
    const ctx = await browser.newContext(v);
    const page = await ctx.newPage();
    await page.goto(`${base}/c/18?recorded=1&theme=${theme}`);
    await page.getByRole("button", { name: /No, it’s false/ }).first().click();
    await page.getByTestId("confirm").click();
    await page.getByTestId("sig-ok").waitFor({ timeout: 40_000 });
    await page.getByText(/an AI trader, replied/).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const file = path.join(out, `${theme}-receipt__${name}.png`);
    await page.screenshot({ path: file });
    if (name === "phone") await page.locator(".sheet-in").screenshot({ path: path.join(out, `${theme}-receipt__${name}__sheet.png`) }).catch(() => {});
    console.log("ok", file);
    await ctx.close();
  }
}
await browser.close();
