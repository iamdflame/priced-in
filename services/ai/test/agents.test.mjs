import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { NearAI, Attestor } from "../src/nearai.js";
import { Swarm, decide, impliedB, buyQuote, dailyLoss, parseCredence, DEFAULT_POLICY } from "../src/agents.js";
import { Research, keywords, excerpt } from "../src/research.js";
import { SignerClient, validateDecision, checkPermission, DECISION_FIELDS } from "../src/signer.js";
import { Ledger } from "../src/ledger.js";
import { loadAiConfig } from "../src/config.js";
import { EventHub } from "../../api/src/events.mjs";
import { startMockRpc } from "../../api/test/mock-rpc.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test("policy: bets only when the edge beats fees plus 2 points", () => {
  const base = { priceYes: 0.5, b: 3, bankrollUsd: 10 };
  assert.equal(decide({ ...base, credence: 0.515 }).action, "none");
  assert.equal(decide({ ...base, credence: 0.515 }).noEdge, true);
  assert.equal(decide({ ...base, credence: 0.52 }).action, "none", "exactly 2 points is not more than 2 points");
  assert.equal(decide({ ...base, credence: 0.6 }).action, "bet");
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
  // in a thin market the size shrinks until the average price still leaves the required edge
  const thin = decide({ credence: 0.6, priceYes: 0.5, b: 0.5, bankrollUsd: 100 });
  assert.equal(thin.action, "bet");
  assert.ok(thin.amountUsd < 2 && 0.6 - thin.avgPrice > 0.019, JSON.stringify(thin));
  assert.equal(decide({ credence: 0.53, priceYes: 0.5, b: 0.1, bankrollUsd: 100 }).action, "none");
  assert.ok(Number(d.min_shares_micro) > 0 && Number(d.min_shares_micro) < buyQuote(0.5, 100, d.amountUsd).shares * 1e6);
  assert.deepEqual(decide({ credence: 0.7, priceYes: 0.41, b: 3, bankrollUsd: 7 }), decide({ credence: 0.7, priceYes: 0.41, b: 3, bankrollUsd: 7 }));
  assert.equal(decide({ credence: 0.9, priceYes: 0.5, b: 3, bankrollUsd: 0 }).action, "none");
});

test("policy: stops on the daily loss limit, marked to market", () => {
  const stopped = decide({ credence: 0.9, priceYes: 0.5, b: 3, bankrollUsd: 10, dailyLossUsd: 5 });
  assert.equal(stopped.action, "none");
  assert.equal(stopped.stopped, true);
  const claims = new Map([[1, { price_yes_ppm: 250000 }], [2, { price_yes_ppm: 500000, outcome: false }]]);
  near(dailyLoss([{ claim_id: 1, side: "yes", amount_micro: "1000000", shares_micro: "2000000" }], claims), 0.5);
  near(dailyLoss([{ claim_id: 2, side: "yes", amount_micro: "1000000", shares_micro: "2000000" }], claims), 1, 1e-9);
  near(dailyLoss([{ claim_id: 2, side: "no", amount_micro: "1000000", shares_micro: "2000000" }], claims), 0, 1e-9);
  near(dailyLoss([{ claim_id: 9, side: "no", amount_micro: "1000000", shares_micro: "2000000" }], claims), 1, 1e-9);
});

test("LMSR math matches the contract's figures", () => {
  near(impliedB(0.5, 3 * Math.log(0.5 / 0.4), 0), 3);
  near(impliedB(0.95, 0, 3 * Math.log(0.95 / 0.85)), 3);
  assert.equal(impliedB(0.5, 0, 0), null);
  // the API e2e measured a $1 NO bet on b=$3 moving 50% to 35.83%
  near(1 - buyQuote(0.5, 3, 1).priceAfter, 0.358265, 2e-4);
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

function fakeWeb(pages) {
  return async (url) => {
    const u = String(url);
    const hit = Object.keys(pages).find((k) => u.startsWith(k));
    const v = hit ? pages[hit] : { status: 404, body: "not found" };
    const body = typeof v.body === "string" ? v.body : JSON.stringify(v.body);
    return { status: v.status ?? 200, url: u, text: async () => body, json: async () => JSON.parse(body) };
  };
}

const WIKI = {
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

test("signer checks: strict decisions and function-call keys only", () => {
  const ok = { agent: "house-ledger", claim_id: 3, side: "yes", amount_micro: "2000000", min_shares_micro: "1" };
  assert.deepEqual(validateDecision(ok), ok);
  assert.throws(() => validateDecision({ ...ok, amount_micro: "2000001" }), /per-bet cap/);
  assert.throws(() => validateDecision({ ...ok, amount_micro: "0" }), /positive/);
  assert.throws(() => validateDecision({ ...ok, side: "maybe" }), /side/);
  assert.throws(() => validateDecision({ ...ok, method: "withdraw" }), /unexpected fields/);
  assert.throws(() => validateDecision(ok, { maxBetMicro: 100n }), /per-bet cap/);
  const fc = (receiver_id, method_names) => ({ permission: { FunctionCall: { receiver_id, method_names, allowance: "1" } } });
  assert.equal(checkPermission(fc("m.testnet", ["buy", "sell"]), "m.testnet"), null);
  assert.match(checkPermission({ permission: "FullAccess" }, "m.testnet"), /full-access/);
  assert.match(checkPermission(fc("other.testnet", ["buy"]), "m.testnet"), /not the market/);
  assert.match(checkPermission(fc("m.testnet", []), "m.testnet"), /every method/);
  assert.match(checkPermission(fc("m.testnet", ["buy", "withdraw"]), "m.testnet"), /withdraw/);
});

test("the signer is a separate process: it holds the keys, refuses full-access keys, and signs from decisions alone", async () => {
  const rpc = await startMockRpc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signer-"));
  const market = "market.testnet";
  const good = KeyPair.fromRandom("ed25519"), full = KeyPair.fromRandom("ed25519");
  rpc.st.keys.set(`ledger.testnet|${good.getPublicKey()}`, { nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id: market, method_names: ["buy", "sell"] } } });
  rpc.addAdminKey("archive.testnet", full.getPublicKey().toString());
  const keysFile = path.join(dir, "keys.json");
  fs.writeFileSync(keysFile, JSON.stringify({ agents: { "house-ledger": { accountId: "ledger.testnet", privateKey: good.toString() }, "house-archive": { accountId: "archive.testnet", privateKey: full.toString() } } }));
  const logs = [];
  const signer = new SignerClient({ keysFile, marketId: market, rpcUrls: [rpc.url], log: (m) => logs.push(m) });
  try {
    const accepted = await signer.start();
    assert.notEqual(signer.child.pid, process.pid);
    assert.equal(accepted.find((a) => a.agent === "house-ledger").ok, true);
    const refused = accepted.find((a) => a.agent === "house-archive");
    assert.equal(refused.ok, false);
    assert.match(refused.error, /full-access/);
    assert.equal(signer.accountOf("house-archive"), null);
    const r = await signer.bet({ agent: "house-ledger", claim_id: 7, side: "no", amount_micro: "1500000", min_shares_micro: "100", privateKey: "ignored", note: "ignored" });
    assert.equal(r.ok, true, r.error);
    assert.equal(rpc.st.outcomes.get(r.txHash).transaction.signer_id, "ledger.testnet");
    assert.equal(r.publicKey, good.getPublicKey().toString());
    assert.equal((await signer.bet({ agent: "house-ledger", claim_id: 7, side: "no", amount_micro: "2000001", min_shares_micro: "0" })).ok, false);
    assert.match((await signer.bet({ agent: "house-archive", claim_id: 7, side: "no", amount_micro: "100", min_shares_micro: "0" })).error, /no usable key/);
    const everything = JSON.stringify([logs, accepted, r]);
    for (const secret of [good.toString(), full.toString()]) assert.ok(!everything.includes(secret), "no key material comes back or is logged");
    assert.ok(!JSON.stringify(process.env).includes(good.toString()), "the keys never enter this process's environment");
  } finally { await signer.stop(); await rpc.close(); }
});

test("the daily spend cap holds inside the signer", async () => {
  const rpc = await startMockRpc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signer-"));
  const k = KeyPair.fromRandom("ed25519");
  rpc.st.keys.set(`ledger.testnet|${k.getPublicKey()}`, { nonce: "5", permission: { FunctionCall: { allowance: "1000", receiver_id: "market.testnet", method_names: ["buy"] } } });
  const keysFile = path.join(dir, "keys.json");
  fs.writeFileSync(keysFile, JSON.stringify({ agents: { a: { accountId: "ledger.testnet", privateKey: k.toString() } } }));
  const signer = new SignerClient({ keysFile, marketId: "market.testnet", rpcUrls: [rpc.url], dailySpendMicro: 3_000_000 });
  try {
    await signer.start();
    const bet = () => signer.bet({ agent: "a", claim_id: 1, side: "yes", amount_micro: "2000000", min_shares_micro: "0" });
    assert.equal((await bet()).ok, true);
    assert.match((await bet()).error, /daily spend cap/);
  } finally { await signer.stop(); await rpc.close(); }
});

test("config refuses agent keys in the model process's environment", () => {
  assert.match(loadAiConfig({ AGENT_PRIVATE_KEY: "ed25519:x" }).errors.join(), /SIGNER_KEYS_FILE/);
  assert.match(loadAiConfig({ HOUSE_LEDGER_KEY: "ed25519:x" }).errors.join(), /SIGNER_KEYS_FILE/);
  assert.deepEqual(loadAiConfig({ SIGNER_KEYS_FILE: "/x" }).errors, []);
  assert.match(loadAiConfig({ NEARAI_BASE_URL: "http://evil.example/v1" }).errors.join(), /https/);
  assert.match(loadAiConfig({ JURY_ACCOUNT_ID: "a.near" }).errors.join(), /wrong network/);
});

const CLAIM = { id: 4, page: "botany", text: "Bananas are botanically berries.", status: "Open", price_yes_ppm: 500000, cost_to_move: { up_10_points_usd: 0.669, down_10_points_usd: 0.669 } };

async function swarmSetup({ p = 0.9, credence, bank = 10, key = true } = {}) {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: key ? mock.apiKey : null, baseUrl: mock.url });
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
  const hub = new EventHub();
  const ledger = new Ledger({ pricing: (m) => client.model(m) });
  const bets = [];
  const signer = {
    accountOf: (a) => `${a}.testnet`,
    bet: async (d) => { bets.push(d); return signer.fail ? { ok: false, error: "rpc down" } : { ok: true, txHash: `tx${bets.length}`, accountId: `${d.agent}.testnet`, trade: { amount_micro: d.amount_micro, shares_micro: "1000000", price_yes_ppm_after: 600000 } }; },
  };
  const research = new Research({ fetchImpl: fakeWeb(WIKI) });
  const agents = [{ name: "house-ledger", model: MOCK_MODELS[2] }, { name: "house-archive", model: MOCK_MODELS[1] }];
  for (const a of agents) mock.behave(a.model, { content: credence ?? ((body) => JSON.stringify({ p, rationale: "The source says so.", source_url: JSON.parse(body.messages[1].content).sources[0].url })) });
  const swarm = new Swarm({ agents, client, attestor, claims: { one: async () => CLAIM, all: async () => [CLAIM] }, hub, signer, ledger, research, balanceOf: async () => bank, sweepMs: 0, freshCooldownMs: 0, signatureDeadlineMs: 600 });
  const events = [];
  hub.subscribe((e) => { if (e.event === "agent_rationale") events.push(e.data); });
  return { mock, swarm, hub, signer, bets, events, ledger };
}
const fresh = (trader = "alice.testnet", ppm = 500000) => ({ event: "trade", data: { claim_id: 4, trader, side: "no", price_yes_ppm: ppm }, txHash: "txA" });

test("the loop: research, signed credence, policy, then only a decision object reaches the signer", async () => {
  const { mock, swarm, bets, events, ledger } = await swarmSetup();
  try {
    const out = await swarm.onTrade(fresh());
    assert.equal(out.posted.length, 2);
    assert.equal(bets.length, 2);
    for (const d of bets) assert.deepEqual(Object.keys(d).sort(), [...DECISION_FIELDS].sort(), "the signer receives the decision object and nothing else");
    const e = events[0];
    assert.equal(e.label, "house");
    assert.equal(e.side, "yes");
    assert.ok(e.size_usd > 0 && e.size_usd <= 2);
    assert.ok(e.tx_hash && e.model && e.agent);
    assert.equal(e.source_url, "https://en.wikipedia.org/wiki/Banana");
    assert.equal(e.source_checked.status, 200);
    assert.equal(e.provenance.status, "signed");
    assert.equal(e.provenance.signature_kind, "provider_tee");
    assert.notEqual(e.provenance.signing_address, undefined);
    const calls = ledger.data.calls.filter((c) => c.purpose === "credence");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(new Set(ledger.data.calls.map((c) => c.agent)).size, 2, "metered per agent");
    assert.ok(ledger.totals()["house-ledger"].cost_usd > 0 && calls.length >= 1);
    assert.equal(ledger.betsToday("house-ledger").length, 1);
    assert.ok(mock.calls.some((c) => c.path === "/v1/attestation/report"));
  } finally { swarm.stop(); await mock.close(); }
});

test("no edge on a fresh trade: one agent says 'agree at N%' with its source", async () => {
  const { mock, swarm, bets, events } = await swarmSetup({ p: 0.51 });
  try {
    await swarm.onTrade(fresh());
    assert.equal(bets.length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].side, "agree");
    assert.equal(events[0].text, "agree at 50%");
    assert.equal(events[0].source_url, "https://en.wikipedia.org/wiki/Banana");
    assert.equal(events[0].size_usd, 0);
  } finally { swarm.stop(); await mock.close(); }
});

test("an agent that disagrees but cannot bet never claims to agree", async () => {
  const a = await swarmSetup({ p: 0.9, bank: 0 });
  try {
    await a.swarm.onTrade(fresh());
    assert.equal(a.events.length, 1);
    assert.equal(a.events[0].side, "no_bet");
    assert.match(a.events[0].text, /no bankroll/);
  } finally { a.swarm.stop(); await a.mock.close(); }
  const b = await swarmSetup({ p: 0.9 });
  try {
    b.signer.fail = true;
    await b.swarm.onTrade(fresh());
    assert.equal(b.events.length, 1);
    assert.equal(b.events[0].side, "no_bet");
    assert.equal(b.events[0].tx_hash, null);
    assert.equal(b.ledger.betsToday("house-ledger").length, 0);
  } finally { b.swarm.stop(); await b.mock.close(); }
});

test("no verified signature, no bet: a tampered credence is not even posted", async () => {
  const a = await swarmSetup({ p: 0.9 });
  try {
    for (const m of [MOCK_MODELS[1], MOCK_MODELS[2]]) a.mock.behave(m, { tamper: true });
    await a.swarm.onTrade(fresh());
    assert.equal(a.bets.length, 0);
    assert.equal(a.events.length, 0);
  } finally { a.swarm.stop(); await a.mock.close(); }
  const b = await swarmSetup({ p: 0.9 });
  try {
    for (const m of [MOCK_MODELS[1], MOCK_MODELS[2]]) b.mock.behave(m, { noSignature: true });
    await b.swarm.onTrade(fresh());
    assert.equal(b.bets.length, 0);
    assert.equal(b.events[0].side, "no_bet");
    assert.equal(b.events[0].provenance.verified, false);
  } finally { b.swarm.stop(); await b.mock.close(); }
});

test("agents never answer their own trades, and with no working source they stay silent", async () => {
  const { mock, swarm, hub, bets, events } = await swarmSetup();
  try {
    swarm.start();
    hub.publish({ uid: "own", event: "trade", data: { claim_id: 4, trader: "house-ledger.testnet", price_yes_ppm: 500000 } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(swarm.stats.triggers, 0);
    swarm.research = new Research({ fetchImpl: async () => { throw new Error("offline"); } });
    await swarm.onTrade(fresh());
    assert.equal(bets.length, 0);
    assert.equal(events.length, 0, "no rationale without a URL that answers 200");
  } finally { swarm.stop(); await mock.close(); }
});

test("the daily loss limit stops an agent inside the loop", async () => {
  const { mock, swarm, bets, ledger } = await swarmSetup({ p: 0.9 });
  try {
    swarm.claims.all = async () => [{ ...CLAIM, price_yes_ppm: 10000, id: 4 }];
    for (const agent of ["house-ledger", "house-archive"]) await ledger.recordBet({ agent, claim_id: 4, side: "yes", amount_micro: "6000000", shares_micro: "6000000" });
    await swarm.onTrade(fresh());
    assert.equal(bets.length, 0);
    assert.equal(DEFAULT_POLICY.dailyLossLimitUsd, 5);
  } finally { swarm.stop(); await mock.close(); }
});
