// NEAR AI Cloud client with verification.
//
// - Chat completions keep the exact request bytes we sent and the exact response bytes we
//   received, before any parsing, so the hashes we check are the hashes the model signed.
// - Response signatures: GET /v1/signature/<chat_id>?signing_algo=ed25519, fetched at once with
//   a short bounded retry on 404. A provider_tee signature covers
//   "<MODEL_ID>:<sha256(request bytes)>:<sha256(response bytes)>".
// - Model attestations: GET /v1/attestation/report with a fresh 32-byte nonce, fetched BEFORE
//   the completion (preflight). Every candidate is verified: the Intel TDX quote (dcap-qvl),
//   debug mode off, report_data = signing key || nonce, the echoed nonce, MRCONFIGID against
//   app_compose, the RTMR3 event-log replay, and the NVIDIA GPU evidence (NRAS).
// - A response is "signed" only when its signature verifies over our bytes AND its signer
//   matches exactly one verified preflight report. Anything else is "unsigned" or
//   "unverified", never "signed".
// Docs: docs.near.ai/cloud/verification/cloud-api/{response-signatures,model-attestations}.md

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";

export const DEFAULT_BASE_URL = "https://cloud-api.near.ai/v1";
export const NRAS_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";

export const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const sha = (alg, ...parts) => { const h = createHash(alg); for (const p of parts) h.update(p); return h.digest(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexBytes = (v) => Buffer.from(String(v || "").replace(/^0x/i, ""), "hex");
const parseMaybeJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);

export class NearAiError extends Error {
  constructor(message, { status = 0, code = "nearai_error", retryable = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** The text a provider_tee signature covers (or a gateway signature, without a model). */
export function expectedSignedText(model, requestBytes, responseBytes) {
  const hashes = `${sha256hex(requestBytes)}:${sha256hex(responseBytes)}`;
  return model === undefined ? hashes : `${model}:${hashes}`;
}

function sameHex(a, b) {
  const x = hexBytes(a), y = hexBytes(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verify a /v1/signature answer over exact bytes. Throws with the reason on any mismatch.
 * Only ed25519 is accepted: it is what the market contract verifies on-chain.
 * @param {{ signature: object, requestBytes: Buffer, responseBytes: Buffer, model?: string, signer: { signing_address: string, signing_algo: string } }} a
 */
export function verifyResponseSignature({ signature, requestBytes, responseBytes, model, signer }) {
  if (!signature || typeof signature.text !== "string") throw new Error("no signature text");
  const kind = signature.signature_kind;
  if (model !== undefined && kind !== "provider_tee") throw new Error(`signature_kind is ${kind ?? "absent"}, not provider_tee`);
  if (model === undefined && kind !== "gateway") throw new Error(`signature_kind is ${kind ?? "absent"}, not gateway`);
  const expected = expectedSignedText(model, requestBytes, responseBytes);
  if (signature.text !== expected) throw new Error("signature text does not match the exact request/response bytes");
  if (signature.signing_algo !== "ed25519") throw new Error(`signing_algo ${signature.signing_algo} is not ed25519`);
  const pk = hexBytes(signature.signing_address);
  const sig = hexBytes(signature.signature);
  if (pk.length !== 32) throw new Error("signing_address must be a 32-byte ed25519 key");
  if (sig.length !== 64) throw new Error("signature must be 64 bytes");
  if (!nacl.sign.detached.verify(Buffer.from(signature.text, "utf8"), sig, pk)) throw new Error("ed25519 signature does not verify");
  if (!signer || signer.signing_algo !== "ed25519" || !sameHex(signer.signing_address, signature.signing_address)) {
    throw new Error("signature signer does not match the verified preflight report");
  }
  return { ok: true, kind, text: signature.text };
}

// ---------- TDX quotes and model reports ----------

const TD10_FIELDS = [
  ["teeTcbSvn", 16], ["mrSeam", 48], ["mrSignerSeam", 48], ["seamAttributes", 8], ["tdAttributes", 8],
  ["xfam", 8], ["mrTd", 48], ["mrConfigId", 48], ["mrOwner", 48], ["mrOwnerConfig", 48],
  ["rtMr0", 48], ["rtMr1", 48], ["rtMr2", 48], ["rtMr3", 48], ["reportData", 64],
];
export const TDX_HEADER_LEN = 48;
export const TD10_BODY_LEN = TD10_FIELDS.reduce((n, [, l]) => n + l, 0); // 584

/** Read a TDX v4 quote's TD report body. Structure only: this checks no signature. */
export function parseTdxQuote(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < TDX_HEADER_LEN + TD10_BODY_LEN) throw new Error("quote too short");
  const version = b.readUInt16LE(0);
  const teeType = b.readUInt32LE(4);
  if (teeType !== 0x81) throw new Error(`not a TDX quote (tee_type 0x${teeType.toString(16)})`);
  const data = {};
  let off = TDX_HEADER_LEN;
  for (const [name, len] of TD10_FIELDS) { data[name] = b.subarray(off, off + len); off += len; }
  return { version, teeType, data };
}

/** Build a TDX-shaped quote (header + TD10 body, no signature): for the offline mock only. */
export function buildTdxQuote(fields) {
  const header = Buffer.alloc(TDX_HEADER_LEN);
  header.writeUInt16LE(4, 0);
  header.writeUInt16LE(2, 2);
  header.writeUInt32LE(0x81, 4);
  const body = Buffer.concat(TD10_FIELDS.map(([name, len]) => {
    const v = fields[name] ? Buffer.from(fields[name]) : Buffer.alloc(len);
    if (v.length !== len) throw new Error(`${name} must be ${len} bytes`);
    return v;
  }));
  return Buffer.concat([header, body, Buffer.alloc(4)]);
}

/** Replay the RTMR3 events of a dstack event log. */
export function replayRtmr3(eventLog) {
  let rtmr3 = Buffer.alloc(48);
  for (const e of parseMaybeJson(eventLog) || []) {
    if (e.imr !== 3) continue;
    const t = Buffer.alloc(4);
    t.writeUInt32LE(e.event_type >>> 0);
    const digest = sha("sha384", t, ":", Buffer.from(e.event ?? "", "utf8"), ":", hexBytes(e.event_payload ?? ""));
    if (e.digest && !hexBytes(e.digest).equals(digest)) throw new Error(`event log digest mismatch for ${e.event}`);
    rtmr3 = sha("sha384", rtmr3, digest);
  }
  return rtmr3;
}

let dcapModule = null;
/** Intel DCAP quote verification with @phala/dcap-qvl (collateral from Phala's PCCS). */
export async function dcapQuoteVerifier(quoteBytes) {
  if (!dcapModule) dcapModule = (await import("@phala/dcap-qvl")).default;
  const v = await dcapModule.getCollateralAndVerify(Buffer.from(quoteBytes));
  return { status: v.status, advisory_ids: v.advisory_ids || [], type: v.report?.type, data: v.report?.data };
}
dcapQuoteVerifier.label = "dcap-qvl@0.7.1 (Intel DCAP, collateral from Phala PCCS)";

/** NVIDIA GPU evidence through NRAS. The payload nonce must be ours before anything is sent. */
export function nrasGpuVerifier(fetchImpl = globalThis.fetch, url = NRAS_URL) {
  const fn = async (payloadText, nonceHex) => {
    const payload = JSON.parse(payloadText);
    if (typeof payload.nonce !== "string" || payload.nonce.toLowerCase() !== nonceHex.toLowerCase()) throw new Error("GPU evidence nonce does not match ours");
    const res = await fetchImpl(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: payloadText, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`NRAS answered HTTP ${res.status}`);
    const arr = await res.json();
    const jwt = Array.isArray(arr) ? arr.find((x) => Array.isArray(x) && x[0] === "JWT")?.[1] : null;
    if (!jwt) throw new Error("NRAS answer has no JWT");
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    if (claims["x-nvidia-overall-att-result"] !== true) throw new Error("NRAS overall attestation result is not true");
    return { ok: true, overall: true, arch: payload.arch ?? null, gpus: payload.evidence_list?.length ?? null, iat: claims.iat, exp: claims.exp, eat_nonce: claims.eat_nonce ?? null, jwt };
  };
  fn.label = "NVIDIA NRAS v3 (verdict over TLS; JWT signature not checked locally)";
  return fn;
}

/**
 * Verify one NEAR model report against our nonce. Never throws: returns every check.
 * @param {object} report one entry of model_attestations[]
 * @param {string} nonceHex the 64-hex nonce we generated for this request
 * @param {{ quoteVerifier?: Function, gpuVerifier?: Function|null, acceptedTcb?: string[], requireGpu?: boolean }} [o]
 */
export async function verifyModelReport(report, nonceHex, o = {}) {
  const quoteVerifier = o.quoteVerifier || dcapQuoteVerifier;
  const gpuVerifier = o.gpuVerifier === undefined ? nrasGpuVerifier() : o.gpuVerifier;
  const accepted = o.acceptedTcb || ["UpToDate"];
  const requireGpu = o.requireGpu ?? true;
  const failures = [];
  const checks = {};
  const fail = (name, msg) => { checks[name] = { ok: false, error: msg }; failures.push(`${name}: ${msg}`); };
  const pass = (name, extra = {}) => { checks[name] = { ok: true, ...extra }; };

  const algo = report?.signing_algo;
  const identity = hexBytes(report?.signing_address);
  if (algo !== "ed25519" || identity.length !== 32) fail("signer", `expected an ed25519 32-byte signing_address, got ${algo} / ${identity.length} bytes`);
  else pass("signer", { signing_address: report.signing_address, signing_algo: algo });

  if (String(report?.request_nonce || "").toLowerCase() === nonceHex.toLowerCase()) pass("nonce_echo", { request_nonce: report.request_nonce });
  else fail("nonce_echo", "request_nonce does not match our nonce");

  let q = null;
  try {
    q = await quoteVerifier(hexBytes(report?.intel_quote));
    if (q.type && q.type !== "td10") throw new Error(`expected a TDX td10 report, got ${q.type}`);
    if (!accepted.includes(q.status)) throw new Error(`TCB status ${q.status} not accepted (advisories: ${(q.advisory_ids || []).join(", ") || "none"})`);
    pass("intel_quote", { tcb_status: q.status, advisory_ids: q.advisory_ids || [], verifier: quoteVerifier.label || "custom" });
  } catch (e) {
    fail("intel_quote", e.message);
    q = null;
  }

  if (q?.data) {
    const d = q.data;
    if (Buffer.from(d.tdAttributes)[0] & 1) fail("debug_off", "TDX debug mode is enabled");
    else pass("debug_off");

    const rd = Buffer.from(d.reportData);
    const fp = report.tls_cert_fingerprint;
    const bound = fp ? sha("sha256", identity, hexBytes(fp)) : Buffer.concat([identity, Buffer.alloc(Math.max(0, 32 - identity.length))]);
    const expected = Buffer.concat([bound, hexBytes(nonceHex)]);
    const detail = { report_data: rd.toString("hex"), first_32_bytes: rd.subarray(0, 32).toString("hex"), last_32_bytes: rd.subarray(32).toString("hex"), expected_signing_address: report.signing_address, expected_nonce: nonceHex };
    if (rd.equals(expected)) pass("report_data_binding", detail);
    else { fail("report_data_binding", "report_data in the verified quote is not signing key || nonce"); checks.report_data_binding = { ...checks.report_data_binding, ...detail }; }

    try {
      const tcb = parseMaybeJson(report.info?.tcb_info);
      const compose = tcb?.app_compose;
      if (typeof compose !== "string") throw new Error("info.tcb_info.app_compose is missing");
      const want = Buffer.concat([Buffer.from([1]), sha("sha256", Buffer.from(compose, "utf8")), Buffer.alloc(15)]);
      if (!Buffer.from(d.mrConfigId).equals(want)) throw new Error("MRCONFIGID does not match sha256(app_compose)");
      pass("mr_config_id", { compose_sha256: sha256hex(Buffer.from(compose, "utf8")) });
    } catch (e) { fail("mr_config_id", e.message); }

    try {
      const replay = replayRtmr3(report.event_log);
      if (!replay.equals(Buffer.from(d.rtMr3))) throw new Error("event log replay does not equal RTMR3");
      pass("rtmr3_event_log", { rtmr3: replay.toString("hex") });
    } catch (e) { fail("rtmr3_event_log", e.message); }
  }

  if (report?.nvidia_payload) {
    if (!gpuVerifier) {
      checks.gpu = { ok: null, skipped: "no GPU verifier configured" };
      if (requireGpu) failures.push("gpu: required but no verifier is configured");
    } else {
      try {
        const g = await gpuVerifier(report.nvidia_payload, nonceHex);
        pass("gpu", { ...g, verifier: gpuVerifier.label || "custom" });
      } catch (e) { fail("gpu", e.message); }
    }
  } else if (requireGpu) fail("gpu", "no NVIDIA GPU evidence in the report");

  return {
    ok: failures.length === 0,
    failures,
    checks,
    signer: identity.length === 32 ? { signing_address: identity.toString("hex"), signing_algo: algo } : null,
    model_name: report?.model_name ?? null,
  };
}

// ---------- the HTTP client ----------

export class NearAI {
  /**
   * @param {{ apiKey?: string|null, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number, modelsTtlMs?: number, now?: () => number }} [o]
   */
  constructor({ apiKey = null, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 60000, modelsTtlMs = 600_000, now = Date.now } = {}) {
    this.apiKey = apiKey || null;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.modelsTtlMs = modelsTtlMs;
    this.now = now;
    this.modelsCache = null;
  }

  get hasKey() { return Boolean(this.apiKey); }

  headers(extra = {}) {
    const h = { accept: "application/json", "accept-encoding": "identity", "x-no-aliasing": "true", ...extra };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async get(p, { timeoutMs = this.timeoutMs } = {}) {
    let res;
    try {
      res = await this.fetch(this.baseUrl + p, { headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new NearAiError(`NEAR AI Cloud unreachable: ${e.cause?.code || e.message}`, { code: "unreachable", retryable: true });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { status: res.status, ok: res.ok, bytes, json: () => JSON.parse(bytes.toString("utf8")) };
  }

  /** Models from /v1/models, read at runtime (cached for a few minutes). */
  async models({ refresh = false } = {}) {
    if (!refresh && this.modelsCache && this.now() - this.modelsCache.at < this.modelsTtlMs) return this.modelsCache.list;
    const r = await this.get("/models", { timeoutMs: 15000 });
    if (!r.ok) throw new NearAiError(`/models answered HTTP ${r.status}`, { status: r.status });
    const list = r.json().data || [];
    this.modelsCache = { at: this.now(), list };
    return list;
  }

  async model(id) {
    return (await this.models()).find((m) => m.id === id) || null;
  }

  /** NEAR-fleet chat models (owned_by nearai, text out), excluding embeddings, rerankers and the like. */
  async nearFleetChatModels() {
    return (await this.models()).filter((m) => m.owned_by === "nearai" && isChatModel(m));
  }

  /**
   * A non-streamed chat completion over exact bytes.
   * @param {object|string|Buffer} body serialized once; a string or Buffer is sent byte for byte
   */
  async chat(body, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.apiKey) throw new NearAiError("NEARAI_API_KEY is not set", { code: "no_key" });
    const requestBytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
    let req;
    try { req = JSON.parse(requestBytes.toString("utf8")); } catch { throw new NearAiError("request body is not JSON", { code: "bad_request" }); }
    if (req.stream) throw new NearAiError("chat() is non-streamed; provider_tee signatures need stream:false", { code: "bad_request" });
    const t0 = this.now();
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: requestBytes, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new NearAiError(e.name === "TimeoutError" ? `NEAR AI Cloud did not answer within ${timeoutMs} ms` : `NEAR AI Cloud unreachable: ${e.cause?.code || e.message}`, { code: "unreachable", retryable: true });
    }
    const responseBytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new NearAiError(`chat completion answered HTTP ${res.status}`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
    let json;
    try { json = JSON.parse(responseBytes.toString("utf8")); } catch { throw new NearAiError("chat completion answer is not JSON", { code: "bad_response" }); }
    const msg = json.choices?.[0]?.message || {};
    return { model: req.model, requestBytes, responseBytes, json, chatId: json.id, content: typeof msg.content === "string" ? msg.content : "", usage: json.usage || null, ms: this.now() - t0 };
  }

  /**
   * A streamed chat completion (needed by web_context_search). The raw stream bytes are kept;
   * its signature, if any, is a gateway signature, so it is used for research, never as proof.
   */
  async chatStream(body, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.apiKey) throw new NearAiError("NEARAI_API_KEY is not set", { code: "no_key" });
    const requestBytes = Buffer.from(JSON.stringify({ ...body, stream: true }), "utf8");
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: this.headers({ "content-type": "application/json", accept: "text/event-stream" }), body: requestBytes, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new NearAiError(`NEAR AI Cloud stream failed: ${e.cause?.code || e.message}`, { code: "unreachable", retryable: true });
    }
    const responseBytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new NearAiError(`streamed completion answered HTTP ${res.status}`, { status: res.status });
    const out = { requestBytes, responseBytes, chatId: null, content: "", toolResults: [], toolCalls: [], usage: null, model: body.model };
    for (const line of responseBytes.toString("utf8").split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      let j;
      try { j = JSON.parse(d); } catch { continue; }
      out.chatId = out.chatId || j.id || null;
      if (j.usage) out.usage = j.usage;
      for (const ch of j.choices || []) {
        const delta = ch.delta || {};
        if (typeof delta.content === "string") out.content += delta.content;
        if (delta.tool_calls) out.toolCalls.push(...delta.tool_calls);
        if (delta.nearai_tool_result !== undefined) out.toolResults.push(delta.nearai_tool_result);
      }
    }
    return out;
  }

  /**
   * The response signature, fetched at once with a short bounded retry on 404 (and on a 2xx
   * "unavailable" answer). Throws NearAiError code "signature_unavailable" after the deadline.
   */
  async signature(chatId, { signingAlgo = "ed25519", deadlineMs = 6000, delaysMs = [0, 200, 400, 600, 800, 1000, 1500, 2000] } = {}) {
    if (!this.apiKey) throw new NearAiError("NEARAI_API_KEY is not set", { code: "no_key" });
    if (!chatId || typeof chatId !== "string") throw new NearAiError("no chat id to fetch a signature for", { code: "signature_unavailable" });
    const t0 = this.now();
    let last = "not fetched";
    for (let i = 0; ; i++) {
      const wait = delaysMs[Math.min(i, delaysMs.length - 1)];
      if (i > 0 && this.now() - t0 + wait > deadlineMs) break;
      if (wait) await sleep(wait);
      let r;
      try {
        r = await this.get(`/signature/${encodeURIComponent(chatId)}?signing_algo=${encodeURIComponent(signingAlgo)}`, { timeoutMs: Math.max(1000, Math.min(5000, deadlineMs)) });
      } catch (e) { last = e.message; continue; }
      if (r.status === 404) { last = "404 not recorded yet"; continue; }
      if (r.status >= 500 || r.status === 429) { last = `HTTP ${r.status}`; continue; }
      if (!r.ok) throw new NearAiError(`/signature answered HTTP ${r.status}`, { status: r.status, code: "signature_error" });
      let j;
      try { j = r.json(); } catch { last = "non-JSON signature answer"; continue; }
      if (j.error_code || !j.signature || !j.text) { last = `unavailable: ${j.error_code || "no signature"} ${j.message || ""}`.trim(); continue; }
      return j;
    }
    throw new NearAiError(`signature unavailable after ${this.now() - t0} ms (${last})`, { code: "signature_unavailable", retryable: true });
  }

  /** A model attestation report for a fresh nonce (the nonce must be ours: 32 random bytes). */
  async attestationReport(model, { nonce, signingAlgo = "ed25519" } = {}) {
    if (!/^[0-9a-f]{64}$/i.test(nonce || "")) throw new NearAiError("nonce must be 32 bytes as 64 hex characters", { code: "bad_request" });
    const q = new URLSearchParams({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: signingAlgo, nonce });
    const p = `/attestation/report?${q}`;
    const r = await this.get(p, { timeoutMs: 60000 });
    if (!r.ok) throw new NearAiError(`/attestation/report answered HTTP ${r.status} for ${model}`, { status: r.status });
    return { url: this.baseUrl + p, bytes: r.bytes, body: r.json() };
  }
}

export function isChatModel(m) {
  const out = m.output_modalities || m.architecture?.outputModalities || ["text"];
  if (!out.includes("text")) return false;
  return !/embedding|reranker|whisper|privacy-filter|flux|abliterated/i.test(m.id);
}

/** USD cost of one call from the live /v1/models pricing (USD per token). Null when unknown. */
export function costOf(modelEntry, usage) {
  const p = modelEntry?.pricing;
  if (!p || !usage || !Number.isFinite(usage.prompt_tokens) || !Number.isFinite(usage.completion_tokens)) return null;
  const cached = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const inPrice = Number(p.prompt), outPrice = Number(p.completion);
  const cachePrice = p.input_cache_read !== undefined ? Number(p.input_cache_read) : inPrice;
  if (!Number.isFinite(inPrice) || !Number.isFinite(outPrice)) return null;
  return (usage.prompt_tokens - cached) * inPrice + cached * cachePrice + usage.completion_tokens * outPrice;
}

// ---------- preflight attestation and the signed-completion flow ----------

export const bundleName = (model) => `${model.replace(/[^A-Za-z0-9._-]+/g, "__")}.json`;

export class Attestor {
  /**
   * @param {{ client: NearAI, quoteVerifier?: Function, gpuVerifier?: Function|null, requireGpu?: boolean, maxAgeMs?: number, dir?: string|null, now?: () => number, log?: (m: string) => void }} o
   */
  constructor({ client, quoteVerifier = dcapQuoteVerifier, gpuVerifier, requireGpu = true, maxAgeMs = 30 * 60_000, dir = null, now = Date.now, log = () => {} }) {
    this.client = client;
    this.quoteVerifier = quoteVerifier;
    this.gpuVerifier = gpuVerifier === undefined ? nrasGpuVerifier(client.fetch) : gpuVerifier;
    this.requireGpu = requireGpu;
    this.maxAgeMs = maxAgeMs;
    this.dir = dir;
    this.now = now;
    this.log = log;
    this.cache = new Map();
    this.pending = new Map();
  }

  /** Fetch and verify a fresh report for a model (a new 32-byte nonce every time). */
  async preflight(model) {
    const nonce = randomBytes(32).toString("hex");
    const fetchedAt = this.now();
    const { url, body } = await this.client.attestationReport(model, { nonce, signingAlgo: "ed25519" });
    const candidates = Array.isArray(body.model_attestations) ? body.model_attestations : [];
    const results = [];
    for (const c of candidates) results.push(await verifyModelReport(c, nonce, { quoteVerifier: this.quoteVerifier, gpuVerifier: this.gpuVerifier, requireGpu: this.requireGpu }));
    const verified = results.filter((r) => r.ok).map((r) => r.signer);
    const rec = {
      model, nonce, fetchedAt, url,
      candidates: candidates.length,
      verifiedSigners: verified,
      ok: verified.length > 0,
      failures: candidates.length ? results.flatMap((r, i) => r.failures.map((f) => `candidate ${i}: ${f}`)) : ["no model_attestations[] in the report"],
      results,
      bundlePath: null,
    };
    if (this.dir) {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, bundleName(model));
      const bundle = {
        model,
        fetched_at: new Date(fetchedAt).toISOString(),
        nonce,
        request: { url, headers: { "x-no-aliasing": "true" }, note: "fetched before any completion it vouches for (preflight)" },
        verdict: rec.ok ? "verified" : "unverified",
        verified_signers: verified,
        failures: rec.failures,
        verifiers: { quote: this.quoteVerifier.label || "custom", gpu: this.gpuVerifier?.label || "none" },
        verification: results,
        report: body,
      };
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(bundle, null, 1));
      fs.renameSync(tmp, file);
      rec.bundlePath = file;
    }
    this.cache.set(model, rec);
    this.log(`attestation ${model}: ${rec.ok ? `verified signer ${verified.map((s) => s.signing_address.slice(0, 12)).join(",")}` : `unverified (${rec.failures.slice(0, 2).join("; ")})`}`);
    return rec;
  }

  /** The current preflight record for a model, refreshed when older than maxAgeMs. */
  async ensure(model, { maxAgeMs = this.maxAgeMs } = {}) {
    const hit = this.cache.get(model);
    if (hit && this.now() - hit.fetchedAt < maxAgeMs) return hit;
    if (this.pending.has(model)) return this.pending.get(model);
    const p = this.preflight(model).finally(() => this.pending.delete(model));
    this.pending.set(model, p);
    return p;
  }

  /** Drop a model's record so the next request preflights again (after a signer change). */
  invalidate(model) { this.cache.delete(model); }

  snapshot() {
    return [...this.cache.values()].map((r) => ({ model: r.model, ok: r.ok, fetchedAt: r.fetchedAt, nonce: r.nonce, verifiedSigners: r.verifiedSigners, failures: r.failures, bundle: r.bundlePath ? path.basename(r.bundlePath) : null }));
  }
}

/**
 * Judge a fetched signature against the completion and its preflight record.
 * @returns {{ status: "signed"|"unverified", reason: string|null, signer: object|null }}
 */
export function judgeSignature(signature, completion, preflight) {
  try {
    if (!preflight?.ok) throw new Error(`the model's attestation did not verify (${(preflight?.failures || ["no preflight"]).slice(0, 2).join("; ")})`);
    const matches = preflight.verifiedSigners.filter((s) => s.signing_algo === signature.signing_algo && sameHex(s.signing_address, signature.signing_address));
    if (matches.length !== 1) throw new Error(matches.length ? "the signer matches more than one verified report" : "signature signer does not match the verified preflight report");
    verifyResponseSignature({ signature, requestBytes: completion.requestBytes, responseBytes: completion.responseBytes, model: completion.model, signer: matches[0] });
    return { status: "signed", reason: null, signer: matches[0] };
  } catch (e) {
    return { status: "unverified", reason: e.message, signer: null };
  }
}

/** The provenance record shown next to model output. */
export function provenanceOf(completion, preflight, signature = null, judged = null, extra = {}) {
  const status = judged?.status || (signature ? "unverified" : "unsigned");
  return {
    status,
    verified: status === "signed",
    model: completion.model,
    chat_id: completion.chatId ?? null,
    request_hash: sha256hex(completion.requestBytes),
    response_hash: sha256hex(completion.responseBytes),
    signed_text: signature?.text ?? null,
    signature: signature?.signature ?? null,
    signing_address: signature?.signing_address ?? null,
    signing_algo: signature?.signing_algo ?? null,
    signature_kind: signature?.signature_kind ?? null,
    expected_signer: preflight?.verifiedSigners?.[0]?.signing_address ?? null,
    reason: judged?.reason ?? (signature ? null : "signature not fetched yet"),
    attestation: preflight ? { ok: preflight.ok, nonce: preflight.nonce, fetched_at: new Date(preflight.fetchedAt).toISOString(), bundle: preflight.bundlePath ? path.basename(preflight.bundlePath) : null } : null,
    ...extra,
  };
}

/**
 * One preflighted, non-streamed completion with its signature judged. The signature fetch
 * starts at once; when it is late, `signed` stays a pending promise the caller can await.
 * @returns {Promise<{ completion: object, preflight: object, unsigned: object, signed: Promise<object> }>}
 */
export async function attestedCompletion({ client, attestor, body, signatureDeadlineMs = 6000, timeoutMs }) {
  const model = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : JSON.stringify(body)).model;
  const preflight = await attestor.ensure(model); // preflight evidence before the completion
  const completion = await client.chat(body, { timeoutMs });
  const unsigned = provenanceOf(completion, preflight);
  const signed = client.signature(completion.chatId, { deadlineMs: signatureDeadlineMs }).then(
    (sig) => {
      const j = judgeSignature(sig, completion, preflight);
      if (j.status !== "signed" && /does not match the verified preflight/.test(j.reason || "")) attestor.invalidate(model); // re-attest before the next request
      return { signature: sig, provenance: provenanceOf(completion, preflight, sig, j) };
    },
    (e) => ({ signature: null, error: e, provenance: { ...unsigned, reason: e.message } }),
  );
  return { completion, preflight, unsigned, signed };
}

/**
 * Re-verify a published provenance record from its own bytes, the way a browser would:
 * both hashes, the signed text, and the ed25519 signature against the attested signer.
 */
export function verifyProvenance(p, { signing_address } = {}) {
  const reasons = [];
  if (!p?.request_b64 || !p?.response_b64) return { ok: false, reasons: ["the record carries no request/response bytes"] };
  const req = Buffer.from(p.request_b64, "base64");
  const resp = Buffer.from(p.response_b64, "base64");
  if (sha256hex(req) !== p.request_hash) reasons.push("request_hash does not match the request bytes");
  if (sha256hex(resp) !== p.response_hash) reasons.push("response_hash does not match the response bytes");
  if (p.signed_text !== expectedSignedText(p.model, req, resp)) reasons.push("signed_text is not <model>:<request_hash>:<response_hash>");
  if (p.signature_kind !== "provider_tee") reasons.push(`signature_kind is ${p.signature_kind}`);
  const want = signing_address || p.expected_signer;
  if (!want || !sameHex(want, p.signing_address || "")) reasons.push("signing_address is not the attested signer");
  try {
    if (!nacl.sign.detached.verify(Buffer.from(p.signed_text || "", "utf8"), hexBytes(p.signature), hexBytes(p.signing_address))) reasons.push("ed25519 signature does not verify");
  } catch { reasons.push("signature or key is malformed"); }
  return { ok: reasons.length === 0, reasons };
}
