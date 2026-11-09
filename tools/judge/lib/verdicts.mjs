// A jury verdict checked the way the market contract checks it in submit_verdict, but from outside:
// the request is the market's canonical_request, the response and signature are the bytes the
// submit_verdict transaction carried, the key is the one get_model returns, and the verdict is the
// rules' reading of the response (lib/rules.mjs, a port proven equal to crates/rules by check 2).
import { createHash, createPublicKey, verify } from "node:crypto";
import { ED_SPKI } from "../checks/chain.mjs";
import { verdictOfResponse } from "./rules.mjs";

export const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const clean = (h) => String(h || "").toLowerCase().replace(/^0x/, "");

/** ed25519 over `text` with a raw 32-byte public key in hex; false on any malformed input. */
export function ed25519Ok(text, signatureHex, publicHex) {
  try {
    const key = Buffer.from(clean(publicHex), "hex");
    const sig = Buffer.from(clean(signatureHex), "hex");
    if (key.length !== 32 || sig.length !== 64) return false;
    return verify(null, Buffer.from(text), createPublicKey({ key: Buffer.concat([ED_SPKI, key]), format: "der", type: "spki" }), sig);
  } catch { return false; }
}

/**
 * The submit_verdict call in a transaction: { challenge_id, model, response: Buffer, signature_hex,
 * signer, ok } or null when the transaction holds no such call to `market`. `ok` is whether the
 * market's receipt for it succeeded.
 */
export function submitVerdictArgs(tx, market) {
  const t = tx?.transaction;
  if (!t || t.receiver_id !== market) return null;
  for (const a of t.actions || []) {
    const fc = a?.FunctionCall;
    if (!fc || fc.method_name !== "submit_verdict") continue;
    let args;
    try { args = JSON.parse(Buffer.from(fc.args, "base64").toString("utf8")); } catch { return null; }
    const failed = (tx.receipts_outcome || []).some((r) => r.outcome?.executor_id === market && r.outcome?.status?.Failure);
    const ok = !failed && !tx.status?.Failure && (tx.status?.SuccessValue !== undefined || (tx.receipts_outcome || []).some((r) => r.outcome?.executor_id === market && r.outcome?.status?.SuccessValue !== undefined));
    return { challenge_id: Number(args.challenge_id), model: String(args.model ?? ""), response: Buffer.from(String(args.response ?? ""), "base64"), signature_hex: String(args.signature_hex ?? ""), signer: t.signer_id, ok };
  }
  return null;
}

/**
 * One verdict. `stored` is the verdict in get_challenge ({model, outcome, request_hash,
 * response_hash}), or null offline; `canonical` is canonical_request's string, or null offline
 * (then `request` bytes stand in); `key` is the model's signing_address_hex.
 * Returns { ok, steps: [[name, ok]] }.
 */
export function verifyVerdict({ model, stored = null, canonical = null, request = null, response, signatureHex, key }) {
  const steps = [];
  const step = (name, ok) => steps.push([name, !!ok]);
  const reqBytes = canonical != null ? Buffer.from(canonical, "utf8") : request;
  step("the request bytes are known", reqBytes && reqBytes.length > 0);
  const requestHash = reqBytes ? sha256hex(reqBytes) : "";
  if (stored) step("sha256(canonical_request) = the request_hash the market stored", requestHash === clean(stored.request_hash));
  if (canonical != null && request) step("the recorded request bytes are canonical_request's", Buffer.compare(Buffer.from(canonical, "utf8"), request) === 0);
  const responseHash = sha256hex(response || Buffer.alloc(0));
  step("the response bytes are known", response && response.length > 0);
  if (stored) step("sha256(response) = the response_hash the market stored", responseHash === clean(stored.response_hash));
  step("ed25519 verifies over model:sha256(request):sha256(response) with the model's key", ed25519Ok(`${model}:${requestHash}:${responseHash}`, signatureHex, key));
  const v = verdictOfResponse(response || Buffer.alloc(0), model);
  step(`the rules read the response as ${v.ok ?? v.err}${stored ? `, the market recorded ${stored.outcome}` : ""}`, v.ok && (!stored || v.ok === stored.outcome));
  return { ok: steps.every((s) => s[1]), steps, outcome: v.ok ?? null, requestHash, responseHash };
}

/**
 * The outcome the contract reaches from its verdicts and disputes: two matching TRUE/FALSE verdicts
 * (in submission order) give the provisional outcome, and each dispute flips it. Three disputes
 * send the claim to the council: then null (the council rules).
 */
export function expectedOutcome(verdicts, disputes = 0, maxDisputes = 3) {
  let t = 0, f = 0, provisional = null;
  for (const v of verdicts) {
    if (v.outcome === "TRUE") t++;
    else if (v.outcome === "FALSE") f++;
    if (t >= 2 || f >= 2) { provisional = t >= 2; break; }
  }
  if (provisional === null || disputes >= maxDisputes) return null;
  return disputes % 2 === 0 ? provisional : !provisional;
}

/** Run `fn` over `items`, at most `n` at a time, keeping order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
