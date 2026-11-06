// Copied unchanged from web/src/core/verify.ts (the proven engine). Fix bugs there first, then copy.
// In-browser verification of a rewrite's provenance, from its own bytes:
//   1. the exact request and response bytes are present;
//   2. sha256 of each matches the recorded hash;
//   3. the signed text is exactly "<model>:<sha256(request)>:<sha256(response)>";
//   4. the ed25519 signature over that text verifies against the signing key;
//   5. that key is the one registered for the model on the market contract (get_model);
//   6. the words on the page are the words in the signed response;
//   7. the market logged an anchor_rewrite for these hashes (read from the chain).
// Steps 1 to 6 decide "signed in a TEE"; step 7 says whether it is also anchored on-chain.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Rewrite } from "./api";
import { unb64 } from "./rpc";

export type StepId = "bytes" | "request_hash" | "response_hash" | "signed_text" | "signature" | "registered_key" | "text" | "anchor";
export type StepStatus = "pass" | "fail" | "skip";

export interface VerifyStep { id: StepId; label: string; status: StepStatus; detail: string }

export interface VerifyResult {
  /** every check that decides "signed" passed */
  ok: boolean;
  anchored: boolean;
  model: string | null;
  /** the chip's words */
  chip: string;
  steps: VerifyStep[];
}

export interface VerifyDeps {
  /** get_model(model).signing_address_hex from the market, or null when unregistered */
  modelKey: (model: string) => Promise<string | null>;
  /** where an anchor_rewrite for this record was sent, if known (the record's own anchor wins) */
  findAnchor?: (rec: Rewrite) => Promise<{ txHash: string; senderId: string } | null>;
  /** the market's "rewrite" events in that transaction */
  anchorEvents?: (txHash: string, senderId: string) => Promise<any[]>;
}

export const sha256Hex = (b: Uint8Array) => bytesToHex(sha256(b));

const LABEL: Record<StepId, string> = {
  bytes: "The exact request and response are published",
  request_hash: "sha256 of the request matches",
  response_hash: "sha256 of the response matches",
  signed_text: "The signature covers model:sha256(request):sha256(response)",
  signature: "The ed25519 signature verifies",
  registered_key: "The key is the model's key registered on the market",
  text: "The words on the page are the words the model signed",
  anchor: "The market logged this rewrite on-chain",
};

const clean = (h: string | null | undefined) => String(h || "").toLowerCase().replace(/^0x/, "");

/** The sentence texts in a writer response, normalised as services/ai does. */
export function signedSentences(responseBytes: Uint8Array): string[] | null {
  try {
    const j = JSON.parse(new TextDecoder().decode(responseBytes));
    const content: string = j?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const s = content.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    const arr = JSON.parse(s.slice(a, b + 1)).sentences;
    return Array.isArray(arr) ? arr.map((x: any) => String(x?.text || "").trim().replace(/\s+/g, " ")) : null;
  } catch { return null; }
}

export async function verifyRewrite(rec: Rewrite, deps: VerifyDeps): Promise<VerifyResult> {
  const p = rec?.provenance || ({} as Rewrite["provenance"]);
  const model = p.model ?? null;
  const steps: VerifyStep[] = [];
  const step = (id: StepId, status: StepStatus, detail: string) => steps.push({ id, label: LABEL[id], status, detail });

  if (!p || p.kind !== "model" || !model) {
    step("bytes", "fail", p?.kind === "template" ? "This is the template wording, written without a model: nothing to verify." : "No model provenance on this rewrite.");
    return finish();
  }

  let req: Uint8Array | null = null, resp: Uint8Array | null = null;
  try { if (p.request_b64 && p.response_b64) { req = unb64(p.request_b64); resp = unb64(p.response_b64); } } catch { req = resp = null; }
  if (!req || !resp) {
    step("bytes", "fail", "The record carries no request or response bytes (an SSE event carries only hashes: read GET /rewrites).");
    return finish();
  }
  step("bytes", "pass", `${req.length} request bytes, ${resp.length} response bytes`);

  const reqHash = sha256Hex(req), respHash = sha256Hex(resp);
  step("request_hash", reqHash === clean(p.request_hash) ? "pass" : "fail", reqHash === clean(p.request_hash) ? reqHash : `recorded ${p.request_hash}, computed ${reqHash}`);
  step("response_hash", respHash === clean(p.response_hash) ? "pass" : "fail", respHash === clean(p.response_hash) ? respHash : `recorded ${p.response_hash}, computed ${respHash}`);

  const expected = `${model}:${reqHash}:${respHash}`;
  if (p.signature_kind && p.signature_kind !== "provider_tee") step("signed_text", "fail", `signature_kind is ${p.signature_kind}, not provider_tee`);
  else step("signed_text", p.signed_text === expected ? "pass" : "fail", p.signed_text === expected ? expected : p.signed_text ? `signed "${p.signed_text}", expected "${expected}"` : "No signature yet.");

  let sigOk = false;
  try {
    const sig = hexToBytes(clean(p.signature));
    const key = hexToBytes(clean(p.signing_address));
    sigOk = sig.length === 64 && key.length === 32 && ed25519.verify(sig, new TextEncoder().encode(expected), key);
  } catch { sigOk = false; }
  step("signature", sigOk ? "pass" : "fail", sigOk ? `by ${clean(p.signing_address)}` : p.signature ? "The signature does not verify over these bytes." : "No signature yet.");

  try {
    const registered = await deps.modelKey(model);
    if (!registered) step("registered_key", "fail", `${model} has no key registered on the market.`);
    else if (clean(registered) === clean(p.signing_address)) step("registered_key", "pass", `get_model("${model}") = ${clean(registered)}`);
    else step("registered_key", "fail", `The market has ${clean(registered)} for ${model}; the rewrite was signed by ${clean(p.signing_address) || "nobody"}.`);
  } catch (e) {
    step("registered_key", "fail", `Could not read get_model from the market: ${(e as Error).message}`);
  }

  const words = signedSentences(resp);
  const shown = (rec.sentences || []).map((s) => s.text);
  if (!words) step("text", "fail", "The signed response has no sentences in it.");
  else if (words.length === shown.length && words.every((w, i) => w === shown[i])) step("text", "pass", `${words.length} sentence${words.length === 1 ? "" : "s"} match`);
  else step("text", "fail", "The page shows different words from the ones the model signed.");

  // the on-chain anchor
  try {
    const where = p.anchor?.tx_hash ? { txHash: p.anchor.tx_hash, senderId: p.anchor.sender_id || "" } : (await deps.findAnchor?.(rec)) ?? null;
    if (!where || !deps.anchorEvents) step("anchor", "skip", "Not anchored on-chain yet.");
    else {
      const evs = await deps.anchorEvents(where.txHash, where.senderId);
      const hit = evs.find((d) => clean(d?.request_hash) === reqHash && clean(d?.response_hash) === respHash && d?.model === model && clean(d?.signature) === clean(p.signature));
      step("anchor", hit ? "pass" : "fail", hit ? `anchor_rewrite in ${where.txHash} (claim ${hit.claim_id}, version ${hit.version})` : `Transaction ${where.txHash} has no matching anchor_rewrite.`);
    }
  } catch (e) {
    step("anchor", "skip", `Could not read the anchor: ${(e as Error).message}`);
  }
  return finish();

  function finish(): VerifyResult {
    const deciding = steps.filter((s) => s.id !== "anchor");
    const ok = deciding.length === 7 && deciding.every((s) => s.status === "pass");
    const anchored = steps.some((s) => s.id === "anchor" && s.status === "pass");
    const firstFail = steps.find((s) => s.status === "fail");
    const chip = ok ? `signed by ${model} in a TEE · verify` : p?.status === "unsigned" || p?.kind === "template" ? "unsigned" : `not verified: ${firstFail?.label.toLowerCase() ?? "incomplete"}`;
    return { ok, anchored, model, chip, steps };
  }
}

/** Anchor lookups from the live event buffer: the market's own "rewrite" events (not services/ai's). */
export function anchorFromEvents(events: { event: string; source?: string; txHash?: string; signerId?: string; data: any }[]) {
  return async (rec: Rewrite) => {
    const p = rec.provenance;
    const e = events.find((x) => x.event === "rewrite" && x.source !== "ai" && clean(x.data?.request_hash) === clean(p.request_hash) && clean(x.data?.response_hash) === clean(p.response_hash));
    return e?.txHash ? { txHash: e.txHash, senderId: e.signerId || "" } : null;
  };
}
