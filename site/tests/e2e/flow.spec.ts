// Home → market → free bet → receipt (live, with the lane and the chain intercepted), and the replay of
// the real mainnet run. Neither spends a cent: see guard.ts.
import { expect, test } from "@playwright/test";
import { guard, noMoneySpent } from "./guard";

test("home → market → free bet → receipt", async ({ page }) => {
  const trade = { claimId: 0, side: "no" as const, beforePpm: 400000, afterPpm: 318000, sharesMicro: "1398001" };
  const g = await guard(page, trade);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bet on whether facts are true." })).toBeVisible();
  await expect(page.getByText("Pick true or false")).toBeVisible();
  await expect(page.getByText("3 AI judges decide")).toBeVisible();
  await expect(page.getByText("Right answers get paid")).toBeVisible();
  // no key is asked for on a page view
  expect(g.laneKeys).toBe(0);

  // tap No on the first card in the grid
  const no = page.locator(".grid a.bet.no").first();
  await expect(no).toContainText("No, it’s false");
  await expect(no).toContainText(/Right: \$1 becomes \$\d\.\d\d/);
  trade.claimId = Number(/\/c\/(\d+)/.exec((await no.getAttribute("href"))!)![1]);
  await no.click();
  await expect(page).toHaveURL(`/c/${trade.claimId}?side=no`);
  await expect(page.getByText("What Wikipedia says (what you’re betting on)")).toBeVisible();

  // the side is picked; the quote says what $1 gets back
  const pickNo = page.getByRole("button", { name: /No, it’s false/ }).first();
  await expect(pickNo).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("If you’re right, $1 becomes", { exact: true })).toBeVisible();
  await expect(page.getByText("If you’re wrong, the free $1 is gone.")).toBeVisible();
  await page.getByTestId("confirm").click();

  // the receipt
  const receipt = page.getByRole("dialog", { name: /You bet \$1 that it’s false/ });
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(receipt.getByTestId("settled")).toContainText(/Settled on NEAR in \d+\.\d s/);
  await expect(receipt.getByText("chance it’s true").first()).toBeVisible();
  // the hash is the one this browser signed
  await expect(receipt.locator("a.hashv")).toHaveAttribute("href", /^https:\/\/nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  await expect(receipt.getByRole("button", { name: "Share on X" })).toBeVisible();
  expect(g.laneKeys).toBe(1);
  expect(g.sends).toBeGreaterThan(0);
  noMoneySpent(g);

  // closed, the ticket remembers the free $1 is used
  await receipt.getByRole("button", { name: "Close the receipt" }).click();
  await expect(page.getByText(/You’ve placed your free \$1/)).toBeVisible();
  expect(g.errors, g.errors.join("\n")).toEqual([]);
});

test("a free bet the lane refuses says why, before and after the tap", async ({ page }) => {
  const g = await guard(page);
  await page.route(/\/(api\/)?lane\/key$/, (route) => route.fulfill({ status: 429, json: { error: { code: "lane_daily_cap", message: "Today’s free bets are all taken. Every price still updates live; come back tomorrow." } } }));
  await page.goto("/c/32");
  await page.getByRole("button", { name: /Yes, it’s true/ }).first().click();
  await expect(page.getByText(/Today’s free bets are all taken/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch a replay" }).first()).toBeVisible();
  noMoneySpent(g);
});

test("the replay of the real mainnet run: bet, signed rewrite verified in the browser, reply, ruling", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/c/18?recorded=1");
  await expect(page.getByText("Replay of a real mainnet run.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Replay the free $1" })).toBeVisible();
  await page.getByRole("button", { name: /No, it’s false/ }).first().click();
  await page.getByTestId("confirm").click();
  const receipt = page.getByRole("dialog", { name: /You bet \$1 that it’s false/ });
  await expect(receipt).toBeVisible({ timeout: 20_000 });
  await expect(receipt.getByText(/Replay · final on NEAR in block 223,236,617/)).toBeVisible();
  await expect(receipt.getByText("23%", { exact: true })).toBeVisible();
  // the rewrite NEAR AI Cloud signed, 4.3 s after the bet, checked here against the model's key on the market
  await expect(receipt.getByText(/U.S. T-Bills, which Tether's attestation report/)).toBeVisible({ timeout: 20_000 });
  await expect(receipt.getByTestId("sig-ok")).toBeVisible({ timeout: 30_000 });
  // the Skeptic's reply, 12 s after the bet
  await expect(receipt.getByText(/The Skeptic, an AI trader, replied/)).toBeVisible({ timeout: 25_000 });
  await receipt.getByRole("button", { name: "Close the receipt" }).click();
  // then the ruling plays
  await expect(page.getByText("All three AI judges ruled it false")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("heading", { name: "Ruled FALSE by 3 AI judges" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /See the new market/ })).toHaveAttribute("href", "/c/32");
  expect(g.laneKeys).toBe(0);
  expect(g.sends).toBe(0);
  noMoneySpent(g);
  expect(g.errors, g.errors.join("\n")).toEqual([]);
});

test("a fact that doesn't exist is a real 404", async ({ page }) => {
  const r = await page.goto("/c/99999");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "There’s no fact here" })).toBeVisible();
});

test("film mode: no replay bar or hint, still countdowns and strip, carried across links, no key asked for", async ({ page }) => {
  const g = await guard(page);
  await page.goto("/?film=1");
  await expect(page.locator("html")).toHaveAttribute("data-film", "1");
  await expect(page.locator(".coach")).toBeHidden();
  const clock = page.locator("#deciding .big");
  const strip = page.locator(".tape");
  const [c0, s0] = [await clock.textContent(), await strip.textContent()];
  await page.waitForTimeout(6_500);
  expect(await clock.textContent()).toBe(c0);
  expect(await strip.textContent()).toBe(s0);
  // carried across an internal link, the replay bar stays hidden and a pick asks for no key
  await page.goto("/c/18?recorded=1");
  await expect(page.locator("html")).toHaveAttribute("data-film", "1");
  await expect(page.getByText("Replay of a real mainnet run.")).toBeHidden();
  await page.goto("/c/32");
  await page.getByRole("button", { name: /Yes, it’s true/ }).first().click();
  await page.waitForTimeout(1_500);
  expect(g.laneKeys).toBe(0);
  // ?film=0 ends it
  await page.goto("/?film=0");
  await expect(page.locator("html")).not.toHaveAttribute("data-film", "1");
  noMoneySpent(g);
});

test("a ruled fact offers no bet: the result, and a link to the corrected question", async ({ page }) => {
  await guard(page);
  await page.goto("/c/18");
  await expect(page.getByText("No won.")).toBeVisible();
  await expect(page.locator(".ticket .seg")).toHaveCount(0);
  await expect(page.getByText("A newer source disagrees")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /See the corrected question/ })).toHaveAttribute("href", "/c/32");
});
