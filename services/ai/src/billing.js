// Inference billing: every metered model call an agent makes is billed to that agent on-chain.
//
// Each cycle, per agent: the unbilled calls' cost (integer nano-USD at the live /v1/models
// price) plus the carry from the last bill is rounded down to whole micro-USD; the remainder
// carries to the next bill and any unpaid part of the last bill is added as debt, so nothing is
// lost or billed twice. The usage record (exact JSON: every call's id, model, tokens and cost)
// is hashed, and the bill goes on-chain with that usage_hash, through the signer:
//
//   route "escrow"   the swarm's sweep_escrow: yoctoNEAR = micro-USD x the configured rate
//                    (INFERENCE_YOCTO_PER_MICRO_USD). The swarm takes what is left when the
//                    escrow is short; at zero the swarm marks the agent sleeping, and the
//                    roster stops it on the next refresh. A top-up wakes it.
//   route "balance"  the market's charge_inference: micro-USDC from the agent's bankroll,
//                    capped at what the bankroll holds; an unpaid remainder is debt and the
//                    agent sleeps until its bankroll covers it.
//
// The usage record is served at GET /ai/usage/<hash>, so anyone can check a bill.

import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** The bill for an agent's unbilled usage, or null when there is nothing to bill. Pure. */
export function prepareBill({ agent, route, unbilled, rateYoctoPerMicro, at, cap = null }) {
  if (unbilled.blocked) return null;
  const carry = BigInt(unbilled.carry_in_nano || 0);
  const debt = BigInt(unbilled.debt_in_micro || 0);
  const nano = unbilled.calls.reduce((s, c) => s + BigInt(c.nano_usd), 0n) + carry;
  const due = nano / 1000n + debt;
  if (due <= 0n) return null;
  const charge = cap === null || cap === undefined ? due : (BigInt(cap) < due ? BigInt(cap) : due);
  if (charge <= 0n) return null;
  const usage = {
    v: 1,
    agent,
    route,
    at,
    calls: unbilled.calls.map((c) => ({ id: c.id, at: c.at, purpose: c.purpose, model: c.model, chat_id: c.chat_id, request_hash: c.request_hash, prompt_tokens: c.prompt_tokens, completion_tokens: c.completion_tokens, cached_tokens: c.cached_tokens, nano_usd: c.nano_usd })),
    carry_in_nano: String(carry),
    debt_in_micro: String(debt),
    due_micro: String(due),
    carry_out_nano: String(nano % 1000n),
    charge_micro: String(charge),
    ...(route === "escrow" ? { rate_yocto_per_micro: String(rateYoctoPerMicro), charge_yocto: String(charge * BigInt(rateYoctoPerMicro)) } : {}),
  };
  const usage_json = JSON.stringify(usage);
  return { usage, usage_json, usage_hash: sha(usage_json), due_micro: due, charge_micro: charge, call_ids: usage.calls.map((c) => c.id), carry_out_nano: nano % 1000n };
}

export class Biller {
  /**
   * @param {{ ledger: import('./ledger.js').Ledger, signer: import('./signer.js').SignerClient, rateYoctoPerMicro: bigint,
   *   balanceOf: (accountId: string) => Promise<number>, log?: (m: string) => void, now?: () => number }} o
   */
  constructor(o) {
    this.ledger = o.ledger;
    this.signer = o.signer;
    this.rate = BigInt(o.rateYoctoPerMicro || 0);
    this.balanceOf = o.balanceOf;
    this.log = o.log || (() => {});
    this.now = o.now || Date.now;
    this.busy = false;
    this.stats = { cycles: 0, bills: 0, failed: 0, lastBillAt: 0, lastError: null };
  }

  /** One billing pass over the roster. Returns what was billed. */
  async cycle(roster) {
    if (this.busy) return [];
    this.busy = true;
    const done = [];
    try {
      this.stats.cycles++;
      for (const a of roster) {
        if (!a.ok || a.closed || a.billing === "none") continue;
        try { const r = await this.billOne(a); if (r) done.push(r); }
        catch (e) { this.stats.failed++; this.stats.lastError = e.message; this.log(`billing: ${a.accountId}: ${e.message}`); }
      }
    } finally { this.busy = false; }
    return done;
  }

  async billOne(a) {
    const route = a.billing;
    const u = this.ledger.unbilled(a.accountId);
    if (u.blocked) {
      // resolve the open bill first: never bill around it
      const open = this.ledger.bills(a.accountId).find((b) => b.pending);
      const o = await this.signer.outcome(open.id);
      if (o.final !== false && !o.pending) this.ledger.recordOutcome(open.id, o);
      return null;
    }
    if (route === "escrow") {
      if (this.rate <= 0n) throw new Error("no INFERENCE_YOCTO_PER_MICRO_USD rate: escrow bills are off");
      if (a.swarm && (a.swarm.sleeping || BigInt(a.swarm.escrow_yocto || 0) === 0n)) return null; // nothing to sweep until a top-up
    }
    const cap = route === "balance" ? BigInt(Math.floor((await this.balanceOf(a.accountId)) * 1e6)) : null;
    const b = prepareBill({ agent: a.accountId, route, unbilled: u, rateYoctoPerMicro: this.rate, at: new Date(this.now()).toISOString(), cap });
    if (!b) return null;
    const id = `bill:${a.accountId}:${b.usage_hash.slice(0, 16)}`;
    this.ledger.recordIntent({ id, kind: "bill", agent: a.accountId, route, usage_hash: b.usage_hash, usage_json: b.usage_json, call_ids: b.call_ids, due_micro: String(b.due_micro), amount_micro: String(b.charge_micro), carry_out_nano: String(b.carry_out_nano), ...(route === "escrow" ? { rate_yocto_per_micro: String(this.rate) } : {}) });
    const r = await this.signer.bill(id, { agent: a.accountId, route, amount_micro: String(b.charge_micro), usage_hash: b.usage_hash });
    this.ledger.recordOutcome(id, r);
    if (!r.ok) {
      if (r.final === false || r.pending) this.log(`billing: ${a.accountId}: bill ${id} sent, outcome not known yet`);
      else { this.stats.failed++; this.stats.lastError = r.error; this.log(`billing: ${a.accountId}: ${r.error}`); }
      return { agent: a.accountId, id, ok: false, error: r.error };
    }
    this.stats.bills++;
    this.stats.lastBillAt = this.now();
    const paidYocto = route === "escrow" ? BigInt(r.value ?? 0) : null;
    const short = route === "escrow" ? paidYocto < b.charge_micro * this.rate : b.charge_micro < b.due_micro;
    if (short && a.swarm) a.swarm = { ...a.swarm, sleeping: route === "escrow" ? true : a.swarm.sleeping, escrow_yocto: route === "escrow" ? "0" : a.swarm.escrow_yocto };
    this.log(`billing: ${a.accountId}: ${route === "escrow" ? `swept ${paidYocto} yoctoNEAR` : `charged ${b.charge_micro} micro-USDC`} for ${b.call_ids.length} call(s), usage ${b.usage_hash.slice(0, 12)}${short ? " (short: the agent sleeps)" : ""}`);
    return { agent: a.accountId, id, ok: true, route, usage_hash: b.usage_hash, tx_hash: r.txHash, charge_micro: String(b.charge_micro), paid_yocto: paidYocto === null ? null : String(paidYocto), short };
  }
}
