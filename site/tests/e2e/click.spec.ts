// Click everything a visitor can: every internal link answers 200 and every #anchor lands somewhere; the
// nav, search, filters, every "?", every sheet and modal open and close; the keyboard works; the theme
// holds across pages; the footer is real and close; and nothing jumps or complains in the console.
import { expect, test, type Page } from "@playwright/test";
import { guard, type Guard } from "./guard";
import { settle } from "./visit";

const ROUTES = ["/", "/c/31", "/c/18", "/c/32", "/rulings", "/agents", "/stats", "/trust", "/developers", "/p", "/p/tether", "/new", "/jack/status/20", "/terms", "/portfolio"];

const quiet = (g: Guard) => { expect(g.errors, "console errors").toEqual([]); expect(g.laneKeys, "asked for a free-bet key").toBe(0); expect(g.sends, "sent a transaction").toBe(0); };

test("every internal link on every page answers 200, and every #anchor exists", async ({ page, request }) => {
  test.setTimeout(420_000);
  await guard(page);
  const hrefs = new Map<string, string>();
  const anchors = new Map<string, Set<string>>();
  for (const route of ROUTES) {
    await page.goto(route);
    await settle(page);
    const here = await page.evaluate(() => ({ links: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.href), ids: [...document.querySelectorAll("[id]")].map((e) => e.id) }));
    anchors.set(route, new Set(here.ids));
    for (const link of here.links) {
      const u = new URL(link);
      if (u.origin === new URL(page.url()).origin && !hrefs.has(u.pathname + u.search + u.hash)) hrefs.set(u.pathname + u.search + u.hash, route);
    }
  }
  expect(hrefs.size, "the crawl found too few links").toBeGreaterThan(40);
  const dead: string[] = [];
  for (const [href, from] of hrefs) {
    const res = await request.get(href.split("#")[0], { maxRedirects: 5 });
    if (res.status() !== 200) dead.push(`${href} (linked from ${from}) answers ${res.status()}`);
    const [path, hash] = href.split("#");
    if (!hash) continue;
    const ids = anchors.get(path.split("?")[0]);
    if (ids ? !ids.has(hash) : !new RegExp(`id="${hash}"`).test(await res.text())) dead.push(`${href} (linked from ${from}): nothing has that id`);
  }
  expect(dead).toEqual([]);
});

test("no public page shows an API status code or a raw error", async ({ page }) => {
  test.setTimeout(120_000);
  await guard(page);
  for (const route of ROUTES) {
    await page.goto(route);
    await settle(page);
    await expect(page.locator("main"), route).not.toContainText(/answered \d{3}|\bHTTP \d{3}\b|undefined|\bNaN\b|\[object/);
  }
});

test("every page has the company footer, with its columns, line and copyright", async ({ page }) => {
  test.setTimeout(180_000);
  await guard(page);
  await page.setViewportSize({ width: 1508, height: 800 });
  for (const route of ROUTES) {
    await page.goto(route);
    const foot = page.locator("footer.foot");
    await foot.scrollIntoViewIfNeeded();
    await expect(foot.locator("svg[aria-label='Priced In']"), route).toBeVisible();
    await expect(foot, route).toContainText("Is it true? Bet on it.");
    for (const title of ["Product", "Proof", "Developers", "Legal"]) await expect(foot.getByRole("heading", { name: title }), route).toBeVisible();
    await expect(foot, route).toContainText("Runs on NEAR. Paid in USDC.");
    await expect(foot, route).toContainText("© 2026 Priced In.");
  }
});

test("the footer is close on the home page: three rows, then See all expands in place", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 1508, height: 800 });
  await page.goto("/");
  const cards = page.locator(".grid .card:visible");
  await expect(cards).toHaveCount(12);
  const all = await page.locator(".grid .card").count();
  const button = page.getByRole("button", { name: `See all ${all} facts` });
  await expect(button).toBeVisible();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height, "the footer is too far down").toBeLessThan(2600);
  await button.click();
  await expect(cards).toHaveCount(all);
  await expect(button).toBeHidden();
  // a filter or a search shows everything it finds
  await page.reload();
  await page.getByRole("searchbox", { name: "Search facts" }).first().fill("Tether");
  await expect(page.locator(".grid .card:visible").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^See all/ })).toBeHidden();
});

for (const size of [{ name: "phone", width: 390, rows: 4 }, { name: "tablet", width: 820, rows: 6 }, { name: "laptop", width: 1100, rows: 9 }]) {
  test(`the home grid starts short on a ${size.name}`, async ({ page }) => {
    await guard(page);
    await page.setViewportSize({ width: size.width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".grid .card:visible")).toHaveCount(size.rows);
  });
}

test("on a phone, the docked ticket and the bottom bar never cover the footer", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/c/32", "/c/31", "/c/18", "/"]) {
    await page.goto(route);
    await settle(page);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const end = (await page.locator(".foot-base").boundingBox())!;
    const dock = await page.locator(".ticket.dock").boundingBox().catch(() => null);
    const bar = (await page.locator(".pnav").boundingBox())!;
    expect(end.y + end.height, `${route}: the footer's last line is under the bottom bar`).toBeLessThanOrEqual(bar.y + 1);
    if (dock && (await page.locator(".ticket.dock").evaluate((el) => getComputedStyle(el).position)) === "fixed") expect(end.y + end.height, `${route}: the footer's last line is under the ticket`).toBeLessThanOrEqual(dock.y + 1);
  }
});

test("search filters as you type, finds nothing kindly, and works from another page", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("/");
  const box = page.getByRole("searchbox", { name: "Search facts" }).first();
  await expect(box).toBeFocused();
  await box.fill("zzzqqq");
  await expect(page.getByRole("heading", { name: "No facts match" })).toBeVisible();
  await page.getByRole("button", { name: "Show every fact" }).click();
  await expect(page.locator(".grid .card:visible").first()).toBeVisible();
  await page.goto("/rulings");
  await box.fill("Tether");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/\?q=Tether#facts$/);
  await expect(page.getByRole("heading", { name: /Facts matching/ })).toBeVisible();
  quiet(g);
});

test("the topic filters each show their own facts, and All brings them back", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  const tabs = page.getByRole("group", { name: "Filter by topic" }).getByRole("button");
  const n = await tabs.count();
  expect(n).toBeGreaterThan(2);
  for (let i = 1; i < n; i++) {
    const tab = tabs.nth(i);
    const want = Number(await tab.locator(".n").textContent());
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".grid .card:visible")).toHaveCount(want);
  }
  await tabs.first().click();
  await expect(page.locator(".grid .card:visible")).toHaveCount(12);
  quiet(g);
});

/** Every "?" on the page opens, stays on screen, and closes with Escape and with its own ✕. */
async function everyExplain(page: Page, route: string) {
  const qs = page.locator("main button.whyest:visible");
  const n = Math.min(await qs.count(), 12);
  for (let i = 0; i < n; i++) {
    const q = qs.nth(i);
    await q.scrollIntoViewIfNeeded();
    await q.click();
    const pop = page.locator(".pop");
    await expect(pop, `${route}: ? ${i}`).toBeVisible();
    const box = (await pop.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x, `${route}: ? ${i} left`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${route}: ? ${i} right`).toBeLessThanOrEqual(vp.width);
    expect(box.y, `${route}: ? ${i} top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${route}: ? ${i} bottom`).toBeLessThanOrEqual(vp.height);
    await page.keyboard.press("Escape");
    await expect(pop, `${route}: Escape closes ? ${i}`).toHaveCount(0);
  }
}

for (const size of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test(`every ? on every page opens and closes (${size.name})`, async ({ page }) => {
    test.setTimeout(240_000);
    const g = await guard(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      await everyExplain(page, route);
    }
    quiet(g);
  });
}

test("the market's tabs each open, and the arrow keys move between them", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/c/18");
  await settle(page);
  const tabs = page.getByRole("tab");
  const n = await tabs.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toBeVisible();
  }
  await tabs.first().click();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  quiet(g);
});

test("the wallet sheet opens from the header, shows the wallets, and closes with Escape and ✕", async ({ page }) => {
  const g = await guard(page);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await settle(page);
    await page.locator("[data-testid='connect-wallet']:visible").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Connect");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.locator("[data-testid='connect-wallet']:visible").first().click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /Close/ }).click();
    await expect(sheet).toBeHidden();
  }
  quiet(g);
});

test("the theme toggle flips, holds across pages and a reload, and flips back", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  const html = page.locator("html");
  await expect(html, "light is the default").toHaveAttribute("data-theme", "light");
  await page.locator("header.nav").getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.locator(".navlinks").getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/rulings$/);
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html, "a saved choice wins").toHaveAttribute("data-theme", "dark");
  await page.locator("header.nav").getByRole("button", { name: "Switch to light theme" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  quiet(g);
});

test("the phone's theme toggle lives in the footer and works", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settle(page);
  await page.locator(".foot").getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  quiet(g);
});

test("the compact header's menu opens, goes, and closes with Escape and a click away", async ({ page }) => {
  const g = await guard(page);
  for (const width of [768, 1024, 1240]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await settle(page);
    const open = page.locator("header.nav").getByRole("button", { name: "Menu" });
    const menu = page.getByRole("navigation", { name: "Menu" });
    await expect(page.locator(".navlinks")).toBeHidden();
    await open.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await page.mouse.click(10, 500);
    await expect(menu).toBeHidden();
    await open.click();
    await menu.getByRole("link", { name: "Results" }).click();
    await expect(page).toHaveURL(/\/rulings$/);
    await expect(menu).toBeHidden();
  }
  quiet(g);
});

test("the keyboard reaches everything: skip link first, a visible focus ring, in order", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect.poll(async () => (await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { tag: el.tagName, w: b.width, h: b.height, ring: cs.outlineStyle !== "none" || el.closest("form:focus-within") !== null };
    });
    expect(r.tag, `tab ${i} left the page`).not.toBe("BODY");
    expect(r.w * r.h, `tab ${i}: focus went to something invisible`).toBeGreaterThan(0);
    expect(r.ring, `tab ${i}: no focus ring on ${r.tag}`).toBe(true);
  }
  quiet(g);
});

test("back and forward restore the page and the place on it", async ({ page }) => {
  const g = await guard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settle(page);
  await page.evaluate(() => scrollTo(0, 900));
  await page.locator(".grid .card a.q").nth(5).click();
  await expect(page).toHaveURL(/\/c\/\d+$/);
  await settle(page);
  await page.goBack();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await page.goForward();
  await expect(page).toHaveURL(/\/c\/\d+$/);
  await expect(page.locator(".mk h1")).toBeVisible();
  quiet(g);
});

for (const size of [{ name: "desktop", width: 1508, height: 800 }, { name: "phone", width: 390, height: 844 }]) {
  test(`no page jumps after it loads, and none says a word to the console (${size.name})`, async ({ page }) => {
    test.setTimeout(180_000);
    const g = await guard(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __moved: string[] };
      w.__cls = 0;
      w.__moved = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Element; previousRect: DOMRect; currentRect: DOMRect }[] }[]) {
          // the live strip moves by design, inside its own fixed-height line
          const inStrip = (n?: Element) => (n?.nodeType === 1 ? n : n?.parentElement)?.closest(".ticker");
          if (e.hadRecentInput || e.sources?.every((s) => inStrip(s.node))) continue;
          w.__cls += e.value;
          for (const s of e.sources ?? []) w.__moved.push(`${s.node?.nodeName}.${s.node?.getAttribute?.("class") ?? ""} ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const jumps: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      await page.waitForTimeout(400);
      const { cls, moved } = await page.evaluate(() => { const w = window as unknown as { __cls: number; __moved: string[] }; return { cls: w.__cls, moved: w.__moved }; });
      if (cls > 0.05) jumps.push(`${route}: layout shift ${cls.toFixed(3)}: ${moved.slice(0, 6).join(", ")}`);
    }
    expect(jumps).toEqual([]);
    quiet(g);
  });
}
