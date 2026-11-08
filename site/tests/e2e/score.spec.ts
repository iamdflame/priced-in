// The free $1's score, in both states: once the free $1 is spent, a browser whose free bet grew bets that
// score again from the same key (its own balance, so no new money moves), worded as score that can't be
// cashed out; /portfolio adds a won free bet to the score. The score's own read (/api/portfolio for the
// browser's lane identity) is answered here, and the guard's fake lane and chain take the transactions:
// nothing reaches a real NEAR RPC.
import { expect, test, type Page } from "@playwright/test";
import { guard, noMoneySpent } from "./guard";

// A throwaway test key, made for this spec: it is an access key on no account, mainnet or testnet
// (checked with view_access_key on 2026-11-08), and the API it talks to here is mocked. Not a secret.
const KEY = "ed25519:3gLuUsyNyCDwquvwZaxjHD5Zye6khkKQncSPz8b5qRvQzBpw8AYM6UGdnjZvsMzXPxWvzvvsrB1j5K5nmq8MhXnX";

/** A browser that spent its free $1 on the T-Bills fact and has `balance` of score; won bets still to add as given. */
async function spentFreeBet(page: Page, balance: number, positions: object[] = []) {
  await page.addInitScript((key) => {
    localStorage.setItem("pricedin.lane.mainnet.v1", key);
    localStorage.setItem("pricedin.bets.v1", JSON.stringify([{ claimId: 18, question: "Are most of Tether’s cash reserves U.S. T-Bills?", side: "no", tx: null, at: 1, shares: 1.2 }]));
  }, KEY);
  await page.route(/\/api\/portfolio\?trader=lane%3A/, (r) => r.fulfill({ json: {
    balance_usd: balance, totals: { value_usd: 0, spent_usd: 1, received_usd: balance, pnl_usd: balance - 1, redeemable_usd: 0, positions: positions.length },
    positions, history: [],
  } }));
}

test("with score to spare, the ticket bets the score: worded as score, the browser's own balance, a receipt that says so", async ({ page }) => {
  const trade = { claimId: 31, side: "no" as const, beforePpm: 500000, afterPpm: 410000, sharesMicro: "2210000" };
  const g = await guard(page, trade);
  await spentFreeBet(page, 1.2);
  await page.goto("/c/31");
  const ticket = page.getByRole("complementary", { name: "Bet ticket" });
  await expect(ticket.getByRole("heading", { name: /Bet your score/ })).toBeVisible();
  await expect(ticket).toContainText("Score, not cash");
  await expect(ticket).toContainText("$1.20 of score");
  await expect(ticket).toContainText("Score can’t be cashed out");
  await expect(ticket.getByText("You’ve already placed your free $1.")).toHaveCount(0);
  const no = ticket.locator(".seg .n");
  await no.click();
  await expect(no).toContainText(/Right: it becomes \$\d\.\d\d/);
  await expect(page.getByTestId("confirm")).toHaveText("Bet $1.20 of score: No, it’s false");
  await expect(ticket).toContainText("If you’re wrong, that score is gone.");
  await page.getByTestId("confirm").click();
  const receipt = page.getByRole("dialog", { name: /You bet \$1\.20 of score that it’s false/ });
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(receipt).toContainText("That score is gone");
  expect(g.laneKeys, "the key already on the lane is reused").toBe(1);
  expect(g.sends).toBeGreaterThan(0);
  noMoneySpent(g);
});

test("with no score, the spent free $1 says so, and nothing more is offered", async ({ page }) => {
  const g = await guard(page);
  await spentFreeBet(page, 0);
  await page.goto("/c/31");
  const ticket = page.getByRole("complementary", { name: "Bet ticket" });
  await expect(ticket.getByText("You’ve already placed your free $1.")).toBeVisible();
  await expect(ticket.getByRole("heading", { name: /Bet your free \$1/ })).toBeVisible();
  noMoneySpent(g);
});

test("/portfolio: a free $1 credited but not bet yet is still the free $1, not a score", async ({ page }) => {
  await guard(page);
  await page.addInitScript((key) => localStorage.setItem("pricedin.lane.mainnet.v1", key), KEY);
  await page.route(/\/api\/portfolio\?trader=lane%3A/, (r) => r.fulfill({ json: { balance_usd: 1, totals: { value_usd: 0, spent_usd: 0, received_usd: 0, pnl_usd: 0, redeemable_usd: 0, positions: 0 }, positions: [], history: [] } }));
  await page.goto("/portfolio");
  const free = page.locator("section[aria-labelledby='pf-free']");
  await expect(free.getByRole("heading", { name: "Your free $1 is ready" })).toBeVisible();
  await expect(free.getByText("Your score", { exact: true })).toHaveCount(0);
});

test("/portfolio: a collected free bet says what it added to the score, not what it's worth", async ({ page }) => {
  await guard(page);
  await spentFreeBet(page, 1.2, [{ claim_id: 18, side: "no", shares: 0, spent_usd: 1, received_usd: 1.2, value_usd: 0, pnl_usd: 0.2, state: "collected", redeemable: false, redeem_usd: 0 }]);
  await page.goto("/portfolio");
  const free = page.locator("section[aria-labelledby='pf-free']");
  await expect(free).toContainText("Added to your score");
  await expect(free).not.toContainText("Worth");
});

test("/portfolio: the score, what's ready to bet again, and a won free bet added to it with the browser's own key", async ({ page }) => {
  const g = await guard(page, { claimId: 18, side: "no", beforePpm: 99800, afterPpm: 99800, sharesMicro: "1203049" });
  await spentFreeBet(page, 0.6, [{ claim_id: 18, side: "no", shares: 1.203049, spent_usd: 1, received_usd: 0, value_usd: 1.203049, pnl_usd: 0.203049, state: "won", redeemable: true, redeem_usd: 1.203049 }]);
  await page.goto("/portfolio");
  const free = page.locator("section[aria-labelledby='pf-free']");
  await expect(free.getByText("Your score", { exact: true })).toBeVisible();
  await expect(free).toContainText("$1.80");
  await expect(free.getByText("Ready to bet again", { exact: true })).toBeVisible();
  await expect(free.getByTestId("score-bet")).toHaveAttribute("href", "/#facts");
  await expect(free).toContainText("can’t be cashed out");
  await free.getByTestId("score-collect-18").click();
  await expect.poll(() => g.sends, { timeout: 20_000 }).toBeGreaterThan(0);
  noMoneySpent(g);
});
