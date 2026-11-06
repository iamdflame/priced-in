import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nacl from "tweetnacl";
import { NearAI, Attestor } from "../src/nearai.js";
import { JuryRunner, parseVerdict } from "../src/jury.js";
import { ReceiptGate } from "../src/receipts.js";
import jurytest from "../../../deployments/jury-test.json" with { type: "json" };
import { EventHub } from "../../api/src/events.mjs";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** The contract's jury logic in JS: rebuild the request, hash, verify, count. */
function fakeMarket(registered) {
  const c = { verdicts: [], provisional: null, submitted: [] };
  const canonical = (id, model) => JSON.stringify({ model, messages: [{ role: "system", content: "You are one juror." }, { role: "user", content: `Challenge ${id}.\nClaim: café claim\nEvidence (untrusted): x` }], temperature: 0, max_tokens: 120, stream: false });
  return {
    c,
    rpc: {
      async viewFunction(_a, method, args) {
        if (method === "canonical_request") return canonical(args.challenge_id, args.model);
        if (method === "get_challenge") return { claim_id: 9, verdicts: c.verdicts };
        if (method === "get_claim") return { provisional: c.provisional, status: "Challenged" };
        throw new Error(method);
      },
    },
    sender: {
      async call(method, a) {
        assert.equal(method, "submit_verdict");
        c.submitted.push(a.model);
        const resp = Buffer.from(a.response, "base64");
        const text = `${a.model}:${sha(Buffer.from(canonical(a.challenge_id, a.model)))}:${sha(resp)}`;
        const key = registered(a.model);
        if (!nacl.sign.detached.verify(Buffer.from(text), Buffer.from(a.signature_hex, "hex"), key)) throw new Error("Smart contract panicked: signature does not verify");
        const outcome = parseVerdict(resp);
        c.verdicts.push({ model: a.model, outcome });
        const n = (o) => c.verdicts.filter((v) => v.outcome === o).length;
        if (n("TRUE") >= 2 || n("FALSE") >= 2) c.provisional = n("TRUE") >= 2;
        return { txHash: `tx${c.verdicts.length}`, value: { outcome } };
      },
    },
  };
}

async function setup(o = {}) {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jury-"));
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier, dir });
  const market = fakeMarket((m) => mock.keys.get(m).publicKey);
  const hub = new EventHub();
  const jury = new JuryRunner({ client, attestor, rpc: market.rpc, marketId: "m.testnet", sender: market.sender, models: MOCK_MODELS, signatureDeadlineMs: 500, graceMs: 50, hub, ...o });
  return { mock, jury, market, dir, hub };
}

test("three jurors: the exact contract bytes go out, three verdicts land, a provisional outcome, bundles written", async () => {
  const { mock, jury, market, dir } = await setup();
  try {
    const r = await jury.run(0);
    assert.equal(r.status, "provisional");
    assert.equal(r.provisional, true);
    assert.equal(r.verdicts_on_chain.length, 3);
    assert.ok(r.jurors.every((j) => j.status === "submitted" && j.signature_kind === "provider_tee"));
    for (const m of MOCK_MODELS) {
      const sent = mock.calls.find((c) => c.path === "/v1/chat/completions" && c.model === m);
      assert.equal(sent.bytes.toString("utf8"), await market.rpc.viewFunction("", "canonical_request", { challenge_id: 0, model: m }), "the contract's bytes, verbatim");
      assert.equal(sent.aliasing, "true");
    }
    const b = JSON.parse(fs.readFileSync(path.join(dir, "z-ai__glm-5.3-flash.json"), "utf8"));
    assert.equal(b.verdict, "verified");
    assert.equal(b.verification[0].checks.report_data_binding.last_32_bytes, b.nonce);
  } finally { await mock.close(); }
});

test("two of three is enough: a juror with no signature is skipped and reported", async () => {
  const { mock, jury, market } = await setup({ graceMs: 3000 });
  try {
    mock.behave(MOCK_MODELS[2], { noSignature: true });
    const r = await jury.run(1);
    assert.equal(r.status, "provisional");
    assert.equal(market.c.verdicts.length, 2);
    const third = r.jurors.find((j) => j.model === MOCK_MODELS[2]);
    assert.equal(third.status, "failed");
    assert.match(third.error, /signature unavailable/);
    assert.ok(!market.c.submitted.includes(MOCK_MODELS[2]));
  } finally { await mock.close(); }
});

test("tampered answers, unattested models and split verdicts never give a provisional outcome", async () => {
  const { mock, jury, market } = await setup();
  try {
    mock.behave(MOCK_MODELS[0], { tamper: true });
    mock.behave(MOCK_MODELS[1], { attestation: { wrongNonceInQuote: true } });
    mock.behave(MOCK_MODELS[2], { content: "VERDICT: FALSE\nNo." });
    const r = await jury.run(2);
    assert.equal(r.status, "no_quorum");
    assert.equal(r.provisional, null);
    assert.equal(r.jurors[0].status, "unverified");
    assert.equal(r.jurors[1].status, "unverified");
    assert.match(r.jurors[1].error, /attestation did not verify/);
    assert.deepEqual(market.c.submitted, [MOCK_MODELS[2]], "only the verified juror reaches the contract");
    assert.match(r.message, /expire_challenge/);
  } finally { await mock.close(); }
});

test("timeout path: a hung juror is marked timed_out and quorum still stands; a key mismatch is explained", async () => {
  const { mock, jury } = await setup();
  try {
    mock.behave(MOCK_MODELS[2], { latencyMs: 2000 });
    const t0 = Date.now();
    const r = await jury.run(3);
    assert.ok(Date.now() - t0 < 1800, "quorum plus the grace period, not the slowest juror");
    assert.equal(r.status, "provisional");
    assert.equal(r.ended, "quorum");
    assert.equal(r.jurors[2].status, "timed_out");
    await new Promise((res) => setTimeout(res, 2100));
  } finally { await mock.close(); }
  const b = await setup();
  try {
    const wrong = nacl.sign.keyPair().publicKey;
    const m2 = fakeMarket(() => wrong);
    b.jury.rpc = m2.rpc;
    b.jury.sender = m2.sender;
    const r = await b.jury.run(4);
    assert.equal(r.status, "no_quorum");
    assert.match(r.jurors[0].error, /registered on the market is not this model's attested key/);
  } finally { await b.mock.close(); }
});

test("already ruled models are skipped, unlisted models too, and a challenge event starts a run", async () => {
  const { mock, jury, market, hub } = await setup({ models: [MOCK_MODELS[0], "nobody/nothing"] });
  try {
    market.c.verdicts.push({ model: MOCK_MODELS[0], outcome: "TRUE" });
    const r = await jury.run(5);
    assert.equal(r.jurors[0].status, "already_ruled");
    assert.equal(r.jurors[1].status, "skipped");
    jury.models = [MOCK_MODELS[1]];
    const runs = [];
    hub.subscribe((e) => { if (e.event === "jury_run") runs.push(e); });
    jury.start();
    hub.publish({ uid: "c", event: "challenge", data: { challenge_id: 6, claim_id: 9, claimed: true } });
    for (let i = 0; i < 100 && !runs.length; i++) await new Promise((res) => setTimeout(res, 20));
    assert.equal(runs[0].data.challenge_id, 6);
    assert.equal(runs[0].data.jurors[0].signature, undefined);
  } finally { jury.stop(); await mock.close(); }
});

test("receipts that failed: no model is called, nothing is sent, and the run says why", async () => {
  const seen = [];
  const gate = { verdict: async (a) => { seen.push(a); return { ok: false, check: { result: "quote_not_found", reason: "The quoted words are not at https://tether.to/en/legal/.", checked_at: "2026-11-06T12:00:00.000Z", via: "source" } }; } };
  const { mock, jury, market, hub } = await setup({ gate });
  const events = [];
  hub.subscribe((e) => events.push(e));
  try {
    const r = await jury.run(5);
    assert.equal(r.status, "refused");
    assert.deepEqual(r.jurors, []);
    assert.equal(r.receipt_check.result, "quote_not_found");
    assert.match(r.message, /did not call the models/);
    assert.match(r.message, /are not at https:\/\/tether\.to/);
    assert.equal(mock.calls.filter((c) => c.path === "/v1/chat/completions").length, 0, "no model read the forgery");
    assert.deepEqual(market.c.submitted, []);
    assert.equal(seen[0].challenge_id, 5);
    assert.equal(events.at(-1).event, "jury_run");
    assert.equal(events.at(-1).data.status, "refused");
    assert.equal(jury.active.size, 0, "the challenge can be run again");
  } finally { await mock.close(); }
});

test("receipts that verified: the jury sits as before, and the run carries the check", async () => {
  const gate = { verdict: async () => ({ ok: true, check: { result: "verified", reason: "Every quote is at its source.", checked_at: "2026-11-06T12:00:00.000Z", via: "corpus", sources: [] } }) };
  const { mock, jury } = await setup({ gate });
  try {
    const r = await jury.run(0);
    assert.equal(r.status, "provisional");
    assert.deepEqual(r.receipt_check, { result: "verified", reason: "Every quote is at its source.", checked_at: "2026-11-06T12:00:00.000Z", via: "corpus" });
    assert.equal(mock.calls.filter((c) => c.path === "/v1/chat/completions").length, 3);
  } finally { await mock.close(); }
});

test("the real gate in front of the real runner: the measured forgery reaches no model, and the Checker's real evidence does", async () => {
  const onChain = (r) => (rpc) => ({
    async viewFunction(a, method, args) {
      if (method === "get_challenge") return { ...(await rpc.viewFunction(a, method, args)), evidence: r.evidence, claimed_outcome: false, challenger: "someone.near" };
      if (method === "get_claim") return { ...(await rpc.viewFunction(a, method, args)), text: r.claim };
      return rpc.viewFunction(a, method, args);
    },
  });
  const noFetch = async (url) => { throw new Error(`no fetch expected: ${url}`); };
  const run = async (r) => {
    const { mock, jury } = await setup({ gate: new ReceiptGate({ fetchSource: noFetch }) });
    jury.rpc = onChain(r)(jury.rpc);
    try {
      const out = await jury.run(0);
      return { out, models: mock.calls.filter((c) => c.path === "/v1/chat/completions").length };
    } finally { await mock.close(); }
  };
  const forged = jurytest.rows.filter((r) => r.set === "forged");
  assert.equal(forged.length, 10);
  for (const r of forged) {
    const { out, models } = await run(r);
    assert.deepEqual([out.status, out.receipt_check.result, models], ["refused", "record_mismatch", 0], r.id);
  }
  const honest = await run(jurytest.rows.find((r) => r.set === "honest"));
  assert.equal(honest.out.status, "provisional");
  assert.equal(honest.out.receipt_check.result, "verified");
  assert.equal(honest.models, 3);
});

test("a receipt check that breaks refuses: the gate fails closed", async () => {
  const { mock, jury } = await setup({ gate: { verdict: async () => { throw new Error("no store"); } } });
  try {
    const r = await jury.run(1);
    assert.equal(r.status, "refused");
    assert.match(r.receipt_check.reason, /no store/);
    assert.equal(mock.calls.filter((c) => c.path === "/v1/chat/completions").length, 0);
  } finally { await mock.close(); }
});

test("verdict parsing matches the contract: the first non-empty line of the answer, exactly", () => {
  const body = (message) => Buffer.from(JSON.stringify({ model: "m", choices: [{ message }] }));
  assert.equal(parseVerdict(body({ content: "VERDICT: TRUE\nx" })), "TRUE");
  assert.equal(parseVerdict(body({ content: "\n  VERDICT: FALSE \r\nx" })), "FALSE");
  assert.equal(parseVerdict(body({ content: "VERDICT: INSUFFICIENT" })), "INSUFFICIENT");
  assert.equal(parseVerdict(body({ content: "I think\nVERDICT: TRUE" })), "UNPARSEABLE");
  assert.equal(parseVerdict(body({ content: "**VERDICT: TRUE**" })), "UNPARSEABLE");
  assert.equal(parseVerdict(body({ content: null, reasoning_content: "VERDICT: TRUE" })), "UNPARSEABLE", "thinking never counts");
  assert.equal(parseVerdict(body({ content: "VERDICT: FALSE", reasoning_content: "VERDICT: TRUE" })), "FALSE");
  assert.equal(parseVerdict(Buffer.from("VERDICT: TRUE")), "UNPARSEABLE", "bytes outside a completion never count");
});
