// The engine: the store, the indexer, the read models, the keeper, the Checker and the read
// routes. Offline: a mock RPC, fake explorer pages and a fake signer.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FsState, JournalDir } from "../../../api/_lib/store.mjs";
import { Indexer, NearblocksSource, FastnearSource, sourcesFor } from "../../../api/_lib/indexer.mjs";
import { activityOf, chronological, downsample, parseTrader, portfolioOf, priceHistory, rulingsOf, whoIs } from "../../../api/_lib/views.mjs";
import { bOf, betsOn, checkerCandidates, checkerDecision, checkerEvidence, checkerFacts, checkerQueue, corpusRecord, correctedWording, firstSitting, isCapRefusal, juryRefused, keeperRound, nextTick, planKeeper, rulingClock, SITTING, sittingConfig } from "../../../api/_lib/keeper.mjs";
import { activityRoute, attestationsRoute, historyRoute, laneStatusRoute, portfolioRoute, rulingsRoute, traderHistory } from "../../../api/_lib/routes.mjs";
import { LEDGER, ledgerChecks, putCheck, putSentinel, readLedger, runSentinel } from "../../../api/_lib/sentinel.mjs";
import { extractMarketEvents } from "../src/events.mjs";
import { laneHold, laneHoldMessage } from "../src/lane.mjs";
import { corpusEvidence } from "../../ai/src/evidence.js";
import errors from "../../../corpus/ERRORS.json" with { type: "json" };
import { Rpc } from "../src/rpc.mjs";
import { startMockRpc, eventLog } from "./mock-rpc.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-engine-"));
const NS = (ms) => String(BigInt(ms) * 1_000_000n);
const STALE = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";
const CAUGHT = errors.items.map((e) => e.sentence).find((t) => corpusEvidence(t) && t !== STALE); // a second caught line
const DAY = Date.UTC(2026, 10, 6); // midnight UTC on a sitting day
const H = 3600_000;
const LANE = "lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT";
let uid = 0;
const ev = (event, data, t = 1000, extra = {}) => ({ uid: `r${++uid}:0:0`, event, data, txHash: `tx${uid}`, blockHeight: t, blockTimestampMs: t, ...extra });
const claim = (id, o = {}) => ({ id, text: `Line ${id}.`, page: "tether", kind: "document", status: "Open", outcome: null, provisional: null, price_yes_ppm: 500000, challenge_id: null, trades: 0, cost_up_10_micro: "0", cost_down_10_micro: "0", ...o });

// ---------- the local store ----------

test("the local store: compare-and-swap, chunks, limits and peek behave like the Blob store", async () => {
  const dir = tmp();
  const s = new FsState({ prefix: "state/testnet/m", dir });
  assert.equal(await s.getDoc("a.json"), null);
  const etag = await s.putDoc("a.json", { n: 1 });
  await assert.rejects(s.putDoc("a.json", { n: 2 }), /already exists/);
  await assert.rejects(s.putDoc("a.json", { n: 2 }, { etag: '"nope"' }), /precondition/);
  await s.putDoc("a.json", { n: 2 }, { etag });
  assert.deepEqual((await s.getDoc("a.json")).value, { n: 2 });
  assert.equal((await s.getDoc("a.json", { ifNoneMatch: (await s.getDoc("a.json")).etag })).notModified, true);
  await s.updateDoc("a.json", (cur) => ({ n: cur.n + 1 }));
  assert.equal((await s.getDoc("a.json")).value.n, 3);
  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, true);
  assert.deepEqual([(await s.peek("lane", "1.2.3.4", 2)).used, (await s.peek("lane", "1.2.3.4", 2)).remaining], [1, 1]);
  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, true);
  assert.equal((await s.take("lane", "1.2.3.4", 2)).ok, false);
  const full = await s.peek("lane", "1.2.3.4", 2);
  assert.equal(full.remaining, 0);
  assert.ok(full.retryAfterS > 0);
  await s.release("lane", "1.2.3.4");
  assert.equal((await s.peek("lane", "1.2.3.4", 2)).remaining, 1);
  const lock = await s.acquire("job", { ttlMs: 60_000 });
  assert.equal(await s.acquire("job", { ttlMs: 60_000 }), null);
  await lock.release();
  assert.ok(await s.acquire("job", { ttlMs: 60_000 }));
  const j = new JournalDir(s, path.join(dir, "data"));
  j.append("events.jsonl", { uid: "a" });
  await j.flush();
  const j2 = new JournalDir(new FsState({ prefix: "state/testnet/m", dir }), path.join(dir, "data2"));
  await j2.hydrate();
  assert.deepEqual(j2.read("events.jsonl"), [{ uid: "a" }]);
  assert.deepEqual(j2.readCached("events.jsonl"), [{ uid: "a" }]);
  assert.equal(j2.readCached("events.jsonl"), j2.readCached("events.jsonl"), "parsed once per change");
  j2.append("events.jsonl", { uid: "b" });
  assert.equal(j2.readCached("events.jsonl").length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- the indexer ----------

test("a receipt that failed contributes no events, whatever it logged before the panic", () => {
  const tx = { receipts_outcome: [
    { id: "A", outcome: { executor_id: "m", logs: [eventLog("trade", { claim_id: 1 })], status: { Failure: { ActionError: {} } } } },
    { id: "B", outcome: { executor_id: "m", logs: [eventLog("trade", { claim_id: 2 })], status: { SuccessValue: "" } } },
    { id: "C", outcome: { executor_id: "other", logs: [eventLog("trade", { claim_id: 3 })], status: { SuccessValue: "" } } },
  ] };
  assert.deepEqual(extractMarketEvents(tx, "m").map((e) => e.data.claim_id), [2]);
});

test("explorer pages parse: nearblocks and FastNEAR", async () => {
  const seen = [];
  const nb = new NearblocksSource({ network: "mainnet", accountId: "market.x.near", perPage: 2, fetchImpl: async (u) => {
    seen.push(String(u));
    return new Response(JSON.stringify({ cursor: "77", txns: [
      { transaction_hash: "H1", signer_account_id: "a.near", receiver_account_id: "market.x.near", block_timestamp: "1793927412980641277", block: { block_height: 5 }, actions: [{ method: "buy" }] },
      { transaction_hash: "H2", signer_account_id: "b.near", receiver_account_id: "market.x.near", block_timestamp: "1793927412000000000", block: { block_height: 4 } },
    ] }), { status: 200 });
  } });
  const pg = await nb.page("99");
  assert.match(seen[0], /^https:\/\/api\.nearblocks\.io\/v1\/account\/market\.x\.near\/txns-only\?per_page=2&order=desc&cursor=99$/);
  assert.deepEqual(pg.txs[0], { hash: "H1", signer: "a.near", receiver: "market.x.near", blockHeight: 5, blockTimestampMs: 1793927412980, method: "buy" });
  assert.equal(pg.next, "77");
  const fn = new FastnearSource({ network: "testnet", accountId: "m.testnet", perPage: 1, fetchImpl: async (u, init) => {
    if (String(u).endsWith("/v0/account")) { assert.deepEqual(JSON.parse(init.body), { account_id: "m.testnet", limit: 1 }); return new Response(JSON.stringify({ account_txs: [{ transaction_hash: "H9", tx_block_height: 9, tx_block_timestamp: "1793920976113187801" }], resume_token: "111" })); }
    return new Response(JSON.stringify({ transactions: [{ transaction: { hash: "H9", signer_id: "s.testnet", receiver_id: "m.testnet" } }] }));
  } });
  const f = await fn.page();
  assert.deepEqual(f.txs, [{ hash: "H9", signer: "s.testnet", receiver: "m.testnet", blockHeight: 9, blockTimestampMs: 1793920976113, method: null }]);
  assert.equal(f.next, "111");
  assert.deepEqual(sourcesFor("mainnet", "m", { order: "" }).map((s) => s.name), ["nearblocks", "fastnear"]);
  assert.deepEqual(sourcesFor("testnet", "m", { order: "" }).map((s) => s.name), ["fastnear", "nearblocks"]);
  const rate = new NearblocksSource({ network: "mainnet", accountId: "m", fetchImpl: async () => new Response("slow down", { status: 429 }) });
  await assert.rejects(rate.page(), (e) => e.rateLimited === true);
});

/** A market with n transactions, paged two at a time, newest first. */
async function fakeChain(n) {
  const mock = await startMockRpc({ blockMs: 100000 });
  const all = [];
  for (let i = 0; i < n; i++) {
    const hash = `T${String(i).padStart(3, "0")}`;
    mock.st.outcomes.set(hash, { status: { SuccessValue: "" }, transaction: { hash, signer_id: "a.testnet" }, receipts_outcome: [{ id: `R${i}`, outcome: { executor_id: "m.testnet", logs: [eventLog("trade", { claim_id: 1, trader: "a.testnet", side: "yes", shares_micro: "1", amount_micro: "1", price_yes_ppm: 500000 + i })], status: { SuccessValue: "" } } }] });
    all.unshift({ hash, signer: "a.testnet", blockHeight: i + 1, blockTimestampMs: 1000 + i });
  }
  const pages = { calls: 0, down: false };
  const source = { name: "fake", async page(cursor) {
    pages.calls++;
    if (pages.down) throw new Error("the explorer is down");
    const at = cursor ? Number(cursor) : 0;
    const txs = all.slice(at, at + 2);
    return { txs, next: at + 2 < all.length ? String(at + 2) : null };
  } };
  return { mock, source, pages, all };
}

test("the indexer reads every transaction once, by uid, and a second run stops at the first known page", async () => {
  const dir = tmp();
  const { mock, source, pages } = await fakeChain(7);
  try {
    const state = new FsState({ prefix: "p", dir });
    const stored = [];
    const ix = new Indexer({ state, rpc: new Rpc([mock.url]), marketId: "m.testnet", sources: [source], record: async (evs) => { const fresh = evs.filter((e) => !stored.some((x) => x.uid === e.uid)); stored.push(...fresh); return fresh; } });
    const r = await ix.run();
    assert.equal(r.source, "fake");
    assert.equal(r.txs_read, 7);
    assert.equal(r.fresh_events, 7);
    assert.equal(r.backfill_done, true);
    assert.equal(stored.length, 7);
    assert.equal(stored[0].blockTimestampMs >= 1000, true);
    const before = pages.calls;
    const r2 = await ix.run();
    assert.equal(pages.calls - before, 1, "one page: nothing new on it");
    assert.equal(r2.fresh_events, 0);
    assert.equal(stored.length, 7);
    assert.equal((await ix.status()).seen, 7);
  } finally { await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the backfill resumes from its cursor when a run runs out of pages, and a quick pass never moves it back", async () => {
  const dir = tmp();
  const { mock, source } = await fakeChain(9);
  try {
    const state = new FsState({ prefix: "p", dir });
    const stored = [];
    const ix = new Indexer({ state, rpc: new Rpc([mock.url]), marketId: "m.testnet", sources: [source], quickEveryMs: 0, record: async (e) => { stored.push(...e); return e; } });
    const a = await ix.run({ maxPages: 2 });
    assert.equal(a.backfill_done, false);
    assert.equal(stored.length, 4);
    const q = await ix.run({ mode: "quick" });
    assert.equal(q.new_txs, 0);
    assert.equal((await state.getDoc("indexer/state.json")).value.backfill.cursor, "4", "the quick pass left the cursor where the backfill got to");
    const b = await ix.run({ maxPages: 2 });
    assert.equal(stored.length, 6);
    assert.equal(b.backfill_done, false);
    const c = await ix.run({ maxPages: 4 });
    assert.equal(c.backfill_done, true);
    assert.equal(new Set(stored.map((e) => e.uid)).size, 9);
    assert.equal(stored.length, 9);
  } finally { await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a transaction the RPC can't read yet is kept for the next run; a dead explorer falls over to the next one", async () => {
  const dir = tmp();
  const { mock, source, pages } = await fakeChain(2);
  try {
    const state = new FsState({ prefix: "p", dir });
    const stored = [];
    const hidden = mock.st.outcomes.get("T001");
    mock.st.outcomes.delete("T001");
    pages.down = true;
    const backup = { name: "backup", page: async (c) => { pages.down = false; return source.page(c); } };
    const ix = new Indexer({ state, rpc: new Rpc([mock.url]), marketId: "m.testnet", sources: [source, backup], record: async (e) => { stored.push(...e); return e; } });
    const a = await ix.run();
    assert.equal(a.source, "backup");
    assert.match(a.errors[0], /the explorer is down/);
    assert.equal(stored.length, 1);
    assert.equal((await ix.status()).retry, 1);
    mock.st.outcomes.set("T001", hidden);
    await ix.run();
    assert.equal(stored.length, 2);
    assert.equal((await ix.status()).retry, 0);
  } finally { await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a quick pass runs at most every 30 s across instances", async () => {
  const dir = tmp();
  const { mock, source, pages } = await fakeChain(1);
  try {
    const ix = new Indexer({ state: new FsState({ prefix: "p", dir }), rpc: new Rpc([mock.url]), marketId: "m.testnet", sources: [source], record: async (e) => e });
    await ix.run({ mode: "quick" });
    const n = pages.calls;
    assert.match((await ix.run({ mode: "quick" })).skipped, /last 30 s/);
    assert.equal(pages.calls, n);
  } finally { await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the read models ----------

test("history: the opening price (clamped), each trade, the outcome at settlement, the price now", () => {
  const events = [
    ev("open", { claim_id: 1, p0_ppm: 900000, b_micro: "1450000" }, 100),
    ev("trade", { claim_id: 1, price_yes_ppm: 700000 }, 200),
    ev("trade", { claim_id: 1, price_yes_ppm: 300000 }, 300),
    ev("open", { claim_id: 2, p0_ppm: 500000, b_micro: "1450000" }, 100),
    ev("trade", { claim_id: 2, price_yes_ppm: 200000 }, 200),
    ev("settle", { claim_id: 2, challenge_id: 0, outcome: false, payout_micro: "1" }, 300),
  ];
  const dup = [...events, events[1]];
  const claims = [claim(1, { price_yes_ppm: 250000 }), claim(2, { status: "Settled", outcome: false, price_yes_ppm: 200000 }), claim(3, { price_yes_ppm: 600000 })];
  const s = priceHistory(dup, claims, { at: 999 });
  assert.deepEqual(s.get(1), [[100, 800000], [200, 700000], [300, 300000], [999, 250000]]);
  assert.deepEqual(s.get(2), [[100, 500000], [200, 200000], [300, 0]]);
  assert.deepEqual(s.get(3), [[999, 600000]]);
  const long = Array.from({ length: 100 }, (_, i) => [i, i]);
  const d = downsample(long, 10);
  assert.equal(d.length, 10);
  assert.deepEqual([d[0], d.at(-1)], [[0, 0], [99, 99]]);
  assert.equal(downsample(long.slice(0, 5), 10).length, 5);
});

test("traders: a lane key, a bare key, an account; nothing else", () => {
  assert.deepEqual(parseTrader(LANE), { trader: LANE, kind: "lane" });
  assert.deepEqual(parseTrader(LANE.slice(5)), { trader: LANE, kind: "lane" });
  assert.deepEqual(parseTrader("h-quant.isitpriced.near"), { trader: "h-quant.isitpriced.near", kind: "account" });
  for (const bad of ["", null, "lane:ed25519:short", "UPPER.near", "a b", "x".repeat(70)]) assert.equal(parseTrader(bad), null, String(bad));
});

test("portfolio: side, shares, value at the price, P&L, status and whether it can be redeemed", () => {
  const events = [
    ev("lane_credit", { trader: LANE, amount_micro: "1000000" }, 90),
    ev("trade", { claim_id: 1, trader: LANE, side: "no", shares_micro: "2000000", amount_micro: "1000000", price_yes_ppm: 400000 }, 100),
    ev("trade", { claim_id: 2, trader: LANE, side: "yes", shares_micro: "4000000", amount_micro: "2000000", price_yes_ppm: 600000 }, 110),
    ev("trade", { claim_id: 2, trader: LANE, side: "sell_yes", shares_micro: "1000000", amount_micro: "700000", price_yes_ppm: 550000 }, 120),
    ev("trade", { claim_id: 3, trader: LANE, side: "yes", shares_micro: "1000000", amount_micro: "500000", price_yes_ppm: 600000 }, 130),
    ev("trade", { claim_id: 4, trader: LANE, side: "no", shares_micro: "3000000", amount_micro: "1500000", price_yes_ppm: 300000 }, 140),
    ev("redeem", { claim_id: 4, trader: LANE, side: "no", shares_micro: "3000000", amount_micro: "3000000", balance_micro: "1" }, 150),
    ev("trade", { claim_id: 1, trader: "someone.else", side: "yes", shares_micro: "9", amount_micro: "9", price_yes_ppm: 1 }, 160),
  ];
  const claims = [
    claim(1, { status: "Settled", outcome: false, price_yes_ppm: 100000 }),
    claim(2, { price_yes_ppm: 750000 }),
    claim(3, { status: "Settled", outcome: false, price_yes_ppm: 100000 }),
    claim(4, { status: "Settled", outcome: false, price_yes_ppm: 100000 }),
  ];
  const positions = new Map([[1, { yes_micro: "0", no_micro: "2000000" }], [2, { yes_micro: "3000000", no_micro: "0" }], [3, { yes_micro: "1000000", no_micro: "0" }], [4, { yes_micro: "0", no_micro: "0" }]]);
  const p = portfolioOf({ trader: LANE, kind: "lane", events, claims, positions, balanceMicro: "2500000" });
  const by = Object.fromEntries(p.positions.map((r) => [r.claim_id, r]));
  assert.deepEqual([by[1].side, by[1].shares, by[1].value_usd, by[1].pnl_usd, by[1].state, by[1].redeemable, by[1].redeem_usd], ["no", 2, 2, 1, "won", true, 2]);
  assert.deepEqual([by[2].side, by[2].shares, by[2].price, by[2].value_usd, by[2].pnl_usd, by[2].state, by[2].redeemable], ["yes", 3, 0.75, 2.25, 0.95, "open", false]);
  assert.deepEqual([by[3].value_usd, by[3].pnl_usd, by[3].state, by[3].redeemable], [0, -0.5, "lost", false]);
  assert.deepEqual([by[4].shares, by[4].received_usd, by[4].pnl_usd, by[4].state, by[4].redeemable], [0, 3, 1.5, "collected", false]);
  assert.equal(p.positions[0].claim_id, 1, "what can be collected comes first");
  assert.equal(p.balance_usd, 2.5);
  assert.equal(p.totals.redeemable_usd, 2);
  assert.equal(p.totals.positions, 3);
  assert.match(p.free_bet.winnings_are, /score/);
  assert.equal(p.free_bet.credit_usd, 1);
  const acct = portfolioOf({ trader: "no.one", kind: "account", events, claims, positions: new Map(), balanceMicro: "0" });
  assert.deepEqual([acct.positions.length, acct.free_bet], [0, null]);
  const fromEvents = portfolioOf({ trader: LANE, kind: "lane", events, claims, balanceMicro: null });
  assert.equal(fromEvents.positions.find((r) => r.claim_id === 2).shares, 3);
  assert.equal(fromEvents.positions.find((r) => r.claim_id === 2).held_from, "events");
});

test("activity: trades, rewrites, answers and rulings in one list, newest first, in plain fields", () => {
  const events = [
    ev("trade", { claim_id: 1, trader: LANE, side: "no", shares_micro: "2000000", amount_micro: "1000000", price_yes_ppm: 400000 }, 100),
    ev("trade", { claim_id: 1, trader: "h-quant.x.near", side: "sell_yes", shares_micro: "1000000", amount_micro: "500000", price_yes_ppm: 390000 }, 110),
    ev("challenge", { challenge_id: 0, claim_id: 1, claimed: false, trader: "checker.x.near", amount_micro: "1000000", jury_deadline_ns: "9000000000" }, 120),
    ev("verdict", { challenge_id: 0, model: "m1", outcome: "FALSE" }, 130),
    ev("settle", { claim_id: 1, challenge_id: 0, outcome: false, payout_micro: "2000000", treasury_micro: "1" }, 140),
    ev("redeem", { claim_id: 1, trader: LANE, side: "no", shares_micro: "2000000", amount_micro: "2000000", balance_micro: "2" }, 150),
  ];
  const rewrites = [
    { id: "t:1:v1", page: "tether", status: "signed", createdAt: 105, trigger: { claim_id: 1, txHash: "T" }, sentences: [{ claim_id: 1, claim: "Line 1.", band: "correct", text: "Corrected." }], provenance: { model: "glm" }, anchor: { status: "anchored", tx_hash: "A" } },
    { id: "t:1:v2", page: "tether", status: "template", createdAt: 200, sentences: [{ claim_id: 1, text: "x" }] },
  ];
  const rationales = [{ agent: "house-quant", claim_id: 1, side: "no_bet", text: "no bet: no edge", rationale: "It reads true.", policy: { reason: "no edge" }, credence: 0.4, source_url: "https://s", trigger: { kind: "sweep" }, at: 107 }];
  const list = activityOf({ events, rewrites, rationales, claims: [claim(1)], names: new Map([["h-quant.x.near", "Quant"]]), limit: 50 });
  assert.deepEqual(list.map((x) => x.kind), ["collect", "ruling", "ruling", "ruling", "trade", "answer", "rewrite", "trade"]);
  const buy = list.at(-1), sell = list[4];
  assert.deepEqual([buy.who, buy.action, buy.side, buy.amount_usd, buy.price_after], ["a free $1 bet", "buy", "no", 1, 0.4]);
  assert.deepEqual([sell.who, sell.action, sell.side], ["Quant", "sell", "yes"]);
  assert.equal(list.find((x) => x.stage === "challenged").who, "the Checker");
  assert.equal(list.find((x) => x.stage === "verdict").claim_id, 1, "a verdict's event names only the challenge: its row names the line");
  assert.equal(list.find((x) => x.kind === "answer").reason, "no edge");
  assert.equal(list.find((x) => x.kind === "rewrite").sentence, "Corrected.");
  assert.equal(activityOf({ events, limit: 2 }).length, 2);
  assert.equal(whoIs(null), null);
});

const MODELS = ["deepseek", "qwen", "glm"];
function challengeEvents(id = 0, claimId = 18, t = 1000) {
  return [
    ev("challenge", { challenge_id: id, claim_id: claimId, claimed: false, trader: "checker.x.near", amount_micro: "1000000", jury_deadline_ns: String(BigInt(t + 3600_000) * 1_000_000n), balance_micro: "0" }, t),
    ...MODELS.map((m, i) => ev("verdict", { challenge_id: id, model: m, outcome: "FALSE" }, t + 10 + i)),
    ev("provisional", { challenge_id: id, claim_id: claimId, outcome: false, window_ends_ns: String(BigInt(t + 600_000) * 1_000_000n) }, t + 11),
  ];
}

test("rulings: per-model verdicts with how each signature was checked, the window, the disputes, the outcome", () => {
  const settled = [
    ...challengeEvents(0, 18, 1000),
    ev("dispute", { challenge_id: 0, claim_id: 18, trader: "doubter.near", amount_micro: "2000000", round: 1, proposed: true, window_ends_ns: String(BigInt(900_000) * 1_000_000n) }, 2000),
    ev("dispute", { challenge_id: 0, claim_id: 18, trader: "other.near", amount_micro: "4000000", round: 2, proposed: false, window_ends_ns: String(BigInt(1_500_000) * 1_000_000n) }, 3000),
    ev("settle", { claim_id: 18, challenge_id: 0, outcome: false, payout_micro: "5000000", treasury_micro: "1" }, 5000),
    ev("bond_paid", { challenge_id: 0, trader: "checker.x.near", amount_micro: "1500000", balance_micro: "1" }, 5000),
  ];
  const expired = [ev("challenge", { challenge_id: 1, claim_id: 3, claimed: false, trader: "checker.x.near", amount_micro: "1000000", jury_deadline_ns: "1000000000" }, 6000), ev("challenge_expired", { challenge_id: 1, claim_id: 3, trader: "checker.x.near", amount_micro: "1000000", balance_micro: "1" }, 7000)];
  const live = challengeEvents(2, 6, 8000);
  const claims = [claim(18, { status: "Settled", outcome: false, challenge_id: 0, text: STALE }), claim(3), claim(6, { status: "Challenged", provisional: false, challenge_id: 2 })];
  const out = rulingsOf({
    events: [...settled, ...expired, ...live], claims,
    live: new Map([[2, { claim_id: 6, challenger: "checker.x.near", evidence: "the source", verdicts: MODELS.map((m) => ({ model: m, outcome: "FALSE", request_hash: "aa", response_hash: "bb" })), resolved: false, disputes: 0 }]]),
    windowEnds: new Map([[2, String(BigInt(99_000) * 1_000_000n)]]),
    juryRuns: [{ challenge_id: 2, at: 8100, jurors: [{ model: "glm", status: "submitted", outcome: "FALSE", signing_address: "5a02", signature_kind: "provider_tee", attestation: { ok: true }, tx_hash: "V3" }, { model: "qwen", status: "already_ruled" }, { model: "late", status: "unverified", error: "signer mismatch" }] }],
    links: [{ old_claim_id: 18, new_claim_id: 32, challenge_id: 0, text: "Corrected.", open_tx: "O", rewrite_id: "t:9:v3", at: 6000 }],
  });
  assert.deepEqual(out.map((r) => [r.challenge_id, r.status]), [[2, "window"], [1, "expired"], [0, "settled"]], "live first, then newest");
  const [l, x, s] = out;
  assert.equal(l.window_ends_at, 99_000, "the chain's dispute_ends_ns wins over the event");
  assert.equal(l.evidence, "the source");
  assert.equal(l.verdicts.find((v) => v.model === "glm").runner.signing_address, "5a02");
  assert.equal(l.verdicts.find((v) => v.model === "qwen").runner, undefined, "a later run that found the verdict on-chain says nothing new");
  assert.match(l.verdicts.find((v) => v.model === "glm").signature, /verified on-chain/);
  assert.match(l.verdicts.find((v) => v.model === "late").signature, /not verified: signer mismatch/);
  assert.equal(x.expired_at, 7000);
  assert.deepEqual([s.outcome, s.claimed, s.settled_at, s.disputes.length, s.provisional, s.payout_usd], ["FALSE", "FALSE", 5000, 2, "FALSE", 5]);
  assert.deepEqual(s.disputes.map((d) => [d.round, d.proposed, d.bond_usd]), [[1, "TRUE", 2], [2, "FALSE", 4]]);
  assert.equal(s.challenger_name, "the Checker");
  assert.equal(s.bonds[0].paid_usd, 1.5);
  assert.equal(s.correction.claim_id, 32);
});

test("rulings: every objection with its account, bond, round, proposed outcome and new window; a live one says what the next objection costs", () => {
  const events = [
    ...challengeEvents(4, 9, 1000),
    ev("dispute", { challenge_id: 4, claim_id: 9, trader: "stranger.near", amount_micro: "2000000", round: 1, proposed: true, window_ends_ns: NS(900_000), balance_micro: "0" }, 2000),
  ];
  const view = {
    claim_id: 9, challenger: "checker.x.near", claimed_outcome: false, evidence: "the source", bond_micro: "2000000", disputes: 2, resolved: false, verdicts: [],
    stakes: [
      { account: "checker.x.near", side: false, amount_micro: "1000000", evidence: "" },
      { account: "stranger.near", side: true, amount_micro: "2000000", evidence: "The filing says TRUE: https://example.org/f" },
      { account: "isitpriced.near", side: false, amount_micro: "4000000", evidence: "Drill: the house defends." },
    ],
  };
  const [r] = rulingsOf({ events, claims: [claim(9, { status: "Challenged", provisional: false, challenge_id: 4 })], live: new Map([[4, { ...view, bond_micro: "4000000" }]]), windowEnds: new Map([[4, NS(1_700_000)]]) });
  assert.equal(r.status, "window");
  assert.equal(r.provisional, "FALSE", "the chain's provisional outcome wins over the index's");
  assert.deepEqual(r.disputes.map((d) => [d.round, d.trader, d.bond_usd, d.proposed, d.window_ends_at]), [[1, "stranger.near", 2, "TRUE", 900_000], [2, "isitpriced.near", 4, "FALSE", null]], "a dispute the index hasn't seen comes from the chain's stakes");
  assert.equal(r.disputes[0].evidence, "The filing says TRUE: https://example.org/f");
  assert.equal(r.disputes[1].tx, null);
  assert.equal(r.dispute_bond_usd, 8, "the next objection posts twice the current bond");
  assert.equal(r.window_ends_at, 1_700_000);
  assert.deepEqual([r.challenger_result, r.disputes[0].result], [null, null], "nothing is paid or lost while it runs");

  const closed = rulingsOf({ events, claims: [claim(9, { status: "Challenged", provisional: true, challenge_id: 4 })], live: new Map(), windowEnds: new Map() })[0];
  assert.equal(closed.dispute_bond_usd, null, "without the chain's view nobody promises a price");
});

test("rulings: the third objection goes to the council and opens no window", () => {
  const events = [
    ...challengeEvents(5, 10, 1000),
    ev("dispute", { challenge_id: 5, claim_id: 10, trader: "a.near", amount_micro: "2000000", round: 1, proposed: true, window_ends_ns: NS(900_000) }, 2000),
    ev("dispute", { challenge_id: 5, claim_id: 10, trader: "b.near", amount_micro: "4000000", round: 2, proposed: false, window_ends_ns: NS(1_500_000) }, 3000),
    ev("escalate", { challenge_id: 5, claim_id: 10 }, 4000),
    ev("dispute", { challenge_id: 5, claim_id: 10, trader: "a.near", amount_micro: "8000000", round: 3, proposed: true, window_ends_ns: NS(1_500_000) }, 4000),
  ];
  const [r] = rulingsOf({ events, claims: [claim(10, { status: "Escalated", provisional: true, challenge_id: 5 })] });
  assert.deepEqual([r.status, r.escalated, r.window_ends_at, r.disputes.length, r.disputes[2].window_ends_at], ["escalated", true, null, 3, null]);
});

test("rulings: the house Sentinel's dispute shows like anyone's, named", () => {
  const events = [
    ...challengeEvents(8, 12, 1000),
    ev("dispute", { challenge_id: 8, claim_id: 12, trader: "sentinel.isitpriced.near", amount_micro: "2000000", round: 1, proposed: true, window_ends_ns: NS(900_000) }, 2000),
  ];
  const [r] = rulingsOf({ events, claims: [claim(12, { status: "Challenged", provisional: true, challenge_id: 8 })] });
  assert.deepEqual(r.disputes.map((d) => [d.who, d.trader, d.bond_usd, d.round, d.proposed, d.window_ends_at]), [["the Sentinel", "sentinel.isitpriced.near", 2, 1, "TRUE", 900_000]]);
  assert.equal(r.status, "window");
});

test("rulings: at the end, which bonds were paid and which were lost", () => {
  const base = [
    ...challengeEvents(6, 11, 1000),
    ev("dispute", { challenge_id: 6, claim_id: 11, trader: "stranger.near", amount_micro: "2000000", round: 1, proposed: true, window_ends_ns: NS(900_000) }, 2000),
    ev("dispute", { challenge_id: 6, claim_id: 11, trader: "isitpriced.near", amount_micro: "4000000", round: 2, proposed: false, window_ends_ns: NS(1_500_000) }, 3000),
  ];
  const settledFalse = rulingsOf({
    events: [...base,
      ev("settle", { claim_id: 11, challenge_id: 6, outcome: false, payout_micro: "0" }, 5000),
      ev("bond_paid", { challenge_id: 6, trader: "checker.x.near", amount_micro: "1400000" }, 5000),
      ev("bond_paid", { challenge_id: 6, trader: "isitpriced.near", amount_micro: "5600000" }, 5000)],
    claims: [claim(11, { status: "Settled", outcome: false, challenge_id: 6 })],
  })[0];
  assert.deepEqual([settledFalse.challenger_result, settledFalse.challenger_paid_usd], ["won", 1.4]);
  assert.deepEqual(settledFalse.disputes.map((d) => [d.result, d.paid_usd]), [["lost", null], ["won", 5.6]], "the losing side's $2 pays the winners in proportion to their bonds");

  // the index has the settlement but not the payouts: the contract's own rule gives the same amounts
  const computed = rulingsOf({ events: [...base, ev("settle", { claim_id: 11, challenge_id: 6, outcome: true, payout_micro: "0" }, 5000)], claims: [claim(11, { status: "Settled", outcome: true, challenge_id: 6 })] })[0];
  assert.deepEqual([computed.challenger_result, ...computed.disputes.map((d) => d.result)], ["lost", "won", "lost"]);
  assert.equal(computed.disputes[0].paid_usd, 7, "the only winning bond takes back its $2 and the losers' $5");

  const voided = rulingsOf({ events: [...base, ev("void", { challenge_id: 6, claim_id: 11 }, 6000)], claims: [claim(11, { status: "Open", challenge_id: null })] })[0];
  assert.deepEqual([voided.challenger_result, ...voided.disputes.map((d) => d.result)], ["returned", "returned", "returned"]);
  assert.deepEqual(voided.disputes.map((d) => d.paid_usd), [2, 4]);
});

test("rulings: an index behind the chain still shows a settled challenge as settled, never as running", () => {
  const settle = ev("settle", { claim_id: 7, challenge_id: 0, outcome: false, payout_micro: "1" }, 9000);
  const view = { claim_id: 7, challenger: "seed-a.testnet", claimed_outcome: false, evidence: "e", verdicts: MODELS.map((m) => ({ model: m, outcome: "FALSE" })), resolved: true, opened_ns: NS(100), jury_deadline_ns: NS(3700), stakes: [{ amount_micro: "1000000" }] };
  const [r] = rulingsOf({ events: [settle], claims: [claim(7, { status: "Settled", outcome: false, provisional: false, challenge_id: 0 })], live: new Map([[0, view]]) });
  assert.deepEqual([r.status, r.outcome, r.settled_at, r.verdicts.length, r.opened_at, r.claimed], ["settled", "FALSE", 9000, 3, 100, "FALSE"]);
  const [v] = rulingsOf({ events: [], claims: [claim(7, { status: "Settled", outcome: true, challenge_id: 0 })], live: new Map([[0, view]]) });
  assert.deepEqual([v.status, v.outcome], ["settled", "TRUE"]);
  const [w] = rulingsOf({ events: [], claims: [claim(7, { status: "Open", challenge_id: null })], live: new Map([[0, view]]) });
  assert.equal(w.status, "void");
  assert.equal(rulingClock({ nowMs: 10_000, rulings: [r] }).ruling_now, null);
});

// ---------- the keeper ----------

test("the keeper finalizes after the window, expires after the jury deadline, and leaves everything else alone", () => {
  const now = 10_000_000;
  const entry = (id, c, ch) => ({ id, claim: claim(c, { status: "Challenged", challenge_id: id, ...(ch.claimOver || {}) }), ch: { claim_id: c, resolved: false, jury_deadline_ns: NS(now + 1000), window_ends_ns: "0", ...ch }, windowEndNs: ch.windowEndNs ?? null });
  const plan = planKeeper({ nowMs: now, challenges: [
    entry(0, 1, { claimOver: { provisional: false }, windowEndNs: NS(now - 60_000) }),                 // due
    entry(1, 2, { claimOver: { provisional: true }, windowEndNs: NS(now + 60_000) }),                  // the window is open
    entry(2, 3, { claimOver: { provisional: false }, windowEndNs: NS(now - 1000) }),                   // inside the 5 s margin
    entry(3, 4, { jury_deadline_ns: NS(now - 60_000) }),                                               // no quorum in time
    entry(4, 5, {}),                                                                                   // the jury is ruling
    entry(5, 6, { claimOver: { status: "Escalated", provisional: true }, windowEndNs: NS(now - 60_000) }), // the council's
    entry(6, 7, { resolved: true, claimOver: { provisional: false }, windowEndNs: NS(now - 60_000) }), // done
    entry(7, 8, { claimOver: { challenge_id: 99, provisional: false }, windowEndNs: NS(now - 60_000) }), // not this claim's challenge
    { id: 8, claim: null, ch: null },
  ] });
  assert.deepEqual(plan.map((a) => [a.method, a.challenge_id]), [["finalize", 0], ["expire_challenge", 3]]);
});

test("the Checker's evidence: the corpus record in plain words, its source, its sha256, and at most 4,000 bytes", () => {
  const ev18 = corpusEvidence(STALE);
  assert.equal(ev18.corpus_id, "tether-0161");
  const rec = corpusRecord("tether-0161");
  assert.match(rec.sha256, /^[0-9a-f]{64}$/);
  const s = checkerEvidence(ev18);
  assert.ok(Buffer.byteLength(s, "utf8") <= 4000);
  assert.match(s, /tether-0161/);
  assert.match(s, /\$122\.84 billion at 30 September 2026/);
  assert.match(s, /ctfassets\.net/);
  assert.ok(s.includes(rec.sha256));
  assert.ok(Buffer.byteLength(checkerEvidence({ ...ev18, receipt_match: "x".repeat(9000), value_today: "y".repeat(9000) }), "utf8") <= 4000);
});

test("the Checker's lines: open, caught, one try each; an expired one waits a day; the most bets first, and on a tie a line never tried", () => {
  const evidenceOf = (t) => (/caught/.test(t) ? { corpus_id: t } : null);
  const now = 100 * 3600_000;
  const claims = [claim(1, { text: "caught a", trades: 1 }), claim(2, { text: "caught b", trades: 9 }), claim(3, { text: "clean" }), claim(4, { text: "caught c", status: "Challenged" }), claim(5, { text: "caught d" }), claim(6, { text: "caught e" }), claim(7, { text: "caught f" }), claim(8, { text: "caught g", trades: 1 }), claim(9, { text: "caught h", trades: 20 })];
  const history = [{ claim_id: 5, status: "settled", at: 1 }, { claim_id: 6, status: "expired", at: now - 3600_000 }, { claim_id: 7, status: "expired", at: now - 25 * 3600_000 }, { claim_id: 8, status: "expired", at: now - 25 * 3600_000 }, { claim_id: 9, status: "expired", at: now - 25 * 3600_000 }];
  const c = checkerCandidates({ claims, history, nowMs: now, evidenceOf });
  assert.deepEqual(c.map((x) => x.claim.id), [9, 2, 1, 8, 7]);
  assert.deepEqual(c.map((x) => x.bets), [20, 9, 1, 1, 0]);
  assert.equal(c.at(-1).tries, 1);
});

test("a bet is a position someone still holds: trades sold back out pay nobody, so they don't count", () => {
  assert.equal(betsOn(claim(1, { trades: 3 })), 3, "no position fields: the chain's count");
  assert.equal(betsOn(claim(1, { trades: 2, q_yes_micro: "0", q_no_micro: "0" })), 0, "claim 12 on mainnet: bought and sold back");
  assert.equal(betsOn(claim(1, { trades: 2, q_yes_micro: "0", q_no_micro: "239652" })), 2);
  assert.equal(betsOn(claim(1, { trades: 1, q_yes_micro: "529048", q_no_micro: "0" })), 1);
  assert.equal(betsOn(claim(1, { trades: 0, q_yes_micro: "0", q_no_micro: "0" })), 0);
});

test("the sitting's config: defaults, CHECKER_* values, and anything out of range keeps the default", () => {
  assert.deepEqual(sittingConfig({}), { perDay: 1, hourUtc: 15, minBets: 1 });
  assert.deepEqual(sittingConfig({ CHECKER_PER_DAY: "2", CHECKER_SITTING_HOUR_UTC: "0", CHECKER_MIN_BETS: "0" }), { perDay: 2, hourUtc: 0, minBets: 0 });
  assert.deepEqual(sittingConfig({ CHECKER_PER_DAY: "0", CHECKER_SITTING_HOUR_UTC: "24", CHECKER_MIN_BETS: "-1" }), SITTING);
  assert.deepEqual(sittingConfig({ CHECKER_PER_DAY: "x", CHECKER_SITTING_HOUR_UTC: "1.5", CHECKER_MIN_BETS: "" }), SITTING);
});

test("CHECKER_FROM holds every sitting until its day, then the jury sits as before", () => {
  const s = sittingConfig({ CHECKER_FROM: "2026-11-16T00:00:00Z" });
  assert.deepEqual(s, { ...SITTING, fromMs: Date.parse("2026-11-16T00:00:00Z") });
  assert.deepEqual(sittingConfig({ CHECKER_FROM: "nonsense" }), SITTING);
  assert.deepEqual(sittingConfig({ CHECKER_FROM: "" }), SITTING);
  const first = Date.UTC(2026, 10, 16, 15);
  assert.equal(firstSitting(s), first);
  assert.equal(firstSitting({ ...SITTING, fromMs: Date.UTC(2026, 10, 16, 16) }), Date.UTC(2026, 10, 17, 15), "a date after the hour: the next day's sitting");
  assert.equal(firstSitting(SITTING), 0);
  const ok = { nowMs: Date.UTC(2026, 10, 9, 15, 5), sitting: s, queue: 2, ready: 2, rulingsToday: 0, balance: "2950000", bond: "1000000" };
  assert.deepEqual(checkerDecision(ok), { go: false, note: "the jury's next sitting is 16 November at 15:00 UTC" });
  assert.equal(checkerDecision({ ...ok, nowMs: first - 1 }).go, false);
  assert.deepEqual(checkerDecision({ ...ok, nowMs: first }), { go: true, note: null });
  assert.equal(checkerDecision({ ...ok, nowMs: first + 24 * H }).go, true, "the day after: the second held line");
  const checker = { enabled: true, queue: 2, waiting_for_bets: 0, rulings_today: 1, funded: true };
  const held = rulingClock({ rulings: [], nowMs: Date.UTC(2026, 10, 8, 22), sitting: s, checker });
  assert.equal(held.next_ruling_at, first);
  assert.equal(held.next_ruling_note, "The jury's next sitting is 16 November at 15:00 UTC");
  assert.equal(rulingClock({ rulings: [], nowMs: Date.UTC(2026, 10, 8, 22), sitting: s, checker: { ...checker, queue: 0 } }).next_ruling_note, "No doubted fact is waiting for the jury", "an empty queue says so, hold or not");
  assert.equal(rulingClock({ rulings: [], nowMs: first + 3 * H, sitting: s, checker }).next_ruling_note.startsWith("Today's ruling is done"), true);
});

test("the Checker's decision: each reason to wait is a quiet note, and it goes only when all of them clear", () => {
  const ok = { nowMs: DAY + 15 * H, queue: 3, ready: 2, rulingsToday: 0, balance: "2950000", bond: "1000000" };
  assert.deepEqual(checkerDecision(ok), { go: true, note: null });
  assert.equal(checkerDecision({ ...ok, nowMs: DAY + 23 * H }).go, true, "the first run at or after the hour: a bet at 23:00 still gets its sitting");
  const no = (o) => { const d = checkerDecision({ ...ok, ...o }); assert.equal(d.go, false); return d.note; };
  assert.match(no({ live: { challenge_id: 7 } }), /one at a time/);
  assert.match(no({ queue: 0, ready: 0 }), /no caught line/);
  assert.match(no({ ready: 0 }), /3 caught lines wait for bets/);
  assert.match(no({ queue: 1, ready: 0 }), /1 caught line waits/);
  assert.match(no({ rulingsToday: 1 }), /today's sitting is done/);
  assert.match(no({ capped: true }), /daily challenge cap/);
  assert.match(no({ nowMs: DAY + 15 * H - 1 }), /sitting is at 15:00 UTC/);
  assert.match(no({ balance: null }), /could not read/);
  assert.match(no({ bond: null }), /could not read/);
  assert.match(no({ balance: "999999" }), /waits for funding/);
  assert.match(no({ left: 1000 }), /out of time/);
  assert.equal(checkerDecision({ ...ok, sitting: { ...SITTING, perDay: 2 }, rulingsToday: 1 }).go, true, "a second ruling when two a day are set");
});

test("the Checker's queue: its own rulings today count, UTC days apart, and the lines short of bets stay queued", () => {
  const claims = [claim(18, { text: STALE, trades: 2 }), claim(19, { text: CAUGHT }), claim(3)];
  const r = (challenger, opened_at) => ({ challenger, claim_id: 50, status: "settled", opened_at, settled_at: opened_at + 1 });
  const rulings = [r("checker.near", DAY + 1), r("checker.near", DAY - 1), r("someone.near", DAY + 2)];
  const q = checkerQueue({ claims, rulings, account: "checker.near", nowMs: DAY + 16 * H });
  assert.deepEqual([q.candidates.length, q.ready.length, q.rulingsToday], [2, 1, 1]);
  assert.equal(q.ready[0].claim.id, 18);
  assert.equal(checkerQueue({ claims, rulings, account: null, nowMs: DAY + 16 * H }).rulingsToday, 0);
  assert.equal(checkerQueue({ claims, rulings, account: "checker.near", nowMs: DAY + 16 * H, sitting: { ...SITTING, minBets: 3 } }).ready.length, 0);
  const facts = checkerFacts({ enabled: true, funded: true, refused: null, capped_on: "2026-11-06" }, q, DAY + 16 * H);
  assert.deepEqual(facts, { enabled: true, queue: 2, waiting_for_bets: 1, rulings_today: 1, funded: true, refused: null, capped: true });
  assert.equal(checkerFacts({ enabled: true, capped_on: "2026-11-05" }, q, DAY + 16 * H).capped, false, "a cap reached yesterday is over");
  assert.equal(checkerFacts(null, q, DAY).enabled, false);
});

test("the corrected wording is the latest signed sentence in the correct band; the liquidity is the old line's", () => {
  const signed = (v, band, text, at, status = "signed") => ({ id: `t:9:v${v}`, version: v, status, createdAt: at, page: "tether", paragraph: 9, sentences: [{ claim_id: 18, band, text }, { claim_id: 19, band: "hedge", text: "other" }] });
  const list = [signed(1, "correct", "old correction", 1), signed(2, "correct", "new correction", 2), signed(3, "correct", "unsigned one", 3, "template"), signed(4, "negate", "Traders doubt this line: x", 4), signed(5, "correct", STALE, 5), signed(6, "correct", "y".repeat(601), 6)];
  assert.equal(correctedWording(list, 18, STALE).text, "new correction");
  assert.equal(correctedWording(list, 18, STALE).rewrite_id, "t:9:v2");
  assert.equal(correctedWording(list, 77, STALE), null);
  const c = claim(18, { price_yes_ppm: 500000, cost_up_10_micro: String(Math.round(1450000 * Math.log(0.5 / 0.4))) });
  assert.deepEqual(bOf(c, [ev("open", { claim_id: 18, b_micro: "1450000", p0_ppm: 500000 })]), { b_micro: "1450000", p0_ppm: 500000, from: "open event" });
  const inferred = bOf(c, []);
  assert.ok(Math.abs(Number(inferred.b_micro) - 1450000) < 20);
  assert.equal(bOf(claim(1), []), null);
});

test("the clock: stages of a live ruling, never a time already past, and never one that slides", () => {
  const every = 600_000;
  assert.equal(nextTick(every * 5, every, 0), every * 5);
  assert.equal(nextTick(every * 5 + 1, every, 45_000), every * 6 + 45_000);
  const now = every * 100 + 30_000;
  const jury = rulingClock({ nowMs: now, rulings: [{ status: "jury", challenge_id: 4, claim_id: 18, claim: "x", verdicts: [], opened_at: now - 1000 }] });
  assert.equal(jury.ruling_now.stage, "jury");
  assert.ok(jury.next_ruling_at > now + 600_000 && jury.next_ruling_at <= now + 25 * 60_000);
  assert.equal(jury.next_challenge_at, null);
  assert.match(jury.next_ruling_note, /judges are ruling/);
  const win = rulingClock({ nowMs: now, rulings: [{ status: "window", challenge_id: 4, claim_id: 18, claim: "x", verdicts: [{ model: "m", verdict: "FALSE" }], provisional: "FALSE", opened_at: now - 1000, window_ends_at: now + 60_000 }] });
  assert.equal(win.ruling_now.stage, "window");
  assert.equal(win.ruling_now.finalize_due_at, nextTick(now + 60_000));
  assert.equal(win.next_ruling_at, nextTick(now + 60_000));
  assert.match(win.next_ruling_note, /object/);
  const esc = rulingClock({ nowMs: now, rulings: [{ status: "escalated", challenge_id: 4, verdicts: [] }] });
  assert.equal(esc.next_ruling_at, null);
  assert.equal(esc.ruling_now.finalize_due_at, null);
  assert.match(esc.next_ruling_note, /council/);
  // the keeper is late with a window that closed: the clock moves on to the next run, not into the past
  const lateWin = rulingClock({ nowMs: now, rulings: [{ status: "window", challenge_id: 4, verdicts: [], window_ends_at: now - 3 * every }] });
  assert.ok(lateWin.next_ruling_at > now);
  // a jury past its three minutes: the one known limit is its deadline, and that doesn't slide
  const late = (nowMs, jury_deadline_at) => rulingClock({ nowMs, rulings: [{ status: "jury", challenge_id: 4, verdicts: [], opened_at: now - 30 * 60_000, jury_deadline_at }] }).next_ruling_at;
  assert.equal(late(now, now + 30 * 60_000), nextTick(now + 30 * 60_000));
  assert.equal(late(now + 60_000, now + 30 * 60_000), late(now, now + 30 * 60_000));
  assert.equal(late(now, undefined), null, "no deadline known: nothing is promised");
});

test("the clock when no ruling runs: every state says what is true, in a sentence fit for a visitor", () => {
  const at = (h, m = 0, s = 0) => DAY + h * H + m * 60_000 + s * 1000;
  const ready = { enabled: true, queue: 4, waiting_for_bets: 1, rulings_today: 0, funded: true };
  const clock = (nowMs, o = {}, sitting) => rulingClock({ nowMs, rulings: [], sitting, checker: { ...ready, ...o } });
  const tomorrow = at(39);

  // before the sitting
  let c = clock(at(10));
  assert.deepEqual([c.next_ruling_at, c.next_challenge_at, c.next_ruling_note], [at(15), at(15), "The jury sits daily at 15:00 UTC"]);
  assert.deepEqual([c.sitting_hour_utc, c.rulings_today, c.per_day, c.queue, c.waiting_for_bets, c.ruling_now], [15, 0, 1, 4, 1, null]);
  // today's ruling is done, after the hour or before it (today's six ran from 03:30)
  for (const t of [at(16), at(10)]) {
    c = clock(t, { rulings_today: 1 });
    assert.deepEqual([c.next_ruling_at, c.next_ruling_note], [tomorrow, "Today's ruling is done. The next sitting is tomorrow at 15:00 UTC"]);
  }
  assert.equal(clock(at(16), { rulings_today: 6 }).rulings_today, 6);
  assert.equal(clock(at(16), { rulings_today: 2 }, { ...SITTING, perDay: 2 }).next_ruling_note, "Today's rulings are done. The next sitting is tomorrow at 15:00 UTC");
  // the signer's cap is reached: the same honest answer, whatever per_day says
  assert.equal(clock(at(16), { rulings_today: 6, capped: true }, { ...SITTING, perDay: 50 }).next_ruling_at, tomorrow);
  // the sitting is due: the cron run about to act, not a promise of the next one
  assert.equal(clock(at(15, 0, 5)).next_ruling_at, at(15, 0, 30));
  assert.equal(clock(at(18, 3)).next_ruling_at, at(18, 10, 30));
  assert.equal(clock(at(18, 3)).next_ruling_note, "The jury sits within the next 10 minutes");
  // nothing can happen: no time at all, and the home page's timer reads the same
  const none = (o, note) => { const n = clock(at(10), o); assert.deepEqual([n.next_ruling_at, n.next_challenge_at, n.next_ruling_note], [null, null, note]); };
  none({ queue: 0, waiting_for_bets: 0 }, "No doubted fact is waiting for the jury");
  none({ waiting_for_bets: 4 }, "No doubted fact has a bet yet, so the next sitting waits for one");
  none({ funded: false }, "The next sitting waits for the Checker's bond to be funded");
  none({ refused: "Smart contract panicked" }, "Today's sitting is delayed while the keeper tries again");
  none({ enabled: false }, "The jury isn't sitting right now");
  assert.equal(rulingClock({ nowMs: at(10), rulings: [] }).next_ruling_at, null);
  // nothing to rule outranks "done today": tomorrow's sitting would have nothing either
  assert.equal(clock(at(16), { rulings_today: 6, waiting_for_bets: 4 }).next_ruling_at, null);
  // an unread balance is not a known shortfall
  assert.equal(clock(at(10), { funded: null }).next_ruling_at, at(15));
  // another hour, and across the end of the year
  assert.equal(clock(at(10), {}, { ...SITTING, hourUtc: 9 }).next_ruling_at, at(10, 0, 30));
  assert.equal(clock(at(1), {}, { ...SITTING, hourUtc: 9 }).next_ruling_note, "The jury sits daily at 09:00 UTC");
  assert.equal(clock(Date.UTC(2026, 11, 31, 20), { rulings_today: 1 }).next_ruling_at, Date.UTC(2027, 0, 1, 15));
});

test("the clock across a whole day: it never reaches a moment and starts again", () => {
  const ready = { enabled: true, queue: 2, waiting_for_bets: 0, funded: true };
  const keys = Object.keys(rulingClock({ nowMs: DAY, rulings: [] })).sort();
  const seen = new Set();
  for (let t = DAY; t < DAY + 24 * H; t += 60_000) {
    const done = rulingClock({ nowMs: t, rulings: [], checker: { ...ready, rulings_today: 1 } });
    assert.equal(done.next_ruling_at, DAY + 39 * H, "done for the day: one fixed time, all day");
    assert.ok(done.next_ruling_at > t);
    const stuck = rulingClock({ nowMs: t, rulings: [], checker: { ...ready, waiting_for_bets: 2 } });
    assert.equal(stuck.next_ruling_at, null, "nothing eligible: no countdown at any hour");
    const open = rulingClock({ nowMs: t, rulings: [], checker: { ...ready, rulings_today: 0 } });
    assert.ok(open.next_ruling_at >= t);
    if (t < DAY + 15 * H) seen.add(open.next_ruling_at);
    for (const x of [done, stuck, open]) assert.deepEqual(Object.keys(x).sort(), keys);
  }
  assert.deepEqual([...seen], [DAY + 15 * H], "before the sitting there is one promise, and it holds still");
});

/** A chain, a signer and a store in memory: the whole loop without a network. */
function loopWorld({ keeper = true, checker = true, balance = "1000000", now = DAY + 15 * H + 5000 } = {}) {
  const w = { now, sent: [], links: [], events: [ev("open", { claim_id: 18, b_micro: "1450000", p0_ppm: 500000 }, 1)], rewrites: [], wanted: [], recorded: [], triggered: [], capped: false };
  w.claims = [claim(18, { text: STALE, price_yes_ppm: 100000, trades: 5 }), claim(3)];
  w.challenges = new Map();
  w.signer = {
    operator: { ...(keeper ? { keeper: { ok: true, accountId: "owner.near" } } : {}), ...(checker ? { checker: { ok: true, accountId: "checker.owner.near" } } : {}) },
    keep: async (intent, method, id) => {
      w.sent.push({ method, id, intent });
      const ch = w.challenges.get(id), c = w.claims.find((x) => x.id === ch.claim_id);
      if (method === "finalize") { c.status = "Settled"; c.outcome = c.provisional; ch.resolved = true; w.events.push(ev("settle", { claim_id: c.id, challenge_id: id, outcome: c.outcome, payout_micro: "1" }, w.now)); return { ok: true, txHash: `F${id}`, value: c.outcome }; }
      c.status = "Open"; c.challenge_id = null; w.challenges.delete(id); w.events.push(ev("challenge_expired", { challenge_id: id, claim_id: c.id, trader: "checker.owner.near", amount_micro: "1000000", balance_micro: "1" }, w.now));
      return { ok: true, txHash: `E${id}` };
    },
    openClaim: async (intent, o) => {
      if (w.refuseOpen) return { ok: false, final: true, error: w.refuseOpen };
      w.sent.push({ method: "open_claim", intent, ...o });
      if (w.capped && o.p0_ppm !== 500000) return { ok: false, final: true, error: "Smart contract panicked: subsidy cap reached" };
      const id = w.claims.length + 30;
      w.claims.push(claim(id, { text: o.text, page: o.page, kind: o.kind }));
      return { ok: true, txHash: `O${id}`, value: id };
    },
    challenge: async (intent, c) => {
      if (w.refuse) return { ok: false, final: true, error: w.refuse };
      w.sent.push({ method: "challenge", intent, ...c });
      const id = w.challenges.size;
      const cl = w.claims.find((x) => x.id === c.claim_id);
      cl.status = "Challenged"; cl.challenge_id = id;
      w.challenges.set(id, { claim_id: c.claim_id, jury_deadline_ns: NS(w.now + 3600_000), resolved: false, verdicts: [] });
      w.events.push(ev("challenge", { challenge_id: id, claim_id: c.claim_id, claimed: false, trader: "checker.owner.near", amount_micro: "1000000", jury_deadline_ns: NS(w.now + 3600_000) }, w.now));
      return { ok: true, txHash: `C${id}`, value: id };
    },
  };
  w.round = (o = {}) => keeperRound({
    signer: w.signer, now: () => w.now,
    view: async (m, a) => (m === "get_challenge" ? w.challenges.get(a.challenge_id) ?? null : m === "dispute_ends_ns" ? w.windowEnd ?? null : m === "get_balance" ? balance : m === "get_resolution" ? { challenge_bond_micro: "1000000" } : null),
    claims: async () => w.claims.map((c) => ({ ...c })),
    events: () => w.events, rewrites: () => w.rewrites, links: () => w.links,
    addLink: async (l) => { w.links.push(l); },
    wantCorrection: async (id) => { w.wanted.push(id); },
    record: async (h, s) => { w.recorded.push([h, s]); },
    trigger: async (c) => { w.triggered.push(c); return { ok: true, status: 202 }; },
    rulings: async (claims) => rulingsOf({ events: w.events, claims }),
    plannerP0: async () => 700000,
    ...o,
  });
  return w;
}

test("the loop: the Checker challenges one caught line, the keeper finalizes, the corrected wording opens linked to it", async () => {
  const w = loopWorld();
  // 1. the Checker challenges the caught line and calls the jury at once
  let r = await w.round();
  assert.deepEqual(r.challenged, { claim_id: 18, corpus_id: "tether-0161", challenge_id: 0, tx: "C0", jury: { ok: true, status: 202 } });
  assert.deepEqual(w.triggered, [{ txHash: "C0", signerId: "checker.owner.near", challenge_id: 0 }]);
  const posted = w.sent.find((x) => x.method === "challenge");
  assert.equal(posted.claimed_outcome, false);
  assert.match(posted.evidence, /122\.84 billion/);
  assert.equal(r.clock.ruling_now.claim_id, 18);
  assert.equal(r.clock.ruling_now.stage, "jury");
  // 2. one at a time: nothing more while it runs, and nothing is finalized before the jury rules
  w.now += 60_000;
  r = await w.round();
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /one at a time/);
  assert.equal(r.finalized.length, 0);
  // 3. the jury rules FALSE; the window runs; the keeper finalizes once it ends
  const c = w.claims.find((x) => x.id === 18);
  c.provisional = false;
  w.windowEnd = NS(w.now + 600_000);
  w.events.push(ev("provisional", { challenge_id: 0, claim_id: 18, outcome: false, window_ends_ns: w.windowEnd }, w.now));
  r = await w.round();
  assert.equal(r.finalized.length, 0, "the window is open");
  assert.equal(r.clock.ruling_now.stage, "window");
  w.now += 700_000;
  r = await w.round();
  assert.deepEqual(r.finalized, [{ challenge_id: 0, claim_id: 18, tx: "F0", outcome: false }]);
  assert.deepEqual(w.recorded.at(-1), ["F0", "owner.near"]);
  // 4. no signed correction yet: the writer is asked, nothing is opened on an unsigned word
  assert.deepEqual(r.waiting.map((x) => x.claim_id), [18]);
  assert.deepEqual(w.wanted, [18]);
  assert.equal(w.links.length, 0);
  // 5. the signed correction lands: it opens as a new market at the same b, at the planner's estimate
  const corrected = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, which Tether's attestation report puts at $122.84 billion at 30 September 2026.";
  w.rewrites.push({ id: "tether:9:v3", version: 3, status: "signed", createdAt: 5, page: "tether", paragraph: 9, sentences: [{ claim_id: 18, band: "correct", text: corrected }] });
  r = await w.round();
  assert.equal(r.opened.length, 1);
  const open = w.sent.find((x) => x.method === "open_claim");
  assert.deepEqual([open.text, open.page, open.kind, open.b_micro, open.p0_ppm], [corrected, "tether", "document", "1450000", 700000]);
  assert.deepEqual([w.links[0].old_claim_id, w.links[0].new_claim_id, w.links[0].rewrite_id, w.links[0].corpus_id], [18, r.opened[0].new_claim_id, "tether:9:v3", "tether-0161"]);
  // 6. once: a later round opens nothing more
  w.now += 3600_000 * 2;
  r = await w.round();
  assert.equal(r.opened.length, 0);
  assert.equal(w.sent.filter((x) => x.method === "open_claim").length, 1);
});

test("an open that hits the subsidy cap falls back to the old line's price, then 50%; a crash between open and link never opens twice", async () => {
  const w = loopWorld({ checker: false });
  w.capped = true;
  const c = w.claims[0];
  Object.assign(c, { status: "Settled", outcome: false, challenge_id: 0 });
  w.events[0].data.p0_ppm = 450000;
  w.rewrites.push({ id: "t:9:v1", version: 1, status: "signed", createdAt: 5, sentences: [{ claim_id: 18, band: "correct", text: "Fixed." }] });
  let r = await w.round();
  assert.deepEqual(w.sent.filter((x) => x.method === "open_claim").map((x) => x.p0_ppm), [700000, 450000, 500000]);
  assert.equal(r.opened[0].p0_ppm, 500000);
  // the same line again, with its link lost: the chain already has the wording, so it is only linked
  w.links.length = 0;
  w.sent.length = 0;
  r = await w.round();
  assert.equal(w.sent.length, 0);
  assert.match(r.opened[0].note, /already open/);
  assert.equal(w.links.length, 1);
});

test("a line ruled FALSE with no sourced correction opens nothing; TRUE opens nothing", async () => {
  const w = loopWorld({ checker: false });
  w.claims = [claim(1, { status: "Settled", outcome: false }), claim(18, { text: STALE, status: "Settled", outcome: true })];
  const r = await w.round();
  assert.deepEqual([r.opened.length, r.waiting.length, w.wanted.length, w.sent.length], [0, 0, 0, 0]);
});

test("the Checker waits: for funding, for its sitting, and for a key; a job out of time stops before a challenge", async () => {
  let w = loopWorld({ balance: "999999" });
  let r = await w.round();
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /waits for funding/);
  assert.equal(r.checker.balance_micro, "999999");
  assert.equal(r.checker.funded, false);
  assert.equal(r.clock.next_ruling_at, null);
  assert.match(r.clock.next_ruling_note, /bond to be funded/);
  assert.deepEqual(r.errors, []);
  // before the hour nothing is sent; the first run at or after it challenges
  w = loopWorld({ now: DAY + 14 * H + 50 * 60_000 + 5000 });
  r = await w.round();
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /sitting is at 15:00 UTC/);
  assert.equal(r.clock.next_ruling_at, DAY + 15 * H);
  assert.equal(r.clock.next_ruling_note, "The jury sits daily at 15:00 UTC");
  w.now += 10 * 60_000;
  r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  // a sitting at another hour
  w = loopWorld({ now: DAY + 9 * H + 5000 });
  r = await w.round({ sitting: { ...SITTING, hourUtc: 9 } });
  assert.equal(r.challenged.claim_id, 18);
  w = loopWorld({ checker: false });
  r = await w.round();
  assert.equal(r.checker.enabled, false);
  assert.match(r.checker.reason, /no Checker key/);
  assert.equal(r.clock.next_ruling_note, "The jury isn't sitting right now");
  w = loopWorld();
  r = await w.round({ left: () => 1000 });
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /out of time/);
  w = loopWorld();
  r = await w.round({ checkerOn: false });
  assert.equal(r.challenged, null);
  assert.equal(w.sent.length, 0);
});

test("a challenge our jury refused doesn't hold up the sitting; one it is ruling on does", async () => {
  const w = loopWorld();
  const liar = ev("challenge", { challenge_id: 40, claim_id: 77, claimed: false, trader: "liar.near", amount_micro: "1000000", jury_deadline_ns: NS(w.now + H) }, w.now - 60_000);
  w.claims.push(claim(77, { status: "Challenged", challenge_id: 40 }));
  w.events.push(liar);
  const held = await w.round({ rulings: async (claims) => rulingsOf({ events: w.events, claims, ledger: { checks: { 40: { result: "verified" } } } }) });
  assert.equal(held.challenged, null, "a ruling is running: one at a time");
  assert.match(held.checker.note, /one at a time/);
  const r = await w.round({ rulings: async (claims) => rulingsOf({ events: w.events, claims, ledger: { checks: { 40: { result: "record_mismatch" } } } }) });
  assert.equal(r.challenged.claim_id, 18, "nothing is sitting on the forgery, so the sitting goes ahead");
});

test("one sitting a day: after today's ruling the Checker rests, and tomorrow it takes the next", async () => {
  const w = loopWorld();
  w.claims.push(claim(19, { text: CAUGHT, trades: 1 }));
  let r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  // the ruling ends; every later run today stays quiet
  const c = w.claims.find((x) => x.id === 18);
  Object.assign(c, { status: "Settled", outcome: true });
  w.challenges.get(0).resolved = true;
  w.events.push(ev("settle", { claim_id: 18, challenge_id: 0, outcome: true, payout_micro: "0" }, w.now + 20 * 60_000));
  for (const later of [H, 3 * H, 8 * H]) {
    w.now = DAY + 15 * H + later;
    r = await w.round();
    assert.equal(r.challenged, null);
    assert.match(r.checker.note, /today's sitting is done: 1 of 1/);
    assert.deepEqual(r.errors, []);
    assert.deepEqual([r.clock.next_ruling_at, r.clock.rulings_today, r.clock.queue], [DAY + 39 * H, 1, 1]);
    assert.equal(r.clock.next_ruling_note, "Today's ruling is done. The next sitting is tomorrow at 15:00 UTC");
  }
  assert.equal(w.sent.filter((x) => x.method === "challenge").length, 1);
  // the next day: before the hour it waits, at the hour it sits
  w.now = DAY + 34 * H;
  r = await w.round();
  assert.equal(r.challenged, null);
  assert.equal(r.clock.next_ruling_at, DAY + 39 * H);
  w.now = DAY + 39 * H + 5000;
  r = await w.round();
  assert.equal(r.challenged.claim_id, 19);
});

test("rule what people bet on: the most bets goes first, and a line with none waits, honestly", async () => {
  let w = loopWorld();
  w.claims[0].trades = 2;
  w.claims.push(claim(19, { text: CAUGHT, trades: 7 }));
  let r = await w.round();
  assert.equal(r.challenged.claim_id, 19);
  // nobody has bet on anything: nothing is challenged, and the clock doesn't count down to it
  w = loopWorld();
  w.claims[0].trades = 0;
  w.claims.push(claim(19, { text: CAUGHT, trades: 2, q_yes_micro: "0", q_no_micro: "0" }));
  r = await w.round();
  assert.equal(r.challenged, null);
  assert.equal(w.sent.length, 0);
  assert.deepEqual(r.errors, []);
  assert.match(r.checker.note, /2 caught lines wait for bets/);
  assert.deepEqual([r.clock.next_ruling_at, r.clock.queue, r.clock.waiting_for_bets], [null, 2, 2]);
  assert.match(r.clock.next_ruling_note, /No doubted fact has a bet yet/);
  assert.deepEqual(r.checker.lines.map((x) => x.bets), [0, 0]);
  // the first bet lands after the hour: the next run sits
  w.claims[0].trades = 1;
  w.now += 3 * H;
  r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  // CHECKER_MIN_BETS sets the bar
  w = loopWorld();
  r = await w.round({ sitting: { ...SITTING, minBets: 6 } });
  assert.equal(r.challenged, null);
  r = await w.round({ sitting: { ...SITTING, minBets: 5 } });
  assert.equal(r.challenged.claim_id, 18);
  // an empty queue
  w = loopWorld();
  w.claims = [claim(3)];
  r = await w.round();
  assert.match(r.checker.note, /no caught line/);
  assert.deepEqual([r.clock.next_ruling_at, r.clock.next_ruling_note, r.errors], [null, "No doubted fact is waiting for the jury", []]);
});

test("a cap is a quiet state: the keeper doesn't try what it knows will be refused, and a real refusal still fails", async () => {
  // it asks first: nothing is sent, nothing fails, and the clock moves to tomorrow
  let w = loopWorld();
  w.signer.caps = async () => ({ ok: true, day: "2026-11-06", challenges: { used: 6, cap: 6 }, opens: { used: 0, cap: 12 } });
  let r = await w.round({ sitting: { ...SITTING, perDay: 50 } });
  assert.equal(r.challenged, null);
  assert.equal(w.sent.length, 0);
  assert.deepEqual(r.errors, []);
  assert.match(r.checker.note, /daily challenge cap/);
  assert.equal(r.clock.next_ruling_at, DAY + 39 * H);
  // a cap from another day is over
  w = loopWorld();
  w.signer.caps = async () => ({ ok: true, day: "2026-11-05", challenges: { used: 6, cap: 6 }, opens: { used: 0, cap: 12 } });
  r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  // the signer can't say, or refuses at the cap anyway: still quiet
  w = loopWorld();
  w.signer.caps = async () => { throw new Error("down"); };
  w.refuse = "challenge: 6 challenges already posted today";
  r = await w.round();
  assert.deepEqual([r.challenged, r.errors], [null, []]);
  assert.equal(r.checker.capped_on, "2026-11-06");
  assert.equal(r.checker.refused, null);
  assert.equal(r.clock.next_ruling_at, DAY + 39 * H);
  // any other refusal is a failure, and the clock stops promising
  w = loopWorld();
  w.refuse = "Smart contract panicked: the claim is paused";
  r = await w.round();
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /challenge of claim 18: Smart contract panicked/);
  assert.equal(r.clock.next_ruling_at, null);
  assert.match(r.clock.next_ruling_note, /delayed/);
  // it clears on the run that gets through
  w.refuse = null;
  w.now += H;
  r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  assert.equal(r.checker.refused, null);
});

test("the pending correction: a capped open waits quietly and the keeper opens it once the cap allows", async () => {
  const settled = () => {
    const w = loopWorld({});
    Object.assign(w.claims[0], { status: "Settled", outcome: false, challenge_id: 0 });
    w.rewrites.push({ id: "t:9:v1", version: 1, status: "signed", createdAt: 5, sentences: [{ claim_id: 18, band: "correct", text: "Fixed." }] });
    return w;
  };
  // the keeper knows the cap is reached: no attempt, no failure, and it's on the list
  let w = settled();
  let used = 12;
  w.signer.caps = async () => ({ ok: true, day: "2026-11-06", challenges: { used: 0, cap: 6 }, opens: { used, cap: 12 } });
  let r = await w.round();
  assert.deepEqual([r.opened.length, r.errors, w.sent.filter((x) => x.method === "open_claim").length], [0, [], 0]);
  assert.match(r.waiting[0].why, /after midnight UTC/);
  assert.equal(w.links.length, 0);
  // the next day's count starts again: the same line opens, linked
  used = 0;
  w.now += 24 * H;
  r = await w.round();
  assert.equal(r.opened.length, 1);
  assert.deepEqual([w.links[0].old_claim_id, w.links[0].new_claim_id], [18, r.opened[0].new_claim_id]);
  // two lines and one open left: one opens, the other waits, and neither fails
  w = settled();
  w.claims.push(claim(19, { text: CAUGHT, status: "Settled", outcome: false, challenge_id: 1 }));
  w.events.push(ev("open", { claim_id: 19, b_micro: "1450000", p0_ppm: 500000 }, 1));
  w.rewrites.push({ id: "t:9:v2", version: 1, status: "signed", createdAt: 6, sentences: [{ claim_id: 19, band: "correct", text: "Also fixed." }] });
  w.signer.caps = async () => ({ ok: true, day: "2026-11-06", challenges: { used: 0, cap: 6 }, opens: { used: 11, cap: 12 } });
  r = await w.round();
  assert.deepEqual([r.opened.length, r.waiting.length, r.errors], [1, 1, []]);
  // the signer refuses at the cap anyway: quiet, and tried again on the next run
  w = settled();
  w.refuseOpen = "open: 12 corrected lines already opened today";
  r = await w.round();
  assert.deepEqual([r.opened.length, r.errors], [0, []]);
  assert.match(r.waiting[0].why, /after midnight UTC/);
  w.refuseOpen = null;
  r = await w.round();
  assert.equal(r.opened.length, 1);
  // a real refusal still fails
  w = settled();
  w.refuseOpen = "Smart contract panicked: paused";
  r = await w.round();
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /open for claim 18: Smart contract panicked/);
  assert.ok(isCapRefusal("challenge: 6 challenges already posted today") && isCapRefusal("open: 5 corrected lines already opened today") && !isCapRefusal("Smart contract panicked"));
});

test("the keeper expires a challenge past its deadline; with no keeper key it does nothing and says so", async () => {
  let w = loopWorld();
  await w.round();
  w.now += 3700_000;
  const r = await w.round();
  assert.deepEqual(r.expired, [{ challenge_id: 0, claim_id: 18, tx: "E0", outcome: null }]);
  assert.equal(w.claims[0].status, "Open");
  w = loopWorld({ keeper: false });
  w.claims[0].status = "Challenged";
  w.claims[0].challenge_id = 0;
  w.claims[0].provisional = false;
  w.challenges.set(0, { claim_id: 18, resolved: false, jury_deadline_ns: NS(1), window_ends_ns: NS(1) });
  const r2 = await w.round();
  assert.equal(r2.finalized.length, 0);
  assert.equal(r2.keeper_key.ok, false);
});

// ---------- the read routes ----------

function routeWorld(mock, { events = [], claims = [], files = {}, docs = {} } = {}) {
  return {
    api: { rpcUrls: [mock.url], marketId: "m.testnet", lane: { accountId: "lane.testnet", perIpPerDay: 10, perDay: 100 } },
    journals: { readCached: (f) => (f === "events.jsonl" ? events : files[f] || []) },
    claims: { decorated: async () => ({ claims, at: 5000 }) },
    state: { getDoc: async (n) => (docs[n] ? { value: docs[n] } : null), peek: async (scope, key, limit) => { const used = docs[`peek:${scope}:${key}`] || 0; return { used, remaining: Math.max(0, limit - used), retryAfterS: used >= limit ? 99 : 0 }; } },
  };
}

test("GET /history and /activity: compact points, a sparkline for every claim, CDN headers, plain refusals", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const events = [ev("open", { claim_id: 1, p0_ppm: 500000, b_micro: "1" }, 100), ev("trade", { claim_id: 1, trader: LANE, side: "no", shares_micro: "1", amount_micro: "1", price_yes_ppm: 300000 }, 200)];
    const p = routeWorld(mock, { events, claims: [claim(1, { price_yes_ppm: 300000 }), claim(2)] });
    const one = await historyRoute(new URL("http://x/history?claim=1"), p);
    assert.deepEqual(one.body.points, [[100, 500000], [200, 300000]]);
    assert.match(one.headers["cache-control"], /s-maxage=5/);
    const all = await historyRoute(new URL("http://x/history?all=1"), p);
    assert.deepEqual(Object.keys(all.body.claims), ["1", "2"]);
    assert.equal((await historyRoute(new URL("http://x/history?claim=x"), p)).status, 400);
    assert.equal((await historyRoute(new URL("http://x/history"), p)).status, 400);
    assert.equal((await historyRoute(new URL("http://x/history?claim=9"), p)).status, 404);
    const act = await activityRoute(new URL("http://x/activity?limit=1"), p);
    assert.equal(act.body.count, 1);
    assert.equal(act.body.activity[0].kind, "trade");
    assert.match(act.headers["cache-control"], /s-maxage=2/);
    assert.equal((await activityRoute(new URL("http://x/activity?limit=abc"), p)).body.count, 2);
  } finally { await mock.close(); }
});

test("GET /portfolio reads the chain for what is held and refuses a bad trader", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    mock.st.views.set("get_balance", () => "250000");
    mock.st.views.set("get_position", (a) => ({ yes_micro: "0", no_micro: a.claim_id === 1 ? "1500000" : "0" }));
    const events = [ev("trade", { claim_id: 1, trader: LANE, side: "no", shares_micro: "2000000", amount_micro: "1000000", price_yes_ppm: 300000 }, 200)];
    const p = routeWorld(mock, { events, claims: [claim(1, { price_yes_ppm: 300000 })] });
    const r = await portfolioRoute(new URL(`http://x/portfolio?trader=${encodeURIComponent(LANE)}`), p);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.kind, r.body.balance_usd, r.body.positions[0].shares, r.body.positions[0].held_from, r.body.positions[0].value_usd], ["lane", 0.25, 1.5, "chain", 1.05]);
    assert.equal((await portfolioRoute(new URL("http://x/portfolio?trader=nope!"), p)).status, 400);
    assert.deepEqual((await portfolioRoute(new URL("http://x/portfolio?trader=fresh.testnet"), p)).body.positions, []);
  } finally { await mock.close(); }
});

test("a trader's history: money moves only, their own, newest first, each with its transaction", () => {
  const me = "me.near";
  const events = [
    ev("deposit", { to: me, trader: me, amount_micro: "5000000", balance_micro: "5000000" }, 100),
    ev("trade", { claim_id: 1, trader: me, side: "no", shares_micro: "2000000", amount_micro: "1000000", fee_micro: "10000", price_yes_ppm: 300000 }, 110),
    ev("trade", { claim_id: 1, trader: "other.near", side: "yes", shares_micro: "1000000", amount_micro: "500000", price_yes_ppm: 310000 }, 115),
    ev("trade", { claim_id: 1, trader: me, side: "sell_no", shares_micro: "500000", amount_micro: "250000", price_yes_ppm: 305000 }, 120),
    ev("redeem", { claim_id: 1, trader: me, side: "no", shares_micro: "1500000", amount_micro: "1500000" }, 130),
    ev("challenge", { challenge_id: 0, claim_id: 1, trader: me, amount_micro: "1000000" }, 135),
    ev("withdraw", { trader: me, amount_micro: "2000000", balance_micro: "0" }, 140),
    ev("withdraw_refunded", { to: me, trader: me, amount_micro: "2000000", balance_micro: "2000000" }, 141),
  ];
  const h = traderHistory(events, me);
  assert.deepEqual(h.map((r) => r.kind), ["refund", "withdraw", "collect", "sell", "buy", "deposit"]);
  assert.deepEqual([h[3].side, h[3].amount_usd, h[3].shares, h[3].claim_id], ["no", 0.25, 0.5, 1]);
  assert.deepEqual([h[5].claim_id, h[5].side, h[5].shares], [null, null, null]);
  assert.ok(h.every((r) => r.tx && r.at));
  assert.equal(traderHistory(events, me, 2).length, 2);
  assert.deepEqual(traderHistory(events, "nobody.near"), []);
});

test("GET /rulings: the chain's live view, the clock and the Checker's state", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    mock.st.views.set("get_challenge", (a) => (a.challenge_id === 7 ? { claim_id: 6, challenger: "checker.x.near", evidence: "e", verdicts: [{ model: "glm", outcome: "FALSE", request_hash: "a", response_hash: "b" }], resolved: false, disputes: 0, jury_deadline_ns: NS(Date.now() + 1000), stakes: [{ amount_micro: "1000000" }], opened_ns: NS(1000) } : null));
    mock.st.views.set("dispute_ends_ns", () => NS(Date.now() + 500_000));
    const docs = { "snapshots/keeper.json": { at: "t", checker: { enabled: true, account: "checker.x.near", candidates: 2, balance_micro: "1000000", funded: true, refused: null, capped_on: null, note: null } } };
    const p = routeWorld(mock, { claims: [claim(6, { status: "Challenged", challenge_id: 7, provisional: false }), claim(18, { text: STALE, trades: 5 }), claim(19, { text: CAUGHT })], docs });
    const r = await rulingsRoute(p);
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 1, "known to the chain before the index has it");
    assert.equal(r.body.rulings[0].verdicts[0].verdict, "FALSE");
    assert.equal(r.body.ruling_now.challenge_id, 7);
    assert.equal(r.body.ruling_now.stage, "window");
    assert.ok(r.body.next_ruling_at > Date.now());
    assert.deepEqual([r.body.checker.account, r.body.checker.balance_usd, r.body.checker.lines_left], ["checker.x.near", 1, 2]);
    assert.deepEqual([r.body.sitting_hour_utc, r.body.per_day, r.body.queue, r.body.waiting_for_bets, r.body.rulings_today], [15, 1, 2, 1, 0]);
    // the exact shape docs/API.md gives
    assert.deepEqual(Object.keys(r.body).sort(), ["asOf", "checker", "count", "keeper_ran_at", "next_challenge_at", "next_ruling_at", "next_ruling_note", "per_day", "queue", "ruling_now", "rulings", "rulings_today", "sitting_hour_utc", "waiting_for_bets"]);
    const idle = await rulingsRoute(routeWorld(mock, { claims: [claim(18, { text: STALE, trades: 5 })], docs }));
    assert.equal(idle.body.ruling_now, null);
    assert.ok(idle.body.next_ruling_at > Date.now());
    assert.equal(idle.body.next_challenge_at, idle.body.next_ruling_at);
    assert.deepEqual(Object.keys(idle.body).sort(), Object.keys(r.body).sort());
    // the queue is read as it stands, not as the last cron run left it: 2 in the record, 1 here, no bets on it
    const noBets = await rulingsRoute(routeWorld(mock, { claims: [claim(18, { text: STALE })], docs }));
    assert.deepEqual([noBets.body.next_ruling_at, noBets.body.next_challenge_at, noBets.body.queue, noBets.body.waiting_for_bets, noBets.body.checker.lines_left], [null, null, 1, 1, 1]);
    assert.match(noBets.body.next_ruling_note, /No doubted fact has a bet yet/);
    const empty = await rulingsRoute(routeWorld(mock, { claims: [claim(1)], docs }));
    assert.deepEqual([empty.body.next_ruling_at, empty.body.queue], [null, 0]);
    const never = await rulingsRoute(routeWorld(mock, { claims: [claim(18, { text: STALE, trades: 5 })] }));
    assert.deepEqual([never.body.next_ruling_at, never.body.checker, never.body.next_ruling_note], [null, null, "The jury isn't sitting right now"]);
  } finally { await mock.close(); }
});

test("GET /rulings: each ruling says what its receipts were and what the Sentinel did, in the shape docs/API.md gives", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    mock.st.views.set("get_challenge", () => ({ claim_id: 6, challenger: "liar.near", evidence: "e", verdicts: [], resolved: false, disputes: 1 }));
    mock.st.views.set("dispute_ends_ns", () => NS(Date.now() + 500_000));
    const check = {
      result: "quote_not_found", reason: "The quoted words are not at https://tether.to/en/legal/.", checked_at: "2026-11-06T15:00:00.000Z", via: "source", record: null,
      quotes: [{ text: "headquartered in Zug", found: false, url: null, via: null }],
      sources: [{ url: "https://tether.to/en/legal/", final_url: "https://tether.to/en/legal/", via: "source", status: 200, content_type: "text/html", bytes: 9, sha256: "ab", fetched_at: "2026-11-06T15:00:00.000Z", error: null }],
    };
    const docs = { [LEDGER]: { checks: { 7: check }, sentinel: { 7: { status: "disputed", note: "Disputed in round 1.", last_look_at: "2026-11-06T15:01:00.000Z", disputes: [{ round: 1, bond_usd: 2, tx: "T", at: "2026-11-06T15:01:00.000Z", result: "quote_not_found" }], attempts: [{ round: 1, at: "x", error: "internal" }] } } } };
    const claims = [claim(6, { status: "Challenged", challenge_id: 7, provisional: true })];
    const r = await rulingsRoute(routeWorld(mock, { claims, docs }));
    const [x] = r.body.rulings;
    assert.deepEqual(Object.keys(x.receipt_check).sort(), ["checked_at", "quotes", "reason", "record", "result", "sources", "support", "via"]);
    assert.equal(x.receipt_check.result, "quote_not_found");
    assert.deepEqual(x.receipt_check.quotes, [{ text: "headquartered in Zug", found: false, url: null }]);
    assert.deepEqual(Object.keys(x.receipt_check.sources[0]).sort(), ["bytes", "content_type", "error", "fetched_at", "sha256", "status", "url", "via"]);
    assert.deepEqual(x.sentinel, { status: "disputed", note: "Disputed in round 1.", last_look_at: "2026-11-06T15:01:00.000Z", disputes: [{ round: 1, bond_usd: 2, tx: "T", at: "2026-11-06T15:01:00.000Z" }] }, "its internal attempts stay internal");
    const none = await rulingsRoute(routeWorld(mock, { claims }));
    assert.deepEqual([none.body.rulings[0].receipt_check, none.body.rulings[0].sentinel], [null, null], "a ruling from before the Sentinel: both fields, null");
    assert.deepEqual(Object.keys(none.body.rulings[0]).sort(), Object.keys(x).sort(), "the same fields either way");
  } finally { await mock.close(); }
});

test("a challenge our jury refused: the clock doesn't call it a sitting, and it holds nothing up", () => {
  const now = DAY + 15 * H;
  const r = { status: "jury", challenge_id: 9, claim_id: 2, claim: "A line.", verdicts: [], opened_at: now - 60_000, jury_deadline_at: now + H, receipt_check: { result: "quote_not_found" } };
  for (const result of ["quote_not_found", "unfetchable", "record_mismatch", "no_receipt"]) assert.equal(juryRefused({ ...r, receipt_check: { result } }), true, result);
  assert.equal(juryRefused({ ...r, receipt_check: { result: "verified" } }), false);
  assert.equal(juryRefused({ ...r, receipt_check: null }), false, "not checked yet: the jury may still sit");
  assert.equal(juryRefused({ ...r, status: "window" }), false, "someone else's jury ruled: it is a ruling like any other");
  const clock = rulingClock({ rulings: [r], nowMs: now });
  assert.equal(clock.next_ruling_note, "Our jury isn't sitting on this challenge: its receipts did not verify");
  assert.ok(clock.next_ruling_at >= r.jury_deadline_at, "its real next step is the deadline, not a settlement in minutes");
  const real = { ...r, challenge_id: 10, receipt_check: { result: "verified" } };
  assert.equal(rulingClock({ rulings: [r, real], nowMs: now }).ruling_now.challenge_id, 10, "a real sitting comes first");
  assert.match(rulingClock({ rulings: [real], nowMs: now }).next_ruling_note, /Three AI judges are ruling/);
});

test("a run's receipt check still shows if the ledger's write failed", () => {
  const events = [ev("challenge", { challenge_id: 1, claim_id: 3, claimed: false, trader: "liar.near", amount_micro: "1000000", jury_deadline_ns: NS(9000) }, 6000)];
  const [r] = rulingsOf({ events, claims: [claim(3)], juryRuns: [{ challenge_id: 1, status: "refused", receipt_check: { result: "unfetchable", reason: "HTTP 403", checked_at: "t", via: "source" }, jurors: [] }] });
  assert.deepEqual([r.receipt_check.result, r.receipt_check.reason, r.receipt_check.sources, r.sentinel], ["unfetchable", "HTTP 403", [], null]);
});

test("the Sentinel's ledger: compare-and-swap on one document, read as the gate's store, the newest 400 kept", async () => {
  const state = new FsState({ prefix: "state/testnet/m", dir: tmp() });
  assert.deepEqual(await readLedger(state), { checks: {}, sentinel: {}, updated_at: null });
  const store = ledgerChecks(state);
  assert.equal(await store.get(3), null);
  await store.put(3, { result: "verified" });
  await putSentinel(state, 3, { status: "no_dispute" });
  await Promise.all([putCheck(state, 4, { result: "no_receipt" }), putCheck(state, 5, { result: "unfetchable" })]);
  const l = await readLedger(state);
  assert.deepEqual(Object.keys(l.checks).sort(), ["3", "4", "5"], "writers at once don't lose each other's records");
  assert.equal((await store.get(3)).result, "verified");
  assert.equal(l.sentinel[3].status, "no_dispute");
  assert.ok(l.updated_at);
  for (let i = 10; i < 416; i += 40) await putCheck(state, i, { result: "verified" });
  await state.updateDoc(LEDGER, (c) => { for (let i = 1000; i < 1500; i++) c.checks[i] = { result: "verified" }; return c; });
  await putCheck(state, 2000, { result: "verified" });
  const pruned = await readLedger(state);
  assert.equal(Object.keys(pruned.checks).length, 400);
  assert.ok(pruned.checks[2000] && pruned.checks[1499] && !pruned.checks[3], "the oldest fall off the end");
});

function sentinelWorld(mock, o = {}) {
  const state = new FsState({ prefix: "state/testnet/m", dir: tmp() });
  const dataDir = tmp();
  return { api: { rpcUrls: [mock.url], marketId: "m.testnet", network: "testnet" }, state, journals: new JournalDir(state, dataDir), env: { NEAR_NETWORK: "testnet", MARKET_CONTRACT_ID: "m.testnet", DATA_DIR: dataDir }, operatorAccounts: o.accounts ?? {} };
}

test("the Sentinel's minute: one view call when nothing is live, and no lock, no store", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    mock.st.stats.bonds_micro = "0";
    const p = sentinelWorld(mock);
    const r = await runSentinel(p);
    assert.deepEqual([r.ok, r.idle], [true, true]);
    assert.deepEqual(mock.st.calls, ["query"]);
    assert.deepEqual([p.state.ops.gets, p.state.ops.puts], [0, 0]);
  } finally { await mock.close(); }
});

test("the Sentinel's minute: a live challenge is checked and written; a running Sentinel is not doubled; no key says so", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    mock.st.stats.bonds_micro = "1000000";
    mock.st.claims = [claim(0, { status: "Challenged", challenge_id: 0, provisional: false, text: "USDC is issued by Circle." })];
    mock.st.views.set("get_challenge", () => ({ claim_id: 0, challenger: "liar.near", claimed_outcome: false, evidence: "Forged. Corpus record usdc-0001 says so.", bond_micro: "1000000", disputes: 0, resolved: false, verdicts: [] }));
    mock.st.views.set("dispute_ends_ns", () => NS(Date.now() + 500_000));
    const p = sentinelWorld(mock);
    const busy = await p.state.acquire("sentinel", { ttlMs: 60_000 });
    assert.equal((await runSentinel(p)).busy, true);
    await busy.release();
    const r = await runSentinel(p);
    assert.equal(r.live[0].receipt, "record_mismatch");
    assert.equal(r.live[0].status, "blocked");
    assert.match(r.live[0].note, /no Sentinel key/);
    const l = await readLedger(p.state);
    assert.equal(l.checks[0].result, "record_mismatch");
    assert.equal(l.sentinel[0].status, "blocked");
    assert.equal((await p.state.acquire("sentinel", { ttlMs: 1000 })) !== null, true, "the lock was released");
  } finally { await mock.close(); }
});

test("the Sentinel's minute: a chain that doesn't answer is a failure said plainly, never a throw", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  mock.st.down = true;
  try {
    const r = await runSentinel(sentinelWorld(mock));
    assert.equal(r.ok, false);
    assert.match(r.error, /stats did not answer/);
  } finally { mock.st.down = false; await mock.close(); }
});

test("the Checker's evidence passes the Sentinel's check: the keeper's hash and the receipt check's are one", async () => {
  const { checkReceipts, recordHash } = await import("../../ai/src/receipts.js");
  for (const e of errors.items) {
    assert.equal(corpusRecord(e.id).sha256, recordHash(e));
    assert.equal((await checkReceipts({ claim: e.sentence, evidence: checkerEvidence(corpusEvidence(e.sentence)), claimed: false, fetchSource: null })).result, "verified", e.id);
  }
});

test("GET /lane/status says before the tap whether this visitor can still get a free bet, with a plain reason", async () => {
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const pk = LANE.slice(5);
    const req = { headers: { "x-forwarded-for": "9.9.9.9" }, socket: {} };
    const ctx = (budget = { paused: false, credits: 5, free: 5 }, enabled = true) => ({ app: { rpc: new Rpc([mock.url]), lane: { enabled, budget: async () => { if (budget === "down") throw new Error("down"); return budget; } } } });
    const url = (q = "") => new URL(`http://x/lane/status${q}`);
    const p = (docs = {}, events = []) => routeWorld(mock, { events, docs });
    const ok = await laneStatusRoute(url(), req, ctx(), p());
    assert.deepEqual([ok.body.available, ok.body.reason, ok.body.ip_left_today, ok.body.left_today, ok.body.credits_left, ok.body.per_ip_per_day], [true, "ok", 10, 100, 5, 10]);
    assert.equal(ok.headers["cache-control"], "no-store");
    const ipCap = await laneStatusRoute(url(), req, ctx(), p({ "peek:lane:9.9.9.9": 10 }));
    assert.deepEqual([ipCap.body.available, ipCap.body.reason, ipCap.body.retry_after_s], [false, "rate_limited", 99]);
    assert.match(ipCap.body.message, /used its 10 free bets/);
    assert.equal((await laneStatusRoute(url(), req, ctx(), p({ "peek:lane-global:all": 100 }))).body.reason, "lane_daily_cap");
    const usedUp = await laneStatusRoute(url(), req, ctx({ paused: false, credits: 0, free: 0 }), p());
    assert.deepEqual([usedUp.body.reason, usedUp.body.replay], ["lane_used_up", "/c/18?recorded=1"]);
    assert.match(usedUp.body.message, /used up for now\. Watch a real bet play out, from the tap to the jury's ruling, at isitpriced\.com\/c\/18\?recorded=1\./, "the used-up words offer the recorded run");
    // the lane account short of NEAR for gas: said before the tap, in the words /lane/key refuses with
    const lowGas = { paused: false, credits: 5, free: 5 };
    const gasCtx = (low) => { const c = ctx(lowGas); c.app.lane.lowOnGas = async () => low; return c; };
    const gas = await laneStatusRoute(url(), req, gasCtx(true), p());
    assert.deepEqual([gas.body.available, gas.body.reason, gas.body.low_gas], [false, "lane_unavailable", true]);
    assert.match(gas.body.message, /topped up with NEAR for gas/);
    assert.equal((await laneStatusRoute(url(), req, gasCtx(false), p())).body.reason, "ok");
    assert.equal((await laneStatusRoute(url(), req, ctx({ paused: true, credits: 5, free: 5 }), p())).body.reason, "market_paused");
    assert.equal((await laneStatusRoute(url(), req, ctx(undefined, false), p())).body.reason, "lane_unavailable");
    assert.equal((await laneStatusRoute(url(), req, ctx("down"), p())).status, 502);
    assert.equal((await laneStatusRoute(url("?publicKey=nope"), req, ctx(), p())).status, 400);
    // a browser that already has its key: its allowance is that key, whatever the address has used
    mock.st.keys.set(`lane.testnet|${pk}`, { nonce: "1", permission: { FunctionCall: { receiver_id: "m.testnet", method_names: ["buy"] } } });
    mock.st.views.set("get_balance", () => "400000");
    const credited = [ev("lane_credit", { trader: LANE, amount_micro: "1000000" }, 1)];
    const ready = await laneStatusRoute(url(`?publicKey=${encodeURIComponent(pk)}`), req, ctx(), p({ "peek:lane:9.9.9.9": 10 }, credited));
    assert.deepEqual([ready.body.available, ready.body.reason, ready.body.key.balance_usd], [true, "key_ready", 0.4]);
    mock.st.views.set("get_balance", () => "0");
    const spent = await laneStatusRoute(url(`?publicKey=${encodeURIComponent(pk)}`), req, ctx(), p({}, credited));
    assert.deepEqual([spent.body.available, spent.body.reason], [false, "credit_spent"]);
    const unused = await laneStatusRoute(url(`?publicKey=${encodeURIComponent(pk)}`), req, ctx(), p());
    assert.deepEqual([unused.body.available, unused.body.reason], [true, "key_ready"]);
  } finally { await mock.close(); }
});

test("GET /lane/status keeps the last free bets for the judges until the date set, and opens them after it", async () => {
  assert.equal(laneHold({ reserve: 4, reserveUntilMs: 2000 }, 1000), 4);
  assert.equal(laneHold({ reserve: 4, reserveUntilMs: 2000 }, 2000), 0, "from the date on, nothing is held");
  assert.equal(laneHold({ reserve: 0, reserveUntilMs: 2000 }, 1000), 0);
  assert.equal(laneHold({}, 1000), 0, "off unless both are set");
  assert.match(laneHoldMessage({ reserveUntilMs: Date.parse("2026-11-15T00:00:00Z") }), /kept for the judges until 15 November/);
  const mock = await startMockRpc({ blockMs: 100000 });
  try {
    const req = { headers: { "x-forwarded-for": "9.9.9.9" }, socket: {} };
    const ctx = (free) => ({ app: { rpc: new Rpc([mock.url]), lane: { enabled: true, budget: async () => ({ paused: false, credits: free, free }) } } });
    const url = new URL("http://x/lane/status");
    const p = routeWorld(mock);
    p.api.lane = { ...p.api.lane, reserve: 4, reserveUntilMs: Date.now() + 3600_000 };
    const held = await laneStatusRoute(url, req, ctx(4), p);
    assert.deepEqual([held.body.available, held.body.reason, held.body.held_for_judges, held.body.credits_left], [false, "lane_used_up", 4, 4]);
    assert.match(held.body.message, /kept for the judges/);
    assert.equal((await laneStatusRoute(url, req, ctx(5), p)).body.reason, "ok", "above the reserve, a visitor still gets one");
    p.api.lane = { ...p.api.lane, reserveUntilMs: Date.now() - 1 };
    assert.equal((await laneStatusRoute(url, req, ctx(4), p)).body.reason, "ok", "after the date, the last ones are anyone's");
  } finally { await mock.close(); }
});

test("GET /attestations: a model nobody published is a 404, and the summary never carries the collateral", () => {
  const r = attestationsRoute(new URL("http://x/attestations"), { attestor: { snapshot: () => [{ model: "m" }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.attestations, [{ model: "m" }]);
  for (const x of r.body.proofs) { assert.equal(x.collateral, undefined); assert.equal(x.gpu?.jwt, undefined); }
  assert.equal(attestationsRoute(new URL("http://x/attestations?model=nobody"), null).status, 404);
});

test("chronological: once per uid, oldest first, in log order within a receipt", () => {
  const a = { uid: "R:1:0", event: "trade", blockTimestampMs: 5, txHash: "T" }, b = { uid: "R:0:0", event: "open", blockTimestampMs: 5, txHash: "T" }, c = { uid: "Q:0:0", event: "open", seenAtMs: 1 };
  assert.deepEqual(chronological([a, b, c, a, null]).map((e) => e.uid), ["Q:0:0", "R:0:0", "R:1:0"]);
});
