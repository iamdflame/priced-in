// Live smoke test against the real NEAR AI Cloud. Runs only with NEARAI_API_KEY (SKIPs otherwise):
// a fresh attestation, verified in full; one real completion; its real provider_tee signature,
// verified locally over our exact bytes; and the signer matched to the attested report.
import { NearAI, Attestor, attestedCompletion, verifyProvenance, DEFAULT_BASE_URL } from "../src/nearai.js";

const apiKey = (process.env.NEARAI_API_KEY || "").trim();
if (!apiKey) {
  console.log("SKIP live-smoke: NEARAI_API_KEY is not set. Nothing was called.");
  process.exit(0);
}
const results = [];
let failures = 0;
const check = (name, ok, detail = "") => { results.push(ok); if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " · " + detail : ""}`); };

const client = new NearAI({ apiKey, baseUrl: process.env.NEARAI_BASE_URL || DEFAULT_BASE_URL });
const attestor = new Attestor({ client });
const model = process.env.SMOKE_MODEL || "z-ai/glm-5.3-flash";
try {
  const listed = await client.model(model);
  check("the model is listed in /v1/models on the NEAR fleet", listed?.owned_by === "nearai", `${model}, owned_by ${listed?.owned_by}`);
  const pre = await attestor.preflight(model);
  check("a fresh attestation verifies (Intel quote, key and nonce binding, RTMR3, MRCONFIGID, GPU)", pre.ok, pre.ok ? `signer ${pre.verifiedSigners[0].signing_address}, nonce ${pre.nonce}` : pre.failures.join("; "));
  const r = await attestedCompletion({ client, attestor, body: { model, messages: [{ role: "user", content: "Reply with only: near-ai-ok" }], temperature: 0, max_tokens: 200, stream: false, reasoning_effort: "low" }, signatureDeadlineMs: 10000 });
  check("a real completion came back", Boolean(r.completion.chatId), `${r.completion.chatId} in ${r.completion.ms} ms, ${JSON.stringify(r.completion.usage)}`);
  const s = await r.signed;
  check("the real signature is provider_tee", s.signature?.signature_kind === "provider_tee", `kind ${s.signature?.signature_kind}${s.error ? `, ${s.error.message}` : ""}`);
  check("it verifies over our exact bytes and its signer is the attested key", s.provenance.status === "signed", s.provenance.reason || `signer ${s.provenance.signing_address}`);
  const rec = { ...s.provenance, request_b64: r.completion.requestBytes.toString("base64"), response_b64: r.completion.responseBytes.toString("base64") };
  check("the record re-verifies from its own bytes", verifyProvenance(rec).ok, verifyProvenance(rec).reasons.join("; "));
  const tampered = { ...rec, response_b64: Buffer.from(`${r.completion.responseBytes.toString("utf8")} `).toString("base64") };
  check("a tampered response is rejected", !verifyProvenance(tampered).ok);
} catch (e) {
  check("run completed", false, e.message);
}
console.log(`${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
