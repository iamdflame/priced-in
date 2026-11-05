import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NearAI, Attestor, attestedCompletion, verifyResponseSignature, verifyModelReport, verifyProvenance,
  expectedSignedText, judgeSignature, provenanceOf, costOf, parseTdxQuote, dcapQuoteVerifier, replayRtmr3,
} from "../src/nearai.js";
import { startMockNearAI, MOCK_MODELS } from "./mock-nearai.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const M = MOCK_MODELS[2];

async function setup() {
  const mock = await startMockNearAI();
  const client = new NearAI({ apiKey: mock.apiKey, baseUrl: mock.url });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "att-"));
  const attestor = new Attestor({ client, quoteVerifier: mock.quoteVerifier, gpuVerifier: mock.gpuVerifier, dir });
  return { mock, client, attestor, dir };
}

test("chat keeps the exact request bytes it sent and the response bytes before parsing", async () => {
  const { mock, client } = await setup();
  try {
    const body = `{"model":"${M}","messages":[{"role":"user","content":"café \\u00e9  spaced"}],"temperature":0,"stream":false}`;
    const c = await client.chat(body);
    const seen = mock.calls.find((x) => x.path === "/v1/chat/completions");
    assert.equal(Buffer.compare(seen.bytes, c.requestBytes), 0, "the server received exactly our bytes");
    assert.equal(c.requestBytes.toString("utf8"), body, "a string body is sent byte for byte, never re-serialized");
    assert.equal(seen.aliasing, "true", "x-no-aliasing: true is sent");
    assert.ok(c.chatId.startsWith("chatcmpl-"));
    assert.equal(JSON.parse(c.responseBytes.toString()).id, c.chatId);
    await assert.rejects(client.chat({ model: M, messages: [], stream: true }), /non-streamed/);
  } finally { await mock.close(); }
});

test("a provider_tee signature verifies over the exact bytes against the attested signer", async () => {
  const { mock, client, attestor } = await setup();
  try {
    const pre = await attestor.ensure(M);
    assert.equal(pre.ok, true, pre.failures.join("; "));
    assert.equal(pre.verifiedSigners[0].signing_address, mock.signerHex(M));
    const c = await client.chat({ model: M, messages: [{ role: "user", content: "hi" }], stream: false });
    const sig = await client.signature(c.chatId);
    assert.equal(sig.signature_kind, "provider_tee");
    assert.equal(sig.text, `${M}:${sha(c.requestBytes)}:${sha(c.responseBytes)}`);
    assert.equal(sig.text, expectedSignedText(M, c.requestBytes, c.responseBytes));
    assert.deepEqual(verifyResponseSignature({ signature: sig, requestBytes: c.requestBytes, responseBytes: c.responseBytes, model: M, signer: pre.verifiedSigners[0] }).ok, true);
    assert.equal(judgeSignature(sig, c, pre).status, "signed");
  } finally { await mock.close(); }
});

test("tampered responses, wrong signers and gateway signatures are never 'signed'", async () => {
  const { mock, client, attestor } = await setup();
  try {
    const pre = await attestor.ensure(M);
    const ask = async () => {
      const c = await client.chat({ model: M, messages: [{ role: "user", content: "hi" }], stream: false });
      return { c, sig: await client.signature(c.chatId) };
    };
    // 1. bytes changed after signing (on our side)
    let { c, sig } = await ask();
    const tampered = { ...c, responseBytes: Buffer.from(c.responseBytes.toString().replace("ok", "OK")) };
    assert.equal(judgeSignature(sig, tampered, pre).status, "unverified");
    assert.match(judgeSignature(sig, tampered, pre).reason, /does not match the exact request\/response bytes/);
    // 2. a request different from what was signed
    assert.equal(judgeSignature(sig, { ...c, requestBytes: Buffer.from(c.requestBytes.toString() + " ") }, pre).status, "unverified");
    // 3. the service signed other bytes than it sent
    mock.behave(M, { tamper: true });
    ({ c, sig } = await ask());
    assert.equal(judgeSignature(sig, c, pre).status, "unverified");
    // 4. a valid signature by a key that is not the attested one
    mock.behave(M, { tamper: false, wrongSigner: true });
    ({ c, sig } = await ask());
    assert.match(judgeSignature(sig, c, pre).reason, /does not match the verified preflight/);
    // 5. a gateway signature is not model-level evidence
    mock.behave(M, { wrongSigner: false, gatewaySigned: true });
    ({ c, sig } = await ask());
    assert.equal(judgeSignature(sig, c, pre).status, "unverified");
    // 6. a forged signature string
    mock.behave(M, { gatewaySigned: false });
    ({ c, sig } = await ask());
    const forged = { ...sig, signature: sig.signature.replace(/^./, (x) => (x === "0" ? "1" : "0")) };
    assert.match(judgeSignature(forged, c, pre).reason, /does not verify/);
    assert.equal(judgeSignature(sig, c, pre).status, "signed", "and the honest one still verifies");
  } finally { await mock.close(); }
});

test("signature fetch: a short bounded retry on 404, then signature_unavailable", async () => {
  const { mock, client } = await setup();
  try {
    mock.behave(M, { signatureDelayMs: 700 });
    let c = await client.chat({ model: M, messages: [{ role: "user", content: "hi" }], stream: false });
    const t0 = Date.now();
    const sig = await client.signature(c.chatId, { deadlineMs: 4000 });
    assert.ok(sig.signature && Date.now() - t0 >= 600, "it waited for the late signature");
    mock.behave(M, { noSignature: true });
    c = await client.chat({ model: M, messages: [{ role: "user", content: "hi" }], stream: false });
    const t1 = Date.now();
    await assert.rejects(client.signature(c.chatId, { deadlineMs: 1500 }), (e) => e.code === "signature_unavailable");
    assert.ok(Date.now() - t1 < 3500, "the retry is bounded");
  } finally { await mock.close(); }
});

test("attestedCompletion: preflight first, then unsigned at once, then signed when the signature arrives", async () => {
  const { mock, client, attestor } = await setup();
  try {
    mock.behave(M, { signatureDelayMs: 300 });
    const r = await attestedCompletion({ client, attestor, body: { model: M, messages: [{ role: "user", content: "x" }], stream: false } });
    const order = mock.calls.map((x) => x.path);
    assert.ok(order.indexOf("/v1/attestation/report") < order.indexOf("/v1/chat/completions"), "attestation is fetched before the completion");
    assert.equal(r.unsigned.status, "unsigned");
    assert.equal(r.unsigned.verified, false);
    const s = await r.signed;
    assert.equal(s.provenance.status, "signed");
    assert.equal(s.provenance.signing_address, mock.signerHex(M));
    const rec = { ...s.provenance, request_b64: r.completion.requestBytes.toString("base64"), response_b64: r.completion.responseBytes.toString("base64") };
    assert.deepEqual(verifyProvenance(rec), { ok: true, reasons: [] });
    const bad = { ...rec, response_b64: Buffer.from(r.completion.responseBytes.toString().replace("ok", "no")).toString("base64") };
    assert.equal(verifyProvenance(bad).ok, false);
    mock.behave(M, { noSignature: true });
    const r2 = await attestedCompletion({ client, attestor, body: { model: M, messages: [{ role: "user", content: "y" }], stream: false }, signatureDeadlineMs: 600 });
    const s2 = await r2.signed;
    assert.equal(s2.provenance.status, "unsigned");
    assert.equal(s2.provenance.verified, false);
  } finally { await mock.close(); }
});

test("attestation: every check passes on an honest report and the bundle shows the key and nonce binding", async () => {
  const { mock, attestor, dir } = await setup();
  try {
    const pre = await attestor.preflight(M);
    assert.equal(pre.ok, true);
    const bundle = JSON.parse(fs.readFileSync(pre.bundlePath, "utf8"));
    assert.equal(bundle.nonce, pre.nonce);
    assert.match(bundle.nonce, /^[0-9a-f]{64}$/);
    const rd = bundle.verification[0].checks.report_data_binding;
    assert.equal(rd.ok, true);
    assert.equal(rd.first_32_bytes, mock.signerHex(M));
    assert.equal(rd.last_32_bytes, pre.nonce);
    for (const k of ["signer", "nonce_echo", "intel_quote", "debug_off", "report_data_binding", "mr_config_id", "rtmr3_event_log", "gpu"]) assert.equal(bundle.verification[0].checks[k].ok, true, k);
    assert.ok(bundle.report.model_attestations[0].intel_quote && bundle.report.model_attestations[0].nvidia_payload, "quote and GPU evidence kept as returned");
    assert.match(bundle.verifiers.quote, /MOCK/, "the bundle names the verifier that was used");
    const again = await attestor.preflight(M);
    assert.notEqual(again.nonce, pre.nonce, "a fresh nonce every time");
    assert.ok(fs.existsSync(path.join(dir, "z-ai__glm-5.3-flash.json")));
  } finally { await mock.close(); }
});

test("attestation: a stale nonce, a wrong key in the quote, debug mode or a missing report all fail", async () => {
  const { mock, attestor } = await setup();
  try {
    for (const [a, re] of [
      [{ wrongNonceInQuote: true }, /report_data_binding/],
      [{ wrongKeyInQuote: true }, /report_data_binding/],
      [{ debug: true }, /debug_off/],
      [{ echoWrongNonce: true }, /nonce_echo/],
      [{ none: true }, /no model_attestations/],
    ]) {
      mock.behave(M, { attestation: a });
      const pre = await attestor.preflight(M);
      assert.equal(pre.ok, false, JSON.stringify(a));
      assert.match(pre.failures.join("; "), re);
    }
    // a signature from an unverified model is never "signed", even if the math checks out
    const client = attestor.client;
    const c = await client.chat({ model: M, messages: [{ role: "user", content: "x" }], stream: false });
    const sig = await client.signature(c.chatId);
    const pre = attestor.cache.get(M);
    assert.equal(judgeSignature(sig, c, pre).status, "unverified");
    assert.equal(provenanceOf(c, pre, sig, judgeSignature(sig, c, pre)).verified, false);
  } finally { await mock.close(); }
});

test("the real DCAP verifier refuses the mock's unsigned quote", async () => {
  const { mock, client } = await setup();
  try {
    const nonce = "ab".repeat(32);
    const { body } = await client.attestationReport(M, { nonce });
    const r = await verifyModelReport(body.model_attestations[0], nonce, { quoteVerifier: dcapQuoteVerifier, gpuVerifier: null, requireGpu: false });
    assert.equal(r.ok, false);
    assert.equal(r.checks.intel_quote.ok, false);
  } finally { await mock.close(); }
});

test("TDX quote layout and RTMR3 replay", () => {
  const ev = [{ imr: 3, event_type: 1, event: "a", event_payload: "00ff" }, { imr: 0, event_type: 1, event: "skip", event_payload: "" }];
  const d = createHash("sha384").update(Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from(":a:"), Buffer.from("00ff", "hex")])).digest();
  const want = createHash("sha384").update(Buffer.concat([Buffer.alloc(48), d])).digest();
  assert.ok(replayRtmr3(ev).equals(want));
  assert.ok(replayRtmr3(JSON.stringify(ev)).equals(want), "the gateway's JSON-string event log works too");
  assert.throws(() => replayRtmr3([{ ...ev[0], digest: "00".repeat(48) }]), /digest mismatch/);
  assert.throws(() => parseTdxQuote(Buffer.alloc(100)), /too short/);
});

test("models come from /v1/models at runtime; cost uses the live pricing and is null without usage", async () => {
  const { mock, client } = await setup();
  try {
    const fleet = await client.nearFleetChatModels();
    assert.deepEqual(fleet.map((m) => m.id), MOCK_MODELS);
    const m = await client.model(M);
    assert.ok(Math.abs(costOf(m, { prompt_tokens: 1000, completion_tokens: 100 }) - (1000 * 1e-7 + 100 * 1e-6)) < 1e-12);
    assert.equal(costOf(m, null), null);
    assert.equal(costOf({}, { prompt_tokens: 1, completion_tokens: 1 }), null);
    const noKey = new NearAI({ baseUrl: mock.url });
    await assert.rejects(noKey.chat({ model: M, messages: [] }), (e) => e.code === "no_key");
    assert.equal((await noKey.models()).length, 3, "the model list needs no key");
  } finally { await mock.close(); }
});
