import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NearAI, Attestor } from "../src/nearai.js";
import { Crowd, DEFAULT_POLICY } from "../src/agents.js";
import { Research } from "../src/research.js";
import { Ledger } from "../src/ledger.js";
import { Journal, journalIn } from "../src/journal.js";
import { PersonaRegistry, HOUSE_PERSONAS, personaHash } from "../src/personas.js";
import { EventHub } from "../../api/src/events.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";
import { fakeWeb, WIKI, fakeSigner, swarmAgent } from "./helpers-ai.mjs";

const CLAIM = { id: 4, page: "botany", text: "Bananas are botanically berries.", status: "Open", price_yes_ppm: 500000, cost_to_move: { up_10_points_usd: 0.669, down_10_points_usd: 0.669 } };
const H = (key) => personaHash(HOUSE_PERSONAS.find((h) => h.key === key).persona);
const credence = (p) => (body) => JSON.stringify({ p, rationale: `I put it at ${p}.`, source_url: JSON.parse(body.messages[1].content).sources[0].url });
const fresh = (trader = "alice.testnet", ppm = 500000) => ({ event: "trade", data: { claim_id: 4, trader, side: "no", price_yes_ppm: ppm }, txHash: "txA", seenAtMs: Date.now() });

async function setup({ agents, credences = {}, bank = 10, holding = {}, dir = null, startPpm = 500000, ledger: ledgerIn = null } = {}) {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
  const hub = new EventHub();
  const ledger = ledgerIn || new Ledger({ journal: journalIn(dir, "ledger.jsonl"), pricing: (m) => client.model(m) });
  for (const [m, p] of Object.entries(credences)) mock.behave(m, { content: typeof p === "function" ? p : credence(p) });
  const signer = fakeSigner(agents, { startPpm });
  const personas = new PersonaRegistry(journalIn(dir, "personas.jsonl"));
  const crowd = new Crowd({
    client, attestor, claims: { one: async () => CLAIM, all: async () => [CLAIM] }, hub, signer, ledger, personas,
    research: new Research({ fetchImpl: fakeWeb(WIKI) }), balanceOf: async () => (typeof bank === "function" ? bank() : bank),
    positionOf: async (c, a) => holding[a] || { yes: 0, no: 0 }, houseOwners: ["house.testnet"], rationales: journalIn(dir, "rationales.jsonl"),
    sweepMs: 0, freshCooldownMs: 0, signatureDeadlineMs: 600,
  });
  await crowd.refresh();
  const events = [];
  hub.subscribe((e) => { if (e.event === "agent_rationale") events.push(e.data); });
  return { mock, crowd, hub, signer, ledger, events, personas, client };
}

const house3 = () => [
  swarmAgent(0, { model: MOCK_MODELS[1], persona_hash: H("house-archivist"), label: "house-archivist" }),
  swarmAgent(1, { model: MOCK_MODELS[0], persona_hash: H("house-skeptic"), label: "house-skeptic" }),
  swarmAgent(2, { model: MOCK_MODELS[2], persona_hash: H("house-quant"), label: "house-quant" }),
];

test("a crowd round: each agent its own model, persona and credence; each trades against the price the one before it left", async () => {
  const { mock, crowd, signer, events } = await setup({ agents: house3(), credences: { [MOCK_MODELS[1]]: 0.95, [MOCK_MODELS[0]]: 0.85, [MOCK_MODELS[2]]: 0.75 } });
  try {
    assert.deepEqual(crowd.roster.map((a) => a.name), ["house-archivist", "house-skeptic", "house-quant"]);
    assert.ok(crowd.roster.every((a) => a.label === "house" && a.awake));
    assert.deepEqual(crowd.roster.map((a) => a.policy.maxBetUsd), [2, 1.5, 1], "each persona's own caps");
    const out = await crowd.onTrade(fresh());
    assert.equal(signer.trades.length, 3);
    assert.deepEqual(signer.trades.map((t) => t.agent), ["a0.swarm.testnet", "a1.swarm.testnet", "a2.swarm.testnet"], "a fixed order");
    assert.ok(signer.trades.every((t) => t.action === "buy" && t.side === "yes"));
    assert.equal(events.length, 3);
    for (let i = 1; i < events.length; i++) assert.equal(events[i].price_before, events[i - 1].price_after, "each decision sees the price the previous trade left");
    assert.deepEqual(events.map((e) => e.price_before), [0.5, 0.55, 0.6]);
    assert.ok(events.every((e) => e.tx_hash && e.source_url === "https://en.wikipedia.org/wiki/Banana" && e.provenance.status === "signed"));
    assert.equal(out.posted.length, 3);
    // the credence request: the persona is in it, the price never is
    const reqs = mock.calls.filter((c) => c.path === "/v1/chat/completions").map((c) => JSON.parse(c.bytes.toString("utf8")));
    const skeptic = reqs.find((r) => r.model === MOCK_MODELS[0]);
    assert.match(skeptic.messages[0].content, /Look first for why the claim could be false/);
    for (const r of reqs) {
      const user = JSON.parse(r.messages[1].content);
      assert.deepEqual(Object.keys(user).sort(), ["claim", "sources"], "only the claim and the sources");
      assert.ok(!/price|500000|0\.5\b|50%/.test(r.messages[1].content), "no market price reaches the model");
    }
    // metered per agent account, for billing
    assert.deepEqual([...new Set(crowd.ledger.calls.map((c) => c.agent))].sort(), ["a0.swarm.testnet", "a1.swarm.testnet", "a2.swarm.testnet"]);
    // last actions are kept
    assert.equal(crowd.ledger.actions.get("a0.swarm.testnet").kind, "yes");
  } finally { crowd.stop(); await mock.close(); }
});

test("sales: an agent holding YES sells when the price passes its credence", async () => {
  const agents = [swarmAgent(0, { model: MOCK_MODELS[2], persona_hash: H("house-quant"), label: "house-quant" })];
  const { mock, crowd, signer, events, ledger } = await setup({ agents, credences: { [MOCK_MODELS[2]]: 0.6 }, holding: { "a0.swarm.testnet": { yes: 4, no: 0 } }, startPpm: 900000 });
  try {
    await crowd.onTrade(fresh("whale.testnet", 900000));
    assert.equal(signer.trades.length, 1);
    const t = signer.trades[0];
    assert.equal(t.action, "sell");
    assert.equal(t.side, "yes");
    assert.ok(Number(t.shares_micro) > 0 && Number(t.shares_micro) <= 4_000_000);
    assert.ok(Number(t.min_proceeds_micro) > 0);
    assert.equal(t.amount_micro, undefined, "a sale carries shares, not dollars");
    assert.equal(events[0].side, "sell_yes");
    assert.match(events[0].text, /^sold .* YES shares for \$.* at 90%$/);
    assert.equal(ledger.trades("a0.swarm.testnet")[0].action, "sell");
  } finally { crowd.stop(); await mock.close(); }
});

test("'agree at N%' only when the credence sits at the price; disagree-but-can't says no_bet; unverified says nothing", async () => {
  const two = () => [swarmAgent(0, { model: MOCK_MODELS[1], persona_hash: H("house-archivist") }), swarmAgent(1, { model: MOCK_MODELS[2], persona_hash: H("house-quant") })];
  const a = await setup({ agents: two(), credences: { [MOCK_MODELS[1]]: 0.51, [MOCK_MODELS[2]]: 0.9 }, bank: 0 });
  try {
    await a.crowd.onTrade(fresh());
    assert.equal(a.signer.trades.length, 0);
    const bySide = Object.fromEntries(a.events.map((e) => [e.agent, e]));
    assert.equal(bySide["house-archivist"].side, "agree");
    assert.equal(bySide["house-archivist"].text, "agree at 50%");
    assert.equal(bySide["house-quant"].side, "no_bet", "it disagrees and has no bankroll: it never claims to agree");
    assert.match(bySide["house-quant"].text, /no bankroll/);
  } finally { a.crowd.stop(); await a.mock.close(); }
  const b = await setup({ agents: two(), credences: { [MOCK_MODELS[1]]: 0.9, [MOCK_MODELS[2]]: 0.9 } });
  try {
    b.mock.behave(MOCK_MODELS[1], { tamper: true });
    b.signer.fail = true;
    await b.crowd.onTrade(fresh());
    assert.equal(b.events.length, 1, "the tampered credence is not even posted");
    assert.equal(b.events[0].side, "no_bet");
    assert.match(b.events[0].text, /was not placed/);
    assert.equal(b.ledger.betsToday("a1.swarm.testnet").length, 0);
    assert.equal(b.ledger.actions.get("a0.swarm.testnet").kind, "unverified");
  } finally { b.crowd.stop(); await b.mock.close(); }
});

test("the roster: asleep, closed and refused agents are never driven; strangers are not house; a refilled agent wakes", async () => {
  const agents = [
    swarmAgent(0, { model: MOCK_MODELS[1], persona_hash: H("house-archivist") }),
    swarmAgent(1, { model: MOCK_MODELS[0], sleeping: true, escrow_yocto: "0" }),
    swarmAgent(2, { model: MOCK_MODELS[2], closed: true }),
    swarmAgent(3, { model: MOCK_MODELS[2], ok: false, error: "the key is not on the account" }),
    swarmAgent(4, { model: MOCK_MODELS[2], owner: "mallory.testnet", persona_hash: H("house-skeptic") }),
  ];
  const { mock, crowd, signer, ledger } = await setup({ agents, credences: { [MOCK_MODELS[1]]: 0.9, [MOCK_MODELS[2]]: 0.9 } });
  try {
    const r = Object.fromEntries(crowd.roster.map((a) => [a.accountId, a]));
    assert.equal(r["a0.swarm.testnet"].label, "house");
    assert.match(r["a1.swarm.testnet"].asleep, /escrow is empty/);
    assert.match(r["a2.swarm.testnet"].asleep, /closed/);
    assert.match(r["a3.swarm.testnet"].asleep, /not on the account/);
    assert.equal(r["a4.swarm.testnet"].label, "stranger", "a house persona is not enough: the owner must be the house");
    assert.equal(r["a4.swarm.testnet"].name, "agent-a4");
    assert.equal(crowd.unheld, 1);
    await crowd.onTrade(fresh());
    assert.deepEqual(signer.trades.map((t) => t.agent).sort(), ["a0.swarm.testnet", "a4.swarm.testnet"]);
    // a top-up: the swarm says awake again, and the next refresh wakes it
    signer.agents[1] = swarmAgent(1, { model: MOCK_MODELS[0], sleeping: false, escrow_yocto: "500" });
    await crowd.refresh();
    assert.equal(crowd.roster[1].awake, true);
    assert.equal(ledger.actions.get("a1.swarm.testnet").kind, "woke");
    signer.agents[1] = swarmAgent(1, { model: MOCK_MODELS[0], sleeping: true, escrow_yocto: "0" });
    await crowd.refresh();
    assert.equal(ledger.actions.get("a1.swarm.testnet").kind, "asleep");
  } finally { crowd.stop(); await mock.close(); }
});

test("a stranger's registered persona and limits are used; an unregistered one gets the careful default", async () => {
  const agents = [swarmAgent(7, { model: MOCK_MODELS[2], owner: "bob.testnet", persona_hash: "9".repeat(64) })];
  const { mock, crowd, personas } = await setup({ agents, credences: { [MOCK_MODELS[2]]: 0.9 } });
  try {
    assert.equal(crowd.roster[0].persona.name, "Unregistered");
    assert.equal(crowd.roster[0].persona_known, false);
    const h = personas.add({ name: "Contrarian", instructions: "Bet against crowds.", limits: { maxBetUsd: 99, kellyFraction: 0.1 } });
    crowd.signer.agents[0] = swarmAgent(7, { model: MOCK_MODELS[2], owner: "bob.testnet", persona_hash: h });
    await crowd.refresh();
    assert.equal(crowd.roster[0].persona.name, "Contrarian");
    assert.equal(crowd.roster[0].policy.maxBetUsd, 2, "a persona can't raise the house cap");
    assert.equal(crowd.roster[0].policy.kellyFraction, 0.1);
  } finally { crowd.stop(); await mock.close(); }
});

test("the crowd never answers its own agents' trades", async () => {
  const { mock, crowd, hub, signer } = await setup({ agents: house3(), credences: { [MOCK_MODELS[1]]: 0.9 } });
  try {
    crowd.start();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = crowd.stats.triggers;
    hub.publish({ uid: "own", event: "trade", data: { claim_id: 4, trader: "a1.swarm.testnet", price_yes_ppm: 500000 } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(crowd.stats.triggers, t0);
    assert.equal(signer.trades.length, 0);
  } finally { crowd.stop(); await mock.close(); }
});

test("rationales, last actions and the loss figures survive a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crowd-"));
  const agents = [swarmAgent(0, { model: MOCK_MODELS[1], persona_hash: H("house-archivist") })];
  const a = await setup({ agents, credences: { [MOCK_MODELS[1]]: 0.9 }, dir });
  try { await a.crowd.onTrade(fresh()); } finally { a.crowd.stop(); await a.mock.close(); }
  assert.equal(a.events.length, 1);
  const b = await setup({ agents, credences: { [MOCK_MODELS[1]]: 0.9 }, dir });
  try {
    const r = b.crowd.recent();
    assert.equal(r.length, 1);
    assert.equal(r[0].tx_hash, a.events[0].tx_hash);
    assert.equal(b.crowd.roster[0].last.kind, "yes");
    assert.equal(b.ledger.betsToday("a0.swarm.testnet").length, 1, "today's trades, for the loss limit, are back");
    assert.equal(b.ledger.totals()["a0.swarm.testnet"].calls, a.ledger.totals()["a0.swarm.testnet"].calls);
  } finally { b.crowd.stop(); await b.mock.close(); }
});

test("an agent that owes its bankroll an inference bill sleeps until it can pay", async () => {
  const ledger = new Ledger({ journal: new Journal(null) });
  ledger.recordIntent({ id: "bill:x:1", kind: "bill", agent: "a0.swarm.testnet", route: "balance", usage_hash: "a".repeat(64), usage_json: "{}", call_ids: [], due_micro: "1000", amount_micro: "400", carry_out_nano: "0" });
  ledger.recordOutcome("bill:x:1", { ok: true, txHash: "t" });
  const agents = [swarmAgent(0, { model: MOCK_MODELS[1], persona_hash: H("house-archivist") })];
  const { mock, crowd } = await setup({ agents, ledger });
  try {
    crowd.billingRoute = () => "balance";
    await crowd.refresh();
    assert.equal(crowd.roster[0].awake, false);
    assert.match(crowd.roster[0].asleep, /owes 600 micro-USD/);
    assert.equal(DEFAULT_POLICY.marginPoints, 0.02);
  } finally { crowd.stop(); await mock.close(); }
});
