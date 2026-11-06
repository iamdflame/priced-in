// The jury runner. For an open challenge, for each NEAR-fleet model:
//   1. preflight: a fresh attestation with a fresh nonce, fully verified, its bundle written to
//      attestations/<model>.json. An unverified model does not sit on the jury;
//   2. read canonical_request(challenge_id, model) from the contract and send exactly those bytes;
//   3. fetch the provider_tee signature and verify it locally against the attested key;
//   4. call submit_verdict from a runner account. The contract rebuilds the request, checks both
//      hashes and verifies the signature itself against the model's registered key.
// Two of three matching TRUE/FALSE verdicts give a provisional outcome and open the dispute
// window. Anyone can run this: the runner can drop a verdict but cannot forge one. Bonded
// people have the last word: the outcome stands only if nobody disputes it in the window.
//
// Our runner first checks the challenge's receipts at their source (a `gate`, see receipts.js):
// a made-up receipt fooled the real models 9 times in 10, so when the receipts don't verify it
// calls no model, and the run says why (status "refused", with the receipt check).
//
// CLI: node services/ai/src/jury.js <challenge_id>
//      node services/ai/src/jury.js --attest     (needs no NEAR AI key)

import { pathToFileURL } from "node:url";
import { judgeSignature } from "./nearai.js";

export const DEFAULT_JURY_MODELS = ["deepseek-ai/DeepSeek-V4.1-Flash-1017", "Qwen/Qwen3.8-27B", "z-ai/glm-5.3-flash"];

/**
 * The contract's reading of a completion (crates/rules): the first non-empty line of
 * choices[0].message.content, exactly. reasoning_content never counts. The contract also
 * refuses a body that is not a completion or that names another model; here those read as
 * UNPARSEABLE and the refusal comes back from submit_verdict.
 */
export function parseVerdict(bytes) {
  let content;
  try { content = JSON.parse(Buffer.from(bytes).toString("utf8"))?.choices?.[0]?.message?.content; } catch { return "UNPARSEABLE"; }
  if (typeof content !== "string") return "UNPARSEABLE";
  const line = content.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  const m = /^VERDICT: (TRUE|FALSE|INSUFFICIENT)$/.exec(line);
  return m ? m[1] : "UNPARSEABLE";
}

export class JuryRunner {
  /**
   * @param {{ client: import('./nearai.js').NearAI, attestor: import('./nearai.js').Attestor, rpc: import('../../api/src/rpc.mjs').Rpc,
   *   marketId: string, sender: import('./txsender.js').FunctionCallSender, models?: string[], quorum?: number, timeoutMs?: number,
   *   graceMs?: number, signatureDeadlineMs?: number, ledger?: object, hub?: object, log?: (m: string) => void,
   *   gate?: { verdict: (a: { challenge_id: number, challenge: object, claim: object }) => Promise<{ ok: boolean, check: object|null, error?: string }> }|null }} o
   *   gate: the receipt check; without one, every challenge goes to the models
   */
  constructor(o) {
    Object.assign(this, { client: o.client, attestor: o.attestor, rpc: o.rpc, marketId: o.marketId, sender: o.sender, ledger: o.ledger || null, hub: o.hub || null, gate: o.gate || null });
    this.models = o.models || DEFAULT_JURY_MODELS;
    this.quorum = o.quorum ?? 2;
    this.timeoutMs = o.timeoutMs ?? 90_000;
    this.graceMs = o.graceMs ?? 10_000; // longer than the signature deadline, so a third juror can land
    this.signatureDeadlineMs = o.signatureDeadlineMs ?? 8000;
    this.log = o.log || (() => {});
    this.runs = new Map();
    this.active = new Set();
    this.unsub = null;
  }

  start() {
    if (this.unsub || !this.hub) return;
    this.unsub = this.hub.subscribe((e) => {
      if (e.event !== "challenge" || !Number.isInteger(e.data?.challenge_id)) return;
      this.run(e.data.challenge_id).catch((err) => this.log(`jury: challenge ${e.data.challenge_id}: ${err.message}`));
    });
  }

  stop() { this.unsub?.(); this.unsub = null; }

  async juror(model, challengeId, rec, onDone) {
    const set = (patch) => Object.assign(rec, patch);
    try {
      const listed = await this.client.model(model);
      if (!listed) return set({ status: "skipped", error: "not listed in /v1/models" });
      if (listed.owned_by !== "nearai") return set({ status: "skipped", error: `owned_by ${listed.owned_by}, not the NEAR fleet` });
      const preflight = await this.attestor.preflight(model);
      set({ attestation: { ok: preflight.ok, nonce: preflight.nonce, bundle: preflight.bundlePath ? preflight.bundlePath.split(/[\\/]/).pop() : null } });
      if (!preflight.ok) return set({ status: "unverified", error: `attestation did not verify: ${preflight.failures.slice(0, 2).join("; ")}` });
      const canonical = await this.rpc.viewFunction(this.marketId, "canonical_request", { challenge_id: challengeId, model });
      if (typeof canonical !== "string") return set({ status: "failed", error: "the contract returned no canonical request" });
      const completion = await this.client.chat(Buffer.from(canonical, "utf8"), { timeoutMs: this.timeoutMs });
      this.ledger?.recordCall({ agent: "jury", purpose: `challenge ${challengeId}`, completion }).catch?.(() => {});
      const signature = await this.client.signature(completion.chatId, { deadlineMs: this.signatureDeadlineMs });
      const judged = judgeSignature(signature, completion, preflight);
      set({ signing_address: signature.signing_address, signature_kind: signature.signature_kind, signature: signature.signature, outcome: parseVerdict(completion.responseBytes) });
      if (judged.status !== "signed") return set({ status: "unverified", error: judged.reason });
      const r = await this.sender.call("submit_verdict", { challenge_id: challengeId, model, response: completion.responseBytes.toString("base64"), signature_hex: signature.signature }, { gasTgas: 30 });
      set({ status: "submitted", tx_hash: r.txHash, outcome: r.value?.outcome ?? rec.outcome, request_hash: r.value?.request_hash, response_hash: r.value?.response_hash });
      onDone();
    } catch (e) {
      const hint = /signature does not verify/.test(e.message) ? " (the key registered on the market is not this model's attested key)" : "";
      set({ status: "failed", error: `${e.message}${hint}`, tx_hash: e.txHash ?? rec.tx_hash ?? null });
    }
  }

  /** Run the jury for one challenge. Resolves at quorum plus a grace period, or at the timeout. */
  async run(challengeId) {
    if (this.active.has(challengeId)) return { challenge_id: challengeId, skipped: "already running" };
    this.active.add(challengeId);
    const t0 = Date.now();
    const timers = [];
    try {
      const ch = await this.rpc.viewFunction(this.marketId, "get_challenge", { challenge_id: challengeId });
      if (!ch) throw new Error(`no challenge ${challengeId}`);
      // the receipts first: no model reads evidence whose sources don't hold what it quotes
      let receipt = null;
      if (this.gate) {
        const claim0 = await this.rpc.viewFunction(this.marketId, "get_claim", { claim_id: ch.claim_id });
        const g = await this.gate.verdict({ challenge_id: challengeId, challenge: ch, claim: claim0 }).catch((e) => ({ ok: false, check: null, error: e.message }));
        receipt = g.check ? { result: g.check.result, reason: g.check.reason, checked_at: g.check.checked_at, via: g.check.via } : { result: null, reason: g.error || "the receipt check did not answer", checked_at: new Date().toISOString(), via: null };
        if (!g.ok) {
          const result = {
            challenge_id: challengeId, claim_id: ch.claim_id, ended: "refused", ms: Date.now() - t0, jurors: [],
            verdicts_on_chain: ch.verdicts ?? [], provisional: claim0?.provisional ?? null, status: "refused", receipt_check: receipt,
            message: `Our jury runner did not call the models: the receipts did not verify (${receipt.result ?? "no check"}). ${receipt.reason || ""} Anyone may still run the jury; if two verdicts side with this challenger, the Sentinel disputes.`.trim(),
          };
          this.runs.set(challengeId, result);
          this.hub?.publish({ uid: `jury:${challengeId}:${t0}`, event: "jury_run", source: "ai", data: result });
          this.log(`jury: challenge ${challengeId}: refused, receipts ${receipt.result}`);
          return result;
        }
      }
      const jurors = this.models.map((model) => ({ model, status: "pending" }));
      const fresh = jurors.filter((j) => {
        if (!ch.verdicts.some((v) => v.model === j.model)) return true;
        j.status = "already_ruled";
        return false;
      });
      let settle;
      const quorumOrTimeout = new Promise((r) => { settle = r; });
      timers.push(setTimeout(() => settle("timeout"), this.timeoutMs));
      const onDone = () => {
        const n = (o) => jurors.filter((j) => j.status === "submitted" && j.outcome === o).length;
        if (n("TRUE") >= this.quorum || n("FALSE") >= this.quorum) timers.push(setTimeout(() => settle("quorum"), this.graceMs));
      };
      const all = Promise.all(fresh.map((j) => this.juror(j.model, challengeId, j, onDone))).then(() => "all_answered");
      const ended = await Promise.race([all, quorumOrTimeout]);
      for (const j of jurors) if (j.status === "pending") { j.status = "timed_out"; j.error = `no result within the ${ended === "quorum" ? "grace period after quorum" : "timeout"}`; }
      // the chain is the record: read what actually landed
      const after = await this.rpc.viewFunction(this.marketId, "get_challenge", { challenge_id: challengeId });
      const claim = await this.rpc.viewFunction(this.marketId, "get_claim", { claim_id: ch.claim_id });
      const result = {
        challenge_id: challengeId, claim_id: ch.claim_id, ended, ms: Date.now() - t0, jurors,
        verdicts_on_chain: after?.verdicts ?? [],
        provisional: claim?.provisional ?? null,
        ...(receipt ? { receipt_check: receipt } : {}),
        status: claim?.provisional === true || claim?.provisional === false ? "provisional" : "no_quorum",
        message: claim?.provisional === null || claim?.provisional === undefined
          ? `No ${this.quorum}-of-${this.models.length} agreement. The claim stays challenged and keeps trading. After the jury deadline anyone can call expire_challenge: the bond is refunded and the claim reopens.`
          : `Provisional outcome ${claim.provisional ? "TRUE" : "FALSE"}. Anyone can dispute it with a bond until the window closes, then finalize settles it.`,
      };
      this.runs.set(challengeId, result);
      this.hub?.publish({ uid: `jury:${challengeId}:${t0}`, event: "jury_run", source: "ai", data: { ...result, jurors: jurors.map(({ signature, ...j }) => j) } });
      this.log(`jury: challenge ${challengeId}: ${result.status}, ${result.verdicts_on_chain.length} verdicts on-chain in ${result.ms} ms`);
      return result;
    } finally {
      timers.forEach(clearTimeout);
      this.active.delete(challengeId);
    }
  }
}

async function cli() {
  const { loadAiConfig } = await import("./config.js");
  const { NearAI, Attestor } = await import("./nearai.js");
  const { Rpc } = await import("../../api/src/rpc.mjs");
  const { KeyPair } = await import("near-api-js");
  const { FunctionCallSender } = await import("./txsender.js");
  const { api, ai, errors } = loadAiConfig(process.env);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  const client = new NearAI({ apiKey: ai.nearai.apiKey, baseUrl: ai.nearai.baseUrl });
  const attestor = new Attestor({ client, dir: ai.attestationsDir, requireGpu: ai.requireGpu });
  if (process.argv[2] === "--attest") {
    let bad = 0;
    for (const m of ai.jury.models) {
      const r = await attestor.preflight(m);
      bad += r.ok ? 0 : 1;
      console.log(`${r.ok ? "VERIFIED" : "UNVERIFIED"} ${m} signer ${r.verifiedSigners[0]?.signing_address ?? "-"} nonce ${r.nonce}${r.ok ? "" : ` ${r.failures.join("; ")}`}`);
    }
    process.exit(bad ? 1 : 0);
  }
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || !ai.jury.accountId || !ai.jury.privateKey || !api.marketId || !client.hasKey) {
    console.error("usage: jury.js <challenge_id> with NEARAI_API_KEY, MARKET_CONTRACT_ID, JURY_ACCOUNT_ID and JURY_PRIVATE_KEY set; or jury.js --attest");
    process.exit(1);
  }
  const rpc = new Rpc(api.rpcUrls, { timeoutMs: 8000 });
  const sender = new FunctionCallSender({ rpc, accountId: ai.jury.accountId, keyPair: KeyPair.fromString(ai.jury.privateKey), receiverId: api.marketId });
  const { ReceiptGate } = await import("./receipts.js");
  const runner = new JuryRunner({ client, attestor, rpc, marketId: api.marketId, sender, models: ai.jury.models, timeoutMs: ai.jury.timeoutMs, log: console.log, gate: new ReceiptGate({ log: console.log }) });
  const r = await runner.run(id);
  console.log(JSON.stringify({ ...r, jurors: r.jurors.map(({ signature, ...j }) => j) }, null, 1));
  process.exit(r.status === "provisional" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
