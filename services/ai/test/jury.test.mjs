import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nacl from "tweetnacl";
import { NearAI, Attestor } from "../src/nearai.js";
import { JuryRunner, parseVerdict } from "../src/jury.js";
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
    assert.match(r.message, /a person must settle/);
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

test("verdict parsing matches the contract's order", () => {
  assert.equal(parseVerdict(Buffer.from('{"content":"VERDICT: TRUE\\nx"}')), "TRUE");
  assert.equal(parseVerdict(Buffer.from("VERDICT: FALSE")), "FALSE");
  assert.equal(parseVerdict(Buffer.from("VERDICT: INSUFFICIENT")), "INSUFFICIENT");
  assert.equal(parseVerdict(Buffer.from("no idea")), "UNPARSEABLE");
});
