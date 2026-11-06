// Phone and desktop layout floors: no horizontal overflow at 360 and 390, Yes/No above the fold on the
// home and market pages, 44 px targets, both themes.
import { expect, test } from "@playwright/test";
import { guard } from "./guard";

for (const theme of ["dark", "light"]) {
  for (const width of [360, 390]) {
    test(`no overflow and Yes/No above the fold at ${width}px, ${theme}`, async ({ page }) => {
      await guard(page);
      await page.setViewportSize({ width, height: 844 });
      for (const path of ["/", "/c/18", "/c/32"]) {
        await page.goto(`${path}?theme=${theme}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
        if (path === "/c/18") continue; // settled: no Yes/No
        const yes = page.locator(path === "/" ? ".feature a.bet.yes" : ".ticket .seg .y").first();
        const box = await yes.boundingBox();
        const nav = await page.locator(".pnav").boundingBox();
        expect(box, `${path}: Yes button`).not.toBeNull();
        expect(box!.y + box!.height, `${path}: Yes/No below the fold`).toBeLessThanOrEqual((nav?.y ?? 844) + 1);
      }
    });
  }
}

test("the phone header has no theme toggle: it lives in the footer", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".pbar").getByRole("button", { name: /theme/ })).toHaveCount(0);
  await expect(page.locator(".foot").getByRole("button", { name: /theme/ })).toBeVisible();
});

for (const width of [360, 390]) {
  test(`the live strip is one still line of real counts at ${width}px`, async ({ page }) => {
    await guard(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const line = page.locator(".ticker .proofline");
    await expect(line).toHaveText(/^\d+ live facts · \d+ rulings? · \$\d+\.\d\d paid out$/);
    await expect(page.locator(".ticker .tape")).toBeHidden();
    expect(await line.evaluate((el) => el.scrollWidth - el.clientWidth), "the line is cut off").toBeLessThanOrEqual(0);
  });
}

test("the score and payout ? stays on screen in the phone's docked ticket", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/c/32");
  const name = "What is the score, and what does $1 pay?";
  await page.locator(".ticket").getByRole("button", { name }).click();
  const box = await page.getByRole("dialog", { name }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
});

test("touch targets are at least 44 px on the phone", async ({ page }) => {
  await guard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/c/32"]) {
    await page.goto(path);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("a, button")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
        if (el.closest("h1, h2, h3, .tape, .ticker, .foot .trust, .ev, .story, .lab, .tl .what, .reason, .t, .pop, details, .skip")) continue; // inline text links
        if (el.classList.contains("whyest")) continue; // 18 px glyph with a 44 px hit area (::before)
        if (r.height < 43.5 && r.width < 43.5) out.push(`${el.tagName} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        else if (r.height < 43.5 && !el.matches(".src, .link, .rq, .q, .row .w a, .tl .when a")) out.push(`${el.tagName} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} h${Math.round(r.height)}`);
      }
      return out;
    });
    expect(small, `${path}: small targets`).toEqual([]);
  }
});
