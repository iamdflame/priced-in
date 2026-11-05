// An in-process stand-in for NEAR AI Cloud, for offline tests. Same endpoints and the same
// byte-exact signing as the real service, with local keys:
//   GET  /v1/models
//   POST /v1/chat/completions        (non-streamed: signed provider_tee over the exact bytes;
//                                     streamed with web_context_search: gateway-signed)
//   GET  /v1/signature/<chat_id>?signing_algo=ed25519
//   GET  /v1/attestation/report?model=&provider=near&signing_algo=ed25519&nonce=
// The provider_tee signature is ed25519 over "<model>:<sha256(request bytes)>:<sha256(response bytes)>".
// Attestation reports have the real layout (report_data = signing key || nonce, MRCONFIGID over
// app_compose, an RTMR3 event log), inside a TDX-shaped quote that carries no Intel signature:
// only mockQuoteVerifier accepts it. The real dcap-qvl verifier rejects it.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { buildTdxQuote, parseTdxQuote } from "../src/nearai.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const hex = (u8) => Buffer.from(u8).toString("hex");

export const MOCK_MODELS = ["deepseek-ai/DeepSeek-V4.1-Flash-1017", "Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"];

/** Offline quote "verification": parses the TDX layout, checks no signature. Tests only. */
export async function mockQuoteVerifier(quoteBytes) {
  const q = parseTdxQuote(quoteBytes);
  return { status: "UpToDate", advisory_ids: [], type: "td10", data: q.data };
}
mockQuoteVerifier.label = "MOCK quote parser (offline tests only: checks no Intel signature)";

export async function mockGpuVerifier(payloadText, nonceHex) {
  const p = JSON.parse(payloadText);
  if (p.nonce !== nonceHex) throw new Error("GPU evidence nonce does not match ours");
  if (p.arch !== "MOCK") throw new Error("not mock GPU evidence");
  return { ok: true, overall: true, arch: "MOCK", gpus: p.evidence_list.length };
}
mockGpuVerifier.label = "MOCK GPU verifier (offline tests only)";

function eventDigest(e) {
  const t = Buffer.alloc(4);
  t.writeUInt32LE(e.event_type >>> 0);
  return createHash("sha384").update(Buffer.concat([t, Buffer.from(":"), Buffer.from(e.event, "utf8"), Buffer.from(":"), Buffer.from(e.event_payload, "hex")])).digest();
}

function buildReport({ model, keyPair, nonce, debug = false, wrongNonceInQuote = false, wrongKeyInQuote = false }) {
  const appCompose = JSON.stringify({ manifest_version: 2, name: `mock-${model}`, runner: "docker-compose", docker_compose_file: "services: {}" });
  const events = [
    { imr: 3, event_type: 134217729, event: "app-id", event_payload: sha(model).slice(0, 40) },
    { imr: 3, event_type: 134217729, event: "compose-hash", event_payload: sha(appCompose) },
    { imr: 3, event_type: 134217729, event: "instance-id", event_payload: sha(`${model}-instance`).slice(0, 40) },
  ].map((e) => ({ ...e, digest: eventDigest(e).toString("hex") }));
  let rtmr3 = Buffer.alloc(48);
  for (const e of events) rtmr3 = createHash("sha384").update(Buffer.concat([rtmr3, Buffer.from(e.digest, "hex")])).digest();
  const pk = Buffer.from(keyPair.publicKey);
  const reportData = Buffer.concat([wrongKeyInQuote ? randomBytes(32) : pk, wrongNonceInQuote ? randomBytes(32) : Buffer.from(nonce, "hex")]);
  const td = Buffer.alloc(8);
  if (debug) td[0] = 1;
  const quote = buildTdxQuote({
    tdAttributes: td,
    mrConfigId: Buffer.concat([Buffer.from([1]), createHash("sha256").update(appCompose).digest(), Buffer.alloc(15)]),
    rtMr3: rtmr3,
    reportData,
  });
  return {
    model_name: model,
    signing_address: hex(pk),
    signing_algo: "ed25519",
    signing_public_key: hex(pk),
    request_nonce: nonce,
    intel_quote: quote.toString("hex"),
    nvidia_payload: JSON.stringify({ nonce, evidence_list: [{ certificate: "MOCK", evidence: "MOCK" }], arch: "MOCK" }),
    event_log: events,
    info: { app_name: "mock-dstack", tcb_info: { app_compose: appCompose, rtmr3: rtmr3.toString("hex") } },
  };
}

/** The default answers, by kind of request. Tests override per model with behave(). */
function defaultContent(model, req) {
  const system = req.messages?.find((m) => m.role === "system")?.content || "";
  const user = req.messages?.find((m) => m.role === "user")?.content || "";
  if (/juror/i.test(system)) return "VERDICT: TRUE\nThe evidence supports the claim.";
  if (/rewrite/i.test(system)) {
    const j = JSON.parse(user);
    return JSON.stringify({
      sentences: j.sentences.map((s) => ({
        claim_id: s.claim_id,
        text: s.band === "assert" ? s.claim
          : s.band === "negate" ? `Contrary to some reports, it is unlikely that ${s.claim.replace(/\.$/, "").replace(/^\w/, (c) => c.toLowerCase())}.`
            : s.band === "disputed" ? `Whether ${s.claim.replace(/\.$/, "").replace(/^\w/, (c) => c.toLowerCase())} is disputed.`
              : `${s.claim.replace(/\.$/, "")}, most sources suggest.`,
      })),
    });
  }
  if (/credence/i.test(system)) {
    const j = JSON.parse(user);
    return JSON.stringify({ p: 0.9, rationale: "The fetched source states this directly.", source_url: j.sources?.[0]?.url || null });
  }
  return "ok";
}

/**
 * @param {{ models?: string[], apiKey?: string, searchResults?: object[] }} [o]
 */
export async function startMockNearAI({ models = MOCK_MODELS, apiKey = "mock-key", searchResults = [] } = {}) {
  const keys = new Map(models.map((m) => [m, nacl.sign.keyPair()]));
  const gatewayKey = nacl.sign.keyPair();
  const behaviour = new Map(); // model -> { content, down, noSignature, signatureDelayMs, tamper, wrongSigner, gatewaySigned, latencyMs, attestation }
  const signatures = new Map(); // chat id -> { record, readyAt, never }
  const calls = [];
  let seq = 0;

  const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const authed = (req) => req.headers.authorization === `Bearer ${apiKey}`;

  function sign(text, kp) {
    return { text, signature: hex(nacl.sign.detached(Buffer.from(text, "utf8"), kp.secretKey)), signing_address: hex(kp.publicKey), signing_algo: "ed25519" };
  }

  async function chat(req, res, raw) {
    if (!authed(req)) return json(res, 401, { error: { message: "Invalid API key" } });
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: { message: "bad json" } }); }
    const model = body.model;
    calls.push({ path: "/v1/chat/completions", model, stream: Boolean(body.stream), aliasing: req.headers["x-no-aliasing"], bytes: raw });
    if (!keys.has(model)) return json(res, 404, { error: { message: `model ${model} not found` } });
    const b = behaviour.get(model) || {};
    if (b.latencyMs) await new Promise((r) => setTimeout(r, b.latencyMs));
    if (b.down) return json(res, 503, { error: { message: "model unavailable" } });
    const id = `chatcmpl-${(++seq).toString(36)}${randomBytes(6).toString("hex")}`;
    const content = typeof b.content === "function" ? b.content(body) : b.content ?? defaultContent(model, body);
    const promptTokens = Math.ceil(raw.length / 4);
    const completionTokens = Math.ceil(content.length / 4);
    if (body.stream) {
      // web_context_search: tool call, injected results, then the answer; signed by the gateway
      const chunks = [
        { id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "web_context_search", arguments: JSON.stringify({ query: "q" }) } }] } }] },
        { id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { nearai_tool_result: { name: "web_context_search", content: JSON.stringify({ results: b.searchResults || searchResults }) } } }] },
        { id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content } }] },
        { id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } },
      ];
      const out = Buffer.from(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", "utf8");
      signatures.set(id, { record: { ...sign(`${sha(raw)}:${sha(out)}`, gatewayKey), signature_kind: "gateway" }, readyAt: Date.now() });
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end(out);
    }
    const respObj = {
      id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: null }, finish_reason: "stop" }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    };
    const out = Buffer.from(JSON.stringify(respObj), "utf8");
    const signedBytes = b.tamper ? Buffer.from(JSON.stringify({ ...respObj, choices: [{ ...respObj.choices[0], message: { role: "assistant", content: "something else" } }] })) : out;
    const kp = b.wrongSigner ? nacl.sign.keyPair() : keys.get(model);
    const rec = b.gatewaySigned
      ? { ...sign(`${sha(raw)}:${sha(signedBytes)}`, gatewayKey), signature_kind: "gateway" }
      : { ...sign(`${model}:${sha(raw)}:${sha(signedBytes)}`, kp), signature_kind: "provider_tee" };
    signatures.set(id, { record: rec, readyAt: Date.now() + (b.signatureDelayMs || 0), never: Boolean(b.noSignature) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(out);
  }

  function signature(req, res, id, url) {
    if (!authed(req)) return json(res, 401, { error: { message: "Invalid API key" } });
    calls.push({ path: "/v1/signature", id });
    if (url.searchParams.get("signing_algo") !== "ed25519") return json(res, 400, { error: { message: "mock signs ed25519 only" } });
    const s = signatures.get(id);
    if (!s || s.never || Date.now() < s.readyAt) return json(res, 404, { detail: "Signature not found" });
    json(res, 200, s.record);
  }

  function attestation(req, res, url) {
    const model = url.searchParams.get("model");
    const nonce = url.searchParams.get("nonce");
    calls.push({ path: "/v1/attestation/report", model, nonce, aliasing: req.headers["x-no-aliasing"] });
    if (!/^[0-9a-f]{64}$/i.test(nonce || "")) return json(res, 400, { error: { message: "nonce must be 64 hex" } });
    const gateway = { ...buildReport({ model: "gateway", keyPair: gatewayKey, nonce }), model_name: undefined };
    if (!model) return json(res, 200, { gateway_attestation: gateway });
    if (!keys.has(model)) return json(res, 404, { error: { message: `model ${model} not found` } });
    const a = behaviour.get(model)?.attestation || {};
    const report = buildReport({ model, keyPair: keys.get(model), nonce, ...a });
    if (a.echoWrongNonce) report.request_nonce = randomBytes(32).toString("hex");
    json(res, 200, { gateway_attestation: gateway, model_attestations: a.none ? [] : [report] });
  }

  const server = http.createServer((req, res) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(parts);
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      try {
        if (req.method === "GET" && p === "/v1/models") {
          return json(res, 200, { object: "list", data: models.map((id) => ({ id, object: "model", owned_by: "nearai", output_modalities: ["text"], pricing: { prompt: "0.0000001", completion: "0.000001", input_cache_read: "0.00000001" } })) });
        }
        if (req.method === "POST" && p === "/v1/chat/completions") return chat(req, res, raw);
        const m = p.match(/^\/v1\/signature\/([^/]+)$/);
        if (req.method === "GET" && m) return signature(req, res, decodeURIComponent(m[1]), url);
        if (req.method === "GET" && p === "/v1/attestation/report") return attestation(req, res, url);
        json(res, 404, { error: { message: `no route ${p}` } });
      } catch (e) {
        json(res, 500, { error: { message: e.message } });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  return {
    url: base,
    apiKey,
    keys,
    calls,
    signerHex: (model) => hex(keys.get(model).publicKey),
    behave(model, b) { behaviour.set(model, { ...(behaviour.get(model) || {}), ...b }); },
    reset() { behaviour.clear(); },
    quoteVerifier: mockQuoteVerifier,
    gpuVerifier: mockGpuVerifier,
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}
