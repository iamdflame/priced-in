// Real money, end to end, with a mock wallet and a pretend chain (./chain.ts): connect, deposit from
// NEAR and from another chain (1Click mocked), buy, sell, collect, withdraw, an outcome nobody can
// confirm, and a geofenced region. Every transaction the wallet is handed is checked as data. Nothing
// is signed and no real RPC receives a send: each test ends by checking that.
import { expect, test, type Page } from "@playwright/test";
import { floorBy, isFail, quoteWalletBuy } from "@/lib/money/quotes";
import { fmtMicroDown } from "@/lib/money/units";
import { guard, type Guard } from "../guard";
import { NEWS } from "../news";
import { ACCOUNT, FakeChain, type ClaimState } from "./chain";

const OPEN = 32;
const SETTLED = 18;
const DEPOSIT_ADDRESS = "0xe2e0000000000000000000000000000000000001";

function world() {
  const claims = new Map<number, ClaimState>([
    [OPEN, { id: OPEN, text: "e2e open fact", status: "Open", outcome: null, b_micro: "1450000", d0: "0", q_yes_micro: "0", q_no_micro: "0", fee_bps: 100 }],
    [SETTLED, { id: SETTLED, text: "e2e settled fact", status: "Settled", outcome: false, b_micro: "1450000", d0: "0", q_yes_micro: "1740974", q_no_micro: "4930100", fee_bps: 100 }],
  ]);
  return new FakeChain(claims);
}

async function setup(page: Page, chain: FakeChain): Promise<Guard> {
  const g = await guard(page);
  await chain.install(page);
  // the indexer's view of this account: one settled win to collect
  await page.route(/\/api\/portfolio\?trader=/, (route) => {
    const who = decodeURIComponent(new URL(route.request().url()).searchParams.get("trader") || "");
    if (who !== ACCOUNT) return route.fulfill({ json: { balance_usd: null, totals: {}, positions: [], history: [] } });
    const win = Number(chain.pos(SETTLED).no) / 1e6;
    return route.fulfill({ json: {
      balance_usd: Number(chain.balance) / 1e6, totals: {}, history: [],
      positions: win > 0 ? [{ claim_id: SETTLED, side: "no", shares: win, spent_usd: 1, received_usd: 0, value_usd: win, pnl_usd: win - 1, state: "won", redeemable: true, redeem_usd: win }] : [],
    } });
  });
  // 1Click, as its public API answers
  let polls = 0;
  await page.route("**/bridge/tokens", (r) => r.fulfill({ json: { routes: [
    { key: "base:USDC", chain: "base", chainName: "Base", symbol: "USDC", assetId: "nep141:base-usdc", decimals: 6, price: 1, addr: "evm", in: true, out: true, slowMin: 5 },
  ] } }));
  await page.route("**/bridge/quote?dir=*", async (r) => {
    const b = r.request().postDataJSON();
    await r.fulfill({ json: { quote: {
      dir: "in", route: b.route, depositAddress: b.dry ? null : DEPOSIT_ADDRESS, depositMemo: null,
      amountIn: b.amount, amountInFormatted: String(Number(b.amount) / 1e6), amountOut: String(Number(b.amount) - 600), amountOutFormatted: "4.9994", minAmountOut: "4949000",
      timeEstimate: 35, sendBy: new Date(Date.now() + 3_600_000).toISOString(), recipient: b.recipient, refundTo: b.recipient, refundsInIntents: true,
    } } });
  });
  await page.route("**/bridge/status?*", (r) => {
    polls++;
    const status = polls < 2 ? "PENDING_DEPOSIT" : "SUCCESS";
    if (status === "SUCCESS") chain.usdc += 4_999_400n;
    return r.fulfill({ json: { status, amountOut: status === "SUCCESS" ? "4999400" : null, refundedFormatted: null, refundReason: null, destinationTx: null, nearTxs: [] } });
  });
  return g;
}

const done = (g: Guard, chain: FakeChain) => {
  expect(chain.realSendsBlocked, "a transaction tried to reach a real NEAR RPC").toBe(0);
  expect(g.realSendsBlocked).toBe(0);
  expect(g.laneKeys, "asked for a free-bet key").toBe(0);
  expect(g.errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
};

async function connect(page: Page) {
  await page.getByTestId("pf-connect").click();
  await page.getByTestId("wallet-my-near-wallet").click();
  await expect(page.getByTestId("wallet-menu").first()).toBeVisible();
}

test("a connected session stays connected while slow wallet code loads, as on a cold CDN", async ({ page }) => {
  const chain = world();
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await page.waitForLoadState("networkidle").catch(() => {});
  // every chunk asked for from now on arrives 3 s late; wait until the last one is in, then a little more
  let late = 0;
  await page.route("**/_next/static/**/*.js", async (route) => { late++; await new Promise((r) => setTimeout(r, 3000)); await route.continue(); late--; });
  await connect(page);
  await expect.poll(async () => { await page.waitForTimeout(1500); return late; }, { timeout: 60_000 }).toBe(0);
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("pf-deposit")).toBeVisible({ timeout: 1000 });
  await expect(page.getByTestId("wallet-menu").first()).toBeVisible();
  done(g, chain);
});

test("connect, then deposit USDC already on NEAR", async ({ page }) => {
  const chain = world();
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.getByTestId("pf-deposit").click();
  const sheet = page.getByRole("dialog", { name: "Deposit" });
  await sheet.getByLabel("Amount").fill("10");
  await expect(sheet.getByTestId("approve")).toContainText("Move $10.00 USDC from your wallet into your Priced In balance.");
  await sheet.getByTestId("deposit-confirm").click();
  await expect(sheet.getByTestId("money-done")).toContainText("$10.00 added");
  expect(chain.sent.at(-1)).toMatchObject({ receiverId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", actions: [{ method: "ft_transfer_call", args: { receiver_id: "market.isitpriced.near", amount: "10000000", msg: "" }, depositYocto: "1" }] });
  expect(chain.balance).toBe(10_000_000n);
  done(g, chain);
});

test("deposit from another chain: quote, address and QR, tracked until it lands, then one tap moves it in", async ({ page }) => {
  const chain = world();
  chain.usdc = 0n;
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.getByTestId("pf-deposit").click();
  const sheet = page.getByRole("dialog", { name: "Deposit" });
  await expect(sheet.getByRole("tab", { name: "Another chain" })).toHaveAttribute("aria-selected", "true");
  await sheet.getByLabel(/You send/).fill("5");
  await expect(sheet.getByText("USDC arriving in your NEAR wallet")).toBeVisible();
  await sheet.getByTestId("bridge-start").click();
  await expect(sheet.getByTestId("deposit-address")).toContainText(DEPOSIT_ADDRESS);
  await expect(sheet.getByRole("img", { name: /Deposit address on Base/ }).locator("svg")).toBeVisible();
  await expect(sheet.getByText("Arrived in your NEAR wallet")).toBeVisible({ timeout: 20_000 });
  await sheet.getByTestId("move-in").click();
  await expect(sheet.getByTestId("money-done")).toContainText("Deposited");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "ft_transfer_call", args: { amount: "4999400" } });
  expect(chain.balance).toBe(4_999_400n);
  done(g, chain);
});

test("buy from the market page at the quoted fill with the slippage floor, then sell it back", async ({ page }) => {
  const chain = world();
  chain.balance = 10_000_000n;
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.goto(`/c/${OPEN}`);
  await page.getByTestId("wallet-bet").click();
  const sheet = page.getByRole("dialog", { name: "Bet with your wallet" });
  await sheet.getByRole("button", { name: /No, it’s false/ }).click();
  await sheet.getByLabel("Amount").fill("1");
  const q = quoteWalletBuy(chain.claims.get(OPEN)!, "no", 1_000_000n);
  if (isFail(q)) throw new Error(q.error);
  await expect(sheet.getByTestId("trade-get")).toContainText(fmtMicroDown(q.sharesMicro));
  await sheet.getByTestId("trade-confirm").click();
  await expect(sheet.getByTestId("money-done")).toContainText("You bet $1.00 on No");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "buy", args: { claim_id: OPEN, side: "no", amount_micro: "1000000", min_shares_micro: String(floorBy(q.sharesMicro, 200)) } });
  expect(chain.pos(OPEN).no).toBe(q.sharesMicro);
  await expect(sheet.getByRole("link", { name: /See the transaction/ })).toHaveAttribute("href", /nearblocks\.io\/txns\/E2eTx/);
  await sheet.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await page.getByRole("button", { name: "Sell" }).click();
  const sell = page.getByRole("dialog", { name: "Sell your shares" });
  await expect(sell.getByLabel(/No shares to sell/)).toHaveValue(String(Number(q.sharesMicro) / 1e6));
  await sell.getByTestId("trade-confirm").click();
  await expect(sell.getByTestId("money-done")).toContainText("Sold for");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "sell", args: { claim_id: OPEN, side: "no", shares_micro: String(q.sharesMicro) } });
  expect(chain.pos(OPEN).no).toBe(0n);
  done(g, chain);
});

test("collect a settled win, then withdraw to the NEAR wallet", async ({ page }) => {
  const chain = world();
  chain.pos(SETTLED).no = 1_810_000n;
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.getByTestId(`collect-${SETTLED}`).click();
  const sheet = page.getByRole("dialog", { name: "You called it" });
  await expect(sheet.getByTestId("approve")).toContainText("Collect $1.81 of winnings");
  await sheet.getByTestId("collect-confirm").click();
  await expect(sheet.getByTestId("money-done")).toContainText("$1.81 collected");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "redeem", args: { claim_id: SETTLED } });

  await sheet.getByRole("button", { name: "Withdraw" }).click();
  const wd = page.getByRole("dialog", { name: "Withdraw" });
  await wd.getByLabel("Amount").fill("1.81");
  await wd.getByTestId("withdraw-confirm").click();
  await expect(wd.getByTestId("money-done")).toContainText("$1.81 withdrawn");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "withdraw", args: { amount_micro: "1810000" } });
  expect(chain.balance).toBe(0n);
  done(g, chain);
});

test("challenge a line with your own $1 bond: the page and its words go in as evidence, one call, then the judges are asked", async ({ page }) => {
  test.skip(!NEWS, "catching a mistake needs today's news on");
  const chain = world();
  chain.balance = 5_000_000n;
  const g = await setup(page, chain);
  let asked = 0;
  await page.route(/\/api\/after-challenge$/, (r) => { asked++; return r.fulfill({ json: { status: "e2e: not asked" } }); });
  await page.goto("/portfolio");
  await connect(page);
  await page.goto(`/c/${OPEN}`);
  await page.getByTestId("challenge-open").click();
  const sheet = page.getByRole("dialog", { name: "Challenge with your bond" });
  await expect(sheet).toContainText("If you’re wrong:");
  await expect(sheet.getByTestId("challenge-confirm")).toBeDisabled();
  await sheet.getByLabel("A public page that shows it").fill("https://example.org/a-newer-source");
  await sheet.getByLabel("The exact words from that page").fill("a newer source says otherwise");
  await sheet.getByTestId("challenge-confirm").click();
  await expect(sheet.getByTestId("money-done")).toContainText("Challenge sent");
  expect(chain.sent.at(-1)?.actions).toHaveLength(1);
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "challenge", args: { claim_id: OPEN, claimed_outcome: false, evidence: 'This line is FALSE.\nSource: https://example.org/a-newer-source\nReceipt excerpt: "a newer source says otherwise"' } });
  expect(chain.balance).toBe(4_000_000n);
  await expect.poll(() => asked).toBe(1);
  done(g, chain);
});

test("a page our Checker won't bond on goes to the wallet with the words already typed", async ({ page }) => {
  test.skip(!NEWS, "catching a mistake needs today's news on");
  const chain = world();
  chain.balance = 5_000_000n;
  const g = await setup(page, chain);
  await page.route(/\/api\/after-challenge$/, (r) => r.fulfill({ json: { status: "e2e: not asked" } }));
  await page.goto("/portfolio");
  await connect(page);
  await page.goto(`/c/${OPEN}`);
  await page.locator(".catch").getByRole("button", { name: "Report a mistake" }).click();
  const report = page.getByRole("dialog", { name: "Report a mistake" });
  await report.getByLabel("A page that shows it").fill("https://example.org/a-newer-source");
  await report.getByLabel("The exact words from that page").fill("a newer source says otherwise");
  await report.getByTestId("report-send").click();
  await expect(report.getByRole("alert")).toContainText("official sites and established news outlets");
  await report.getByTestId("report-to-wallet").click();
  const sheet = page.getByRole("dialog", { name: "Challenge with your bond" });
  await expect(sheet.getByLabel("A public page that shows it")).toHaveValue("https://example.org/a-newer-source");
  await expect(sheet.getByLabel("The exact words from that page")).toHaveValue("a newer source says otherwise");
  await sheet.getByTestId("challenge-confirm").click();
  await expect(sheet.getByTestId("money-done")).toContainText("Challenge sent");
  expect(chain.sent.at(-1)?.actions[0]).toMatchObject({ method: "challenge", args: { claim_id: OPEN } });
  done(g, chain);
});

test("a withdrawal to a wallet that can't hold USDC registers it first, in the same flow", async ({ page }) => {
  const chain = world();
  chain.balance = 2_000_000n;
  chain.registered = false;
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.getByTestId("pf-withdraw").click();
  const wd = page.getByRole("dialog", { name: "Withdraw" });
  await wd.getByLabel("Amount").fill("2");
  await expect(wd.getByTestId("approve")).toContainText("2 steps");
  await wd.getByTestId("withdraw-confirm").click();
  await expect(wd.getByTestId("money-done")).toBeVisible();
  expect(chain.sent.slice(-2).map((t) => t.actions[0].method)).toEqual(["storage_deposit", "withdraw"]);
  done(g, chain);
});

test("an outcome nobody can confirm never reads as success, and the button stays shut", async ({ page }) => {
  const chain = world();
  chain.nextUnknown = true;
  const g = await setup(page, chain);
  await page.goto("/portfolio");
  await connect(page);
  await page.getByTestId("pf-deposit").click();
  const sheet = page.getByRole("dialog", { name: "Deposit" });
  await sheet.getByLabel("Amount").fill("5");
  await sheet.getByTestId("deposit-confirm").click();
  await expect(sheet.getByRole("alert")).toContainText("We can’t confirm this yet.");
  await expect(sheet.getByTestId("deposit-confirm")).toBeDisabled();
  await expect(sheet.getByTestId("money-done")).toHaveCount(0);
  done(g, chain);
});

// The region comes from x-vercel-ip-country. A local server takes it from the request, so a test can be
// in the US; Vercel's edge overwrites it with the runner's real country, so against a deployment the test
// can only (and must) prove that a claimed country is ignored.
async function honoursClaimedCountry(request: import("@playwright/test").APIRequestContext) {
  const r = await request.get("/terms", { headers: { "x-vercel-ip-country": "US" } });
  return /pi_geo=close_only\.US/.test(r.headers()["set-cookie"] ?? "");
}

test("a country the visitor claims doesn't move the geofence on a deployment", async ({ request }) => {
  test.skip(await honoursClaimedCountry(request), "a local server takes the country from the request; this checks a deployment");
  // whatever the runner's real region is, claiming another one changes nothing
  const geo = async (headers: Record<string, string>) => /pi_geo=([^;]+)/.exec((await request.get("/terms", { headers })).headers()["set-cookie"] ?? "")?.[1] ?? null;
  const quote = async (headers: Record<string, string>) => (await request.post("/bridge/quote?dir=in", { headers, data: { route: "base:USDC", amount: "5000000", recipient: ACCOUNT, dry: true } })).status();
  for (const claimed of ["US", "IR"]) {
    expect(await geo({ "x-vercel-ip-country": claimed }), `claiming ${claimed} changed the region`).toBe(await geo({}));
    expect(await quote({ "x-vercel-ip-country": claimed }), `claiming ${claimed} changed the answer to a deposit quote`).toBe(await quote({}));
  }
});

test.describe("from a close-only region (US)", () => {
  test.use({ extraHTTPHeaders: { "x-vercel-ip-country": "US" } });

  test("no money goes in, existing money can leave, and the server refuses a deposit address", async ({ page, request }) => {
    test.skip(!(await honoursClaimedCountry(request)), "the host sets the country itself (Vercel): run against next start");
    const chain = world();
    chain.balance = 3_000_000n;
    const g = await setup(page, chain);
    await page.unroute("**/bridge/quote?dir=*");
    await page.goto("/portfolio");
    await connect(page);
    await expect(page.getByText(/From the United States you can sell, collect and withdraw/).first()).toBeVisible();
    await expect(page.getByTestId("pf-deposit")).toHaveCount(0);
    await expect(page.getByTestId("pf-withdraw")).toBeVisible();
    await page.goto(`/c/${OPEN}`);
    await expect(page.getByTestId("wallet-bet")).toHaveCount(0);
    const refused = await request.post("/bridge/quote?dir=in", { data: { route: "base:USDC", amount: "5000000", recipient: ACCOUNT, dry: true } });
    expect(refused.status()).toBe(451);
    done(g, chain);
  });
});
