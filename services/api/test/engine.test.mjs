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
import { bOf, checkerCandidates, checkerEvidence, corpusRecord, correctedWording, keeperRound, nextTick, planKeeper, rulingClock } from "../../../api/_lib/keeper.mjs";
import { activityRoute, attestationsRoute, historyRoute, laneStatusRoute, portfolioRoute, rulingsRoute, traderHistory } from "../../../api/_lib/routes.mjs";
import { extractMarketEvents } from "../src/events.mjs";
import { corpusEvidence } from "../../ai/src/evidence.js";
import { Rpc } from "../src/rpc.mjs";
import { startMockRpc, eventLog } from "./mock-rpc.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pricedin-engine-"));
const NS = (ms) => String(BigInt(ms) * 1_000_000n);
const STALE = "The majority of Tether's reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";
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

test("the Checker's lines: open, caught, one try each; an expired one waits a day; never tried first, then the most traded", () => {
  const evidenceOf = (t) => (/caught/.test(t) ? { corpus_id: t } : null);
  const now = 100 * 3600_000;
  const claims = [claim(1, { text: "caught a", trades: 1 }), claim(2, { text: "caught b", trades: 9 }), claim(3, { text: "clean" }), claim(4, { text: "caught c", status: "Challenged" }), claim(5, { text: "caught d" }), claim(6, { text: "caught e" }), claim(7, { text: "caught f" })];
  const history = [{ claim_id: 5, status: "settled", at: 1 }, { claim_id: 6, status: "expired", at: now - 3600_000 }, { claim_id: 7, status: "expired", at: now - 25 * 3600_000 }];
  const c = checkerCandidates({ claims, history, nowMs: now, evidenceOf });
  assert.deepEqual(c.map((x) => x.claim.id), [2, 1, 7]);
  assert.equal(c.at(-1).tries, 1);
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

test("the clock: stages of a live ruling, the next slot, and an honest null", () => {
  const every = 600_000;
  assert.equal(nextTick(every * 5, every, 0), every * 5);
  assert.equal(nextTick(every * 5 + 1, every, 45_000), every * 6 + 45_000);
  const now = every * 100 + 30_000;
  const jury = rulingClock({ nowMs: now, rulings: [{ status: "jury", challenge_id: 4, claim_id: 18, claim: "x", verdicts: [], opened_at: now - 1000 }] });
  assert.equal(jury.ruling_now.stage, "jury");
  assert.ok(jury.next_ruling_at > now + 600_000 && jury.next_ruling_at <= now + 25 * 60_000);
  const win = rulingClock({ nowMs: now, rulings: [{ status: "window", challenge_id: 4, claim_id: 18, claim: "x", verdicts: [{ model: "m", verdict: "FALSE" }], provisional: "FALSE", opened_at: now - 1000, window_ends_at: now + 60_000 }] });
  assert.equal(win.ruling_now.stage, "window");
  assert.equal(win.ruling_now.finalize_due_at, nextTick(now + 60_000));
  assert.equal(win.next_ruling_at, nextTick(now + 60_000));
  const esc = rulingClock({ nowMs: now, rulings: [{ status: "escalated", challenge_id: 4, verdicts: [] }] });
  assert.equal(esc.next_ruling_at, null);
  assert.match(esc.next_ruling_note, /council/);
  const idle = rulingClock({ nowMs: now, rulings: [], checker: { enabled: true, gapMs: 3000_000, lastEndAt: now - 1000_000, candidates: 3 } });
  assert.equal(idle.ruling_now, null);
  assert.ok(idle.next_challenge_at >= now - 1000_000 + 3000_000);
  assert.ok(idle.next_ruling_at > idle.next_challenge_at);
  assert.equal(rulingClock({ nowMs: now, rulings: [], checker: { enabled: true, gapMs: 1, candidates: 0 } }).next_ruling_at, null);
  assert.match(rulingClock({ nowMs: now, rulings: [], checker: { enabled: false, reason: "no Checker key" } }).next_ruling_note, /no Checker key/);
});

/** A chain, a signer and a store in memory: the whole loop without a network. */
function loopWorld({ keeper = true, checker = true, balance = "1000000", now = 1_000_000_000 } = {}) {
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
      w.sent.push({ method: "open_claim", intent, ...o });
      if (w.capped && o.p0_ppm !== 500000) return { ok: false, final: true, error: "Smart contract panicked: subsidy cap reached" };
      const id = w.claims.length + 30;
      w.claims.push(claim(id, { text: o.text, page: o.page, kind: o.kind }));
      return { ok: true, txHash: `O${id}`, value: id };
    },
    challenge: async (intent, c) => {
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

test("the Checker waits: for funding, for its slot, and for a key; a job out of time stops before a challenge", async () => {
  let w = loopWorld({ balance: "999999" });
  let r = await w.round();
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /waits for funding/);
  assert.equal(r.checker.balance_micro, "999999");
  w = loopWorld();
  w.events.push(ev("challenge", { challenge_id: 5, claim_id: 3, claimed: false, trader: "checker.owner.near", amount_micro: "1000000", jury_deadline_ns: "1" }, w.now - 3000_000), ev("settle", { claim_id: 3, challenge_id: 5, outcome: true, payout_micro: "0" }, w.now - 60_000));
  r = await w.round();
  assert.match(r.checker.note, /next slot is in/);
  assert.ok(r.clock.next_challenge_at > w.now);
  w.now += 50 * 60_000;
  r = await w.round();
  assert.equal(r.challenged.claim_id, 18);
  w = loopWorld({ checker: false });
  r = await w.round();
  assert.equal(r.checker.enabled, false);
  assert.match(r.clock.next_ruling_note, /no Checker key/);
  w = loopWorld();
  r = await w.round({ left: () => 1000 });
  assert.equal(r.challenged, null);
  assert.match(r.checker.note, /out of time/);
  w = loopWorld();
  r = await w.round({ checkerOn: false });
  assert.equal(r.challenged, null);
  assert.equal(w.sent.length, 0);
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
    const docs = { "snapshots/keeper.json": { at: "t", checker: { enabled: true, account: "checker.x.near", gapMs: 3000_000, lastEndAt: null, candidates: 2, balance_micro: "1000000", note: null } } };
    const p = routeWorld(mock, { claims: [claim(6, { status: "Challenged", challenge_id: 7, provisional: false })], docs });
    const r = await rulingsRoute(p);
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 1, "known to the chain before the index has it");
    assert.equal(r.body.rulings[0].verdicts[0].verdict, "FALSE");
    assert.equal(r.body.ruling_now.challenge_id, 7);
    assert.equal(r.body.ruling_now.stage, "window");
    assert.ok(r.body.next_ruling_at > Date.now());
    assert.deepEqual([r.body.checker.account, r.body.checker.balance_usd, r.body.checker.lines_left], ["checker.x.near", 1, 2]);
    const idle = await rulingsRoute(routeWorld(mock, { claims: [claim(1)], docs }));
    assert.equal(idle.body.ruling_now, null);
    assert.ok(idle.body.next_ruling_at > Date.now());
    assert.equal((await rulingsRoute(routeWorld(mock, { claims: [claim(1)] }))).body.next_ruling_at, null);
  } finally { await mock.close(); }
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
    assert.equal((await laneStatusRoute(url(), req, ctx({ paused: false, credits: 0, free: 0 }), p())).body.reason, "lane_used_up");
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
