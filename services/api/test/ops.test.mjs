// The operating signals: the spend meter's refusals and call counts (api/_lib/spend.mjs), and the
// /health entries the cron writes (api/_lib/ops.mjs): ai, jury_keys, news, checker, lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chargeOf, countCalls, installSpendMeter, SpendCapError } from "../../../api/_lib/spend.mjs";
import { aiEntry, chainSignals, checkerEntry, juryKeysCheck, juryKeysDue, juryKeysEntry, juryKeysRound, juryKeysWindow, keyRow, laneEntry, mergeSignal, newsEntry, roomOf, JURY_KEYS_DOC } from "../../../api/_lib/ops.mjs";
import { FsState } from "../../../api/_lib/store.mjs";
import { creditsOf, spareNear } from "../src/lane.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-ops-"));
const HOUR = 3600_000;

// ---------- the spend meter ----------

test("chargeOf: a refused or failed call costs nothing; a 2xx with usage is priced; a 2xx without is the flat amount", () => {
  assert.deepEqual(chargeOf(429, { usd: 0.01 }), { usd: 0, basis: "no charge: HTTP 429, refused or failed" });
  assert.equal(chargeOf(400, null).usd, 0);
  assert.equal(chargeOf(500, null).usd, 0);
  assert.equal(chargeOf(null, null).usd, 0, "no answer at all");
  assert.deepEqual(chargeOf(200, { usd: 0.0012 }), { usd: 0.0012, basis: "usage x /v1/models pricing" });
  assert.deepEqual(chargeOf(200, { basis: "flat: no usage reported" }), { usd: 0.005, basis: "flat: no usage reported" });
  assert.equal(chargeOf(204, null).usd, 0.005);
});

test("countCalls: a day's calls by status; refusals are non-2xx or no answer; the cap's own refusals are counted apart", () => {
  const day = "2026-11-12";
  const rows = [
    { day, status: 200, usd: 0.001 }, { day, status: 200, usd: 0.002 }, { day, status: 429, usd: 0 }, { day, status: 400, usd: 0 },
    { day, status: null, usd: 0 }, { day, status: null, refused: "spend_cap", usd: 0 }, { day: "2026-11-11", status: 500, usd: 0 },
  ];
  assert.deepEqual(countCalls(rows, day), { day, calls: 5, refusals: 3, cap_refused: 1, by_status: { 200: 2, 429: 1, 400: 1, network: 1, spend_cap: 1 }, spent_usd: 0.003 });
  assert.deepEqual(countCalls([], day), { day, calls: 0, refusals: 0, cap_refused: 0, by_status: {}, spent_usd: 0 });
});

test("the spend meter: refusals never use up the daily cap, every call is written with its status, and the cap still holds", async (t) => {
  const BASE = "https://nearai.test/v1";
  const realFetch = globalThis.fetch;
  delete globalThis.__pricedinSpend;
  let sent = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === `${BASE}/models`) return new Response(JSON.stringify({ data: [{ id: "priced", pricing: { prompt: "0.000001", completion: "0.000002" } }] }), { status: 200 });
    sent++;
    const model = JSON.parse(init.body).model;
    if (model === "net") throw new TypeError("fetch failed");
    if (model === "refuse") return new Response(JSON.stringify({ error: { message: "content policy" } }), { status: 400 });
    if (model === "busy") return new Response("rate limited", { status: 429 });
    if (model === "priced") return new Response(JSON.stringify({ model, usage: { prompt_tokens: 1000, completion_tokens: 500 } }), { status: 200 });
    return new Response(JSON.stringify({ model }), { status: 200 }); // no usage: the flat amount
  };
  const dir = tmp();
  t.after(() => { globalThis.fetch = realFetch; delete globalThis.__pricedinSpend; fs.rmSync(dir, { recursive: true, force: true }); });
  const meter = installSpendMeter({ baseUrl: BASE, capUsd: 0.01, dir });
  const call = (model) => globalThis.fetch(`${BASE}/chat/completions`, { method: "POST", body: JSON.stringify({ model }) });

  // 25 refusals and 5 failures with no answer: before this change each cost $0.005, so the second one used up a $0.01 cap
  for (let i = 0; i < 25; i++) assert.equal((await call(i % 2 ? "refuse" : "busy")).status, i % 2 ? 400 : 429);
  for (let i = 0; i < 5; i++) await assert.rejects(call("net"), /fetch failed/);
  await meter.settle();
  assert.equal(meter.status().spent_usd, 0, "a refused or failed call is charged nothing");
  assert.equal(meter.status().open, true, "so the cap is still open for the jury, the writer and the agents");

  const priced = await call("priced");
  assert.equal(priced.status, 200);
  await meter.settle();
  assert.equal(meter.status().spent_usd, 0.002, "1,000 prompt tokens at $0.000001 and 500 completion tokens at $0.000002");
  await call("plain");
  await call("plain");
  await meter.settle();
  assert.equal(meter.status().spent_usd, 0.012, "a 2xx with no usage is still charged the flat $0.005, so the cap can't be crossed unseen");
  assert.equal(meter.status().open, false);
  const before = sent;
  await assert.rejects(call("plain"), (e) => e instanceof SpendCapError && e.code === "spend_cap");
  assert.equal(sent, before, "at the cap, the call never leaves");

  const counts = meter.callsToday();
  assert.deepEqual([counts.calls, counts.refusals, counts.cap_refused], [33, 30, 1]);
  assert.deepEqual(counts.by_status, { 429: 13, 400: 12, network: 5, 200: 3, spend_cap: 1 });
  const lines = fs.readFileSync(path.join(dir, "spend.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 34, "every call is written down, the refused ones too");
  assert.ok(lines.filter((l) => l.status === 400).every((l) => l.usd === 0 && l.model === "refuse" && /no charge: HTTP 400/.test(l.basis)));
  assert.ok(lines.filter((l) => l.status === null && !l.refused).every((l) => l.usd === 0 && /no answer/.test(l.basis)));
});

// ---------- ai ----------

test("ai: calls and refusals today, ok until more than 20 refusals", () => {
  const counts = (refusals) => ({ day: "2026-11-12", calls: 40, refusals, cap_refused: 0, by_status: { 200: 40 - refusals, 429: refusals } });
  assert.equal(aiEntry(counts(20)).ok, true);
  const bad = aiEntry(counts(21));
  assert.deepEqual([bad.ok, bad.calls, bad.refusals, bad.max_refusals], [false, 40, 21, 20]);
  assert.match(bad.note, /refused or failed 21 model calls today/);
  assert.equal(aiEntry(null), null);
});

// ---------- jury_keys ----------

const SITTING = { perDay: 1, hourUtc: 15, minBets: 1, fromMs: Date.parse("2026-11-12T00:00:00Z") };
const at = (s) => Date.parse(s);

test("jury_keys: the daily window, and from 14:00 UTC on a sitting day a second one, an hour before the Checker sits", () => {
  assert.equal(juryKeysWindow(at("2026-11-10T16:00:00Z"), SITTING).key, "2026-11-10", "before CHECKER_FROM, no sitting: the daily check only");
  assert.equal(juryKeysWindow(at("2026-11-12T13:59:00Z"), SITTING).key, "2026-11-12");
  assert.equal(juryKeysWindow(at("2026-11-12T14:00:00Z"), SITTING).key, "2026-11-12T14");
  assert.equal(juryKeysWindow(at("2026-11-13T23:50:00Z"), SITTING).key, "2026-11-13T14");
  assert.equal(juryKeysWindow(at("2026-11-10T14:30:00Z"), { ...SITTING, fromMs: undefined }).key, "2026-11-10T14", "no CHECKER_FROM: every day is a sitting day");

  const done = { window: "2026-11-12", complete: true, attempts: 1 };
  assert.equal(juryKeysDue(done, at("2026-11-12T09:00:00Z"), SITTING), null, "checked today: not again before the sitting window");
  assert.equal(juryKeysDue(done, at("2026-11-12T14:05:00Z"), SITTING).key, "2026-11-12T14", "the pre-sitting check runs even after the morning's");
  assert.equal(juryKeysDue({ window: "2026-11-12", complete: false, attempts: 2 }, at("2026-11-12T09:00:00Z"), SITTING).key, "2026-11-12", "an incomplete check is tried again");
  assert.equal(juryKeysDue({ window: "2026-11-12", complete: false, attempts: 3 }, at("2026-11-12T09:00:00Z"), SITTING), null, "at most three tries a window");
  assert.equal(juryKeysDue(null, at("2026-11-12T09:00:00Z"), SITTING).key, "2026-11-12");
});

const A = "aa".repeat(32), B = "bb".repeat(32);
const pre = (signer, ok = true) => ({ v: { ok, verifiedSigners: ok ? [{ signing_address: signer, signing_algo: "ed25519" }] : [], failures: ok ? [] : ["candidate 0: intel_quote: TCB out of date"], fetchedAt: at("2026-11-12T14:00:00Z"), nonce: "n1" } });

test("jury_keys: each model's attested signing key against the one registered on the market", () => {
  assert.equal(keyRow("m", pre(A), { v: { signing_address_hex: A.toUpperCase() } }).status, "match", "hex case does not matter");
  const mis = keyRow("m", pre(B), { v: { signing_address_hex: A } });
  assert.deepEqual([mis.status, mis.registered_signing_address, mis.attested_signing_address], ["mismatch", A, B]);
  assert.match(mis.detail, /the contract would refuse its verdicts\. Re-register it: docs\/RUNBOOK-jury-keys\.md/);
  assert.equal(keyRow("m", pre(A), { v: null }).status, "not_registered");
  assert.equal(keyRow("m", pre(A, false), { v: { signing_address_hex: A } }).status, "unverified");
  assert.equal(keyRow("m", { e: new Error("HTTP 502") }, { v: { signing_address_hex: A } }).status, "unread");
  assert.equal(keyRow("m", pre(A), { e: new Error("rpc down") }).status, "unread");
  // two verified signers (two TEEs serve the model): the registered one only has to be among them
  const two = { v: { ok: true, verifiedSigners: [{ signing_address: B }, { signing_address: A }], fetchedAt: 1, nonce: "n" } };
  assert.equal(keyRow("m", two, { v: { signing_address_hex: A } }).status, "match");
});

test("jury_keys: a mismatch fails at once; an unread attestation fails only after three tries in the window", async () => {
  const models = ["deepseek", "qwen", "glm"];
  const registered = async (m) => ({ signing_address_hex: m === "qwen" ? B : A });
  const mis = await juryKeysCheck({ models, attest: async () => pre(A).v, registered, nowMs: at("2026-11-12T14:00:00Z"), window: "2026-11-12T14" });
  assert.deepEqual([mis.ok, mis.complete, mis.attempts], [false, true, 1]);
  assert.deepEqual(mis.models.map((x) => x.status), ["match", "mismatch", "match"]);
  assert.match(mis.note, /^qwen: its key does not match the market's\. The jury cannot rule until it is re-registered/);

  const good = async () => ({ signing_address_hex: A });
  const down = async (m) => { if (m === "glm") throw new Error("HTTP 503"); return pre(A).v; };
  const first = await juryKeysCheck({ models, attest: down, registered: good, nowMs: 1, window: "w" });
  assert.deepEqual([first.ok, first.complete, first.attempts], [true, false, 1]);
  assert.match(first.note, /glm could not be checked \(attempt 1 of 3; the next cron run tries again\)/);
  const third = await juryKeysCheck({ models, attest: down, registered: good, nowMs: 2, window: "w", prev: { window: "w", attempts: 2 } });
  assert.deepEqual([third.ok, third.attempts], [false, 3]);

  const slow = await juryKeysCheck({ models: ["glm"], attest: () => new Promise(() => {}), registered: good, nowMs: 3, window: "x", timeoutMs: 50 });
  assert.equal(slow.models[0].status, "unread");
  assert.match(slow.models[0].detail, /no answer in 0 s/);

  const all = await juryKeysCheck({ models, attest: async () => pre(A).v, registered: good, nowMs: 4, window: "y" });
  assert.deepEqual([all.ok, all.complete, all.note], [true, true, "All 3 jury keys match the market's."]);
});

test("jury_keys: the cron's round claims the window, checks once, stores the result; a check older than 26 hours fails", async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = new FsState({ prefix: "p", dir });
  let attests = 0;
  let now = at("2026-11-12T09:00:00Z");
  const round = () => juryKeysRound({ state, models: ["a", "b"], attest: async () => { attests++; return pre(A).v; }, registered: async () => ({ signing_address_hex: A }), sitting: SITTING, now: () => now });
  const e1 = await round();
  assert.deepEqual([e1.ok, e1.window, attests], [true, "2026-11-12", 2]);
  assert.equal((await state.getDoc(JURY_KEYS_DOC)).value.running_until, undefined, "the claim is let go");
  now += 10 * 60_000;
  assert.equal((await round()).window, "2026-11-12");
  assert.equal(attests, 2, "the same window is not checked twice");
  now = at("2026-11-12T14:00:00Z");
  assert.equal((await round()).window, "2026-11-12T14");
  assert.equal(attests, 4, "an hour before the sitting, again");
  // another run holds the claim: this one waits and shows the last result
  await state.updateDoc(JURY_KEYS_DOC, (cur) => ({ ...cur, window: "old", running_until: now + 60_000 }));
  now += 60_000 - 1;
  const busy = await round();
  assert.equal(attests, 4);
  assert.equal(busy.running_until, undefined);

  assert.deepEqual(juryKeysEntry(null, now), { checked: false, note: "Not checked yet: the cron checks the jury keys once a day, and an hour before each sitting." });
  const old = juryKeysEntry({ at: "2026-11-10T09:00:00.000Z", ok: true, note: "All 2 jury keys match the market's." }, at("2026-11-11T12:00:00Z"));
  assert.equal(old.ok, false);
  assert.match(old.note, /last ran 27 hours ago/);
});

// ---------- news, checker, lane ----------

test("news: when the last line opened and the reserve room; it fails after 26 hours with none, or when the room can't carry the next", () => {
  const now = at("2026-11-12T20:00:00Z");
  const lines = { 40: { claim_id: 40, opened_at: now - 30 * HOUR, reserve_micro: "700000" }, 44: { claim_id: 44, opened_at: now - 2 * HOUR, reserve_micro: "500000" } };
  const ok = newsEntry({ enabled: true, lines, roomMicro: 2_400_000, nowMs: now });
  assert.deepEqual([ok.ok, ok.last_claim_id, ok.hours_since, ok.opened_today, ok.reserve_room_usd, ok.last_line_reserve_usd, ok.note], [true, 44, 2, 1, 2.4, 0.5, null]);
  assert.equal(ok.last_opened_at, new Date(now - 2 * HOUR).toISOString());
  const short = newsEntry({ enabled: true, lines, roomMicro: 400_000, nowMs: now });
  assert.equal(short.ok, false);
  assert.match(short.note, /can carry \$0\.40 more of reserves, less than the \$0\.50 the last line reserved/);
  const stale = newsEntry({ enabled: true, lines, roomMicro: 2_400_000, nowMs: now + 25 * HOUR });
  assert.equal(stale.ok, false);
  assert.match(stale.note, /No news line opened in 27 hours/);
  const unread = newsEntry({ enabled: true, lines, roomMicro: null, nowMs: now });
  assert.deepEqual([unread.ok, unread.reserve_room_usd], [true, null], "an unread room is said, not guessed");
  assert.match(unread.note, /could not be read/);
  assert.equal(newsEntry({ enabled: true, lines: {}, roomMicro: 1, nowMs: now }).ok, false);
  assert.deepEqual(newsEntry({ enabled: false, lines: {}, roomMicro: null, nowMs: now }).ok, true);
  // the room: the smaller of the cap less what is reserved, and the treasury less the free bets and the floor
  assert.equal(roomOf({ treasuryMicro: "13110000", reservedMicro: "4000000", capMicro: "8000000", laneBudgetMicro: "11000000" }, 1_500_000), 610_000);
  assert.equal(roomOf(null, 0), null);
});

test("checker: its balance against the bond; lane: credits and NEAR for gas", () => {
  const c = checkerEntry({ account: "checker.x.near", balanceMicro: "2950000", bondMicro: "1000000" });
  assert.deepEqual([c.ok, c.balance_usd, c.bond_usd, c.bonds_covered], [true, 2.95, 1, 2]);
  const poor = checkerEntry({ account: "checker.x.near", balanceMicro: "999999", bondMicro: "1000000" });
  assert.equal(poor.ok, false);
  assert.match(poor.note, /less than one \$1\.00 bond/);
  assert.equal(checkerEntry({ account: "c", balanceMicro: null, bondMicro: "1" }).ok, undefined, "unread: no verdict either way");
  assert.equal(checkerEntry({ account: null }).configured, false);

  const stats = { lane_credit_micro: "1000000", lane_budget_micro: "11000000", treasury_micro: "13110000" };
  assert.equal(creditsOf(stats), 11);
  assert.equal(creditsOf({ ...stats, treasury_micro: "4500000" }), 4, "the treasury pays every credit: the smaller of the two");
  const acct = { amount: "996345385717011200000000", storage_usage: 3494 };
  assert.equal(spareNear(acct), 0.9614);
  const lane = laneEntry({ account: "lane.x.near", stats, acct, minNear: 0.3 });
  assert.deepEqual([lane.ok, lane.credits, lane.near_spare, lane.near_min], [true, 11, 0.9614, 0.3]);
  const low = laneEntry({ account: "lane.x.near", stats, acct: { amount: "250000000000000000000000", storage_usage: 3494 }, minNear: 0.3 });
  assert.equal(low.ok, false);
  assert.match(low.note, /0\.215 NEAR spare, under the 0\.3 NEAR minimum/);
  assert.equal(laneEntry({ account: "lane.x.near", stats: { ...stats, lane_budget_micro: "0" }, acct, minNear: 0.3 }).ok, false);
  const unread = laneEntry({ account: "lane.x.near", stats: null, acct: null, minNear: 0.3 });
  assert.deepEqual([unread.ok, unread.credits, unread.near_spare], [true, null, null]);
});

test("chainSignals: one round of reads; a read that fails leaves its figure null and never throws", async () => {
  const views = { stats: { lane_credit_micro: "1000000", lane_budget_micro: "11000000", treasury_micro: "13110000" }, get_resolution: { challenge_bond_micro: "1000000" }, get_balance: "2950000" };
  const d = {
    view: async (m) => views[m], account: async () => ({ amount: "996345385717011200000000", storage_usage: 3494 }),
    capacity: async () => ({ treasuryMicro: "13110000", reservedMicro: "1000000", capMicro: "8000000", laneBudgetMicro: "11000000" }),
    lines: async () => ({ lines: { 7: { claim_id: 7, opened_at: Date.now() - HOUR, reserve_micro: "500000" } } }),
    news: { enabled: true, floorMicro: 0 }, checkerId: "checker.x.near", laneId: "lane.x.near", laneMinNear: 0.3, nowMs: Date.now(),
  };
  const s = await chainSignals(d);
  assert.deepEqual([s.news.ok, s.news.reserve_room_usd, s.checker.ok, s.lane.ok, s.lane.credits], [true, 2.11, true, true, 11]);
  const broken = await chainSignals({ ...d, view: async () => { throw new Error("rpc down"); }, account: async () => { throw new Error("rpc down"); }, capacity: async () => null });
  assert.deepEqual([broken.checker.balance_usd, broken.lane.credits, broken.news.reserve_room_usd], [null, null, null]);
});

test("register-model: refuses without CONFIRM_MAINNET=yes before any network or key, and points at --plan", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = path.resolve(import.meta.dirname, "../../..");
  const env = { ...process.env };
  delete env.CONFIRM_MAINNET;
  const r = spawnSync(process.execPath, ["scripts/mainnet/register-model.mjs", "Qwen/Qwen3.8-27B"], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to touch mainnet: set CONFIRM_MAINNET=yes to mean it, or add --plan/);
  assert.equal(r.stdout, "", "nothing was attested or read");
});

test("mergeSignal: the cron's figures over the request's own, with the cron's time; nothing from the cron leaves the entry as it was", () => {
  const req = { configured: true, open: true, creditsLeft: 11, paused: false };
  assert.deepEqual(mergeSignal(req, { credits: 11, near_spare: 0.96, ok: true }, "2026-11-12T14:00:00.000Z"), { configured: true, open: true, creditsLeft: 11, paused: false, credits: 11, near_spare: 0.96, ok: true, as_of: "2026-11-12T14:00:00.000Z" });
  assert.equal(mergeSignal(req, undefined, "x"), req);
  assert.equal(mergeSignal(null, undefined, "x"), null);
});
