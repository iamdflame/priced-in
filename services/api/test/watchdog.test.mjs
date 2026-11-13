// The watchdog's thresholds (scripts/watchdog.mjs): a FAIL emails the founder, a WARN never does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiState, checkerBondState, freeBetState, houseState, juryKeysState, marketStorageState, newsState, relayerState, sentinelState, RESERVE_ENDS, TWO_BONDS_UNTIL } from "../../../scripts/watchdog.mjs";

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

test("watchdog: a bond posted on the ruling in progress counts as covered", () => {
  // every sitting on 13 November: $2.95 in hand, $1 of it posted, and the run failed twice
  assert.equal(checkerBondState(1.95, 1, before).state, "FAIL", "with no ruling in progress, $1.95 is short of two bonds");
  assert.equal(checkerBondState(1.95, 1, before, 1).state, "WARN");
  assert.match(checkerBondState(1.95, 1, before, 1).detail, /\$1\.95 for a \$1\.00 bond, and 1 posted on the ruling in progress; 2 bonds needed/);
  assert.equal(checkerBondState(0.95, 1, before, 1).state, "FAIL", "nothing to spare behind the posted bond");
  assert.equal(checkerBondState(2, 1, before, 1).state, "PASS");
});

test("watchdog: failed AI calls FAIL by their share of the day's calls, not by their count", () => {
  const ai = (refusals, calls, by_status) => ({ ok: false, calls, refusals, by_status });
  const busy = aiState(ai(29, 819, { 200: 790, 429: 11, 502: 2, network: 16 }));
  assert.equal(busy.state, "WARN", "13 November: 3.5% of 819 calls, the judges sat twice");
  assert.equal(busy.detail, "NEAR AI refused or failed 29 of 819 model calls today, 3.5% (11 HTTP 429, 2 HTTP 502, 16 network)");
  assert.equal(aiState(ai(82, 819)).state, "FAIL");
  assert.equal(aiState(ai(21, 40)).state, "FAIL");
  assert.equal(aiState(ai(5, 0)).state, "FAIL", "failures with no call counted can't be a small share");
  assert.equal(aiState({ ok: true, calls: 819, refusals: 29 }), null);
  assert.equal(aiState(null), null);
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

test("watchdog: a treasury short for the next news line WARNs; no new line for over 26 hours FAILs", () => {
  const short = "The treasury can carry $0.21 more of reserves, less than the $0.40 the last line reserved: the next line won't open until money is added (scripts/mainnet/news-funding.mjs).";
  assert.equal(newsState({ enabled: true, ok: true, hours_since: 3 }), null, "fine news says nothing beyond the API row");
  assert.equal(newsState({ enabled: false, ok: true }), null, "news switched off is not a failure");
  assert.equal(newsState(undefined), null, "an API without the news check is not a failure");
  assert.equal(newsState({ enabled: true, ok: false, hours_since: 9.2, note: short }).state, "WARN", "the 9 November case: short, but a line opened 9 hours ago");
  assert.match(newsState({ enabled: true, ok: false, hours_since: 9.2, note: short }).detail, /news-funding/);
  const shortRoom = { reserve_room_usd: 0.21, last_line_reserve_usd: 0.4 };
  assert.equal(newsState({ enabled: true, ok: false, hours_since: 26, ...shortRoom }).state, "WARN");
  assert.equal(newsState({ enabled: true, ok: false, hours_since: 26.1, ...shortRoom }).state, "FAIL", "short treasury and a board that stopped moving: the owner can fix it");
  assert.equal(newsState({ enabled: true, ok: false, hours_since: 30, reserve_room_usd: 3, last_line_reserve_usd: 0.4 }).state, "WARN", "room enough, stale for another reason (NEAR AI down): 48 h before it fails");
  assert.equal(newsState({ enabled: true, ok: false, hours_since: 48.5, reserve_room_usd: 3, last_line_reserve_usd: 0.4 }).state, "FAIL");
  assert.equal(newsState({ enabled: true, ok: false, hours_since: null, note: "No news line has opened yet." }).state, "FAIL");
});

test("watchdog: AI judges' keys that NEAR AI couldn't serve WARN; a wrong or unverified key FAILs", () => {
  const unread = (m) => ({ model: m, status: "unread", detail: "NEAR AI Cloud's attestation report did not answer: /attestation/report answered HTTP 500" });
  assert.equal(juryKeysState({ ok: true, complete: true, models: [] }), null);
  assert.equal(juryKeysState(undefined), null);
  const outage = { ok: false, complete: false, attempts: 3, models: [unread("a"), unread("b"), unread("c")], note: "a, b, c could not be checked (attempt 3 of 3)." };
  assert.equal(juryKeysState(outage).state, "WARN", "the 10 November outage: all three unread");
  assert.match(juryKeysState(outage).detail, /still verifies every verdict/);
  assert.equal(juryKeysState({ ...outage, models: [unread("a"), { model: "b", status: "mismatch" }, unread("c")] }).state, "FAIL", "a changed key fails even during an outage");
  assert.equal(juryKeysState({ ok: false, models: [{ model: "a", status: "not_registered" }] }).state, "FAIL");
  assert.equal(juryKeysState({ ok: false, models: [{ model: "a", status: "unverified" }] }).state, "FAIL", "a report that came back and didn't verify fails");
  assert.equal(juryKeysState({ ok: false, models: [] }).state, "FAIL", "not ok with nothing to show fails");
});

test("watchdog: the house agents, the x402 relayer and the Sentinel only ever WARN", () => {
  assert.equal(houseState(0.39).state, "WARN");
  assert.equal(houseState(0.74).state, "PASS");
  assert.equal(houseState(2.5).state, "PASS");
  assert.equal(relayerState(0.049).state, "WARN");
  assert.equal(relayerState(0.2).state, "PASS");
  assert.equal(sentinelState(0.09, 10, 1).state, "PASS");
  assert.equal(sentinelState(0.02, 10, 1).state, "WARN");
  assert.equal(sentinelState(0.09, 1.5, 1).state, "WARN", "less than a first dispute bond (twice the challenge bond)");
  for (const s of [houseState(0), relayerState(0), sentinelState(0, 0, 1)]) assert.notEqual(s.state, "FAIL");
});
