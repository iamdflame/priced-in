// The truth API offline: matching, the credence answer, the free tier, and the x402 flow
// against a mock facilitator (in-process and over the protocol's HTTP interface).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { startApi } from "./helpers.mjs";
import { startMockRpc } from "./mock-rpc.mjs";
import { ClaimIndex, tokens, normalize } from "../src/match.mjs";
import { quoteBuy, impliedB } from "../src/credence.mjs";
import { b64json, unb64json } from "../src/x402.mjs";

const MARKET = "market.pricedin.testnet";
const USDC = "tusdc.pricedin.testnet";
const PAY_TO = "truth.pricedin.testnet";

/** A claim view as the contract returns it, with cost-to-move figures consistent with b. */
function claimView(id, text, p, { b = 3, page = "tether", oi = 4_547_388, status = "Open", outcome = null, provisional = null, challenge = null } = {}) {
  const up = p + 0.1 < 0.999 ? Math.floor(b * Math.log((1 - p) / (1 - p - 0.1)) * 1e6) : 0;
  const down = p - 0.1 > 0.001 ? Math.floor(b * Math.log(p / (p - 0.1)) * 1e6) : 0;
  return {
    id, text, page, kind: "data", price_yes_ppm: Math.round(p * 1e6), cost_up_10_micro: String(up), cost_down_10_micro: String(down),
    status, outcome, provisional, trades: 3, volume_micro: "3100000", open_interest_micro: String(oi), collected_micro: "3100000",
    payout_left_micro: "0", challenge_id: challenge, prev: null, next: null, bounty_micro: "0",
  };
}

const CLAIMS = [
  claimView(0, "It is represented by its currency codes USD₮ and USDT.", 0.653479),
  claimView(1, "Tether is the issuer of USDT, the world's largest stablecoin by market capitalization and one of the most widely used cryptocurrencies.", 0.653479),
  claimView(2, "As of July 2024, Tether has more than 350 million users worldwide.", 0.516391),
  claimView(3, "Tether Holdings Limited is headquartered in El Salvador as of January 2025.", 0.653479),
  claimView(4, "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Liquid Network, Near, Polygon, Solana, Bitcoin Cash's Standard Ledger Protocol, Statemint, Tezos, and Tron.", 0.18997),
  claimView(5, "Each XAU₮ token purports to represent ownership of one troy fine ounce of physical gold stored in vaults in Switzerland.", 0.516391),
  claimView(6, "Tether claims its tokens are backed 100% by reserve assets, but has faced scrutiny for failing to publish an external audit.", 0.516391, { status: "Settled", outcome: true }),
  claimView(7, "NEAR Intents passed $10 billion in volume.", 0.4, { page: "near-intents", challenge: 0 }),
];

// ---------- matching ----------
test("match: tokens are normalised, stemmed and aliased; question words drop out", () => {
  assert.deepEqual(tokens("Does Tether issue USDT on NEAR?"), ["tether", "issu", "tether", "near"]);
  assert.deepEqual(tokens("Tether issues tokens"), ["tether", "issu", "token"]);
  assert.equal(normalize("Tether’s “reserves” — $1,000.50"), "tether \"reserves\" - $1000.50".replace(/"/g, " ").replace(/\s+/g, " ").trim());
});

test("match: an exact page sentence first, then the closest claims by text", () => {
  const ix = new ClaimIndex(CLAIMS);
  const exact = ix.search("Tether Holdings Limited is headquartered in El Salvador as of January 2025.");
  assert.equal(exact.matches[0].claim.id, 3);
  assert.equal(exact.matches[0].kind, "exact");
  assert.equal(exact.matches[0].score, 1);
  // a question about one chain in a long list still finds the list
  const q = ix.search("Does Tether issue USDT on NEAR?");
  assert.equal(q.matches[0].claim.id, 4);
  assert.equal(q.matches[0].kind, "close");
  assert.ok(q.matches[0].matched.includes("near"));
  // a typo in a long word still meets it
  assert.equal(ix.search("Is Tether headquatered in El Salvador?").matches[0].claim.id, 3);
  assert.equal(ix.search("tether gold vaults in switzerland").matches[0].claim.id, 5);
  assert.equal(ix.search("how many users does tether have").matches[0].claim.id, 2);
  // a sentence quoted inside a longer question
  assert.equal(ix.search("Is it true that as of July 2024, Tether has more than 350 million users worldwide?").matches[0].kind, "sentence");
});

test("match: nothing matches is an answer, not the least-bad claim", () => {
  const ix = new ClaimIndex(CLAIMS);
  assert.equal(ix.search("Is the moon made of cheese?").matches.length, 0);
  assert.equal(ix.search("Will Bitcoin go up tomorrow?").matches.length, 0);
  // a word on nearly every line says nothing on its own
  assert.equal(ix.search("tether").matches.length, 0);
  assert.equal(ix.search("?!").matches.length, 0);
  // page filter
  assert.equal(ix.search("NEAR Intents volume", { page: "tether" }).matches.length, 0);
  assert.equal(ix.search("NEAR Intents volume", { page: "near-intents" }).matches[0].claim.id, 7);
});

// ---------- the LMSR quote ----------
test("quote: b is implied from the contract's cost to move, and buying that cost moves the price 10 points", () => {
  const c = CLAIMS[4];
  const b = impliedB(c.price_yes_ppm / 1e6, Number(c.cost_up_10_micro) / 1e6, Number(c.cost_down_10_micro) / 1e6);
  assert.ok(Math.abs(b - 3) < 1e-4, `b ${b}`);
  const up = quoteBuy(c, "yes", Number(c.cost_up_10_micro) / 1e6);
  assert.ok(Math.abs(up.price_yes_after - (0.18997 + 0.1)) < 1e-4, `after ${up.price_yes_after}`);
  const no = quoteBuy(c, "no", 1);
  assert.ok(no.price_yes_after < c.price_yes_ppm / 1e6);
  assert.ok(no.shares > 1, "a $1 NO at 81 cents buys more than one share");
  assert.equal(no.payout_if_right_usd, no.shares);
  assert.ok(BigInt(no.min_shares_micro) < BigInt(Math.floor(no.shares * 1e6)));
  assert.throws(() => quoteBuy(c, "maybe", 1), /side/);
  assert.throws(() => quoteBuy(c, "yes", 0), /amount/);
});

test("quote: a v3 view's taker fee comes out of the amount first, as the contract's fill_buy does, and its b is used as is", () => {
  const c = CLAIMS[4];
  const plain = quoteBuy(c, "no", 1);
  const v3 = { ...c, b_micro: "3000000", fee_bps: 100 };
  const q = quoteBuy(v3, "no", 1);
  // the same market with $1 * 10,000 / 10,100 spent and no fee
  const net = quoteBuy({ ...c, b_micro: "3000000" }, "no", 10_000 / 10_100);
  assert.equal(q.fee_bps, 100);
  assert.ok(Math.abs(q.fee_usd - (1 - 10_000 / 10_100)) < 1e-6, `fee ${q.fee_usd}`);
  assert.ok(Math.abs(q.shares - net.shares) < 2e-6, `${q.shares} vs ${net.shares}`);
  assert.ok(q.shares < plain.shares, "the fee buys fewer shares than the fee-free quote");
  assert.ok(BigInt(q.min_shares_micro) < BigInt(Math.floor(q.shares * 1e6)));
  assert.equal(plain.fee_bps, 0, "a view from before v3 has no fee");
});

// ---------- HTTP ----------
function mockFacilitator({ valid = true, settles = true } = {}) {
  const calls = [];
  return {
    calls, kind: "mock",
    async verify(p, r) { calls.push(["verify", p, r]); return valid ? { isValid: true, payer: "payer.testnet" } : { isValid: false, invalidReason: "insufficient_funds", payer: "payer.testnet" }; },
    async settle(p, r) { calls.push(["settle", p, r]); return settles ? { success: true, transaction: "9xMockSettledTx", network: r.network, payer: "payer.testnet" } : { success: false, errorReason: "settlement_failed", errorMessage: "inner ft_transfer failed", transaction: "", network: r.network }; },
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: "exact", network: "near:testnet" }], extensions: [], signers: {} }; },
  };
}

async function setup(t, env = {}, deps = {}) {
  const mock = await startMockRpc({ blockMs: 100 });
  t.after(() => mock.close());
  mock.st.claims = CLAIMS.map((c) => ({ ...c }));
  mock.st.views.set("get_challenge", ({ challenge_id }) => ({ id: challenge_id, claim_id: 7, claimed_outcome: false, status: "Jury" }));
  const api = await startApi({ RPC_URLS: mock.url, MARKET_CONTRACT_ID: MARKET, USDC_CONTRACT_ID: USDC, CLAIMS_TTL_MS: "50", ...env }, deps);
  t.after(() => api.close());
  return { mock, api };
}

const payHeader = (accepted) => encodePaymentSignatureHeader({ x402Version: 2, resource: { url: "http://x/v1/credence" }, accepted, payload: { signedDelegateAction: "bW9jaw==" } });

test("/v1/credence: price, open interest, cost to move, rationales with sources, resolution and provenance", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credence-"));
  const evidence = path.join(dir, "rewrite.json");
  fs.writeFileSync(evidence, JSON.stringify({
    market: MARKET, writer_key: "test",
    record: { id: "tether:2:v1", page: "tether", paragraph: 2, version: 1, status: "signed", trigger: { claim_id: 4 }, sentences: [{ claim_id: 4 }], prices_hash: "ab".repeat(32), updatedAt: 1,
      provenance: { model: "z-ai/glm-5.3-flash", signature: "cd".repeat(64), signing_address: "ef".repeat(32), signature_kind: "provider_tee", verified: true, request_hash: "01".repeat(32), response_hash: "02".repeat(32), anchor: { tx_hash: "AnchorTx111" } } },
  }));
  const { api } = await setup(t, { REWRITE_EVIDENCE_FILES: evidence });
  api.app.hub.publish({ uid: "r1", event: "agent_rationale", source: "ai", data: { agent: "skeptic", model: "deepseek", account_id: "a1.swarm.testnet", claim_id: 4, side: "no", size_usd: 1, credence: 0.12, rationale: "NEAR is not on Tether's supported chain list any more.", source_url: "https://tether.to/en/supported-protocols", source_title: "Supported protocols", tx_hash: "TradeTx1", at: 1000 } });
  api.app.hub.publish({ uid: "r2", event: "agent_rationale", source: "ai", data: { agent: "other", claim_id: 1, rationale: "unrelated", at: 2000 } });
  api.app.hub.publish({ uid: "t1", event: "trade", data: { claim_id: 4, side: "no", amount_micro: "2000000", price_yes_ppm: 189970, trader: "seed-b.testnet" }, txHash: "TradeTx0", blockHeight: 5 });

  const r = await api.req("GET", "/v1/credence?q=" + encodeURIComponent("Does Tether issue USDT on NEAR?"));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.matched >= 1, true);
  const c = r.json.claims[0];
  assert.equal(c.claim_id, 4);
  assert.match(r.json.answer, /^The closest claim: "Tether issues tokens on Algorand/);
  assert.equal(c.credence, 0.18997);
  assert.deepEqual(c.price, { yes: 0.18997, no: 0.81003, yes_ppm: 189970 });
  assert.equal(c.open_interest_usd, 4.547388);
  assert.ok(c.cost_to_move_10_points.up_usd > 0 && c.cost_to_move_10_points.down_usd > 0);
  assert.ok(Math.abs(c.liquidity_b_usd - 3) < 0.001);
  assert.match(c.summary, /19% true, with \$4\.55 riding on it/);
  assert.equal(c.rationales.length, 1);
  assert.equal(c.rationales[0].source_url, "https://tether.to/en/supported-protocols");
  assert.equal(c.rationales[0].tx_explorer, "https://testnet.nearblocks.io/txns/TradeTx1");
  assert.equal(c.recent_trades[0].tx_hash, "TradeTx0");
  assert.equal(c.resolution.state, "open");
  assert.equal(c.provenance.contract, MARKET);
  assert.equal(c.provenance.claim_id, 4);
  assert.deepEqual(c.provenance.view, { method: "get_claim", args: { claim_id: 4 } });
  assert.equal(c.provenance.last_rewrite.signature, "cd".repeat(64));
  assert.equal(c.provenance.last_rewrite.anchor_tx, "AnchorTx111");
  assert.match(c.provenance.last_rewrite.key_note, /TEST writer key/);
  assert.equal(r.json.free.limit, 20);
  assert.equal(r.headers.get("x-free-calls-remaining"), "19");

  // by claim id, and resolution states
  const settled = await api.req("GET", "/v1/credence?claim=6");
  assert.equal(settled.json.claims[0].resolution.state, "settled");
  assert.equal(settled.json.claims[0].resolution.outcome, "true");
  const challenged = await api.req("GET", "/v1/credence?claim=7");
  assert.equal(challenged.json.claims[0].resolution.state, "challenged");
  assert.equal(challenged.json.claims[0].resolution.challenge.status, "Jury");
  assert.equal((await api.req("GET", "/v1/credence?claim=99")).status, 404);
});

test("/v1/credence: no match says so plainly and offers to open the claim through the paste flow", async (t) => {
  const { api } = await setup(t);
  const r = await api.req("GET", "/v1/credence?q=" + encodeURIComponent("The moon is made of green cheese."));
  assert.equal(r.status, 200);
  assert.equal(r.json.matched, 0);
  assert.deepEqual(r.json.claims, []);
  assert.match(r.json.answer, /No claim on Priced In matches that/);
  assert.equal(r.json.open.result.planner, "unavailable");
  assert.equal(r.json.open.result.sentences[0].text, "The moon is made of green cheese.");
  assert.match(r.json.open.result.page, /^paste-/);
  const noOpen = await api.req("GET", "/v1/credence?open=0&q=" + encodeURIComponent("The moon is made of green cheese."));
  assert.equal(noOpen.json.open.result, null);
  // bad input never spends a free call
  assert.equal((await api.req("GET", "/v1/credence")).status, 400);
  assert.equal((await api.req("GET", "/v1/credence?q=" + "x".repeat(700))).status, 413);
  assert.equal((await api.req("GET", "/v1/credence?claim=abc")).status, 400);
});

test("free tier: N calls per address per day, then 402 with an x402 challenge (or 429 with no payments)", async (t) => {
  const f = mockFacilitator();
  const { api } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "2", X402_PAY_TO: PAY_TO }, { facilitator: f });
  const q = "/v1/credence?q=" + encodeURIComponent("Is Tether headquartered in El Salvador?");
  assert.equal((await api.req("GET", q)).headers.get("x-free-calls-remaining"), "1");
  // a failed call gives its unit back
  assert.equal((await api.req("GET", "/v1/credence?claim=99")).status, 404);
  assert.equal((await api.req("GET", q)).json.free.remaining, 0);
  const r = await api.req("GET", q);
  assert.equal(r.status, 402);
  const hdr = decodePaymentRequiredHeader(r.headers.get("payment-required")); // the protocol's own decoder
  assert.equal(hdr.x402Version, 2);
  assert.deepEqual(hdr.accepts, [{ scheme: "exact", network: "near:testnet", asset: USDC, amount: "10000", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: {} }]);
  assert.match(hdr.resource.url, /\/v1\/credence\?q=/);
  assert.match(hdr.error, /free tier is 2 credence calls a day/);
  assert.equal(r.json.x402Version, 2);
  assert.equal(r.json.free.remaining, 0);
  assert.equal(f.calls.length, 0);

  // with no facilitator: a plain 429
  const { api: api2 } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "1" });
  await api2.req("GET", q);
  const r2 = await api2.req("GET", q);
  assert.equal(r2.status, 429);
  assert.equal(r2.json.error.code, "free_tier_used");
  assert.ok(Number(r2.headers.get("retry-after")) > 0);
});

test("x402: verify, answer, settle, and the settled receipt in PAYMENT-RESPONSE", async (t) => {
  const f = mockFacilitator();
  const { api } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0", X402_PAY_TO: PAY_TO }, { facilitator: f });
  const q = "/v1/credence?q=" + encodeURIComponent("Does Tether issue USDT on NEAR?");
  const challenge = await api.req("GET", q);
  assert.equal(challenge.status, 402);
  const accepted = decodePaymentRequiredHeader(challenge.headers.get("payment-required")).accepts[0];
  const r = await api.req("GET", q, undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.claims[0].claim_id, 4);
  assert.deepEqual(f.calls.map((c) => c[0]), ["verify", "settle"]);
  assert.deepEqual(f.calls[0][2], accepted);
  const settled = decodePaymentResponseHeader(r.headers.get("payment-response"));
  assert.deepEqual(settled, { success: true, transaction: "9xMockSettledTx", network: "near:testnet", payer: "payer.testnet" });
  assert.equal(r.json.payment.settled, true);
  assert.equal(r.json.payment.explorer, "https://testnet.nearblocks.io/txns/9xMockSettledTx");
  assert.equal(r.json.payment.usd, 0.01);
  assert.equal(r.json.free, undefined, "a paid call spends no free unit");

  // the legacy v1 header name carries a v2 payload too
  assert.equal((await api.req("GET", q, undefined, { "x-payment": payHeader(accepted) })).status, 200);

  // a payment for other requirements is refused before the facilitator is asked
  f.calls.length = 0;
  const cheap = await api.req("GET", q, undefined, { "payment-signature": payHeader({ ...accepted, amount: "1" }) });
  assert.equal(cheap.status, 402);
  assert.match(cheap.json.error, /does not accept these requirements/);
  const elsewhere = await api.req("GET", q, undefined, { "payment-signature": payHeader({ ...accepted, payTo: "thief.testnet" }) });
  assert.equal(elsewhere.status, 402);
  const garbage = await api.req("GET", q, undefined, { "payment-signature": "not base64 at all!" });
  assert.equal(garbage.status, 402);
  assert.equal(f.calls.length, 0);

  // a failed answer is never settled: nothing is charged
  const missing = await api.req("GET", "/v1/credence?claim=99", undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.payment.settled, false);
  assert.deepEqual(f.calls.map((c) => c[0]), ["verify"]);
});

test("x402: an invalid payment or a failed settlement gets a fresh 402 and no answer", async (t) => {
  const bad = mockFacilitator({ valid: false });
  const { api } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0", X402_PAY_TO: PAY_TO }, { facilitator: bad });
  const q = "/v1/credence?q=" + encodeURIComponent("Does Tether issue USDT on NEAR?");
  const accepted = unb64json((await api.req("GET", q)).headers.get("payment-required")).accepts[0];
  const r = await api.req("GET", q, undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(r.status, 402);
  assert.match(r.json.error, /insufficient_funds/);
  assert.equal(r.json.claims, undefined);
  assert.deepEqual(bad.calls.map((c) => c[0]), ["verify"]);

  const unsettled = mockFacilitator({ settles: false });
  const { api: api2 } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0", X402_PAY_TO: PAY_TO }, { facilitator: unsettled });
  const r2 = await api2.req("GET", q, undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(r2.status, 402);
  assert.match(r2.json.error, /did not settle: settlement_failed/);
  assert.equal(r2.json.claims, undefined, "an unsettled payment gets no answer");
  assert.equal(r2.headers.get("payment-response"), null);
});

test("x402: a facilitator read that failed (fail-closed RPC) is asked again; a real refusal is not", async () => {
  const { Paywall, requirements } = await import("../src/x402.mjs");
  const x = { network: "testnet", priceMicro: 10000, asset: USDC, payTo: PAY_TO, maxTimeoutS: 60 };
  let n = 0;
  const flaky = {
    async verify() { n++; return n < 2 ? { isValid: false, invalidReason: "invalid_exact_near_token_account_lookup_failed" } : { isValid: true, payer: "p.testnet" }; },
    async settle(p, r) { n++; return n < 4 ? { success: false, errorReason: "invalid_exact_near_balance_check_failed", transaction: "", network: r.network } : { success: true, transaction: "T", network: r.network, payer: "p.testnet" }; },
  };
  const pw = new Paywall(x, flaky, { retryDelaysMs: [1, 1] });
  const header = b64json({ x402Version: 2, accepted: requirements(x), payload: {} });
  const ok = await pw.charge(header, "http://x/v1/credence", "d", async () => ({ status: 200, body: { a: 1 } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.payment.transaction, "T");
  assert.equal(n, 4);
  let m = 0;
  const refusing = { async verify() { m++; return { isValid: false, invalidReason: "insufficient_funds" }; }, async settle() { throw new Error("never"); } };
  const no = await new Paywall(x, refusing, { retryDelaysMs: [1, 1] }).charge(header, "http://x", "d", async () => ({ status: 200, body: {} }));
  assert.equal(no.status, 402);
  assert.equal(m, 1);
});

test("x402: a remote facilitator over the protocol's HTTP interface", async (t) => {
  const seen = [];
  const fac = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = body ? JSON.parse(body) : null;
      seen.push([req.method, req.url, j]);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/verify") return res.end(JSON.stringify({ isValid: true, payer: "p.testnet" }));
      if (req.url === "/settle") return res.end(JSON.stringify({ success: true, transaction: "HttpTx", network: j.paymentRequirements.network, payer: "p.testnet" }));
      res.end("{}");
    });
  });
  await new Promise((r) => fac.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => fac.close(r)));
  const { api } = await setup(t, { CREDENCE_FREE_PER_IP_PER_DAY: "0", X402_PAY_TO: PAY_TO, X402_FACILITATOR_URL: `http://127.0.0.1:${fac.address().port}/` });
  const q = "/v1/credence?q=" + encodeURIComponent("Is Tether headquartered in El Salvador?");
  const accepted = unb64json((await api.req("GET", q)).headers.get("payment-required")).accepts[0];
  const r = await api.req("GET", q, undefined, { "payment-signature": payHeader(accepted) });
  assert.equal(r.status, 200);
  assert.equal(r.json.payment.transaction, "HttpTx");
  assert.deepEqual(seen.map((s) => s[1]), ["/verify", "/settle"]);
  assert.equal(seen[0][2].x402Version, 2);
  assert.deepEqual(seen[0][2].paymentRequirements, accepted);
  assert.equal(seen[0][2].paymentPayload.payload.signedDelegateAction, "bW9jaw==");
  const info = await api.req("GET", "/v1");
  assert.equal(info.json.credence.payments.amount, "10000");
  assert.equal(info.json.credence.payments.facilitator, "http");
});

test("our facilitator's own routes settle only payments to us", async (t) => {
  const f = mockFacilitator();
  const { api } = await setup(t, { X402_PAY_TO: PAY_TO, X402_RELAYER_ACCOUNT_ID: "relayer.pricedin.testnet", X402_RELAYER_PRIVATE_KEY: "ed25519:unused-in-this-test" }, { facilitator: f });
  const ours = { scheme: "exact", network: "near:testnet", asset: USDC, amount: "10000", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: {} };
  assert.equal((await api.req("GET", "/x402/supported")).json.kinds[0].network, "near:testnet");
  const ok = await api.req("POST", "/x402/verify", { x402Version: 2, paymentPayload: { x402Version: 2, accepted: ours, payload: {} }, paymentRequirements: ours });
  assert.equal(ok.json.isValid, true);
  const theirs = await api.req("POST", "/x402/settle", { x402Version: 2, paymentPayload: {}, paymentRequirements: { ...ours, payTo: "someone.testnet" } });
  assert.equal(theirs.status, 403);
  assert.equal(theirs.json.error.code, "not_our_payment");
  assert.deepEqual(f.calls.map((c) => c[0]), ["verify"]);
});

test("/v1/quote: the LMSR cost of a bet and the exact buy call", async (t) => {
  const { api } = await setup(t);
  const r = await api.req("GET", "/v1/quote?claim=4&side=no&amount_usd=1");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.quote.side, "no");
  assert.ok(r.json.quote.price_yes_after < 0.18997);
  assert.deepEqual(r.json.call.args, { claim_id: 4, side: "no", amount_micro: "1000000", min_shares_micro: r.json.quote.min_shares_micro });
  assert.equal(r.json.call.method, "buy");
  assert.equal((await api.req("GET", "/v1/quote?claim=6&side=yes&amount_usd=1")).status, 409);
  assert.equal((await api.req("GET", "/v1/quote?claim=4&side=up&amount_usd=1")).status, 400);
  assert.equal((await api.req("GET", "/v1/quote?claim=4&side=yes&amount_usd=-1")).status, 400);
});

test("config: x402 is testnet test USDC by default; mainnet values only with NEAR_NETWORK=mainnet", async () => {
  const { loadConfig, MAINNET_USDC } = await import("../src/config.mjs");
  const t = loadConfig({ USDC_CONTRACT_ID: USDC, X402_PAY_TO: PAY_TO });
  assert.equal(t.config.x402.network, "testnet");
  assert.equal(t.config.x402.asset, USDC);
  assert.equal(t.config.x402.priceMicro, 10000);
  const m = loadConfig({ NEAR_NETWORK: "mainnet" });
  assert.equal(m.config.x402.asset, MAINNET_USDC);
  assert.ok(loadConfig({ X402_PAY_TO: "truth.pricedin.near" }).errors.some((e) => /X402_PAY_TO.*mainnet/.test(e)));
  assert.ok(loadConfig({ X402_ASSET: MAINNET_USDC }).errors.some((e) => /mainnet USDC/.test(e)));
  assert.ok(loadConfig({ X402_PRICE_MICRO: "5000000" }).errors.some((e) => /at most \$1/.test(e)));
  assert.equal(b64json({ a: 1 }), Buffer.from('{"a":1}').toString("base64"));
});
