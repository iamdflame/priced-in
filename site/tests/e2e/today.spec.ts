// Today's claims, free picks, the board and catching a mistake, in both states.
// Off (the default, and the live API today): none of it shows anywhere, and nothing links to it.
// On (E2E_NEWS=on, the stand-in API at tests/mock/api.mjs, whose picks and reports go through the API's own
// code): the front door, one-tap picks with the tray, results for a returning browser, the board with a
// signed nickname, a report refused in the API's words, and a line waiting past its date.
// The money guard is on throughout: a pick never asks the lane for a key, and nothing is ever sent.
import { expect, test, type Page } from "@playwright/test";
import { guard, noMoneySpent } from "./guard";
import { MOCK, NEWS, scenario } from "./news";

const VISITOR_PICKS = { 9101: "yes", 9102: "yes", 9103: "yes", 9104: "yes", 9001: "no", 9003: "yes" };
/** The returning browser: the stand-in's visitor key and its picks, shown since 3 Nov 07:30 UTC. */
async function asReturning(page: Page, secret: string) {
  await page.addInitScript(({ secret, picks }) => {
    localStorage.setItem("pricedin.lane.mainnet.v1", secret);
    localStorage.setItem("pricedin.picks.v1", JSON.stringify({ picks: Object.fromEntries(Object.entries(picks).map(([k, side]) => [k, { side, at: 1 }])), seen: Date.UTC(2026, 10, 3, 7, 30) }));
  }, { secret, picks: VISITOR_PICKS });
}

test.describe("with today's news off", () => {
  test.skip(NEWS, "the news-off state");

  test("nothing of it shows, and nothing links to it", async ({ page, request }) => {
    const g = await guard(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Bet on whether facts are true." })).toBeVisible();
    await expect(page.getByText("Today’s claims")).toHaveCount(0);
    await expect(page.locator("a[href='/leaderboard']")).toHaveCount(0);
    await expect(page.locator(".grid a.bet.no").first()).toContainText(/Right: \$1 becomes/);
    expect((await request.get("/leaderboard")).status()).toBe(404);
    expect((await request.get("/api/today")).status()).toBe(404);
    await page.goto("/how");
    await expect(page.getByText("Every day: call today’s news")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Two ways to play" })).toBeVisible();
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Your picks" })).toHaveCount(0);
    await page.goto("/c/31");
    await expect(page.getByRole("button", { name: /Report a mistake/ })).toHaveCount(0);
    expect(g.laneKeys).toBe(0);
    noMoneySpent(g);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });
});

test.describe("with today's news on", () => {
  test.skip(!NEWS, "the news-on state: E2E_NEWS=on with the stand-in API");
  test.describe.configure({ mode: "serial" });
  let secret = "";

  test.beforeAll(async ({ request }) => {
    secret = (await scenario(request, null, { news: "on", scenario: "first" }, { path: "/", has: "Today’s claims", lacks: "Waiting for its source" })).visitor.secret;
  });
  test.afterAll(async ({ request }) => {
    await scenario(request, null, { news: "on", scenario: "first" }, { path: "/", lacks: "Waiting for its source" });
  });

  test("today's claims are the front door, and a first visit sees the AI traders' real records", async ({ page }) => {
    const g = await guard(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Bet on whether facts are true." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Today’s claims" })).toBeVisible();
    const lead = page.locator(".tlead");
    await expect(lead.getByRole("heading", { level: 2 })).toHaveText("Is Anthropic pressing ahead with a $1.5tn IPO?");
    await expect(lead).toContainText("chance it’s true");
    await expect(lead).toContainText("Settles by 14 Nov");
    await expect(lead.locator("a.fromnews")).toContainText("Financial Times");
    await expect(lead).toContainText("Picks are free and win nothing");
    await expect(page.locator(".tgrid .card")).toHaveCount(3);
    await expect(page.locator(".you")).toContainText("You vs the AIs");
    await expect(page.locator(".you .vs li")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Just decided" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Facts from Wikipedia" })).toBeVisible();
    // one rule for the page: the Wikipedia cards pick too, and say so
    await expect(page.locator("#facts .grid .card").first()).toContainText("Free pick · wins nothing");
    await expect(page.locator("header.nav .navlinks")).toContainText("Leaderboard");
    expect(g.laneKeys).toBe(0);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("a tap on Yes picks at once: no page change, no wallet, no key from the lane, and the next step in plain words", async ({ page, request }) => {
    const g = await guard(page);
    await page.goto("/");
    const yes = page.locator(".tlead a.bet.yes");
    await yes.click();
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(yes).toHaveAttribute("aria-pressed", "true");
    await expect(yes).toContainText("Your pick: Yes");
    const tray = page.getByRole("complementary", { name: "Your pick" });
    await expect(tray).toContainText("Pick saved");
    await expect(tray).toContainText("Picks are free and win nothing");
    await expect(tray.getByRole("link", { name: "Back it with your free $1" })).toBeVisible();
    await expect(tray.getByRole("button", { name: "Bet real USDC" })).toBeVisible();
    // the API's own parser took the signature, and the line counts the pick
    const key = await page.evaluate(() => localStorage.getItem("pricedin.lane.mainnet.v1"));
    expect(key).toMatch(/^ed25519:/);
    const today = await (await request.get("/api/today")).json();
    expect(today.lines.find((l: { claim_id: number }) => l.claim_id === 9001).picks.yes).toBeGreaterThanOrEqual(1);
    expect(g.laneKeys, "a pick must never ask the lane for a key").toBe(0);
    // the first pick is the one that counts: the other side shows it again, without an error
    await tray.getByRole("button", { name: "Close" }).click();
    await page.locator(".tlead a.bet.no").click();
    await expect(tray).toContainText("Your pick:");
    await expect(page.locator(".pickerr")).toHaveCount(0);
    // the money step: the fact's page, the side picked, the free $1 ready (the lane is the guard's fake)
    await tray.getByRole("link", { name: "Back it with your free $1" }).click();
    await expect(page).toHaveURL(/\/c\/9001\?side=yes$/);
    await expect(page.getByText("Your free pick:")).toBeVisible();
    await expect(page.getByRole("button", { name: /Yes, it’s true/ }).first()).toHaveAttribute("aria-pressed", "true");
    noMoneySpent(g);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("a returning browser sees its results first: You called it, its streak and its place against the AIs", async ({ page, request }) => {
    await scenario(request, page, { scenario: "returning" });
    const g = await guard(page);
    await asReturning(page, secret);
    await page.goto("/");
    const you = page.locator(".you");
    await expect(you.getByText("You called it")).toBeVisible();
    await expect(you).toContainText("Is Meta raising up to $95B for AI?");
    await expect(you).toContainText("+30 points");
    await expect(you).toContainText("3 of 4 right");
    await expect(you.locator(".vs li.me")).toContainText("75%");
    await expect(page.locator(".tlead a.bet.no")).toContainText("Your pick: No");
    // shown once: the next visit starts from here
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pricedin.picks.v1") || "{}").seen), { timeout: 8000 }).toBeGreaterThan(Date.UTC(2026, 10, 3, 7, 30));
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: "Your picks" })).toBeVisible();
    await expect(page.locator(".pf-picks")).toContainText("You called it · +30");
    await expect(page.locator(".pf-picks").first(), "no money in the picks").not.toContainText(/worth|becomes|USDC|profit/i);
    expect(g.laneKeys).toBe(0);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("the leaderboard: the free $1 score beside picks, for people only, and never in a rank", async ({ page, request }) => {
    await scenario(request, page, { scenario: "returning" }, { path: "/leaderboard", has: "Visitor 99r6yL" });
    const g = await guard(page);
    await page.addInitScript((key) => localStorage.setItem("pricedin.lane.mainnet.v1", key), secret);
    await page.goto("/leaderboard");
    await page.getByRole("button", { name: "All time" }).click();
    await expect(page.locator(".lbt th.lb-sc")).toHaveText("Free $1 score");
    await expect(page.locator(".lbt tr", { hasText: "Visitor 99r6yL" }).locator("td.lb-sc")).toHaveText("$1.20");
    await expect(page.locator(".lbt tr", { hasText: "The Quant" }).locator("td.lb-sc")).toHaveText("—");
    await expect(page.getByTestId("board-score")).toContainText("$1.20");
    await expect(page.locator("main")).toContainText("it doesn’t change a rank");
    expect(g.laneKeys).toBe(0);
  });

  test("the leaderboard: the AI traders beside people, the empty board said honestly, a nickname signed by the key", async ({ page, request }) => {
    await scenario(request, page, { scenario: "first" }, { path: "/leaderboard", lacks: "Visitor 99r6yL" });
    const g = await guard(page);
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Who calls it best");
    await expect(page.locator(".lbt")).toContainText("Nobody is ranked this week yet");
    for (const ai of ["The Archivist", "The Skeptic", "The Quant"]) await expect(page.locator(".lbt")).toContainText(ai);
    for (const p of ["This month", "All time"]) {
      await page.getByRole("button", { name: p }).click();
      await expect(page.getByRole("button", { name: p })).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByLabel("Your name on the board").fill("Ama Tester");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".lb-nick-m")).toHaveText("Saved. You’re Ama Tester on the board.");
    // a name that could pass for one of the AIs is refused in the API's words
    await page.getByLabel("Your name on the board").fill("The Quant");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".lb-nick-m")).toContainText("could be mistaken for Priced In or one of its AIs");
    // so is a name in two alphabets (the o here is Cyrillic), as the API says it
    await page.getByLabel("Your name on the board").fill("J\u043Ehn Fan");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".lb-nick-m")).toHaveText("A nickname keeps to one alphabet. Pick another.");
    expect(g.laneKeys).toBe(0);
    expect(g.errors.filter((e) => !/status of 400/.test(e)), g.errors.join("\n")).toEqual([]);
  });

  test("catch a mistake: the report goes in signed, and a refusal is the API's own sentence", async ({ page, request }) => {
    await scenario(request, page, { scenario: "refused" });
    const g = await guard(page);
    await page.goto("/c/9001");
    await expect(page.getByRole("heading", { name: "Think it’s wrong? Catch it." })).toBeVisible();
    await page.locator(".mk-head").getByRole("button", { name: "Report a mistake" }).click();
    const sheet = page.getByRole("dialog", { name: "Report a mistake" });
    await expect(sheet.getByTestId("report-send")).toBeDisabled();
    await expect(sheet).toContainText("This line’s own sources, an official site or an established news outlet.");
    await sheet.getByLabel("A page that shows it").fill("https://www.anthropic.com/news");
    await sheet.getByLabel("The exact words from that page").fill("Anthropic has filed for an initial public offering at a valuation of 1.5 trillion dollars");
    await sheet.getByTestId("report-send").click();
    await expect(sheet.getByTestId("report-status")).toContainText("Received");
    await expect(sheet.getByTestId("report-status")).toContainText("Refused", { timeout: 20_000 });
    await expect(sheet.getByTestId("report-status")).toContainText("We couldn't find those exact words at that page.");
    await expect(sheet.getByRole("button", { name: "Fix it and send again" })).toBeVisible();
    expect(g.laneKeys).toBe(0);
    noMoneySpent(g);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("catch a mistake: a page our Checker won't bond on says which do, in the API's words, and the wallet takes it from there", async ({ page, request }) => {
    await scenario(request, page, { scenario: "first" });
    const g = await guard(page);
    await page.goto("/c/9001");
    await expect(page.locator(".catch")).toContainText("an official site or an established news outlet");
    await expect(page.locator(".catch")).toContainText("Any public page will do");
    await page.locator(".mk-head").getByRole("button", { name: "Report a mistake" }).click();
    const sheet = page.getByRole("dialog", { name: "Report a mistake" });
    await sheet.getByLabel("A page that shows it").fill("https://example.org/my-own-page");
    await sheet.getByLabel("The exact words from that page").fill("the exact words from my own page");
    await sheet.getByTestId("report-send").click();
    const refusal = sheet.getByRole("alert");
    await expect(refusal).toContainText("Our Checker puts up its own money only on this line's own sources");
    await expect(refusal).toContainText("official sites and established news outlets");
    await expect(refusal).toContainText("challenge it yourself with your own bond.");
    await expect(refusal).not.toContainText("GET /api");
    await expect(refusal.getByRole("link").first()).toHaveAttribute("href", /^https:\/\/[a-z0-9.-]+$/);
    await expect(sheet.getByTestId("report-send")).toBeDisabled();
    // a different page takes the refusal away
    await sheet.getByLabel("A page that shows it").fill("https://example.org/another");
    await expect(refusal).toHaveCount(0);
    await sheet.getByTestId("report-send").click();
    await sheet.getByTestId("report-to-wallet").click();
    await expect(page.getByRole("dialog", { name: "Report a mistake" })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(g.laneKeys).toBe(0);
    noMoneySpent(g);
    expect(g.errors.filter((e) => !/status of 400/.test(e)), g.errors.join("\n")).toEqual([]);
  });

  test("a busy API: a pick lands on the second try by itself, and a report still busy says so in the API's words", async ({ page, request }) => {
    await scenario(request, page, { scenario: "first" });
    const g = await guard(page);
    const busy = { error: { code: "busy", message: "That didn't go through just now. Try again in a moment.", retryAfterS: 1 } };
    let picks = 0;
    await page.route(/\/api\/picks$/, (r) => (r.request().method() === "POST" && ++picks === 1 ? r.fulfill({ status: 503, json: busy }) : r.fallback()));
    await page.goto("/");
    const yes = page.locator(".tlead a.bet.yes");
    await yes.click();
    await expect(yes).toContainText("Your pick: Yes");
    expect(picks).toBe(2);
    await expect(page.locator(".pickerr")).toHaveCount(0);

    let reports = 0;
    await page.route(/\/api\/reports$/, (r) => { if (r.request().method() !== "POST") return r.fallback(); reports++; return r.fulfill({ status: 503, json: busy }); });
    await page.goto("/c/9001");
    await page.locator(".mk-head").getByRole("button", { name: "Report a mistake" }).click();
    const sheet = page.getByRole("dialog", { name: "Report a mistake" });
    await sheet.getByLabel("A page that shows it").fill("https://www.anthropic.com/news");
    await sheet.getByLabel("The exact words from that page").fill("the exact words from that page");
    await sheet.getByTestId("report-send").click();
    await expect(sheet.getByRole("alert")).toHaveText(busy.error.message);
    expect(reports).toBe(2);
    await expect(sheet.getByTestId("report-send")).toBeEnabled();
    expect(g.laneKeys).toBe(0);
    expect(g.errors.filter((e) => !/status of 503/.test(e)), g.errors.join("\n")).toEqual([]);
  });

  test("a report we couldn't finish reads Closed and gives its reason, on the line and on /portfolio", async ({ page, request }) => {
    await scenario(request, page, { scenario: "closed" });
    const g = await guard(page);
    await asReturning(page, secret);
    await page.goto("/c/9001");
    await expect(page.locator(".catch").getByTestId("report-status")).toContainText("Closed");
    await expect(page.locator(".catch").getByTestId("report-status")).toContainText("We couldn't finish this within two days. Send it again.");
    await page.goto("/portfolio");
    await expect(page.locator(".pf-why")).toContainText("We couldn't finish this within two days. Send it again.");
    expect(g.laneKeys).toBe(0);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("a line past its date waits, says why with the settler's note, and takes no picks or new bets", async ({ page, request }) => {
    await scenario(request, page, { scenario: "overdue" }, { path: "/", has: "Waiting for its source" });
    const g = await guard(page);
    await page.goto("/");
    await expect(page.locator(".tlist").filter({ hasText: "Settling next" })).toContainText("Waiting for its source");
    await page.goto("/c/9201");
    await expect(page.getByText("Its date has passed: it’s waiting for its source.")).toBeVisible();
    await expect(page.locator(".settler-note")).toContainText("no source has settled it yet");
    await expect(page.locator(".settler-note")).not.toContainText("receipt");
    await expect(page.getByRole("heading", { name: "Waiting for its result" })).toBeVisible();
    await expect(page.locator(".ticket .seg")).toHaveCount(0);
    expect(g.laneKeys).toBe(0);
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("a line with a bounty says what it pays", async ({ page, request }) => {
    await scenario(request, page, { scenario: "bounty" }, { path: "/c/9002", has: "$2.00 bounty" });
    const g = await guard(page);
    await page.goto("/c/9002");
    await expect(page.locator(".mk-head")).toContainText("$2.00 bounty");
    await expect(page.locator(".catch")).toContainText("paid to the first challenger proven right");
    expect(g.errors, g.errors.join("\n")).toEqual([]);
  });

  test("on a phone: the lead's Yes/No above the fold, and a returning browser's results before it", async ({ page, request }) => {
    await scenario(request, page, { scenario: "returning" });
    await guard(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const yes = await page.locator(".tlead a.bet.yes").boundingBox();
    const bar = await page.locator(".pnav").boundingBox();
    expect(yes!.y + yes!.height).toBeLessThanOrEqual(bar!.y);
    await expect(page.locator(".pnav")).toContainText("Leaderboard");
    await asReturning(page, secret);
    await page.goto("/");
    await expect(page.locator(".you").getByText("You called it")).toBeVisible();
    const you = await page.locator(".you").boundingBox();
    const lead = await page.locator(".tlead").boundingBox();
    expect(you!.y, "results first").toBeLessThan(lead!.y);
  });

  test("the stand-in is reachable, so this run really tested the news-on state", async ({ request }) => {
    const r = await request.get(MOCK);
    expect((await r.json()).news).toBe("on");
  });
});
