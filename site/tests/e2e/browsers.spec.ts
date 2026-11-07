// The main things a judge does, in Firefox and WebKit too (flow.spec.ts runs there as well): land, see
// the stats row as a row, reach the footer, click across pages and back, open a market, the wallet sheet,
// the "?", and the theme. Whatever differs between engines shows up here.
import { expect, test } from "@playwright/test";
import { audit, brokenImages } from "./audit";
import { guard } from "./guard";
import { NEWS } from "./news";
import { settle } from "./visit";

test("land, click across pages and back, and every stop is sound", async ({ page, isMobile }) => {
  test.setTimeout(240_000);
  const g = await guard(page);
  const clean = async (where: string) => {
    await settle(page);
    expect(await audit(page), where).toEqual([]);
  };
  await page.goto("/");
  await clean("home");
  const proof = await page.locator(".home .proof").evaluate((el) => getComputedStyle(el).flexDirection);
  expect(proof).toBe("row");

  const links = page.locator(isMobile ? ".pnav" : ".navlinks");
  const stops: [string, RegExp][] = [["Results", /\/rulings$/], NEWS ? ["Leaderboard", /\/leaderboard$/] : ["AI traders", /\/agents$/], ["Portfolio", /\/portfolio$/]];
  for (const [name, url] of stops) {
    await links.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await clean(name);
  }
  await page.locator(".foot").getByRole("link", { name: "Trust", exact: true }).first().click();
  await expect(page).toHaveURL(/\/trust$/);
  await clean("trust");
  await page.locator(isMobile ? ".pbar .logo" : "header.nav .logo").click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await clean("home after trust");
  expect(await page.locator(".home .proof").evaluate((el) => getComputedStyle(el).flexDirection), "the stats row after /trust").toBe("row");

  await page.locator(".grid .card a.q").first().click();
  await expect(page).toHaveURL(/\/c\/\d+$/);
  await clean("market");
  await page.goBack();
  await expect(page).toHaveURL(/:\d+\/$/);
  expect(await brokenImages(page)).toEqual([]);
  expect(g.errors).toEqual([]);
});

test("the footer, the wallet sheet, a ? and the theme work", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const g = await guard(page);
  await page.goto("/");
  await settle(page);

  const see = page.getByRole("button", { name: /^See all \d+ facts$/ });
  await expect(see).toBeVisible();
  await see.click();
  await expect(see).toBeHidden();

  await page.locator(".foot").scrollIntoViewIfNeeded();
  await expect(page.locator(".foot")).toContainText("© 2026 Priced In");

  await page.locator("[data-testid='connect-wallet']:visible").first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /Close/ }).click();
  await expect(sheet).toBeHidden();

  await page.getByRole("button", { name: NEWS ? "What is a pick?" : "What is the score, and what does $1 pay?" }).first().click();
  await expect(page.locator(".pop")).toBeVisible();
  await page.locator(".pop").getByRole("button", { name: /Close/ }).click();
  await expect(page.locator(".pop")).toHaveCount(0);

  const toggle = page.locator(isMobile ? ".foot" : "header.nav").getByRole("button", { name: "Switch to dark theme" });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(g.errors).toEqual([]);
});
