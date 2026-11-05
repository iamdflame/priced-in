import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { KeyPair } from "near-api-js";
import { startApi, sse } from "./helpers.mjs";
import { startMockRpc, eventLog } from "./mock-rpc.mjs";
import { receiptMessage } from "../src/planner.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("condition not met in time");
    await sleep(100);
  }
}

test("/health: 200 while scanning, 503 with the reason when the RPC is unreachable", async (t) => {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", HEALTH_MAX_SCAN_AGE_S: "2" });
  t.after(() => api.close());
  const ok = await until(async () => { const r = await api.req("GET", "/health"); return r.status === 200 && r; });
  assert.equal(ok.json.ok, true);
  assert.deepEqual(ok.json.failures, []);
  assert.ok(ok.json.checks.scanner.lastScanAgeS < 2);
  assert.equal(ok.json.checks.rpc.reachable, 1);
  assert.equal(ok.json.checks.planner.status, "unavailable");

  // the RPC goes away mid-run: the scan goes stale and the probe fails
  mock.st.down = true;
  const bad = await until(async () => {
    const r = await api.req("GET", "/health");
    return r.status === 503 && r.json.failures.length >= 2 && r;
  }, 8000);
  assert.equal(bad.json.ok, false);
  assert.ok(bad.json.failures.some((f) => /no RPC reachable/.test(f)), bad.json.failures.join(" | "));
  assert.ok(bad.json.failures.some((f) => /scanner: last block scanned/.test(f)), bad.json.failures.join(" | "));
});

test("/health: 503 from the start when no RPC answers", async (t) => {
  const api = await startApi({ RPC_URLS: "http://127.0.0.1:1,http://127.0.0.1:2", MARKET_CONTRACT_ID: "market.testnet", RPC_TIMEOUT_MS: "800" });
  t.after(() => api.close());
  const r = await api.req("GET", "/health");
  assert.equal(r.status, 503);
  assert.ok(r.json.failures.some((f) => /no RPC reachable/.test(f)));
  assert.ok(r.json.failures.some((f) => /no block scanned yet/.test(f)));
});

test("/health: an RPC serving the wrong chain fails the check", async (t) => {
  const mock = await startMockRpc({ chainId: "mainnet" });
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet" });
  t.after(() => api.close());
  await sleep(300);
  const r = await api.req("GET", "/health");
  assert.equal(r.status, 503);
  assert.ok(r.json.failures.some((f) => /serves chain "mainnet"/.test(f)));
});

test("/health: an optional event-age assertion", async (t) => {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", HEALTH_MAX_EVENT_AGE_S: "60" });
  t.after(() => api.close());
  await sleep(300);
  const r = await api.req("GET", "/health");
  assert.equal(r.status, 503);
  assert.ok(r.json.failures.some((f) => /no market event in the last 60 s/.test(f)));
});

test("/events streams market events to subscribers, replays the buffer, and /events/recent lists them", async (t) => {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet" });
  t.after(() => api.close());
  const s = await sse(`${api.base}/events`);
  t.after(() => s.close());
  assert.equal(s.status, 200);
  assert.match(s.contentType, /text\/event-stream/);
  await s.next((e) => e.event === "hello");
  const t0 = Date.now();
  mock.injectTx({ hash: "TxTrade", signerId: "lane.testnet", receiverId: "market.testnet", logs: [eventLog("trade", { claim_id: 0, trader: "lane:ed25519:k1", side: "no", amount_micro: "1000000", price_yes_ppm: 450000 })] });
  const e = await s.next((x) => x.data.event === "trade", 3000);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(e.data.data.trader, "lane:ed25519:k1");
  assert.equal(e.id, String(e.data.seq));

  mock.injectTx({ hash: "TxOpen", signerId: "lane.testnet", receiverId: "market.testnet", logs: [eventLog("open", { claim_id: 1, p0_ppm: 600000, b_micro: "1000000" }), eventLog("trade", { claim_id: 1, trader: "lane:ed25519:k2", side: "yes", amount_micro: "500000", price_yes_ppm: 690000 })] });
  await s.next((x) => x.data.event === "open");
  await s.next((x) => x.data.event === "trade" && x.data.data?.claim_id === 1);

  // a late subscriber gets the backlog, and Last-Event-ID resumes after it
  const late = await sse(`${api.base}/events`);
  t.after(() => late.close());
  const hello = await late.next((x) => x.event === "hello");
  assert.equal(hello.data.replayed, 3);
  const resumed = await sse(`${api.base}/events`, { "last-event-id": "2" });
  t.after(() => resumed.close());
  assert.equal((await resumed.next((x) => x.event === "hello")).data.replayed, 1);

  const r = await api.req("GET", "/events/recent");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.events.map((x) => x.event), ["trade", "open", "trade"]);
  assert.equal((await api.req("GET", "/events/recent?since=2")).json.events.length, 1);
});

test("/claims reads the views with cost-to-move figures, filtered by page and cached", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const claim = (id, page) => ({ id, text: `Claim ${id}.`, page, kind: "data", price_yes_ppm: 500000, cost_up_10_micro: "620000", cost_down_10_micro: "610000", status: "Open", outcome: null, provisional: null, trades: 0, volume_micro: "0" });
  mock.st.claims = [claim(0, "near"), claim(1, "solana"), claim(2, "near")];
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet" });
  t.after(() => api.close());
  const r = await api.req("GET", "/claims?page=near");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.claims.map((c) => c.id), [0, 2]);
  assert.equal(r.json.claims[0].cost_to_move.up_10_points_usd, 0.62);
  assert.equal(r.json.claims[0].price_yes, 0.5);
  const one = await api.req("GET", "/claims/1");
  assert.equal(one.json.claim.page, "solana");
  const before = mock.st.calls.filter((c) => c === "query").length;
  await Promise.all([1, 2, 3, 4, 5].map(() => api.req("GET", "/claims?page=near")));
  assert.ok(mock.st.calls.filter((c) => c === "query").length - before <= 2, "served from the 1 s cache");
  assert.equal((await api.req("GET", "/claims")).json.count, 3);
});

test("/lane/key adds a function-call key and returns what the browser needs to sign at once", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const admin = KeyPair.fromRandom("ed25519");
  mock.addAdminKey("lane.testnet", admin.getPublicKey().toString());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", LANE_ACCOUNT_ID: "lane.testnet", LANE_PRIVATE_KEY: admin.toString(), LANE_KEYS_PER_IP_PER_DAY: "3" });
  t.after(() => api.close());
  const visitor = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  const r = await api.req("POST", "/lane/key", { publicKey: visitor });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.laneAccountId, "lane.testnet");
  assert.equal(r.json.contractId, "market.testnet");
  assert.match(r.json.nonce, /^\d+$/);
  assert.ok(r.json.blockHash.length >= 32);
  assert.equal(r.json.rpc, mock.url);
  assert.deepEqual(r.json.methods, ["buy", "sell", "open_and_buy", "redeem"]);
  assert.equal(r.json.allowanceYocto, "250000000000000000000000");
  const key = mock.st.keys.get(`lane.testnet|${visitor}`);
  assert.equal(key.permission.FunctionCall.receiver_id, "market.testnet");

  // the same key again is answered, not added twice, and doesn't use up the visitor's allowance
  const again = await api.req("POST", "/lane/key", { publicKey: visitor });
  assert.equal(again.status, 200);
  assert.equal(again.json.reused, true);

  // a burst from different addresses rides one or two transactions
  const keys = Array.from({ length: 2 }, () => KeyPair.fromRandom("ed25519").getPublicKey().toString());
  const sendsBefore = mock.st.calls.filter((c) => c === "send_tx").length;
  const burst = await Promise.all(keys.map((k) => api.req("POST", "/lane/key", { publicKey: k })));
  assert.ok(burst.every((x) => x.status === 200));
  assert.ok(mock.st.calls.filter((c) => c === "send_tx").length - sendsBefore <= 2);

  // the per-IP daily limit (3 keys; the reused one didn't count)
  const over = await api.req("POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
  assert.equal(over.status, 429);
  assert.equal(over.json.error.code, "rate_limited");
  assert.ok(Number(over.headers.get("retry-after")) > 0);
});

test("/lane/key mirrors the contract's lane budget and says plainly when it is used up", async (t) => {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  mock.st.stats.lane_budget_micro = "2000000"; // two $1 credits
  const admin = KeyPair.fromRandom("ed25519");
  mock.addAdminKey("lane.testnet", admin.getPublicKey().toString());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", LANE_ACCOUNT_ID: "lane.testnet", LANE_PRIVATE_KEY: admin.toString(), LANE_KEYS_PER_IP_PER_DAY: "10", CLAIMS_TTL_MS: "0", LANE_STATS_MAX_STALE_MS: "0" });
  t.after(() => api.close());
  const k = () => KeyPair.fromRandom("ed25519").getPublicKey().toString();
  const k1 = k();
  assert.equal((await api.req("POST", "/lane/key", { publicKey: k1 })).status, 200);
  assert.equal((await api.req("POST", "/lane/key", { publicKey: k() })).status, 200);
  const third = await api.req("POST", "/lane/key", { publicKey: k() });
  assert.equal(third.status, 503);
  assert.equal(third.json.error.code, "lane_used_up");
  assert.match(third.json.error.message, /used up/);

  // k1 bets: the contract spends its credit (budget 2 -> 1) and its slot frees, so the outstanding count drops too
  mock.st.stats.lane_budget_micro = "1000000";
  mock.injectTx({ hash: "TxK1", signerId: "lane.testnet", receiverId: "market.testnet", logs: [eventLog("trade", { claim_id: 0, trader: `lane:${k1}`, side: "no", amount_micro: "1000000", price_yes_ppm: 400000 })] });
  await until(async () => (await api.req("GET", "/health")).json.checks.lane.outstandingKeys === 1);
  assert.equal((await api.req("POST", "/lane/key", { publicKey: k() })).json.error.code, "lane_used_up", "1 credit left, 1 key still holding it");

  mock.st.stats.paused = true;
  assert.equal((await api.req("POST", "/lane/key", { publicKey: k() })).json.error.code, "market_paused");
});

test("/lane/key: a global daily cap", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const admin = KeyPair.fromRandom("ed25519");
  mock.addAdminKey("lane.testnet", admin.getPublicKey().toString());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", LANE_ACCOUNT_ID: "lane.testnet", LANE_PRIVATE_KEY: admin.toString(), LANE_KEYS_PER_DAY: "1" });
  t.after(() => api.close());
  assert.equal((await api.req("POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() })).status, 200);
  const r = await api.req("POST", "/lane/key", { publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "lane_daily_cap");
});

test("/paste without NEARAI_API_KEY: the split, planner unavailable, no receipts, no prices", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", PLANNER_PRIVATE_KEY: Buffer.alloc(32, 1).toString("hex") });
  t.after(() => api.close());
  const r = await api.req("POST", "/paste", { text: "NEAR Intents passed $10B. I love it! Dr. Who lives at 12 Elm St." });
  assert.equal(r.status, 200);
  assert.equal(r.json.planner, "unavailable");
  assert.match(r.json.plannerReason, /NEARAI_API_KEY/);
  assert.match(r.json.message, /Pricing soon/);
  assert.equal(r.json.sentences.length, 3);
  assert.ok(r.json.sentences.every((s) => s.status === "pricing_soon" && !s.receipt && s.p0_ppm === undefined));
  assert.match(r.json.page, /^paste-[0-9a-f]{12}$/);
});

test("/paste with a planner: labels, person and opinion lines unpriced, receipts that verify", async (t) => {
  const mock = await startMockRpc();
  t.after(() => mock.close());
  const seed = Buffer.alloc(32, 9);
  const plannerKp = nacl.sign.keyPair.fromSeed(seed);
  let calls = 0;
  let fail = false;
  const fakeFetch = async (url, init) => {
    if (!String(url).startsWith("https://cloud-api.near.ai/v1")) return fetch(url, init);
    calls++;
    if (fail) return new Response("upstream down", { status: 503 });
    const body = JSON.parse(init.body);
    assert.equal(body.model, "test-model");
    assert.equal(init.headers.authorization, "Bearer test-key");
    const content = '```json\n{"labels":[{"i":0,"label":"data","p":0.71},{"i":1,"label":"unfalsifiable"},{"i":2,"label":"person","p":0.5},{"i":3,"label":"judgment","p":0.05}]}\n```';
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: "market.testnet", NEARAI_API_KEY: "test-key", PLANNER_MODEL: "test-model", PLANNER_PRIVATE_KEY: seed.toString("hex") }, { fetchImpl: fakeFetch });
  t.after(() => api.close());
  const text = "NEAR Intents passed $10B in volume. I love it! Jane Doe of 12 Elm St. is ill. NEAR will flip Solana by 2027.";
  const r = await api.req("POST", "/paste", { text });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.planner, "ok");
  assert.equal(r.json.plannerPublicKeyHex, Buffer.from(plannerKp.publicKey).toString("hex"));
  const [a, b, c, d] = r.json.sentences;
  assert.equal(a.status, "priced");
  assert.equal(a.kind, "data");
  assert.equal(a.p0_ppm, 710000);
  const msg = receiptMessage({ page: r.json.page, text: a.text, kind: "data", p0_ppm: 710000, b_micro: 1000000 });
  assert.equal(a.receipt.message, msg);
  assert.ok(nacl.sign.detached.verify(Buffer.from(msg), Buffer.from(a.receipt.planner_sig_hex, "hex"), plannerKp.publicKey));
  assert.equal(b.status, "unfalsifiable");
  assert.equal(b.receipt, undefined);
  assert.equal(c.status, "person");
  assert.equal(c.receipt, undefined);
  assert.equal(d.status, "priced");
  assert.equal(d.p0_ppm, 200000, "clamped to 0.2");

  // the same paste again is served from cache: same page, same receipts, no second model call
  const again = await api.req("POST", "/paste", { text });
  assert.equal(calls, 1);
  assert.equal(again.json.sentences[0].receipt.planner_sig_hex, a.receipt.planner_sig_hex);

  // a sentence whose market already exists on the page comes back as listed, not re-opened
  mock.st.claims = [{ id: 0, text: a.text, page: r.json.page, kind: "data", price_yes_ppm: 650000, cost_up_10_micro: "1", cost_down_10_micro: "1", status: "Open", trades: 1, volume_micro: "1" }];
  await sleep(1100);
  const listed = await api.req("POST", "/paste", { text });
  assert.equal(listed.json.sentences[0].status, "listed");
  assert.equal(listed.json.sentences[0].claim.id, 0);

  // the model fails: an honest "unavailable", never invented prices
  fail = true;
  const down = await api.req("POST", "/paste", { text: "A different text entirely. With two sentences." });
  assert.equal(down.status, 200);
  assert.equal(down.json.planner, "unavailable");
  assert.match(down.json.plannerReason, /HTTP 503/);
  assert.ok(down.json.sentences.every((s) => s.status === "pricing_soon" && !s.receipt));
});
