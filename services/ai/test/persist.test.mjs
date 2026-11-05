import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Journal, journalIn } from "../src/journal.js";
import { Ledger } from "../src/ledger.js";
import { NearAI, Attestor, verifyProvenance } from "../src/nearai.js";
import { Writer } from "../src/writer.js";
import { EventHub } from "../../api/src/events.mjs";
import { RewriteStore } from "../../api/src/rewrites.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";
import { waitFor } from "./helpers-ai.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "persist-"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("journal: a torn last line from a crash is cut off, never glued to the next record", () => {
  const f = path.join(tmp(), "j.jsonl");
  fs.writeFileSync(f, '{"a":1}\n{"a":2}\n{"a":3,"tor');
  const j = new Journal(f);
  assert.equal(j.torn, 1);
  assert.deepEqual(j.read(), [{ a: 1 }, { a: 2 }]);
  j.append({ a: 4 });
  assert.deepEqual(new Journal(f).read(), [{ a: 1 }, { a: 2 }, { a: 4 }]);
  j.rewrite([{ b: 1 }]);
  assert.deepEqual(new Journal(f).read(), [{ b: 1 }]);
  assert.deepEqual(new Journal(null).read(), [], "no directory: in memory only");
});

test("ledger: calls, intents, outcomes, bills and last actions are rebuilt exactly after a restart", async () => {
  const dir = tmp();
  const pricing = async () => ({ pricing: { prompt: "0.000001", completion: "0.00001" } });
  const a = new Ledger({ journal: journalIn(dir, "ledger.jsonl"), pricing });
  await a.recordCall({ agent: "x.testnet", purpose: "credence 1", completion: { model: "m", chatId: "c1", requestBytes: Buffer.from("r"), usage: { prompt_tokens: 100, completion_tokens: 10 } } });
  a.recordIntent({ id: "trade:1", kind: "trade", agent: "x.testnet", claim_id: 1, decision: { action: "buy", side: "yes" } });
  a.recordOutcome("trade:1", { ok: true, txHash: "T1", value: { claim_id: 1, side: "yes", amount_micro: "700000", shares_micro: "1500000" } });
  a.recordIntent({ id: "trade:2", kind: "trade", agent: "x.testnet", claim_id: 1, decision: { action: "sell", side: "yes" } });
  a.recordOutcome("trade:2", { ok: true, txHash: "T2", value: { claim_id: 1, side: "sell_yes", amount_micro: "300000", shares_micro: "500000" } });
  a.recordIntent({ id: "trade:3", kind: "trade", agent: "x.testnet", claim_id: 1 });
  a.recordOutcome("trade:3", { ok: false, final: false, error: "sent, outcome unknown" });
  a.recordAction("x.testnet", { kind: "sell_yes", claim_id: 1 });
  const b = new Ledger({ journal: journalIn(dir, "ledger.jsonl"), pricing });
  assert.equal(a.calls[0].nano_usd, 200_000, "100 x $1e-6 + 10 x $1e-5 = $0.0002");
  assert.deepEqual(b.totals(), a.totals());
  assert.deepEqual(b.pnl(), a.pnl());
  assert.equal(b.pnl()["x.testnet"].cost_micro, 700000n);
  assert.equal(b.pnl()["x.testnet"].proceeds_micro, 300000n);
  assert.equal(b.pnl()["x.testnet"].positions["1"].yes, 1_000_000n);
  assert.deepEqual(b.pending().map((p) => p.id), ["trade:3"]);
  assert.equal(b.actions.get("x.testnet").kind, "sell_yes");
  assert.equal(b.betsToday("x.testnet").length, 2);
  await b.recordCall({ agent: "x.testnet", purpose: "p", completion: { model: "m", chatId: "c2", requestBytes: Buffer.from("r"), usage: null } });
  assert.notEqual(b.calls[1].id, b.calls[0].id, "call ids keep counting after a restart");
  assert.equal(b.calls[1].nano_usd, null, "no usage, no cost");
});

const CLAIMS = [{ id: 0, page: "p", text: "Bananas are botanically berries.", price_yes_ppm: 500000 }];
async function writerSetup(dir, anchors, mock) {
  const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier });
  const hub = new EventHub(), store = new RewriteStore();
  const claims = { one: async (id) => CLAIMS.find((c) => c.id === id), byPage: async () => CLAIMS };
  const anchor = async (intent, args) => { anchors.push({ intent, args }); return anchors.fail ? { ok: false, final: true, error: "unknown model" } : { ok: true, final: true, txHash: `A${anchors.length}` }; };
  const writer = new Writer({ client, attestor, model: MOCK_MODELS[2], store, hub, claims, signatureDeadlineMs: 2000, journal: journalIn(dir, "rewrites.jsonl"), anchor });
  return { writer, store, hub };
}
const trade = (ppm, n) => ({ uid: `t${n}`, event: "trade", data: { claim_id: 0, trader: "alice.testnet", price_yes_ppm: ppm }, txHash: `tx${n}` });

test("writer: every signed rewrite is anchored once with its prices hash; after a restart the store is back and versions continue", async () => {
  const dir = tmp();
  const mock = await startMockNearAI();
  const anchors = [];
  try {
    const a = await writerSetup(dir, anchors, mock);
    await a.writer.onTrade(trade(300000, 1));
    const rec = await waitFor(() => a.store.byPage("p")[0]?.anchor?.status === "anchored" && a.store.byPage("p")[0]);
    assert.equal(anchors.length, 1);
    const { intent, args } = anchors[0];
    assert.equal(intent, `anchor:${rec.id}`, "a deterministic intent id: a retry can't anchor twice");
    assert.equal(args.prices_hash, sha(rec.prices_canonical), "prices_hash is the sha256 of the prices it was written from");
    assert.deepEqual(JSON.parse(rec.prices_canonical).prices, [[0, 300000]]);
    assert.equal(args.request_hash, rec.provenance.request_hash);
    assert.equal(args.response_hash, rec.provenance.response_hash);
    assert.match(args.signature_hex, /^[0-9a-f]{128}$/);
    assert.equal(args.model, MOCK_MODELS[2]);
    assert.equal(args.version, 1);
    assert.ok(verifyProvenance(rec.provenance, { signing_address: mock.signerHex(MOCK_MODELS[2]) }).ok);
    // restart
    const b = await writerSetup(dir, anchors, mock);
    assert.equal(b.writer.restored, 1);
    const back = b.store.byPage("p")[0];
    assert.equal(back.id, rec.id);
    assert.equal(back.anchor.tx_hash, "A1");
    assert.equal(back.provenance.response_b64, rec.provenance.response_b64, "the bytes that prove it are kept");
    assert.equal(await b.writer.reanchor(), 0, "nothing to re-anchor");
    await b.writer.onTrade(trade(900000, 2));
    await waitFor(() => b.store.byPage("p")[0]?.version === 2 && b.store.byPage("p")[0].anchor?.status === "anchored");
    assert.equal(b.store.byPage("p", { history: true })[0].versions.length, 2, "version 2, not a second version 1");
    // an anchor that failed is retried after a restart, with the same intent id
    anchors.fail = true;
    await b.writer.onTrade(trade(100000, 3));
    await waitFor(() => b.store.byPage("p")[0]?.version === 3 && b.store.byPage("p")[0].anchor?.status === "failed");
    anchors.fail = false;
    const c = await writerSetup(dir, anchors, mock);
    assert.equal(await c.writer.reanchor(), 1);
    assert.equal(anchors.at(-1).intent, anchors.at(-2).intent);
    assert.equal(c.store.byPage("p")[0].anchor.status, "anchored");
    a.writer.stop(); b.writer.stop(); c.writer.stop();
  } finally { await mock.close(); }
});
