// Real people click around. One browser session walks every route by clicking (nav, footer, cards, back
// and forward), and at each stop the page must match a fresh load of the same URL: same computed styles,
// same boxes. A stylesheet left over from the last route can't hide here. This is the test that failed
// on the founder's screenshot: the home stats row collapsed into a column after visiting /trust.
import { expect, test, type Page } from "@playwright/test";
import { guard } from "./guard";
import { differences, freshShot, settle, shoot } from "./visit";

test.use({ reducedMotion: "reduce" });

type Step = [name: string, go: (page: Page) => Promise<unknown>, url: RegExp];

// a phone keeps the link groups in accordions: open them as a visitor would, and leave them shut afterwards,
// because the footer outlives the navigation and the next stop is held against a fresh load
const foot = async (page: Page, name: string) => {
  const links = page.locator(".foot").getByRole("link", { name, exact: true });
  if (!(await links.count())) for (const s of await page.locator(".foot details.ft-acc:not([open]) summary:visible").all()) await s.click();
  await links.first().click();
  await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>(".foot details[open]").forEach((d) => { d.open = false; }));
};

function walk(main: (page: Page, name: string) => Promise<unknown>): Step[] {
  return [
    ["Results, from the main nav", (p) => main(p, "Results"), /\/rulings$/],
    ["AI traders, from the main nav", (p) => main(p, "AI traders"), /\/agents$/],
    ["home, after a proof page", (p) => p.locator("header.nav .logo:visible, .pbar .logo:visible").first().click(), /:\d+\/$/],
    ["Trust, from the footer", (p) => foot(p, "Trust"), /\/trust$/],
    ["home again, by the back button", (p) => p.goBack(), /:\d+\/$/],
    ["Trust, by the forward button", (p) => p.goForward(), /\/trust$/],
    ["Accuracy, from the footer", (p) => foot(p, "Accuracy"), /\/accuracy$/],
    ["Truth API, from the footer", (p) => foot(p, "Truth API"), /\/developers/],
    ["Encyclopedia, from the footer", (p) => foot(p, "Encyclopedia"), /\/p$/],
    ["an article, from its card", (p) => p.locator("a.pagec").first().click(), /\/p\/[\w-]+$/],
    ["Terms, from the footer", (p) => foot(p, "Terms"), /\/terms$/],
    ["Portfolio, from the main nav", (p) => main(p, "Portfolio"), /\/portfolio$/],
    ["home, from Facts", (p) => main(p, "Facts"), /:\d+\/$/],
    ["a market, from a card", async (p) => {
      // the API read is cached with stale-while-revalidate: ask once first, so both loads get the same feed
      const card = p.locator(".grid .card a.q").first();
      await p.request.get((await card.getAttribute("href"))!);
      await p.waitForTimeout(1_500);
      await card.click();
    }, /\/c\/\d+$/],
    ["Price a claim, from the footer", (p) => foot(p, "Price a claim"), /\/new$/],
    ["back to the market", (p) => p.goBack(), /\/c\/\d+$/],
    ["back to home", (p) => p.goBack(), /:\d+\/$/],
  ];
}

const SIZES = [
  { name: "desktop", width: 1440, height: 900, main: (p: Page, name: string) => p.locator(".navlinks").getByRole("link", { name, exact: true }).click() },
  { name: "phone", width: 390, height: 844, main: (p: Page, name: string) => p.locator(".pnav").getByRole("link", { name, exact: true }).click() },
];

const ROUTES = ["/c/31", "/c/18", "/rulings", "/agents", "/stats", "/trust", "/developers", "/p", "/p/tether", "/new", "/jack/status/20", "/terms", "/privacy", "/help", "/status", "/accuracy", "/portfolio"];

// the founder's trigger: the logo, from any page, must land on the same home a fresh load gives
for (const size of SIZES) {
  test(`the logo from any page lands on the real home page (${size.name})`, async ({ page, context }) => {
    test.setTimeout(300_000);
    await guard(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      await page.locator("header.nav .logo:visible, .pbar .logo:visible").first().click();
      await expect(page, route).toHaveURL(/:\d+\/$/);
      const here = await shoot(page);
      expect(await page.locator(".home .proof").evaluate((el) => getComputedStyle(el).flexDirection), `the stats row after the logo on ${route}`).toBe("row");
      const diff = differences(here, await freshShot(context, page));
      expect.soft(diff.slice(0, 12), `the logo from ${route} differs from a fresh home in ${diff.length} ways`).toEqual([]);
    }
  });
}

for (const size of SIZES) {
  test(`one session, every route by clicking, each stop equal to a fresh load (${size.name})`, async ({ page, context }) => {
    test.setTimeout(420_000);
    const g = await guard(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await settle(page);
    for (const [name, go, url] of walk(size.main)) {
      await go(page);
      await expect(page, name).toHaveURL(url);
      const here = await shoot(page);
      expect(here.length, `${name}: the page is empty`).toBeGreaterThan(10);
      const fresh = await freshShot(context, page);
      const diff = differences(here, fresh);
      expect.soft(diff.slice(0, 12), `${name}: ${page.url()} differs from a fresh load in ${diff.length} ways`).toEqual([]);
    }
    expect(g.laneKeys, "asked for a free-bet key").toBe(0);
    expect(g.sends, "sent a transaction").toBe(0);
  });
}
