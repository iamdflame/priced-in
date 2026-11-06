import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { NearAI } from "../src/nearai.js";
import { decide, impliedB, buyQuote, sellQuote, sharesToTarget, dailyLoss, parseCredence, DEFAULT_POLICY } from "../src/agents.js";
import { Research, keywords, excerpt } from "../src/research.js";
import { SignerClient, validateDecision, validateBill, validateAnchor, validateDispute, checkPermission, DAILY_CHALLENGES, DAILY_DISPUTES, DAILY_DISPUTE_MICRO, DAILY_OPENS, DECISION_FIELDS, MAX_DISPUTE_BOND_MICRO, OPERATOR_METHODS } from "../src/signer.js";
import { newRunnerKey, operatorKey } from "../src/keystore.js";
import { loadAiConfig } from "../src/config.js";
import { startMockRpc } from "../../api/test/mock-rpc.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "signer-"));

test("policy: buys only when the edge beats fees plus 2 points", () => {
  const base = { priceYes: 0.5, b: 3, bankrollUsd: 10 };
  assert.equal(decide({ ...base, credence: 0.515 }).action, "none");
  assert.equal(decide({ ...base, credence: 0.515 }).noEdge, true);
  assert.equal(decide({ ...base, credence: 0.52 }).action, "none", "exactly 2 points is not more than 2 points");
  assert.equal(decide({ ...base, credence: 0.6 }).action, "buy");
  assert.equal(decide({ ...base, credence: 0.6 }).side, "yes");
  assert.equal(decide({ ...base, credence: 0.3 }).side, "no");
  assert.equal(decide({ ...base, credence: 0.6, policy: { feePoints: 0.09 } }).action, "none", "fees raise the bar");
});

test("policy: fractional Kelly, a $2 cap, price impact, and determinism", () => {
  const d = decide({ credence: 0.6, priceYes: 0.5, b: 100, bankrollUsd: 10 });
  near(d.amountUsd, 0.25 * ((0.6 - 0.5) / 0.5) * 10, 1e-5); // quarter Kelly: 0.25 x 0.2 x $10
  near(Number(d.amount_micro), 500000, 2);
  const big = decide({ credence: 0.95, priceYes: 0.5, b: 100, bankrollUsd: 1000 });
  assert.equal(big.amountUsd, 2, "the $2 cap");
  assert.equal(decide({ credence: 0.95, priceYes: 0.5, b: 100, bankrollUsd: 1000, policy: { maxBetUsd: 1 } }).amountUsd, 1, "a persona's lower cap");
  const thin = decide({ credence: 0.6, priceYes: 0.5, b: 0.5, bankrollUsd: 100 });
  assert.equal(thin.action, "buy");
  assert.ok(thin.amountUsd < 2 && 0.6 - thin.avgPrice > 0.019, JSON.stringify(thin));
  assert.equal(decide({ credence: 0.53, priceYes: 0.5, b: 0.1, bankrollUsd: 100 }).action, "none");
  assert.ok(Number(d.min_shares_micro) > 0 && Number(d.min_shares_micro) < buyQuote(0.5, 100, d.amountUsd).shares * 1e6);
  assert.deepEqual(decide({ credence: 0.7, priceYes: 0.41, b: 3, bankrollUsd: 7 }), decide({ credence: 0.7, priceYes: 0.41, b: 3, bankrollUsd: 7 }));
  assert.equal(decide({ credence: 0.9, priceYes: 0.5, b: 3, bankrollUsd: 0 }).action, "none");
});

test("policy: sells when the credence crosses the price the other way, down toward the credence", () => {
  // holds 3 YES; the market moved to 90% but the agent thinks 60%
  const s = decide({ credence: 0.6, priceYes: 0.9, b: 3, bankrollUsd: 10, holding: { yes: 3, no: 0 } });
  assert.equal(s.action, "sell");
  assert.equal(s.side, "yes");
  const shares = Number(s.shares_micro) / 1e6;
  assert.ok(shares > 0 && shares <= 3, `sells at most what it holds: ${shares}`);
  near(s.priceAfterYes, Math.max(0.62, sellQuote(0.9, 3, 3).priceAfter), 1e-4); // stops at credence + margin, or when it runs out
  assert.ok(Number(s.min_proceeds_micro) < s.proceedsUsd * 1e6 && Number(s.min_proceeds_micro) > 0.97 * s.proceedsUsd * 1e6);
  // with plenty of shares it sells exactly down to credence + margin
  const all = decide({ credence: 0.6, priceYes: 0.9, b: 3, bankrollUsd: 10, holding: { yes: 50, no: 0 } });
  near(all.priceAfterYes, 0.62, 1e-4);
  near(Number(all.shares_micro) / 1e6, sharesToTarget(0.9, 0.62, 3), 1e-5);
  // holds NO, credence moved above the price: sells NO
  const n = decide({ credence: 0.7, priceYes: 0.3, b: 3, bankrollUsd: 10, holding: { yes: 0, no: 2 } });
  assert.equal(n.action, "sell");
  assert.equal(n.side, "no");
  // within the margin of the price: no sale, and it agrees
  const at = decide({ credence: 0.89, priceYes: 0.9, b: 3, bankrollUsd: 10, holding: { yes: 3, no: 0 } });
  assert.equal(at.action, "none");
  assert.equal(at.noEdge, true);
  // a sale too small to matter is skipped and says so (it is not an agreement)
  const dust = decide({ credence: 0.6, priceYes: 0.9, b: 3, bankrollUsd: 10, holding: { yes: 0.01, no: 0 } });
  assert.equal(dust.action, "none");
  assert.notEqual(dust.noEdge, true);
  assert.match(dust.reason, /sale this small/);
  // holding the side it still believes in: no sale, it may buy more
  assert.equal(decide({ credence: 0.95, priceYes: 0.6, b: 3, bankrollUsd: 10, holding: { yes: 3, no: 0 } }).action, "buy");
  // the daily loss limit stops buying, never selling
  assert.equal(decide({ credence: 0.6, priceYes: 0.9, b: 3, bankrollUsd: 10, dailyLossUsd: 99, holding: { yes: 3, no: 0 } }).action, "sell");
});

test("policy: stops on the daily loss limit, marked to market, sales included", () => {
  const stopped = decide({ credence: 0.9, priceYes: 0.5, b: 3, bankrollUsd: 10, dailyLossUsd: 5 });
  assert.equal(stopped.action, "none");
  assert.equal(stopped.stopped, true);
  const claims = new Map([[1, { price_yes_ppm: 250000 }], [2, { price_yes_ppm: 500000, outcome: false }]]);
  near(dailyLoss([{ claim_id: 1, side: "yes", amount_micro: "1000000", shares_micro: "2000000" }], claims), 0.5);
  near(dailyLoss([{ claim_id: 2, side: "yes", amount_micro: "1000000", shares_micro: "2000000" }], claims), 1, 1e-9);
  near(dailyLoss([{ claim_id: 2, side: "no", amount_micro: "1000000", shares_micro: "2000000" }], claims), 0, 1e-9);
  near(dailyLoss([{ claim_id: 9, side: "no", amount_micro: "1000000", shares_micro: "2000000" }], claims), 1, 1e-9);
  // bought 2 YES for $1, sold 1 back for $0.60: cost 1 - 0.6 - 1 share x 0.25 = 0.15
  near(dailyLoss([{ claim_id: 1, action: "buy", side: "yes", amount_micro: "1000000", shares_micro: "2000000" }, { claim_id: 1, action: "sell", side: "yes", amount_micro: "600000", shares_micro: "1000000" }], claims), 0.15);
});

test("LMSR math matches the contract's figures, buying and selling", () => {
  near(impliedB(0.5, 3 * Math.log(0.5 / 0.4), 0), 3);
  near(impliedB(0.95, 0, 3 * Math.log(0.95 / 0.85)), 3);
  assert.equal(impliedB(0.5, 0, 0), null);
  // the API e2e measured a $1 NO bet on b=$3 moving 50% to 35.83%
  near(1 - buyQuote(0.5, 3, 1).priceAfter, 0.358265, 2e-4);
  // selling what you bought returns what you paid
  const q = buyQuote(0.4, 3, 1.5);
  near(sellQuote(q.priceAfter, 3, q.shares).proceeds, 1.5, 1e-9);
  near(sellQuote(q.priceAfter, 3, q.shares).priceAfter, 0.4, 1e-9);
  near(sellQuote(0.9, 3, sharesToTarget(0.9, 0.7, 3)).priceAfter, 0.7, 1e-9);
  assert.equal(sharesToTarget(0.5, 0.6, 3), 0);
});

test("credence replies: bad numbers refused, unknown URLs replaced and labelled", () => {
  const sources = [{ url: "https://a.example/x", title: "A" }];
  const c = parseCredence('```json\n{"p":0.7,"rationale":"Because.","source_url":"https://a.example/x"}\n```', sources);
  assert.equal(c.p, 0.7);
  assert.equal(c.sourceChosenBy, "model");
  const d = parseCredence('{"p":70,"rationale":"Because.","source_url":"https://made.up/404"}', sources);
  assert.equal(d.p, 0.7);
  assert.equal(d.source.url, "https://a.example/x");
  assert.match(d.sourceChosenBy, /runner/);
  assert.throws(() => parseCredence('{"p":0,"rationale":"x"}', sources), /not a probability/);
  assert.throws(() => parseCredence('{"p":0.5}', sources), /no rationale/);
  assert.throws(() => parseCredence('{"p":0.5,"rationale":"x"}', []), /no verified source/);
  assert.throws(() => parseCredence("nope", sources), /no JSON/);
});

export function fakeWeb(pages) {
  return async (url) => {
    const u = String(url);
    const hit = Object.keys(pages).find((k) => u.startsWith(k));
    const v = hit ? pages[hit] : { status: 404, body: "not found" };
    const body = typeof v.body === "string" ? v.body : JSON.stringify(v.body);
    return { status: v.status ?? 200, url: u, text: async () => body, json: async () => JSON.parse(body) };
  };
}

export const WIKI = {
  "https://en.wikipedia.org/w/api.php": { body: { query: { search: [{ title: "Banana" }, { title: "Dead" }] } } },
  "https://en.wikipedia.org/api/rest_v1/page/summary/Banana": { body: { title: "Banana", extract: "A banana is botanically a berry.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Banana" } } } },
  "https://en.wikipedia.org/api/rest_v1/page/summary/Dead": { body: { title: "Dead", extract: "Gone.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Dead" } } } },
  "https://en.wikipedia.org/wiki/Banana": { body: "<html><p>A banana is a berry.</p></html>" },
  "https://en.wikipedia.org/wiki/Dead": { status: 404, body: "gone" },
  "https://www.wikidata.org/w/api.php": { body: { search: [{ id: "Q503", label: "banana", description: "edible fruit" }] } },
  "https://www.wikidata.org/wiki/Q503": { body: "<html>banana</html>" },
};

test("research: every source answered 200 just now; dead links are dropped; web search is used when there is a key", async () => {
  assert.equal(keywords("The price of NEAR is more than $10 billion."), "price NEAR $10 billion");
  assert.match(excerpt("Cats sleep. Bananas are berries. Dogs bark.", "Bananas are berries"), /Bananas are berries/);
  const r = await new Research({ fetchImpl: fakeWeb(WIKI) }).forClaim("Bananas are botanically berries.");
  assert.deepEqual(r.sources.map((s) => s.url), ["https://en.wikipedia.org/wiki/Banana", "https://www.wikidata.org/wiki/Q503"]);
  assert.ok(r.sources.every((s) => s.status === 200 && s.checked_at));
  assert.ok(r.errors.some((e) => /Dead answered 404/.test(e)));
  const mock = await startMockNearAI({ searchResults: [{ title: "Live", url: "https://live.example/a", content: "It is." }, { title: "Dead", url: "https://dead.example/b", content: "x" }] });
  try {
    const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
    const s = await new Research({ client, searchModel: MOCK_MODELS[2], fetchImpl: fakeWeb({ ...WIKI, "https://live.example/a": { body: "<p>It is.</p>" } }) }).forClaim("Bananas are botanically berries.");
    assert.equal(s.sources[0].url, "https://live.example/a");
    assert.equal(s.sources[0].via, "web_context_search");
    assert.ok(!s.sources.some((x) => x.url.includes("dead.example")));
    assert.equal(mock.calls.find((c) => c.path === "/v1/chat/completions").stream, true, "web_context_search needs stream:true");
  } finally { await mock.close(); }
  const none = await new Research({ fetchImpl: async () => { throw new Error("offline"); } }).forClaim("Anything at all here.");
  assert.equal(none.sources.length, 0);
});

test("signer checks: strict trade decisions, bills, anchors and function-call keys only", () => {
  const buy = { agent: "a0.swarm.testnet", claim_id: 3, action: "buy", side: "yes", amount_micro: "2000000", min_shares_micro: "1" };
  assert.deepEqual(validateDecision(buy), buy);
  assert.throws(() => validateDecision({ ...buy, amount_micro: "2000001" }), /per-bet cap/);
  assert.throws(() => validateDecision({ ...buy, amount_micro: "0" }), /positive/);
  assert.throws(() => validateDecision({ ...buy, side: "maybe" }), /side/);
  assert.throws(() => validateDecision({ ...buy, method: "withdraw" }), /unexpected fields/);
  assert.throws(() => validateDecision({ ...buy, action: "withdraw" }), /buy or sell/);
  assert.throws(() => validateDecision({ ...buy, agent: "Not An Account" }), /NEAR account/);
  assert.throws(() => validateDecision(buy, { maxBetMicro: 100n }), /per-bet cap/);
  assert.throws(() => validateDecision({ ...buy, shares_micro: "5" }), /amount_micro and min_shares_micro only/);
  const sell = { agent: "a0.swarm.testnet", claim_id: 3, action: "sell", side: "no", shares_micro: "1500000", min_proceeds_micro: "100" };
  assert.deepEqual(validateDecision(sell), sell);
  assert.throws(() => validateDecision({ ...sell, shares_micro: "0" }), /positive/);
  assert.throws(() => validateDecision({ ...sell, amount_micro: "1" }), /shares_micro and min_proceeds_micro only/);
  const bill = { agent: "a0.swarm.testnet", route: "escrow", amount_micro: "1500", usage_hash: "ab".repeat(32) };
  assert.deepEqual(validateBill(bill), bill);
  assert.throws(() => validateBill({ ...bill, route: "withdraw" }), /route/);
  assert.throws(() => validateBill({ ...bill, amount_micro: "5000001" }), /per-bill cap/);
  assert.throws(() => validateBill({ ...bill, usage_hash: "xyz" }), /usage_hash/);
  const anchor = { claim_id: 0, version: 1, prices_hash: "a".repeat(64), request_hash: "b".repeat(64), response_hash: "c".repeat(64), signature_hex: "d".repeat(128), model: "z-ai/glm-5.3-flash" };
  assert.deepEqual(validateAnchor(anchor), anchor);
  assert.throws(() => validateAnchor({ ...anchor, signature_hex: "00" }), /signature_hex/);
  const fc = (receiver_id, method_names) => ({ permission: { FunctionCall: { receiver_id, method_names, allowance: "1" } } });
  assert.equal(checkPermission(fc("m.testnet", ["buy", "sell"]), "m.testnet"), null);
  assert.equal(checkPermission(fc("m.testnet", ["buy", "sell", "redeem"]), "m.testnet"), null, "a swarm agent's key");
  assert.match(checkPermission({ permission: "FullAccess" }, "m.testnet"), /full-access/);
  assert.match(checkPermission(fc("other.testnet", ["buy"]), "m.testnet"), /not m.testnet/);
  assert.match(checkPermission(fc("m.testnet", []), "m.testnet"), /every method/);
  assert.match(checkPermission(fc("m.testnet", ["buy", "withdraw"]), "m.testnet"), /withdraw/);
  assert.equal(checkPermission(fc("m.testnet", ["anchor_rewrite", "charge_inference"]), "m.testnet", OPERATOR_METHODS.market), null);
  assert.match(checkPermission(fc("m.testnet", ["anchor_rewrite", "withdraw_treasury"]), "m.testnet", OPERATOR_METHODS.market), /withdraw_treasury/);
  assert.match(checkPermission(fc("s.testnet", ["sweep_escrow", "close_agent"]), "s.testnet", OPERATOR_METHODS.swarm), /close_agent/);
});

/** A mock chain with a swarm: three agents, the keystore holds two of their runner keys. */
async function swarmChain() {
  const rpc = await startMockRpc();
  const dir = tmpdir();
  const ks = path.join(dir, "keystore");
  const market = "market.testnet", swarm = "swarm.testnet", ops = "house.testnet";
  const k0 = newRunnerKey(ks, { label: "house-archivist" });
  const k1 = newRunnerKey(ks, { label: "issued" });
  const stranger = KeyPair.fromRandom("ed25519").getPublicKey().toString(); // a runner key we don't hold
  const agents = [
    { id: 0, account: `a0.${swarm}`, owner: ops, model: MOCK_MODELS[1], persona_hash: "0".repeat(64), runner_public_key: k0.publicKey, escrow_yocto: "100", charged_yocto: "0", sleeping: false, closed: false, deleted: false },
    { id: 1, account: `a1.${swarm}`, owner: "someone.testnet", model: MOCK_MODELS[0], persona_hash: "1".repeat(64), runner_public_key: k1.publicKey, escrow_yocto: "100", charged_yocto: "0", sleeping: false, closed: false, deleted: false },
    { id: 2, account: `a2.${swarm}`, owner: "other.testnet", model: MOCK_MODELS[2], persona_hash: "2".repeat(64), runner_public_key: stranger, escrow_yocto: "100", charged_yocto: "0", sleeping: false, closed: false, deleted: false },
  ];
  rpc.st.views.set("get_agents", (args) => agents.slice(args.from, args.from + args.limit));
  const fc = (receiver_id, method_names) => ({ nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id, method_names } } });
  rpc.st.keys.set(`a0.${swarm}|${k0.publicKey}`, fc(market, ["buy", "sell", "redeem"]));
  rpc.st.keys.set(`a1.${swarm}|${k1.publicKey}`, fc(market, ["buy", "sell", "redeem"]));
  const om = operatorKey(ks, "market", { accountId: ops, receiverId: market, methods: OPERATOR_METHODS.market }).rec;
  const os_ = operatorKey(ks, "swarm", { accountId: ops, receiverId: swarm, methods: OPERATOR_METHODS.swarm }).rec;
  rpc.st.keys.set(`${ops}|${om.publicKey}`, fc(market, OPERATOR_METHODS.market));
  rpc.st.keys.set(`${ops}|${os_.publicKey}`, fc(swarm, OPERATOR_METHODS.swarm));
  const sent = [];
  rpc.st.onCall = (c) => {
    sent.push(c);
    if (c.method === "buy") return { value: { claim_id: c.args.claim_id, trader: c.signer, side: c.args.side, shares_micro: "2000000", amount_micro: c.args.amount_micro, price_yes_ppm_before: 500000, price_yes_ppm_after: 600000, balance_micro: "1" } };
    if (c.method === "sell") return { value: { claim_id: c.args.claim_id, trader: c.signer, side: `sell_${c.args.side}`, shares_micro: c.args.shares_micro, amount_micro: "700000", price_yes_ppm_before: 600000, price_yes_ppm_after: 550000, balance_micro: "1" } };
    if (c.method === "sweep_escrow") return { value: "40" };
    return { value: null };
  };
  const secrets = [k0, k1].map((k) => JSON.parse(fs.readFileSync(path.join(ks, `runner-${k.publicKey.replace("ed25519:", "")}.json`), "utf8")).privateKey).concat([om.privateKey, os_.privateKey]);
  const client = (o = {}) => new SignerClient({ marketId: market, swarmId: swarm, rpcUrls: [rpc.url], keystoreDir: ks, journalFile: path.join(dir, "signer.jsonl"), yoctoPerMicro: 10n, ...o });
  return { rpc, dir, ks, market, swarm, ops, agents, sent, secrets, client, k0, k1 };
}

test("the signer drives the swarm agents whose runner key it holds, and only those", async () => {
  const c = await swarmChain();
  const logs = [];
  const signer = c.client({ log: (m) => logs.push(m) });
  try {
    const ready = await signer.start();
    assert.notEqual(signer.child.pid, process.pid);
    assert.deepEqual(ready.filter((a) => a.ok).map((a) => a.accountId).sort(), ["a0.swarm.testnet", "a1.swarm.testnet"]);
    assert.ok(!ready.some((a) => a.accountId === "a2.swarm.testnet"), "an agent whose key we don't hold is not even listed");
    const l = await signer.listAgents();
    assert.equal(l.unheld, 1);
    assert.equal(l.operator.market.ok, true);
    assert.deepEqual(l.operator.swarm.methods, ["sweep_escrow"]);
    const buy = await signer.trade("trade:test:0001", { agent: "a0.swarm.testnet", claim_id: 7, action: "buy", side: "no", amount_micro: "1500000", min_shares_micro: "100", privateKey: "ignored" });
    assert.equal(buy.ok, true, buy.error);
    assert.equal(rpc_(c).outcomes.get(buy.txHash).transaction.signer_id, "a0.swarm.testnet");
    assert.equal(buy.value.amount_micro, "1500000");
    const sell = await signer.trade("trade:test:0002", { agent: "a1.swarm.testnet", claim_id: 7, action: "sell", side: "yes", shares_micro: "1000000", min_proceeds_micro: "1" });
    assert.equal(sell.ok, true, sell.error);
    assert.equal(c.sent.at(-1).method, "sell");
    assert.deepEqual(c.sent.at(-1).args, { claim_id: 7, side: "yes", shares_micro: "1000000", min_proceeds_micro: "1" });
    assert.match((await signer.trade("trade:test:0003", { agent: "a2.swarm.testnet", claim_id: 7, action: "buy", side: "no", amount_micro: "100", min_shares_micro: "0" })).error, /no usable key/);
    // operator: an escrow bill sweeps micro x rate yoctoNEAR; a balance bill charges micro-USDC; an anchor anchors
    const bill = await signer.bill("bill:test:0001", { agent: "a0.swarm.testnet", route: "escrow", amount_micro: "1234", usage_hash: "ab".repeat(32) });
    assert.equal(bill.ok, true, bill.error);
    assert.deepEqual(c.sent.at(-1), { method: "sweep_escrow", args: { agent_id: "a0.swarm.testnet", amount_yocto: "12340", usage_hash: "ab".repeat(32) }, signer: "house.testnet", receiver: "swarm.testnet", publicKey: c.sent.at(-1).publicKey });
    assert.equal(bill.value, "40");
    const charge = await signer.bill("bill:test:0002", { agent: "a1.swarm.testnet", route: "balance", amount_micro: "999", usage_hash: "cd".repeat(32) });
    assert.equal(charge.ok, true);
    assert.equal(c.sent.at(-1).method, "charge_inference");
    assert.match((await signer.bill("bill:test:0003", { agent: "a2.swarm.testnet", route: "balance", amount_micro: "1", usage_hash: "cd".repeat(32) })).error, /not an agent this signer runs/);
    const an = await signer.anchor("anchor:test:p:0:v1", { claim_id: 0, version: 1, prices_hash: "a".repeat(64), request_hash: "b".repeat(64), response_hash: "c".repeat(64), signature_hex: "d".repeat(128), model: "m" });
    assert.equal(an.ok, true);
    assert.equal(c.sent.at(-1).method, "anchor_rewrite");
    // a runner key for a stranger: the signer writes it; only the public key comes back
    const k = await signer.issueKey("e".repeat(64));
    assert.match(k.publicKey, /^ed25519:/);
    assert.ok(fs.existsSync(path.join(c.ks, `runner-${k.publicKey.replace("ed25519:", "")}.json`)));
    const everything = JSON.stringify([logs, ready, buy, sell, bill, charge, an, k, l]);
    for (const s of c.secrets) assert.ok(!everything.includes(s), "no key material comes back or is logged");
  } finally { await signer.stop(); await c.rpc.close(); }
});
const rpc_ = (c) => c.rpc.st;

test("the signer's journal: daily spend survives a restart, and an intent is never sent twice", async () => {
  const c = await swarmChain();
  let signer = c.client({ dailySpendMicro: 3_000_000 });
  try {
    await signer.start();
    const d = { agent: "a0.swarm.testnet", claim_id: 1, action: "buy", side: "yes", amount_micro: "2000000", min_shares_micro: "0" };
    const first = await signer.trade("trade:spend:0001", d);
    assert.equal(first.ok, true);
    const n = c.sent.length;
    const again = await signer.trade("trade:spend:0001", d);
    assert.equal(again.replayed, true, "the same intent returns its recorded outcome");
    assert.equal(again.txHash, first.txHash);
    assert.equal(c.sent.length, n, "and sends nothing");
    await signer.stop();
    signer = c.client({ dailySpendMicro: 3_000_000 });
    await signer.start();
    assert.equal(signer.ready.spent.agents["a0.swarm.testnet"].spend_micro, "2000000", "today's spend is rebuilt from the journal");
    assert.match((await signer.trade("trade:spend:0002", d)).error, /daily spend cap/);
    assert.equal((await signer.outcome("trade:spend:0001")).txHash, first.txHash, "outcomes survive the restart");
    assert.equal((await signer.outcome("trade:never")).unknownIntent, true);
    // sells spend nothing, so the cap does not stop them
    assert.equal((await signer.trade("trade:spend:0003", { agent: "a0.swarm.testnet", claim_id: 1, action: "sell", side: "yes", shares_micro: "1", min_proceeds_micro: "0" })).ok, true);
    // a refused transaction spends nothing either
    c.rpc.st.onCall = () => ({ failure: "not enough balance" });
    const failed = await signer.trade("trade:spend:0004", { ...d, amount_micro: "1000000" });
    assert.equal(failed.ok, false);
    assert.equal(failed.final, true);
    assert.equal((await signer.spent()).agents["a0.swarm.testnet"].spend_micro, "2000000");
  } finally { await signer.stop(); await c.rpc.close(); }
});

test("an outcome the signer cannot see is never re-sent: it waits for the chain", async () => {
  const c = await swarmChain();
  const signer = c.client({ supersededAfterMs: 0 });
  try {
    await signer.start();
    const d = { agent: "a0.swarm.testnet", claim_id: 1, action: "buy", side: "yes", amount_micro: "100000", min_shares_micro: "0" };
    assert.equal((await signer.trade("trade:lost:0000", d)).ok, true); // the nonce and block hash are cached now
    c.rpc.st.down = true; // the next broadcast goes nowhere we can confirm
    const r = await signer.trade("trade:lost:0001", d);
    c.rpc.st.down = false;
    assert.equal(r.ok, false);
    assert.equal(r.final, false, "signed and broadcast, outcome unknown");
    assert.match(r.error, /outcome unknown/);
    assert.ok(r.txHash, "the hash was journaled before the broadcast");
    const n = c.sent.length;
    const again = await signer.trade("trade:lost:0001", d);
    assert.equal(again.pending, true);
    assert.equal(c.sent.length, n, "not re-sent under a new nonce");
    assert.equal((await signer.spent()).agents["a0.swarm.testnet"].spend_micro, "200000", "an unknown outcome still counts against the cap");
    // a later transaction from the same key uses a higher nonce: the lost one can never land now
    assert.equal((await signer.trade("trade:lost:0002", d)).ok, true);
    const settled = await signer.outcome("trade:lost:0001");
    assert.equal(settled.final, true);
    assert.equal(settled.ok, false);
    assert.match(settled.error, /never landed: no node knows it and the key's nonce/);
    assert.equal((await signer.spent()).agents["a0.swarm.testnet"].spend_micro, "200000", "its reserved spend is released: 0000 and 0002 remain");
  } finally { await signer.stop(); await c.rpc.close(); }
});

test("the signer refuses operator keys that allow more, and legacy agents keep working", async () => {
  const c = await swarmChain();
  const om = JSON.parse(fs.readFileSync(path.join(c.ks, "operator-market.json"), "utf8"));
  c.rpc.st.keys.set(`${c.ops}|${om.publicKey}`, { nonce: "5", permission: { FunctionCall: { allowance: "1", receiver_id: c.market, method_names: ["anchor_rewrite", "withdraw_treasury"] } } });
  const full = KeyPair.fromRandom("ed25519");
  c.rpc.addAdminKey("old.testnet", full.getPublicKey().toString());
  const good = KeyPair.fromRandom("ed25519");
  c.rpc.st.keys.set(`ledger.testnet|${good.getPublicKey()}`, { nonce: "5", permission: { FunctionCall: { allowance: "1", receiver_id: c.market, method_names: ["buy", "sell"] } } });
  const keysFile = path.join(c.dir, "keys.json");
  fs.writeFileSync(keysFile, JSON.stringify({ agents: { "house-ledger": { accountId: "ledger.testnet", privateKey: good.toString() }, "house-old": { accountId: "old.testnet", privateKey: full.toString() } } }));
  const signer = c.client({ keysFile });
  try {
    const ready = await signer.start();
    assert.equal(ready.find((a) => a.label === "house-ledger").ok, true);
    assert.match(ready.find((a) => a.label === "house-old").error, /full-access/);
    assert.match(signer.ready.operator.market.error, /withdraw_treasury/);
    assert.match((await signer.anchor("anchor:x:0001", { claim_id: 0, version: 1, prices_hash: "a".repeat(64), request_hash: "b".repeat(64), response_hash: "c".repeat(64), signature_hex: "d".repeat(128), model: "m" })).error, /no usable operator key/);
    assert.equal(signer.accountOf("house-ledger"), "ledger.testnet");
    assert.equal((await signer.bet({ agent: "ledger.testnet", claim_id: 2, side: "yes", amount_micro: "100", min_shares_micro: "0" })).ok, true);
  } finally { await signer.stop(); await c.rpc.close(); }
});

test("config: agent keys never in the model process's environment; swarm, owners and rates checked", () => {
  assert.match(loadAiConfig({ AGENT_PRIVATE_KEY: "ed25519:x" }).errors.join(), /SIGNER_KEYS_FILE/);
  assert.match(loadAiConfig({ HOUSE_LEDGER_KEY: "ed25519:x" }).errors.join(), /SIGNER_KEYS_FILE/);
  assert.deepEqual(loadAiConfig({ SIGNER_KEYS_FILE: "/x" }).errors, []);
  assert.match(loadAiConfig({ NEARAI_BASE_URL: "http://evil.example/v1" }).errors.join(), /https/);
  assert.match(loadAiConfig({ JURY_ACCOUNT_ID: "a.near" }).errors.join(), /wrong network/);
  assert.match(loadAiConfig({ SWARM_CONTRACT_ID: "swarm.near" }).errors.join(), /wrong network/);
  assert.match(loadAiConfig({ HOUSE_OWNER_IDS: "x.near" }).errors.join(), /wrong network/);
  assert.match(loadAiConfig({ AGENT_BILLING: "free" }).errors.join(), /AGENT_BILLING/);
  assert.match(loadAiConfig({ INFERENCE_YOCTO_PER_MICRO_USD: "1.5" }).errors.join(), /yoctoNEAR/);
  const { ai } = loadAiConfig({ AGENT_BILLING_OVERRIDES: "house-quant=balance", DATA_DIR: "/d" });
  assert.equal(ai.agents.billing.overrides["house-quant"], "balance");
  assert.equal(ai.agents.billing.yoctoPerMicro, 400_000_000_000_000_000n, "testnet default: $1 = 0.4 NEAR");
  assert.equal(path.normalize(ai.agents.keystoreDir), path.normalize("/d/keystore"));
  assert.equal(DECISION_FIELDS.includes("privateKey"), false);
  assert.equal(DEFAULT_POLICY.minSellUsd, 0.05);
});

test("every house model's credence request keeps reasoning short, so the JSON fits in max_tokens", async () => {
  const { credenceRequest, DEFAULT_AGENTS } = await import("../src/agents.js");
  const kw = { "deepseek-ai/DeepSeek-V4.1-Flash-1017": { thinking: false }, "Qwen/Qwen3.8-27B": { enable_thinking: false } };
  for (const a of DEFAULT_AGENTS) {
    const r = credenceRequest(a.model, { text: "x" }, [{ url: "https://example.org", title: "t", excerpt: "e" }]);
    assert.ok(r.reasoning_effort === "low" || r.chat_template_kwargs, `${a.model} has no reasoning setting`);
    if (kw[a.model]) assert.deepEqual(r.chat_template_kwargs, kw[a.model]);
  }
});

test("the keeper's and the Checker's keys: each may do its one job, capped, and nothing else", async () => {
  const c = await swarmChain();
  const fc = (receiver_id, method_names) => ({ nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id, method_names } } });
  const checker = "checker.house.testnet";
  const kk = operatorKey(c.ks, "keeper", { accountId: c.ops, receiverId: c.market, methods: OPERATOR_METHODS.keeper }).rec;
  const ck = operatorKey(c.ks, "checker", { accountId: checker, receiverId: c.market, methods: OPERATOR_METHODS.checker }).rec;
  c.rpc.st.keys.set(`${c.ops}|${kk.publicKey}`, fc(c.market, OPERATOR_METHODS.keeper));
  c.rpc.st.keys.set(`${checker}|${ck.publicKey}`, fc(c.market, OPERATOR_METHODS.checker));
  const base = c.rpc.st.onCall;
  c.rpc.st.onCall = (x) => (x.method === "finalize" ? (c.sent.push(x), { value: false }) : x.method === "open_claim" ? (c.sent.push(x), { value: 42 }) : x.method === "challenge" ? (c.sent.push(x), { value: 3 }) : base(x));
  const signer = c.client({ dailyOpens: 2, dailyChallenges: 1 });
  try {
    await signer.start();
    const l = await signer.listAgents({ force: true });
    assert.equal(l.operator.keeper.ok, true, l.operator.keeper.error);
    assert.equal(l.operator.checker.ok, true, l.operator.checker.error);
    assert.deepEqual(l.operator.keeper.methods, ["finalize", "expire_challenge", "open_claim"]);
    const f = await signer.keep("keep:finalize:7:1", "finalize", 7);
    assert.equal(f.ok, true, f.error);
    assert.deepEqual([c.sent.at(-1).method, c.sent.at(-1).signer, c.sent.at(-1).args], ["finalize", c.ops, { challenge_id: 7 }]);
    assert.match((await signer.keep("keep:redeem:7:1", "redeem", 7)).error, /finalize or expire_challenge only/);
    const open = { text: "A corrected line.", page: "tether", kind: "document", p0_ppm: 700000, b_micro: "1450000" };
    const o = await signer.openClaim("open:18:700000:1", open);
    assert.equal(o.ok, true, o.error);
    assert.equal(o.value, 42);
    assert.deepEqual(c.sent.at(-1).args, open);
    assert.match((await signer.openClaim("open:18:bad-1", { ...open, b_micro: "9000000" })).error, /b_micro must be/);
    assert.match((await signer.openClaim("open:18:bad-2", { ...open, kind: "opinion" })).error, /kind must be/);
    assert.match((await signer.openClaim("open:18:bad-3", { ...open, text: "x".repeat(601) })).error, /at most 600 bytes/);
    assert.equal((await signer.openClaim("open:19:700000:1", open)).ok, true);
    assert.match((await signer.openClaim("open:20:700000:1", open)).error, /already opened today/, "the signer's daily cap on opened lines");
    let caps = await signer.caps();
    assert.deepEqual([caps.opens, caps.challenges], [{ used: 2, cap: 2 }, { used: 0, cap: 1 }], "the keeper can ask before it tries");
    assert.equal(caps.day, new Date().toISOString().slice(0, 10));
    const ch = await signer.challenge("checker:18:0:d", { claim_id: 18, claimed_outcome: false, evidence: "the source says otherwise" });
    assert.equal(ch.ok, true, ch.error);
    assert.equal(ch.value, 3);
    assert.deepEqual([c.sent.at(-1).method, c.sent.at(-1).signer], ["challenge", checker]);
    assert.match((await signer.challenge("checker:19:0:d", { claim_id: 19, claimed_outcome: false, evidence: "again" })).error, /already posted today/);
    caps = await signer.caps();
    assert.deepEqual(caps.challenges, { used: 1, cap: 1 }, "a refusal at the cap is not counted as a challenge");
    assert.match((await signer.challenge("checker:20:0:d", { claim_id: 20, claimed_outcome: false, evidence: "x".repeat(4001) })).error, /1\.\.4000 bytes/);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("the daily caps: SIGNER_DAILY_OPENS and SIGNER_DAILY_CHALLENGES reach the signer; unset, its defaults leave room for a day of corrected lines", () => {
  assert.ok(DAILY_OPENS >= 2 * DAILY_CHALLENGES, "a corrected line can't be stranded behind a full day of rulings");
  const base = { NEAR_NETWORK: "testnet", MARKET_CONTRACT_ID: "m.testnet" };
  const set = loadAiConfig({ ...base, SIGNER_DAILY_OPENS: "20", SIGNER_DAILY_CHALLENGES: "3" }).ai.agents;
  assert.deepEqual([set.dailyOpens, set.dailyChallenges], [20, 3]);
  const unset = loadAiConfig(base).ai.agents;
  assert.deepEqual([unset.dailyOpens, unset.dailyChallenges], [undefined, undefined]);
});

test("a keeper or Checker key that allows more than its job is refused", async () => {
  const c = await swarmChain();
  const fc = (receiver_id, method_names) => ({ nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id, method_names } } });
  const kk = operatorKey(c.ks, "keeper", { accountId: c.ops, receiverId: c.market, methods: OPERATOR_METHODS.keeper }).rec;
  c.rpc.st.keys.set(`${c.ops}|${kk.publicKey}`, fc(c.market, [...OPERATOR_METHODS.keeper, "withdraw_treasury"]));
  const ck = operatorKey(c.ks, "checker", { accountId: "checker.house.testnet", receiverId: c.market, methods: OPERATOR_METHODS.checker }).rec;
  c.rpc.st.keys.set(`checker.house.testnet|${ck.publicKey}`, fc(c.market, ["challenge", "withdraw"]));
  const signer = c.client();
  try {
    await signer.start();
    const l = await signer.listAgents({ force: true });
    assert.equal(l.operator.keeper.ok, false);
    assert.match(l.operator.keeper.error, /withdraw_treasury/);
    assert.equal(l.operator.checker.ok, false);
    assert.match(l.operator.checker.error, /withdraw/);
    assert.match((await signer.keep("keep:finalize:1:1", "finalize", 1)).error, /no usable operator key/);
    assert.match((await signer.challenge("checker:1:0:d", { claim_id: 1, claimed_outcome: false, evidence: "x" })).error, /no usable operator key/);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

// ---------- the Sentinel's key ----------

async function disputeChain() {
  const c = await swarmChain();
  const fc = (receiver_id, method_names) => ({ nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id, method_names } } });
  const sentry = "sentinel.house.testnet";
  const sk = operatorKey(c.ks, "sentinel", { accountId: sentry, receiverId: c.market, methods: OPERATOR_METHODS.sentinel }).rec;
  c.rpc.st.keys.set(`${sentry}|${sk.publicKey}`, fc(c.market, OPERATOR_METHODS.sentinel));
  // a challenge on claim 0 that the jury ruled for the challenger, and a market that does what dispute does
  c.chain = { ch: { claim_id: 0, challenger: "liar.testnet", claimed_outcome: false, bond_micro: "1000000", disputes: 0, resolved: false }, balance: "20000000" };
  c.rpc.st.claims = [{ id: 0, status: "Challenged", provisional: false, challenge_id: 4 }];
  c.rpc.st.views.set("get_challenge", () => c.chain.ch);
  c.rpc.st.views.set("get_balance", () => c.chain.balance);
  const base = c.rpc.st.onCall;
  c.rpc.st.onCall = (x) => {
    if (x.method !== "dispute") return base(x);
    c.sent.push(x);
    const claim = c.rpc.st.claims[0];
    c.chain.ch = { ...c.chain.ch, bond_micro: String(BigInt(c.chain.ch.bond_micro) * 2n), disputes: c.chain.ch.disputes + 1 };
    claim.provisional = !claim.provisional;
    return { value: c.chain.ch.disputes };
  };
  c.sentry = sentry;
  c.flip = (o) => { Object.assign(c.chain.ch, o.ch || {}); Object.assign(c.rpc.st.claims[0], o.claim || {}); };
  return c;
}
const EV = "Priced In's Sentinel disputes challenge 4: the quoted words are not at the source.";

test("the Sentinel's key disputes through the signer, from its own account, and the round, side and bond come from the chain", async () => {
  const c = await disputeChain();
  const signer = c.client({ dailyDisputes: 5, dailyDisputeMicro: 100_000_000 });
  try {
    await signer.start();
    const l = await signer.listAgents({ force: true });
    assert.equal(l.operator.sentinel.ok, true, l.operator.sentinel.error);
    assert.deepEqual(l.operator.sentinel.methods, ["dispute"]);
    const r = await signer.dispute("sentinel:dispute:4:r1:1", { challenge_id: 4, round: 1, evidence: EV });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.value, 1);
    assert.deepEqual([c.sent.at(-1).method, c.sent.at(-1).signer, c.sent.at(-1).args], ["dispute", c.sentry, { challenge_id: 4, evidence: EV }]);
    const again = await signer.dispute("sentinel:dispute:4:r1:1", { challenge_id: 4, round: 1, evidence: EV });
    assert.deepEqual([again.ok, again.replayed, c.sent.filter((x) => x.method === "dispute").length], [true, true, 1], "one intent lands once");
    assert.match((await signer.dispute("sentinel:dispute:4:r1:2", { challenge_id: 4, round: 1, evidence: EV })).error, /does not side with the challenger/, "the chain moved: a second dispute would help the liar");
    c.flip({ claim: { provisional: false } });
    assert.match((await signer.dispute("sentinel:dispute:4:r1:3", { challenge_id: 4, round: 1, evidence: EV })).error, /at round 2, not 1/);
    assert.equal((await signer.dispute("sentinel:dispute:4:r2:1", { challenge_id: 4, round: 2, evidence: EV })).ok, true);
    c.flip({ ch: { resolved: true } });
    assert.match((await signer.dispute("sentinel:dispute:4:r3:1", { challenge_id: 4, round: 3, evidence: EV })).error, /is not live/);
    c.flip({ ch: { resolved: false }, claim: { status: "Escalated" } });
    assert.match((await signer.dispute("sentinel:dispute:4:r3:2", { challenge_id: 4, round: 3, evidence: EV })).error, /can't be disputed now \(its claim is Escalated\)/);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("the dispute caps: a few a day, a dollar limit, a bond cap and the balance, each refused before anything is signed", async () => {
  const c = await disputeChain();
  const signer = c.client({ dailyDisputes: 2, dailyDisputeMicro: 6_000_000, maxDisputeBondMicro: 4_000_000 });
  const send = (n, round) => signer.dispute(`sentinel:dispute:4:r${round}:${n}`, { challenge_id: 4, round, evidence: EV });
  try {
    await signer.start();
    await signer.listAgents({ force: true });
    let caps = await signer.caps();
    assert.deepEqual(caps.disputes, { used: 0, cap: 2, used_micro: "0", cap_micro: "6000000", max_bond_micro: "4000000" });
    c.chain.balance = "1999999";
    assert.match((await send(1, 1)).error, /holds \$1\.99 in the market and the bond is \$2\.00/);
    c.chain.balance = "20000000";
    assert.equal((await send(2, 1)).ok, true);
    caps = await signer.caps();
    assert.deepEqual([caps.disputes.used, caps.disputes.used_micro], [1, "2000000"]);
    c.flip({ claim: { provisional: false }, ch: { bond_micro: "4000000", disputes: 2 } });
    assert.match((await send(3, 3)).error, /over the bond cap/, "an $8 bond is over this signer's $4 cap");
    c.flip({ claim: { provisional: false }, ch: { bond_micro: "2000000", disputes: 1 } });
    assert.equal((await send(4, 2)).ok, true);
    caps = await signer.caps();
    assert.deepEqual([caps.disputes.used, caps.disputes.used_micro], [2, "6000000"]);
    c.flip({ claim: { provisional: false }, ch: { bond_micro: "1000000", disputes: 0 } });
    assert.match((await send(5, 1)).error, /2 disputes already sent today/);
    const before = c.sent.filter((x) => x.method === "dispute").length;
    assert.equal(before, 2, "nothing was signed for a refusal");
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("today's disputes survive a restart, and one that clearly failed gives its room back", async () => {
  const c = await disputeChain();
  const send = (signer, n) => signer.dispute(`sentinel:dispute:4:r1:${n}`, { challenge_id: 4, round: 1, evidence: EV });
  const inner = c.rpc.st.onCall;
  let first = c.client({ dailyDisputes: 3, dailyDisputeMicro: 3_000_000 });
  try {
    await first.start();
    await first.listAgents({ force: true });
    c.rpc.st.onCall = (x) => (x.method === "dispute" ? { failure: "the dispute window has closed" } : inner(x));
    const failed = await send(first, 1);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /window has closed/);
    assert.deepEqual([(await first.caps()).disputes.used, (await first.caps()).disputes.used_micro], [0, "0"], "a clear failure spent nothing");
    c.rpc.st.onCall = inner;
    assert.equal((await send(first, 2)).ok, true);
    await first.stop();
    c.flip({ claim: { provisional: false }, ch: { bond_micro: "1000000", disputes: 0 } });
    first = c.client({ dailyDisputes: 3, dailyDisputeMicro: 3_000_000 });
    await first.start();
    await first.listAgents({ force: true });
    assert.deepEqual([(await first.caps()).disputes.used, (await first.caps()).disputes.used_micro], [1, "2000000"], "rebuilt from the journal");
    assert.match((await send(first, 3)).error, /would pass today's dispute limit/);
  } finally { await first.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("a dispute whose outcome is unknown holds the next one: two in one round would undo each other", async () => {
  const c = await disputeChain();
  const journal = path.join(c.dir, "signer.jsonl");
  const today = new Date().toISOString();
  const hash = "11111111111111111111111111111111";
  fs.writeFileSync(journal, [
    { t: "intent", id: "sentinel:dispute:4:r1:0", kind: "dispute", agent: c.sentry, signer: c.sentry, method: "dispute", args: { challenge_id: 4, evidence: EV }, day: today.slice(0, 10), at: today, dispute_micro: "2000000" },
    { t: "attempt", id: "sentinel:dispute:4:r1:0", hash, nonce: "6", at: today },
  ].map((x) => JSON.stringify(x)).join("\n") + "\n");
  const signer = c.client({ dailyDisputes: 3 });
  try {
    await signer.start();
    await signer.listAgents({ force: true });
    assert.match((await signer.dispute("sentinel:dispute:4:r1:1", { challenge_id: 4, round: 1, evidence: EV })).error, /still in flight/);
    assert.equal(c.sent.filter((x) => x.method === "dispute").length, 0);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("a Sentinel key that allows more than dispute is refused, and without one nothing is sent", async () => {
  const c = await disputeChain();
  const sk = operatorKey(c.ks, "sentinel", { accountId: c.sentry, receiverId: c.market, methods: OPERATOR_METHODS.sentinel }).rec;
  c.rpc.st.keys.set(`${c.sentry}|${sk.publicKey}`, { nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id: c.market, method_names: ["dispute", "withdraw"] } } });
  const signer = c.client();
  try {
    await signer.start();
    const l = await signer.listAgents({ force: true });
    assert.equal(l.operator.sentinel.ok, false);
    assert.match(l.operator.sentinel.error, /withdraw/);
    assert.match((await signer.dispute("sentinel:dispute:4:r1:1", { challenge_id: 4, round: 1, evidence: EV })).error, /no usable operator key for the sentinel/);
  } finally { await signer.stop(); await c.rpc.close(); fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test("a dispute's shape is checked, and the caps default to a few a day, $10, and a full escalation's $8 bond", () => {
  assert.deepEqual(validateDispute({ challenge_id: 4, round: 3, evidence: "x", extra: 1 }), { challenge_id: 4, round: 3, evidence: "x" });
  assert.throws(() => validateDispute({ challenge_id: -1, round: 1, evidence: "x" }), /whole number/);
  assert.throws(() => validateDispute({ challenge_id: 1, round: 4, evidence: "x" }), /round must be/);
  assert.throws(() => validateDispute({ challenge_id: 1, round: 1, evidence: "  " }), /1\.\.4000 bytes/);
  assert.throws(() => validateDispute({ challenge_id: 1, round: 1, evidence: "x".repeat(4001) }), /1\.\.4000 bytes/);
  assert.deepEqual([DAILY_DISPUTES, DAILY_DISPUTE_MICRO, MAX_DISPUTE_BOND_MICRO], [3, 10_000_000n, 8_000_000n]);
  const set = loadAiConfig({ NEAR_NETWORK: "testnet", MARKET_CONTRACT_ID: "m.testnet", SIGNER_DAILY_DISPUTES: "5", SIGNER_DAILY_DISPUTE_MICRO: "30000000", SIGNER_MAX_DISPUTE_BOND_MICRO: "16000000" }).ai.agents;
  assert.deepEqual([set.dailyDisputes, set.dailyDisputeMicro, set.maxDisputeBondMicro], [5, 30_000_000, 16_000_000]);
});
