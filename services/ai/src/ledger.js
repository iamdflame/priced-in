// Metered inference: every model call by every house agent (and the writer and jury), with
// its tokens as NEAR AI Cloud reported them and its cost at the live /v1/models price, in a
// local JSON ledger. No usage reported means no cost recorded: the entry says so.
//
// TODO(contract): the on-chain half is `charge_inference(agent, nano_usd, usage_hash)` on
// the market (BLUEPRINT-draft §B.2): hourly, move each agent's metered cost from its
// inference escrow to the operator, with usage_hash = sha256 of the ledger entries charged.
// The market contract has no such method yet, so nothing here is charged on-chain and no
// on-chain figure is claimed.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { costOf } from "./nearai.js";

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

export class Ledger {
  /**
   * @param {{ file?: string|null, pricing?: (model: string) => Promise<object|null>, now?: () => number, maxCalls?: number }} o
   */
  constructor({ file = null, pricing = async () => null, now = Date.now, maxCalls = 20_000 } = {}) {
    this.file = file;
    this.pricing = pricing;
    this.now = now;
    this.maxCalls = maxCalls;
    this.data = { version: 1, note: "costs at the live NEAR AI Cloud /v1/models price per token; on-chain charge_inference is not implemented yet", calls: [], bets: [], totals: {} };
    if (file && fs.existsSync(file)) {
      try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch { /* a broken ledger starts fresh; the old file is kept */ fs.renameSync(file, `${file}.broken-${this.now()}`); }
    }
    this.writing = Promise.resolve();
  }

  /** Record one completion's usage and cost. */
  async recordCall({ agent, purpose, completion, extra = {} }) {
    let entry;
    try {
      const m = await this.pricing(completion.model).catch(() => null);
      const usage = completion.usage || null;
      const cost = costOf(m, usage);
      entry = {
        at: new Date(this.now()).toISOString(),
        agent, purpose, model: completion.model, chat_id: completion.chatId ?? null,
        request_hash: createHash("sha256").update(completion.requestBytes).digest("hex"),
        prompt_tokens: usage?.prompt_tokens ?? null,
        completion_tokens: usage?.completion_tokens ?? null,
        cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? null,
        cost_usd: cost,
        cost_basis: cost === null ? (usage ? "no price for this model in /v1/models" : "no usage reported") : "usage x /v1/models pricing",
        ...extra,
      };
    } catch (e) {
      entry = { at: new Date(this.now()).toISOString(), agent, purpose, model: completion?.model ?? null, error: e.message, cost_usd: null };
    }
    this.data.calls.push(entry);
    if (this.data.calls.length > this.maxCalls) this.data.calls.splice(0, this.data.calls.length - this.maxCalls);
    const t = (this.data.totals[agent] ||= { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, calls_without_cost: 0 });
    t.calls++;
    t.prompt_tokens += entry.prompt_tokens || 0;
    t.completion_tokens += entry.completion_tokens || 0;
    if (entry.cost_usd === null) t.calls_without_cost++;
    else t.cost_usd += entry.cost_usd;
    await this.save();
    return entry;
  }

  /** Record a bet a house agent placed (for the daily loss limit). */
  async recordBet(bet) {
    this.data.bets.push({ at: new Date(this.now()).toISOString(), day: day(this.now()), ...bet });
    if (this.data.bets.length > this.maxCalls) this.data.bets.splice(0, this.data.bets.length - this.maxCalls);
    await this.save();
  }

  betsToday(agent) {
    const d = day(this.now());
    return this.data.bets.filter((b) => b.agent === agent && b.day === d);
  }

  totals() { return this.data.totals; }

  save() {
    if (!this.file) return Promise.resolve();
    this.writing = this.writing.then(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
      fs.renameSync(tmp, this.file);
    }).catch(() => {});
    return this.writing;
  }
}
