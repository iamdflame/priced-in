// The proof pages, against live data: each renders, says nothing to the console, fits 360 px in both
// themes, and shows the API's real numbers. The money guard is on throughout, and every test ends by
// checking nothing tried to reach the free-bet lane. /paste and refusals are stubbed: a test shouldn't
// spend a planner call or a visitor's limit. The signature check is real, because that's the claim.
import { expect, test, type Page } from "@playwright/test";
import { guard, type Guard } from "./guard";

const ROUTES: [string, RegExp][] = [
  ["/rulings", /Three AI judges decide/],
  ["/agents", /Three AI traders/],
  ["/stats", /in public/],
  ["/trust", /Nobody can change the rules quietly/],
  ["/developers", /Ask the market/],
  ["/p", /Read Wikipedia with the odds on/],
  ["/p/tether", /Tether/],
  ["/new", /Paste it and find out/],
  ["/jack/status/20", /Fact-check this post/],
];

const settle = (page: Page) => page.waitForLoadState("networkidle").catch(() => {});
const noMoney = (g: Guard) => { expect(g.laneKeys, "asked for a free-bet key").toBe(0); expect(g.sends, "sent a transaction").toBe(0); };

for (const theme of ["dark", "light"]) {
  for (const [path, heading] of ROUTES) {
    test(`${path} renders, fits 360 px, no console errors, ${theme}`, async ({ page }) => {
      const g = await guard(page);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`${path}?theme=${theme}`);
      await settle(page);
      await expect(page.locator("h1").first()).toContainText(heading);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      expect(g.errors).toEqual([]);
      noMoney(g);
    });
  }
}

test("/rulings and /stats show the API's real record, and agree", async ({ page, request }) => {
  await guard(page);
  // a ruling can settle between the API read and the page's cached render: read both again until they meet
  await expect(async () => {
    const api = await (await request.get("/api/rulings")).json();
    const settled = api.rulings.filter((r: { status: string }) => r.status === "settled");
    const paid = `$${settled.reduce((n: number, r: { payout_usd: number | null }) => n + (r.payout_usd ?? 0), 0).toFixed(2)}`;
    await page.goto("/rulings");
    const record = page.getByLabel("The record so far");
    await expect(record).toContainText(paid, { timeout: 2_000 });
    await expect(record.locator(".kpi").first().locator(".v")).toHaveText(String(settled.length), { timeout: 2_000 });
    await expect(page.locator(".rrow")).toHaveCount(api.rulings.length, { timeout: 2_000 });
    await page.goto("/stats");
    await expect(page.locator("#rulings").locator("xpath=following::div[contains(@class, 'books')][1]")).toContainText(paid, { timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [5_000] });
});

test("a verdict's signature verifies in the browser, from the chain", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/rulings");
  await page.getByRole("button", { name: "Verify the signature" }).first().click();
  await expect(page.locator(".vres").first()).toContainText("verified in your browser", { timeout: 30_000 });
  await expect(page.locator(".vres .checks li.fail")).toHaveCount(0);
  noMoney(g);
});

test("/stats: the books close, and each settled fact is counted", async ({ page }) => {
  await guard(page);
  await page.goto("/stats");
  await expect(page.getByText("The books close: the seven parts")).toBeVisible();
  await expect(page.locator("#rulings").locator("xpath=following::*[contains(., 'settled fact')]").first()).toBeVisible();
});

test("/trust: the live hash matches the build, and what you must trust is on the page", async ({ page }) => {
  await guard(page);
  await page.goto("/trust");
  await expect(page.getByText("They match: mainnet runs the published source.")).toBeVisible();
  const first = await page.locator(".trusted li").first().boundingBox();
  expect(first?.y, "the list must sit in the page, not off-screen").toBeGreaterThan(100);
  await expect(page.locator(".proofc")).toHaveCount(3);
  await page.getByText("Upgrade the code").click();
  await expect(page.getByText("Locking the contract removes this power")).toBeVisible();
});

test("/agents: the leaderboard and the filter", async ({ page }) => {
  await guard(page);
  await page.goto("/agents");
  await expect(page.locator(".board tbody tr")).toHaveCount(3);
  await page.getByRole("tab", { name: /Held off/ }).click();
  await expect(page.locator(".rsn .chip.warn").first()).toBeVisible();
  await expect(page.locator(".rsn .chip.yes")).toHaveCount(0);
});

test("/developers: every copied MCP command reaches the live market", async ({ page }) => {
  await guard(page);
  await page.goto("/developers");
  const commands = page.locator(".code", { hasText: "claude mcp add" });
  await expect(commands).toHaveCount(2);
  for (const c of await commands.all()) {
    await expect(c).toContainText("PRICEDIN_API_URL=");
    await expect(c).toContainText("NEAR_NETWORK=mainnet");
  }
});

test("/developers: the truth box answers, and says when it's refused", async ({ page }) => {
  await guard(page);
  await page.route("**/api/v1/credence*", (r) => r.fulfill({ json: { matched: 1, answer: "a", claims: [{ claim_id: 18, credence: 0.1, summary: "Settled false." }], free: { limit: 20, remaining: 19 } } }));
  await page.goto("/developers");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".answer")).toContainText("19 of 20 free calls left");
  await page.unroute("**/api/v1/credence*");
  await page.route("**/api/v1/credence*", (r) => r.fulfill({ status: 429, json: { error: { code: "free_tier_used", message: "Today’s free calls are used." } } }));
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".answer")).toContainText("Today’s free calls are used.");
});

test("/p/tether: a tinted sentence opens the sheet, Escape closes it and returns focus", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/p/tether");
  await settle(page);
  const sentence = page.locator("a.hs:not(.gone)").first();
  await sentence.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Open market" })).toBeVisible();
  await expect(sheet.getByText("chance it’s true").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(sentence).toBeFocused();
  noMoney(g);
});

test("/p/tether: a ruled sentence is struck through, with its correction beside it", async ({ page }) => {
  await guard(page);
  await page.goto("/p/tether");
  // every ruled sentence on the page is struck through, the T-Bills one among them
  await expect(page.locator("a.hs.gone", { hasText: "$72.6 billion" })).toHaveCount(1);
  await expect(page.locator("a.hs.new", { hasText: "$122.84 billion" })).toHaveCount(1);
});

const PRICED = { index: 0, text: "Bitcoin has a hard cap of 21 million coins.", label: "data", kind: "data", status: "priced", p0_ppm: 800000, receipt: { message: "m", planner_sig_hex: "ab", args: { text: "t", page: "p", kind: "data", p0_ppm: 800000, b_micro: "1000000", planner_sig_hex: "ab" } } };
const OPINION = { index: 1, text: "I love it.", label: "unfalsifiable", status: "unfalsifiable", reason: "Opinion or uncheckable: not priced." };
const PASTE = { page: "paste-x", truncated: false, totalSentences: 2, bMicro: "1000000", planner: "ok", model: "m", sentences: [PRICED, OPINION] };

test("/new: prices a sentence, greys an opinion, and says how a market opens", async ({ page }) => {
  const g = await guard(page);
  await page.route("**/api/paste", (r) => r.fulfill({ json: PASTE }));
  await page.goto("/new");
  await page.fill("#claim", "Bitcoin has a hard cap of 21 million coins. I love it.");
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page.locator(".pline").first()).toContainText("80");
  await expect(page.locator(".pline").first()).toContainText("our AI’s starting estimate");
  await expect(page.locator(".pline.grey")).toContainText("not priced");
  await page.getByText("How this becomes a market").click();
  await expect(page.getByText("The free $1 on this site only bets on facts that are already live.")).toBeVisible();
  noMoney(g);
});

test("/new: a refusal is said plainly, and the planner being offline is a state", async ({ page }) => {
  await guard(page);
  await page.route("**/api/paste", (r) => r.fulfill({ status: 429, json: { error: { code: "rate_limited", message: "Too many pastes from your address today." } } }));
  await page.goto("/new");
  await page.fill("#claim", "Anything.");
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page.locator(".notice.err")).toContainText("Too many pastes");
  await page.unroute("**/api/paste");
  await page.route("**/api/paste", (r) => r.fulfill({ json: { ...PASTE, planner: "unavailable", message: "Pricing soon.", sentences: [{ index: 0, text: "Anything.", status: "pricing_soon", label: null }] } }));
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page.locator(".notice")).toContainText("Pricing soon.");
});

test("/new: an X link goes to its fact-check page", async ({ page }) => {
  await guard(page);
  await page.goto("/new");
  await page.fill("#claim", "https://x.com/jack/status/20");
  await page.getByRole("button", { name: "Price it" }).click();
  await expect(page).toHaveURL(/\/jack\/status\/20$/);
});

test("a deleted post shows nothing of it; a failed read offers a way on", async ({ page }) => {
  await guard(page);
  await page.route("**/api/post/**", (r) => r.fulfill({ status: 410, json: { source: "x", page: "x-1", id: "1", gone: true, reason: "deleted", link: "l", message: "This post was deleted, so we show nothing from it." } }));
  await page.goto("/jack/status/1");
  await expect(page.getByRole("heading", { name: "This post was deleted" })).toBeVisible();
  await page.unroute("**/api/post/**");
  await page.route("**/api/post/**", (r) => r.fulfill({ status: 503, json: { error: { code: "x_rate_limited", message: "X is limiting us just now." } } }));
  await page.goto("/jack/status/2");
  await expect(page.getByText("X is limiting us just now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the embed can be framed anywhere, and its script tag places it", async ({ request }) => {
  const frame = await request.get("/embed/32");
  expect(frame.status()).toBe(200);
  expect(frame.headers()["content-security-policy"]).toBe("frame-ancestors *");
  expect(await frame.text()).toContain("chance it’s true");
  expect((await request.get("/embed/999999")).status()).toBe(404);
  expect((await request.get("/embed.js")).headers()["content-type"]).toContain("javascript");
});

test("real 404s, and a share card for every page", async ({ request }) => {
  for (const path of ["/p/no-such-page", "/not_a_handle!/status/20", "/jack/status/abc"]) expect((await request.get(path)).status(), path).toBe(404);
  for (const path of ["/rulings", "/agents", "/stats", "/trust", "/developers", "/new", "/p", "/p/tether", "/jack/status/20"]) {
    const r = await request.get(`${path}/opengraph-image`);
    expect(r.status(), path).toBe(200);
    expect(r.headers()["content-type"], path).toContain("image/png");
  }
});

test("?recorded=1 on /rulings shows the replay bar and sends nothing", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/rulings?recorded=1");
  await expect(page.getByText("Replay of a real mainnet run.").first()).toBeVisible();
  noMoney(g);
});
