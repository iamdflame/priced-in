// The truth API's counts on the hosted runtime: two app instances on one store, as two Vercel
// function instances are. The store is FsState, the local-disk twin of the Blob store.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { startApi } from "./helpers.mjs";
import { startMockRpc } from "./mock-rpc.mjs";
import { FsState, JournalDir } from "../../../api/_lib/store.mjs";
import { PAYMENTS, storeMeter, truthApiOf } from "../../../api/_lib/meter.mjs";
import { localMeter, paymentTotals } from "../src/meter.mjs";
import { Paywall, requirements, b64json } from "../src/x402.mjs";

const MARKET = "market.pricedin.testnet";
const USDC = "tusdc.pricedin.testnet";
const PAY_TO = "truth.pricedin.testnet";
const CLAIM = { id: 0, text: "Tether is the issuer of USDT.", page: "tether", kind: "data", price_yes_ppm: 650000, cost_up_10_micro: "400000", cost_down_10_micro: "500000", status: "Open", outcome: null, provisional: null, trades: 1, volume_micro: "1000000", open_interest_micro: "1000000", collected_micro: "1000000", payout_left_micro: "0", challenge_id: null, prev: null, next: null, bounty_micro: "0" };
const Q = "/v1/credence?claim=0";

const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meter-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** One store, and as many function instances on it as the test asks for. */
async function hosted(t, env = {}, facilitator = null) {
  const dir = tmp(t);
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  mock.st.claims = [{ ...CLAIM }];
  const instance = async (n) => {
    const state = new FsState({ prefix: "state/testnet/market", dir: path.join(dir, "store") });
    const journals = new JournalDir(state, path.join(dir, `data-${n}`));
    const meter = storeMeter({ state, journals, limit: Number(env.CREDENCE_FREE_PER_IP_PER_DAY ?? 2), waitMs: 5000 });
    const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: MARKET, USDC_CONTRACT_ID: USDC, CLAIMS_TTL_MS: "50", X402_PAY_TO: PAY_TO, ...env }, { meter, ...(facilitator ? { facilitator } : {}) });
    t.after(() => api.close());
    return { api, state, journals, meter };
  };
  return { instance };
}

const payHeader = (accepted, payload = { signedDelegateAction: "bW9jaw==" }) => encodePaymentSignatureHeader({ x402Version: 2, resource: { url: "http://x/v1/credence" }, accepted, payload });

/** A facilitator with the chain's one rule that matters here: a delegate settles once. */
function chainLikeFacilitator({ settleMs = 0 } = {}) {
  const spent = new Set();
  const f = {
    kind: "mock", settled: [], running: 0, most: 0,
    async verify(p) { return spent.has(p.payload.signedDelegateAction) ? { isValid: false, invalidReason: "invalid_exact_near_payload_delegate_action_nonce_already_used" } : { isValid: true, payer: "payer.testnet" }; },
    async settle(p, r) {
      f.running++; f.most = Math.max(f.most, f.running);
      try {
        const v = await f.verify(p);
        if (!v.isValid) return { success: false, errorReason: v.invalidReason, transaction: "", network: r.network };
        await new Promise((ok) => setTimeout(ok, settleMs));
        spent.add(p.payload.signedDelegateAction);
        f.settled.push(p.payload.signedDelegateAction);
        return { success: true, transaction: `tx-${f.settled.length}`, network: r.network, payer: "payer.testnet" };
      } finally { f.running--; }
    },
  };
  return f;
}

test("hosted free tier: the daily limit holds across instances, and a failed call gives its unit back", async (t) => {
  const f = chainLikeFacilitator();
  const { instance } = await hosted(t, { CREDENCE_FREE_PER_IP_PER_DAY: "3" }, f);
  const [a, b] = [await instance(1), await instance(2)];
  assert.equal((await a.api.req("GET", Q)).headers.get("x-free-calls-remaining"), "2");
  assert.equal((await b.api.req("GET", Q)).headers.get("x-free-calls-remaining"), "1", "the second instance sees the first's call");
  assert.equal((await a.api.req("GET", "/v1/credence?claim=9")).status, 404);
  const last = await b.api.req("GET", Q);
  assert.equal(last.status, 200);
  assert.equal(last.json.free.remaining, 0);
  for (const i of [a, b]) {
    const r = await i.api.req("GET", Q);
    assert.equal(r.status, 402, "each instance refuses the fourth call");
    assert.ok(r.json.free.resets_in_s > 0);
  }
});

test("hosted free tier: concurrent calls across instances never pass the limit", async (t) => {
  const { instance } = await hosted(t, { CREDENCE_FREE_PER_IP_PER_DAY: "4" }, chainLikeFacilitator());
  const [a, b] = [await instance(1), await instance(2)];
  const all = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).api.req("GET", Q)));
  assert.equal(all.filter((r) => r.status === 200).length, 4);
  assert.equal(all.filter((r) => r.status === 402).length, 6);
});

test("hosted free tier: when the store can't answer, the instance counts for itself", async () => {
  const logs = [];
  const state = { take: async () => { throw new Error("store down"); }, release: async () => { throw new Error("never"); } };
  const m = storeMeter({ state, journals: null, limit: 1, log: (x) => logs.push(x) });
  const first = await m.take("1.2.3.4");
  assert.equal(first.ok, true);
  assert.equal((await m.take("1.2.3.4")).ok, false);
  await m.release("1.2.3.4", first);
  assert.equal((await m.take("1.2.3.4")).ok, true);
  assert.match(logs[0], /store did not answer/);
});

test("hosted payments: recorded in the store, so every instance reports the same revenue", async (t) => {
  const f = chainLikeFacilitator();
  const { instance } = await hosted(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0" }, f);
  const [a, b] = [await instance(1), await instance(2)];
  const accepted = decodePaymentRequiredHeader((await a.api.req("GET", Q)).headers.get("payment-required")).accepts[0];
  const r = await a.api.req("GET", Q, undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.payment.transaction, "tx-1");

  await b.journals.hydrate();
  const info = await b.api.req("GET", "/v1");
  assert.equal(info.json.truth_api.paid_calls, 1);
  assert.equal(info.json.truth_api.revenue_usd, 0.01);
  assert.equal(info.json.truth_api.revenue_micro, "10000");
  assert.equal(info.json.truth_api.payers, 1);
  assert.equal(info.json.truth_api.last_tx, "tx-1");
  assert.equal(info.json.truth_api.last_tx_explorer, "https://testnet.nearblocks.io/txns/tx-1");
  const [rec] = b.journals.read(PAYMENTS);
  assert.deepEqual(Object.keys(rec).sort(), ["amount_micro", "asset", "at", "network", "pay_to", "payer", "tx"]);
  assert.equal(rec.pay_to, PAY_TO);
});

test("hosted payments: the same payment sent to two instances at once settles once and is answered once", async (t) => {
  const f = chainLikeFacilitator({ settleMs: 30 });
  const { instance } = await hosted(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0" }, f);
  const [a, b] = [await instance(1), await instance(2)];
  const accepted = decodePaymentRequiredHeader((await a.api.req("GET", Q)).headers.get("payment-required")).accepts[0];
  const header = payHeader(accepted);
  const both = await Promise.all([a, b].map((i) => i.api.req("GET", Q, undefined, { "payment-signature": header })));
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 402]);
  assert.match(both.find((r) => r.status === 402).json.error, /nonce_already_used/);
  assert.equal(both.find((r) => r.status === 402).json.claims, undefined);
  assert.equal(f.settled.length, 1);
  assert.equal(f.most, 1);
});

test("hosted payments: settlements take turns across instances: one relayer key, one nonce", async (t) => {
  const f = chainLikeFacilitator({ settleMs: 20 });
  const { instance } = await hosted(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0" }, f);
  const [a, b] = [await instance(1), await instance(2)];
  const accepted = decodePaymentRequiredHeader((await a.api.req("GET", Q)).headers.get("payment-required")).accepts[0];
  const paid = await Promise.all(["YQ==", "Yg==", "Yw=="].map((d, i) => (i % 2 ? a : b).api.req("GET", Q, undefined, { "payment-signature": payHeader(accepted, { signedDelegateAction: d }) })));
  assert.deepEqual(paid.map((r) => r.status), [200, 200, 200]);
  assert.equal(f.settled.length, 3);
  assert.equal(f.most, 1, "never two settlements in flight");
  await a.journals.hydrate();
  assert.equal(truthApiOf(a.journals).paid_calls, 3);
});

test("hosted payments: no turn on the relayer: 503, nothing sent, nothing charged", async (t) => {
  const dir = tmp(t);
  const state = new FsState({ prefix: "s", dir });
  const held = await state.acquire("x402-relayer", { ttlMs: 60_000 });
  const m = storeMeter({ state, journals: new JournalDir(state, path.join(dir, "data")), limit: 1, waitMs: 0 });
  const x = { network: "testnet", priceMicro: 10000, asset: USDC, payTo: PAY_TO, maxTimeoutS: 60 };
  const f = chainLikeFacilitator();
  const out = await new Paywall(x, f, { meter: m }).charge(b64json({ x402Version: 2, accepted: requirements(x), payload: { signedDelegateAction: "YQ==" } }), "http://x", "d", async () => ({ status: 200, body: { answer: "secret" } }));
  assert.equal(out.status, 503);
  assert.equal(out.body.error.code, "settlement_busy");
  assert.equal(out.body.answer, undefined);
  assert.equal(out.headers["retry-after"], "5");
  assert.equal(f.settled.length, 0);
  await held.release();
});

test("a record that fails never costs a paid caller the answer", async () => {
  const x = { network: "testnet", priceMicro: 10000, asset: USDC, payTo: PAY_TO, maxTimeoutS: 60 };
  const logs = [];
  const meter = { ...localMeter(1), record: async () => { throw new Error("store down"); } };
  const out = await new Paywall(x, chainLikeFacilitator(), { meter, log: (m) => logs.push(m) }).charge(b64json({ x402Version: 2, accepted: requirements(x), payload: { signedDelegateAction: "YQ==" } }), "http://x", "d", async () => ({ status: 200, body: { answer: 1 } }));
  assert.equal(out.status, 200);
  assert.equal(out.body.payment.settled, true);
  assert.match(logs[0], /record of tx-1 failed/);
});

test("x402: the relayer's own stale nonce is asked again; a failure inside a transaction that ran is not", async () => {
  const x = { network: "testnet", priceMicro: 10000, asset: USDC, payTo: PAY_TO, maxTimeoutS: 60 };
  const header = b64json({ x402Version: 2, accepted: requirements(x), payload: {} });
  const work = async () => ({ status: 200, body: {} });
  let n = 0;
  const stale = {
    async verify() { return { isValid: true, payer: "p.testnet" }; },
    async settle(p, r) { n++; return n < 2 ? { success: false, errorReason: "settlement_failed", errorMessage: "Transaction nonce 7 must be larger than nonce of the used access key 7", transaction: "", network: r.network } : { success: true, transaction: "T", network: r.network, payer: "p.testnet" }; },
  };
  assert.equal((await new Paywall(x, stale, { retryDelaysMs: [1, 1] }).charge(header, "http://x", "d", work)).status, 200);
  assert.equal(n, 2);
  let m = 0;
  const ran = {
    async verify() { return { isValid: true, payer: "p.testnet" }; },
    async settle(p, r) { m++; return { success: false, errorReason: "settlement_failed", errorMessage: "DelegateActionInvalidNonce", transaction: "ranTx", network: r.network }; },
  };
  assert.equal((await new Paywall(x, ran, { retryDelaysMs: [1, 1] }).charge(header, "http://x", "d", work)).status, 402);
  assert.equal(m, 1);
});

test("x402: a facilitator a block behind the payer is asked again", async () => {
  const x = { network: "testnet", priceMicro: 10000, asset: USDC, payTo: PAY_TO, maxTimeoutS: 60 };
  let n = 0;
  const behind = {
    async verify() { n++; return n < 2 ? { isValid: false, invalidReason: "invalid_exact_near_payload_delegate_action_timeout_window_exceeds_max_timeout" } : { isValid: true, payer: "p.testnet" }; },
    async settle(p, r) { return { success: true, transaction: "T", network: r.network, payer: "p.testnet" }; },
  };
  const out = await new Paywall(x, behind, { retryDelaysMs: [1, 1] }).charge(b64json({ x402Version: 2, accepted: requirements(x), payload: {} }), "http://x", "d", async () => ({ status: 200, body: {} }));
  assert.equal(out.status, 200);
  assert.equal(n, 2);
});

test("the local meter: settlements take turns in this process, and a failed turn doesn't block the next", async () => {
  const m = localMeter(1);
  const order = [];
  const slow = m.exclusive(async () => { order.push("a-in"); await new Promise((r) => setTimeout(r, 15)); order.push("a-out"); });
  const bad = m.exclusive(async () => { order.push("b"); throw new Error("no"); });
  const next = m.exclusive(async () => { order.push("c"); return 7; });
  await slow;
  await assert.rejects(bad, /no/);
  assert.equal(await next, 7);
  assert.deepEqual(order, ["a-in", "a-out", "b", "c"]);
});

test("paymentTotals: a transaction counts once, and nothing paid is zero", () => {
  assert.deepEqual(paymentTotals([]), { paid_calls: 0, revenue_usd: 0, revenue_micro: "0", payers: 0, last_paid_at: null, last_tx: null, last_tx_explorer: null });
  const rec = (tx, payer, at) => ({ at, tx, payer, amount_micro: "10000", network: "near:mainnet" });
  const t = paymentTotals([rec("a", "x.near", "2026-11-06T01:00:00.000Z"), rec("b", "y.near", "2026-11-06T02:00:00.000Z"), rec("a", "x.near", "2026-11-06T01:00:00.000Z")]);
  assert.equal(t.paid_calls, 2);
  assert.equal(t.revenue_usd, 0.02);
  assert.equal(t.payers, 2);
  assert.equal(t.last_tx_explorer, "https://nearblocks.io/txns/b");
});
