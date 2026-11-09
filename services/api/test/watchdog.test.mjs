// The watchdog's thresholds (scripts/watchdog.mjs): a FAIL emails the founder, a WARN never does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkerBondState, freeBetState, houseState, marketStorageState, relayerState, sentinelState, RESERVE_ENDS, TWO_BONDS_UNTIL } from "../../../scripts/watchdog.mjs";

const before = Date.parse("2026-11-12T10:00:00Z");
const judging = Date.parse("2026-11-16T10:00:00Z");
const after = Date.parse("2026-11-18T10:00:00Z");

test("watchdog: importing it runs no check (the checks run only as a script)", () => {
  assert.equal(typeof checkerBondState, "function");
  assert.equal(process.exitCode ?? 0, 0);
});

test("watchdog: the Checker's bond balance must cover two bonds until 17 November 15:00 UTC, then one", () => {
  assert.equal(TWO_BONDS_UNTIL, Date.parse("2026-11-17T15:00:00Z"));
  assert.equal(checkerBondState(1.99, 1, before).state, "FAIL");
  assert.equal(checkerBondState(2.95, 1, before).state, "WARN", "two bonds covered, not a third");
  assert.equal(checkerBondState(3, 1, before).state, "PASS");
  assert.equal(checkerBondState(1.5, 1, TWO_BONDS_UNTIL - 1).state, "FAIL");
  assert.equal(checkerBondState(1.5, 1, TWO_BONDS_UNTIL).state, "WARN", "from the 17 November sitting, one bond is enough");
  assert.equal(checkerBondState(0.99, 1, after).state, "FAIL");
  assert.equal(checkerBondState(2, 1, after).state, "PASS");
  assert.match(checkerBondState(1.5, 1, before).detail, /\$1\.50 for a \$1\.00 bond; 2 bonds needed until 17 November 15:00 UTC: fund it with scripts\/mainnet\/checker\.mjs/);
});

test("watchdog: the market's storage NEAR fails below 0.35 (it used to fail only below 0.1)", () => {
  assert.equal(marketStorageState(0.349).state, "FAIL");
  assert.equal(marketStorageState(0.35).state, "WARN");
  assert.equal(marketStorageState(0.561).state, "PASS");
});

test("watchdog: the free $1 is a WARN while held for the judges, and fails below three from 15 November", () => {
  assert.equal(RESERVE_ENDS, Date.parse("2026-11-15T00:00:00Z"));
  const held = { available: false, held_for_judges: 4, held_until: "2026-11-15T00:00:00.000Z", credits_left: 4, reason: "lane_used_up" };
  assert.deepEqual([freeBetState(held, before).state, freeBetState(held, before).name], ["WARN", "the free $1 is held for the judges"]);
  assert.equal(freeBetState({ available: true, credits_left: 2 }, before).state, "WARN", "before the 15th, the old thresholds");
  assert.equal(freeBetState({ available: false, credits_left: 0, reason: "lane_used_up" }, before).state, "FAIL");
  assert.equal(freeBetState({ available: true, credits_left: 2 }, judging).state, "FAIL", "from the 15th, fewer than three fails");
  assert.equal(freeBetState({ available: true, credits_left: 3 }, judging).state, "WARN");
  assert.equal(freeBetState({ available: true, credits_left: 11 }, judging).state, "PASS");
  assert.equal(freeBetState(held, judging).state, "FAIL", "a hold still on after its date is an outage");
  assert.equal(freeBetState({ available: false, credits_left: 9, reason: "lane_unavailable" }, judging).state, "FAIL");
  // a limit set on purpose is a WARN: today's 8, or this runner's address
  assert.equal(freeBetState({ available: false, credits_left: 9, reason: "lane_daily_cap" }, judging).state, "WARN");
  assert.equal(freeBetState({ available: false, credits_left: 9, reason: "rate_limited" }, before).state, "WARN");
  assert.equal(freeBetState({ available: false, credits_left: 2, reason: "lane_daily_cap" }, judging).state, "FAIL", "capped and nearly out is still a FAIL");
});

test("watchdog: the house agents, the x402 relayer and the Sentinel only ever WARN", () => {
  assert.equal(houseState(0.74).state, "WARN");
  assert.equal(houseState(2.5).state, "PASS");
  assert.equal(relayerState(0.049).state, "WARN");
  assert.equal(relayerState(0.2).state, "PASS");
  assert.equal(sentinelState(0.09, 10, 1).state, "PASS");
  assert.equal(sentinelState(0.02, 10, 1).state, "WARN");
  assert.equal(sentinelState(0.09, 1.5, 1).state, "WARN", "less than a first dispute bond (twice the challenge bond)");
  for (const s of [houseState(0), relayerState(0), sentinelState(0, 0, 1)]) assert.notEqual(s.state, "FAIL");
});
