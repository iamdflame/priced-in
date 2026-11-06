// Real screens: every route at the CSS widths people really have (the founder's 125% Windows scaling
// is 1508 px at 1.25), then a continuous drag from 320 to 2600 px on the three pages that carry the most,
// then the key widths at each device scale. audit.ts says what counts as wrong.
import { expect, test } from "@playwright/test";
import { audit, brokenImages } from "./audit";
import { guard } from "./guard";
import { settle } from "./visit";

const ROUTES = ["/", "/c/31", "/c/18", "/c/32", "/rulings", "/agents", "/stats", "/trust", "/developers", "/p", "/p/tether", "/new", "/jack/status/20", "/terms", "/privacy", "/help", "/status", "/accuracy", "/portfolio"];
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1366, 1440, 1508, 1536, 1600, 1707, 1920, 2048, 2560];
const KEY_WIDTHS = [390, 768, 1280, 1508, 1920];
const SCALES = [1, 1.25, 1.5, 2];

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

for (const route of ROUTES) {
  test(`${route}: clean at every real width`, async ({ page }) => {
    test.setTimeout(240_000);
    const g = await guard(page);
    // one real read of the post, not nineteen: the API limits new posts, and the shape is what's on test
    let post: string | undefined;
    await page.route(/\/post\/jack\/status\/20$/, async (r) => {
      if (post === undefined) { const res = await r.fetch(); if (res.ok()) post = await res.text(); else return r.fulfill({ response: res }); }
      await r.fulfill({ body: post, contentType: "application/json" });
    });
    const wrong: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
      await page.goto(route);
      await settle(page);
      for (const p of await audit(page)) wrong.push(`${width}px: ${p}`);
    }
    for (const src of await brokenImages(page)) wrong.push(`image did not load: ${src}`);
    expect(wrong).toEqual([]);
    expect(g.errors).toEqual([]);
  });
}

for (const route of ["/", "/c/31", "/c/18"]) {
  test(`${route}: clean at every width from 320 to 2600 in steps of 8`, async ({ page }) => {
    test.setTimeout(300_000);
    await guard(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await settle(page);
    const wrong: string[] = [];
    for (let width = 320; width <= 2600; width += 8) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(frame);
      for (const p of await audit(page)) wrong.push(`${width}px: ${p}`);
    }
    expect(wrong).toEqual([]);
  });
}

for (const deviceScaleFactor of SCALES) {
  test(`key pages at device scale ${deviceScaleFactor}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const wrong: string[] = [];
    for (const width of KEY_WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor });
      const page = await context.newPage();
      await guard(page);
      for (const route of ["/", "/c/31", "/trust"]) {
        await page.goto(route);
        await settle(page);
        for (const p of await audit(page)) wrong.push(`${route} at ${width}px: ${p}`);
      }
      await context.close();
    }
    expect(wrong).toEqual([]);
  });
}
