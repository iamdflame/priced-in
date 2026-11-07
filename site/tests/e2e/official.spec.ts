// The official pages (OFFICIAL_PAGES=1 on the API), in either state.
// Off (the default, and the live API today): /p and /p/<slug> are the priced Wikipedia articles they always
// were, /record is not a page, and the footer and /help say what they said.
// On (E2E_PAGES=on, the stand-in API at tests/mock/api.mjs with MOCK_PAGES=on: the API's own api/_lib/pages.mjs
// over live claims and rulings and a real signed page sweep): /p/<slug> opens on the market's page, one tap from
// Wikipedia's words, with each change's diff and proof; /p says how much the AI has written; /record lists the
// decided news claims. The money guard is on throughout.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { guard, type Guard } from "./guard";
import { NEWS, PAGES, scenario } from "./news";
import { settle } from "./visit";

const quiet = (g: Guard) => { expect(g.errors, g.errors.join("\n")).toEqual([]); expect(g.laneKeys, "asked for a free-bet key").toBe(0); expect(g.sends, "sent a transaction").toBe(0); };
const MARKET = "The market’s page";
const WIKI = "Wikipedia’s words";

interface Sentence { text: string; wikipedia?: string; written_by: string; claim: { id: number; trades: number; status: string } | null }
interface Paragraph { index: number; changed: boolean; sentences: Sentence[] }
interface Page1 { title: string; totals: { written_by_ai: number; paragraphs: number }; paragraphs: Paragraph[] }

const pageOf = async (request: APIRequestContext, slug: string) => (await (await request.get(`/api/pages/${slug}`)).json()) as Page1;
const family = (page: Page) => page.locator(".article > section > p").first().evaluate((p) => getComputedStyle(p).fontFamily);

test.describe("with the official pages off", () => {
  test.skip(PAGES, "the off state: the live API, or the stand-in with MOCK_PAGES off");

  test("/p/tether is the priced Wikipedia article it always was", async ({ page }) => {
    const g = await guard(page);
    await page.goto("/p/tether");
    await expect(page.locator("h1")).toHaveText("Tether (cryptocurrency)");
    await expect(page.locator(".enc-head .lede")).toContainText("on this page");
    await expect(page.getByRole("button", { name: MARKET })).toHaveCount(0);
    await expect(page.getByText("Written by AI from what the market believes")).toHaveCount(0);
    await expect(page.locator(".enc-side")).toContainText("Signed by AI");
    expect(await page.locator(".article p").first().evaluate((p) => getComputedStyle(p).fontFamily)).toMatch(/amstelvar/i);
    await settle(page);
    quiet(g);
  });

  test("/p has no AI share and no record, and /record is not a page", async ({ page, request }) => {
    const g = await guard(page);
    await page.goto("/p");
    await expect(page.locator("h1")).toHaveText("Read Wikipedia with the odds on.");
    await expect(page.getByText("written by AI")).toHaveCount(0);
    await expect(page.locator('a[href="/record"]')).toHaveCount(0);
    expect((await request.get("/record")).status()).toBe(404);
    quiet(g);
  });

  test("the footer, /help and /how say what they said", async ({ page }) => {
    await guard(page);
    await page.goto("/help");
    await expect(page.locator("footer")).toContainText("Facts quote Wikipedia, whose text is available under CC BY-SA 4.0.");
    await expect(page.getByText("Who writes the encyclopedia pages?")).toHaveCount(0);
    await page.goto("/how");
    await expect(page.locator(".how-who")).not.toContainText("The writer");
  });
});

test.describe("with the official pages on", () => {
  test.skip(!PAGES, "the on state: E2E_PAGES=on with the stand-in API and MOCK_PAGES=on");

  test("/p/tether opens on the market's page: written from the odds, with when it changed, and the source's licence", async ({ page, request }) => {
    const g = await guard(page);
    const api = await pageOf(request, "tether");
    await page.goto("/p/tether");
    await expect(page.locator("h1")).toHaveText(api.title);
    await expect(page.getByText("Written by AI from what the market believes right now.")).toBeVisible();
    await expect(page.locator(".said")).toContainText("Last changed");
    await expect(page.getByRole("button", { name: MARKET })).toHaveAttribute("aria-pressed", "true");
    const article = page.locator(".article");
    const sentences = api.paragraphs.flatMap((p) => p.sentences);
    const written = sentences.filter((s) => s.written_by === "ai");
    expect(written.length, "the stand-in serves rewritten sentences").toBeGreaterThan(3);
    for (const s of written) await expect(article).toContainText(s.text);
    // every sentence with a market is a link to it, and none without one is
    await expect(article.locator("a.hs")).toHaveCount(sentences.filter((s) => s.claim).length);
    const unbet = sentences.filter((s) => s.claim && !s.claim.trades && s.claim.status !== "decided");
    if (unbet.length) await expect(article.locator(".hs.unbet sup").first()).toHaveText("No bets");
    expect(await family(page)).toMatch(/geist/i);
    await expect(page.locator(".wrote")).toContainText(`${api.totals.written_by_ai} of ${api.totals.paragraphs} paragraphs`);
    const credit = page.locator(".attribution");
    await expect(credit).toContainText("CC BY-SA 4.0");
    await expect(credit).toContainText("rewritten from it by AI");
    await settle(page);
    quiet(g);
  });

  test("one tap switches to Wikipedia's words, in Wikipedia's face, and the switch stays put", async ({ page, request }) => {
    const g = await guard(page);
    const api = await pageOf(request, "tether");
    await page.goto("/p/tether");
    const wiki = page.getByRole("button", { name: WIKI });
    const before = await wiki.boundingBox();
    await wiki.click();
    await expect(wiki).toHaveAttribute("aria-pressed", "true");
    const after = await wiki.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), "the switch moved under the pointer").toBeLessThan(1);
    await expect(page.getByText("Wikipedia’s words, from the revision of")).toBeVisible();
    const article = page.locator(".article");
    for (const s of api.paragraphs.flatMap((p) => p.sentences).filter((x) => x.written_by === "ai")) await expect(article).toContainText(s.wikipedia!);
    expect(await family(page)).toMatch(/amstelvar/i);
    await expect(page.getByRole("button", { name: "What changed" })).toHaveCount(0);
    await page.getByRole("button", { name: MARKET }).click();
    await expect(page.getByRole("button", { name: "What changed" }).first()).toBeVisible();
    quiet(g);
  });

  test("a changed paragraph shows its word diff and its proof, by click or keyboard", async ({ page }) => {
    const g = await guard(page);
    await page.goto("/p/tether");
    const open = page.getByRole("button", { name: "What changed" }).first();
    const panel = page.locator(`#${await open.getAttribute("aria-controls")}`);
    await expect(panel).toBeHidden();
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(panel.locator("ins").first()).toBeVisible();
    await expect(panel).toContainText("Signed in a TEE by the model’s attested key");
    await expect(panel).toContainText("glm-5.3-flash");
    await expect(panel).toContainText("chance it’s true");
    await expect(panel.getByRole("link", { name: "How to check a signature" })).toHaveAttribute("href", "/trust");
    await open.press("Enter");
    await expect(panel).toBeHidden();
    quiet(g);
  });

  test("decided lines read as decided: the correction in the market's words, the struck line in Wikipedia's", async ({ page, request }) => {
    const g = await guard(page);
    const api = await pageOf(request, "tether");
    const fixed = api.paragraphs.find((p) => p.sentences.some((s) => s.written_by === "correction"));
    test.skip(!fixed, "no corrected line on the live market right now");
    const line = fixed!.sentences.find((s) => s.written_by === "correction")!;
    await page.goto("/p/tether");
    const article = page.locator(".article");
    await expect(article).toContainText(line.text);
    await expect(article).not.toContainText(line.wikipedia!, { useInnerText: true });
    await page.locator(`button[aria-controls="chg-${fixed!.index}"]`).click();
    const panel = page.locator(`#chg-${fixed!.index}`);
    await expect(panel.locator(".verdict")).toHaveText("Ruled false");
    await expect(panel.getByRole("link", { name: "See the ruling" })).toBeVisible();
    await expect(panel.locator("a.hash").first()).toHaveAttribute("href", /^https:\/\/nearblocks\.io\/txns\//);
    await page.getByRole("button", { name: WIKI }).click();
    const struck = article.locator(".hs.gone", { hasText: line.wikipedia!.slice(0, 40) });
    await expect(struck).toBeVisible();
    await expect(struck.locator("sup")).toHaveText("Ruled false");
    quiet(g);
  });

  test("a priced sentence opens its market in a sheet, and Escape gives the focus back", async ({ page }) => {
    const g = await guard(page);
    await page.goto("/p/tether");
    const first = page.locator('.article a.hs[aria-haspopup="dialog"]').first();
    await first.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Open market" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(first).toBeFocused();
    quiet(g);
  });

  test("a thin page: NEAR's one priced sentence is written from its odds, and the rest is Wikipedia's", async ({ page, request }) => {
    const g = await guard(page);
    const api = await pageOf(request, "near");
    await page.goto("/p/near");
    await expect(page.locator(".article a.hs")).toHaveCount(api.paragraphs.flatMap((p) => p.sentences).filter((s) => s.claim).length);
    await expect(page.locator(".vnote")).toContainText(api.totals.written_by_ai ? `${api.totals.written_by_ai} of ${api.totals.paragraphs} paragraphs written by AI` : "No paragraph written by AI yet");
    await expect(page.locator(".article h2").first()).toBeVisible();
    quiet(g);
  });

  test("/p says how much of each page the AI has written", async ({ page, request }) => {
    const g = await guard(page);
    const index = await (await request.get("/api/pages")).json() as { pages: { slug: string; written_by_ai: number; paragraphs: number }[] };
    await page.goto("/p");
    await expect(page.locator("h1")).toHaveText("The encyclopedia the market writes.");
    for (const p of index.pages) {
      await expect(page.locator(`a.pagec[href="/p/${p.slug}"] .aiw`)).toHaveText(p.written_by_ai ? `${p.written_by_ai} of ${p.paragraphs} paragraphs written by AI` : "No paragraph written by AI yet");
    }
    quiet(g);
  });

  test("the footer's licence covers the AI's text, /help says who writes the pages, /how names the writer", async ({ page }) => {
    const g = await guard(page);
    await page.goto("/help");
    await expect(page.locator("footer")).toContainText("the encyclopedia’s pages are rewritten from it by AI. Both are available under CC BY-SA 4.0.");
    await page.getByText("Who writes the encyclopedia pages?").click();
    await expect(page.getByText("Each rewrite is signed in a TEE by the model that wrote it")).toBeVisible();
    await page.goto("/how");
    await expect(page.locator(".how-who")).toContainText("The writer");
    quiet(g);
  });

  for (const width of [360, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`/p/tether fits ${width} px in both views, ${theme}`, async ({ page }) => {
        const g = await guard(page);
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/p/tether?theme=${theme}`);
        for (const view of [MARKET, WIKI]) {
          const tab = page.getByRole("button", { name: view });
          await tab.click();
          expect((await tab.boundingBox())?.height ?? 0, "a 44 px target").toBeGreaterThanOrEqual(44);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `${view} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
        }
        quiet(g);
      });
    }
  }
});

test.describe("switching the official pages off again", () => {
  test.skip(!PAGES, "the on state: E2E_PAGES=on with the stand-in API and MOCK_PAGES=on");
  test.describe.configure({ mode: "serial" });

  // a rollback must reach every page, the ones rendered per request too: the site reads the switch from /v1, which
  // answers 200 either way, so its cache never keeps the last "on" after the API says off
  test("an article rendered per request, and a dynamic page's footer, go back to how they were", async ({ page, request }) => {
    const HEAT = "on this page";
    try {
      await scenario(request, page, { pages: "off" }, { path: "/p/tether", has: HEAT, lacks: "Written by AI from what the market believes" });
      await page.goto("/p/tether");
      await expect(page.locator(".enc-head .lede")).toContainText(HEAT);
      await expect(page.getByRole("button", { name: MARKET })).toHaveCount(0);
      await expect.poll(async () => (await request.get("/c/18")).text(), { timeout: 60_000, intervals: [2_000] }).toContain("whose text is available under");
      await expect.poll(async () => (await request.get("/record")).status(), { timeout: 60_000, intervals: [2_000] }).toBe(404);
    } finally {
      await scenario(request, page, { pages: "on" }, { path: "/p/tether", has: "Written by AI from what the market believes" });
    }
  });
});

test.describe("the record, with the official pages and today's news on", () => {
  test.skip(!PAGES || !NEWS, "E2E_PAGES=on and E2E_NEWS=on with the stand-in API");
  test.describe.configure({ mode: "serial" });

  test("/p links the record, and the record lists each decided claim with its sources and ruling", async ({ page, request }) => {
    const g = await guard(page);
    const record = await (await request.get("/api/record")).json() as { count: number; lines: { question: string; sources: unknown[] }[] };
    await page.goto("/p");
    await page.getByRole("link", { name: "See the record of decided claims" }).click();
    await expect(page).toHaveURL(/\/record$/);
    await expect(page.locator("h1")).toHaveText("The record.");
    await expect(page.locator(".recl")).toHaveCount(record.count);
    const first = page.locator(".recl").first();
    await expect(first.locator("h2")).toHaveText(record.lines[0].question);
    await expect(first.locator(".verdict")).toHaveText(/Ruled (true|false)/);
    await expect(first.locator(".recl-src a")).toHaveCount(record.lines[0].sources.length);
    // a ruling the index settled links its section on the fact's page; the stand-in's lines have none, so they link the fact
    const line = record.lines[0] as unknown as { ruling: { url: string }; market_url: string };
    await expect(first.getByRole("link", { name: "The market" })).toHaveAttribute("href", line.market_url);
    await expect(first.getByRole("link", { name: "The ruling", exact: true })).toHaveCount(line.ruling.url === line.market_url ? 0 : 1);
    quiet(g);
  });

  test("with today's news off, the record goes, and nothing points at it", async ({ page, request }) => {
    try {
      await scenario(request, page, { news: "off" }, { path: "/p", lacks: "See the record" });
      // the page was built with news on: it turns into a 404 when it next regenerates
      await expect.poll(async () => (await request.get("/record")).status(), { timeout: 60_000, intervals: [2_000] }).toBe(404);
      await page.goto("/p");
      await expect(page.locator('a[href="/record"]')).toHaveCount(0);
      await expect(page.locator("h1")).toHaveText("The encyclopedia the market writes.");
    } finally {
      await scenario(request, page, { news: "on" }, { path: "/p", has: "See the record" });
    }
  });
});
