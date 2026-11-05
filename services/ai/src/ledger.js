// The runner's own ledger, in ledger.jsonl under the data directory. It survives restarts:
// everything is rebuilt from the journal on start.
//
//   call      one model completion: tokens as NEAR AI Cloud reported them, cost at the live
//             /v1/models price (nano-USD, an integer). No usage reported means no cost: the
//             entry says so and it is never billed.
//   intent    a money action before it is sent: a trade, a redeem, an inference bill, an anchor.
//             A bill carries its usage record (the exact JSON whose sha256 is the usage_hash
//             that goes on-chain) and the call ids it covers.
//   outcome   what the chain said: ok with the transaction hash and the contract's return value,
//             a clear failure, or unknown (sent, not yet seen). Unknown outcomes are resolved
//             through the signer by the journaled hashes, never by sending again.
//   action    an agent's last action (bet, sell, agree, no_bet, asleep...), for the roster.
//
// P&L components come from outcomes only, using the contract's own return values, so they can
// be compared to the micro-USDC with the same figures rebuilt from chain events (pnl.js).

import { createHash } from "node:crypto";
import { costOf } from "./nearai.js";
import { Journal } from "./journal.js";

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const big = (v) => BigInt(v ?? 0);

export class Ledger {
  /**
   * @param {{ journal?: Journal|null, pricing?: (model: string) => Promise<object|null>, now?: () => number }} o
   */
  constructor({ journal = null, pricing = async () => null, now = Date.now } = {}) {
    this.journal = journal || new Journal(null);
    this.pricing = pricing;
    this.now = now;
    this.calls = [];
    this.intents = new Map(); // id -> { intent, outcome }
    this.actions = new Map(); // agent -> last action
    this.totalsBy = {};
    this.seq = 0;
    for (const r of this.journal.read()) this.apply(r);
  }

  get data() { return { calls: this.calls, bets: this.betsAll() }; } // read-only view for older callers

  apply(r) {
    if (r.t === "call") {
      this.calls.push(r);
      this.seq = Math.max(this.seq, Number(String(r.id).split(":")[1]) || 0);
      const t = (this.totalsBy[r.agent] ||= { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, nano_usd: 0, calls_without_cost: 0 });
      t.calls++;
      t.prompt_tokens += r.prompt_tokens || 0;
      t.completion_tokens += r.completion_tokens || 0;
      if (r.nano_usd === null || r.nano_usd === undefined) t.calls_without_cost++;
      else { t.cost_usd += r.cost_usd; t.nano_usd += r.nano_usd; }
    } else if (r.t === "intent") this.intents.set(r.id, { intent: r, outcome: null });
    else if (r.t === "outcome") { const x = this.intents.get(r.id); if (x) x.outcome = r; }
    else if (r.t === "action") this.actions.set(r.agent, r);
  }

  write(r) { this.journal.append(r); this.apply(r); return r; }

  /** Record one completion's usage and cost. */
  async recordCall({ agent, purpose, completion, extra = {} }) {
    let entry;
    const id = `call:${++this.seq}:${completion?.chatId ?? "none"}`;
    try {
      const m = await this.pricing(completion.model).catch(() => null);
      const usage = completion.usage || null;
      const cost = costOf(m, usage);
      entry = {
        t: "call", id, at: new Date(this.now()).toISOString(),
        agent, purpose, model: completion.model, chat_id: completion.chatId ?? null,
        request_hash: createHash("sha256").update(completion.requestBytes).digest("hex"),
        prompt_tokens: usage?.prompt_tokens ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
        cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null,
        cost_usd: cost,
        nano_usd: cost === null ? null : Math.round(cost * 1e9),
        cost_basis: cost === null ? (usage ? "no price for this model in /v1/models" : "no usage reported") : "usage x /v1/models pricing",
        ...extra,
      };
    } catch (e) {
      entry = { t: "call", id, at: new Date(this.now()).toISOString(), agent, purpose, model: completion?.model ?? null, error: e.message, cost_usd: null, nano_usd: null };
    }
    return this.write(entry);
  }

  recordIntent(intent) { return this.write({ t: "intent", at: new Date(this.now()).toISOString(), day: day(this.now()), ...intent }); }

  recordOutcome(id, o) {
    return this.write({ t: "outcome", id, at: new Date(this.now()).toISOString(), ok: Boolean(o.ok), final: o.final !== false, tx_hash: o.txHash ?? o.tx_hash ?? null, value: o.value ?? null, error: o.error ?? null });
  }

  recordAction(agent, action) { return this.write({ t: "action", agent, at: new Date(this.now()).toISOString(), ...action }); }

  /** A bet placed outside the intent flow (older callers, tests). */
  async recordBet(bet) {
    const id = `bet:${this.now()}:${Math.random().toString(36).slice(2)}`;
    this.recordIntent({ id, kind: "trade", agent: bet.agent, claim_id: bet.claim_id, decision: { action: "buy", side: bet.side } });
    this.recordOutcome(id, { ok: true, txHash: bet.tx_hash ?? null, value: { claim_id: bet.claim_id, side: bet.side, amount_micro: String(bet.amount_micro), shares_micro: String(bet.shares_micro ?? 0) } });
  }

  /** Intents whose outcome is not final yet. */
  pending() { return [...this.intents.values()].filter((x) => !x.outcome || x.outcome.final === false).map((x) => x.intent); }

  /** Successful trades: { claim_id, action, side, amount_micro, shares_micro, day }. */
  trades(agent, { today = false } = {}) {
    const d = day(this.now());
    const out = [];
    for (const { intent, outcome } of this.intents.values()) {
      if (intent.kind !== "trade" || intent.agent !== agent || !outcome?.ok) continue;
      if (today && intent.day !== d) continue;
      const v = outcome.value || {};
      const sell = String(v.side || "").startsWith("sell_");
      out.push({ claim_id: Number(v.claim_id ?? intent.claim_id), action: sell ? "sell" : "buy", side: String(v.side || intent.decision?.side).replace(/^sell_/, ""), amount_micro: String(v.amount_micro ?? 0), shares_micro: String(v.shares_micro ?? 0), tx_hash: outcome.tx_hash, day: intent.day });
    }
    return out;
  }

  betsToday(agent) { return this.trades(agent, { today: true }); }
  betsAll() { return [...this.intents.values()].filter((x) => x.intent.kind === "trade" && x.outcome?.ok).map((x) => ({ agent: x.intent.agent, ...x.outcome.value })); }

  // ---------- inference bills ----------

  bills(agent) {
    return [...this.intents.values()].filter((x) => x.intent.kind === "bill" && x.intent.agent === agent).map(({ intent, outcome }) => {
      const failed = Boolean(outcome?.final !== false && outcome && !outcome.ok);
      const pending = !outcome || outcome.final === false;
      let paid = 0n, paidYocto = null;
      if (outcome?.ok) {
        if (intent.route === "escrow") { paidYocto = big(outcome.value); paid = paidYocto / big(intent.rate_yocto_per_micro); }
        else paid = big(intent.amount_micro);
      }
      return { ...intent, failed, pending, paid_micro: paid, paid_yocto: paidYocto, debt_out_micro: failed || pending ? null : big(intent.due_micro) - paid, tx_hash: outcome?.tx_hash ?? null };
    });
  }

  /** What an agent owes and has not been billed for yet. */
  unbilled(agent) {
    const bills = this.bills(agent).filter((b) => !b.failed);
    const covered = new Set(bills.flatMap((b) => b.call_ids || []));
    const calls = this.calls.filter((c) => c.agent === agent && Number.isInteger(c.nano_usd) && !covered.has(c.id));
    const last = bills.at(-1) || null;
    return {
      calls,
      blocked: bills.some((b) => b.pending) ? "a bill for this agent has no final outcome yet" : null,
      carry_in_nano: last ? Number(last.carry_out_nano || 0) : 0,
      debt_in_micro: last && !last.pending ? last.debt_out_micro : 0n,
    };
  }

  /** Total debt (billed, not paid) for an agent. */
  debt(agent) { const u = this.unbilled(agent); return u.debt_in_micro || 0n; }

  billByHash(hash) {
    for (const { intent, outcome } of this.intents.values()) if (intent.kind === "bill" && intent.usage_hash === hash) return { intent, outcome };
    return null;
  }

  totals() { return this.totalsBy; }

  /**
   * The runner's P&L components per agent, from outcomes only (the contract's own figures):
   * cost and proceeds of trades, redemptions, inference charged from the balance, escrow swept
   * (yoctoNEAR, and in micro-USD at each bill's rate), and the shares still held per claim.
   */
  pnl() {
    const out = {};
    const row = (a) => (out[a] ||= { cost_micro: 0n, proceeds_micro: 0n, redeemed_micro: 0n, charged_micro: 0n, swept_yocto: 0n, swept_micro: 0n, trades: 0, bills: 0, positions: {}, redeemedClaims: new Set() });
    for (const { intent, outcome } of this.intents.values()) {
      if (!outcome?.ok || !intent.agent) continue;
      const r = row(intent.agent);
      if (intent.kind === "trade") {
        const v = outcome.value || {};
        const side = String(v.side || "");
        const sell = side.startsWith("sell_");
        const s = side.replace(/^sell_/, "");
        const claim = String(v.claim_id ?? intent.claim_id);
        const p = (r.positions[claim] ||= { yes: 0n, no: 0n });
        if (sell) { r.proceeds_micro += big(v.amount_micro); p[s] -= big(v.shares_micro); }
        else { r.cost_micro += big(v.amount_micro); p[s] += big(v.shares_micro); }
        r.trades++;
      } else if (intent.kind === "redeem") {
        r.redeemed_micro += big(outcome.value);
        r.redeemedClaims.add(String(intent.claim_id));
      } else if (intent.kind === "bill") {
        r.bills++;
        if (intent.route === "escrow") { const y = big(outcome.value); r.swept_yocto += y; r.swept_micro += y / big(intent.rate_yocto_per_micro); }
        else r.charged_micro += big(intent.amount_micro);
      }
    }
    for (const r of Object.values(out)) {
      for (const c of r.redeemedClaims) r.positions[c] = { yes: 0n, no: 0n }; // redeem clears the whole position
      delete r.redeemedClaims;
    }
    return out;
  }
}

/** Today's trades marked to market: what they cost, minus what they returned and are worth now. */
export function dailyLoss(trades, claimsById) {
  let cost = 0, back = 0;
  const net = new Map();
  for (const t of trades) {
    const shares = Number(t.shares_micro || 0) / 1e6;
    const k = `${t.claim_id}|${t.side}`;
    if (t.action === "sell") { back += Number(t.amount_micro) / 1e6; net.set(k, (net.get(k) || 0) - shares); }
    else { cost += Number(t.amount_micro) / 1e6; net.set(k, (net.get(k) || 0) + shares); }
  }
  let value = 0;
  for (const [k, shares] of net) {
    if (shares <= 0) continue;
    const [id, side] = k.split("|");
    const c = claimsById.get(Number(id));
    if (!c) continue; // unknown now: counts as worth nothing (conservative)
    const pYes = c.outcome === true ? 1 : c.outcome === false ? 0 : c.price_yes_ppm / 1e6;
    value += shares * (side === "yes" ? pYes : 1 - pYes);
  }
  return Math.max(0, cost - back - value);
}
