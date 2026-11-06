// TradeHistory and AgentBook, copied from web/src/ui/context.ts (the proven engine's view context).
// The DOM helpers there are replaced by React components in this site.
import type { Api } from "./api";
import type { AppState, Sentence } from "./store";

export interface Trade { claimId: number; trader: string; side: string; amountUsd: number; priceBefore: number | null; priceAfter: number; txHash: string | null; at: number; mine: boolean }

/** Recent trades per sentence, from /events/recent, then kept up to date from the store. */
export class TradeHistory {
  private by = new Map<number, Trade[]>();
  private seen = new Set<string>();
  /** every distinct trade per sentence, counted once by its transaction: the one source for "N bets" */
  private tally = new Map<number, { n: number; usd: number }>();
  private loaded = false;
  async load(api: Api, mineTrader: () => string) {
    if (this.loaded) return;
    this.loaded = true;
    const r = await api.recentEvents(0);
    if (!r.ok) return;
    const last = new Map<number, number>();
    for (const e of [...r.value.events].sort((a, b) => a.seq - b.seq)) {
      if (e.event !== "trade" || e.source === "ai") continue;
      const d = e.data || {};
      const id = Number(d.claim_id);
      const after = Number(d.price_yes_ppm) / 1e6;
      this.add({ claimId: id, trader: d.trader, side: d.side, amountUsd: Number(d.amount_micro || 0) / 1e6, priceBefore: last.get(id) ?? null, priceAfter: after, txHash: e.txHash ?? null, at: e.blockTimestampMs ?? e.seenAtMs ?? 0, mine: d.trader === mineTrader() });
      last.set(id, after);
    }
  }
  add(t: Trade) {
    const k = t.txHash ? `${t.txHash}:${t.claimId}` : `${t.claimId}:${t.trader}:${t.priceAfter}:${t.at}`;
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    const c = this.tally.get(t.claimId) || { n: 0, usd: 0 };
    this.tally.set(t.claimId, { n: c.n + 1, usd: c.usd + t.amountUsd });
    const list = this.by.get(t.claimId) || [];
    if (t.priceBefore === null && list.length) t.priceBefore = list[0].priceAfter;
    list.unshift(t);
    this.by.set(t.claimId, list.slice(0, 20));
    return true;
  }
  /** How many distinct bets this sentence has had, and their dollars. */
  count(claimId: number | null) { return claimId === null ? { n: 0, usd: 0 } : this.tally.get(claimId) || { n: 0, usd: 0 }; }
  /** Newest first. */
  of(claimId: number | null): Trade[] { return claimId === null ? [] : this.by.get(claimId) || []; }
  /** Take in live trades the store has seen on this page's sentences. Returns the new ones. */
  absorb(sentences: Sentence[]): Trade[] {
    const fresh: Trade[] = [];
    for (const s of sentences) {
      if (s.claimId === null) continue;
      for (const m of [...s.movers].reverse()) {
        const t: Trade = { claimId: s.claimId, trader: m.trader, side: m.side, amountUsd: m.amountUsd, priceBefore: null, priceAfter: m.priceAfter, txHash: m.txHash ?? null, at: m.at, mine: m.mine };
        if (this.add(t)) fresh.push(t);
      }
    }
    return fresh;
  }
}

/** Agents by account: from the roster and from the rationales they publish. */
export class AgentBook {
  private by = new Map<string, { name: string; house: boolean; model: string | null }>();
  learn(account: string | null | undefined, name: string, house: boolean, model: string | null = null) {
    if (account && name) this.by.set(account, { name, house, model });
  }
  of(account: string) { return this.by.get(account) || null; }
  all() { return [...this.by.entries()].map(([account, v]) => ({ account, ...v })); }
  learnFrom(state: AppState) {
    for (const r of state.page.rationales) this.learn(r.account_id, r.agent, r.house, r.model);
    for (const a of state.page.aiStatus?.agents?.roster || []) this.learn(a.account_id, a.name, a.house, a.model);
  }
}

