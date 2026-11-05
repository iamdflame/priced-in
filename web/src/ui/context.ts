// What every view shares: the engine, the mode (live or recorded), who the traders are, the
// recent trade history per sentence, and the plain words for trades and for each doubt stage.
import type { Api } from "../core/api";
import type { Config } from "../core/config";
import type { Router } from "../core/router";
import type { AppState, DoubtState, Sentence, Store } from "../core/store";
import { explorerTx, h, host, pct, traderName, usd, type Child } from "./dom";
import { todayFor } from "./data";

export type Mode = "live" | "recorded";

export interface Ctx {
  store: Store;
  api: Api;
  config: Config;
  router: Router;
  mode: Mode;
  card: boolean;
  recordedDate: string | null;
  history: TradeHistory;
  agents: AgentBook;
  openVerify(page: string, rewriteId: string, opener?: HTMLElement): void;
}

export interface Trade { claimId: number; trader: string; side: string; amountUsd: number; priceBefore: number | null; priceAfter: number; txHash: string | null; at: number; mine: boolean }

/** Recent trades per sentence, from /events/recent, then kept up to date from the store. */
export class TradeHistory {
  private by = new Map<number, Trade[]>();
  private seen = new Set<string>();
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
    const list = this.by.get(t.claimId) || [];
    if (t.priceBefore === null && list.length) t.priceBefore = list[0].priceAfter;
    list.unshift(t);
    this.by.set(t.claimId, list.slice(0, 20));
    return true;
  }
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

/** The lettering on a trader's dish: an agent's name, or the account's first label. */
export function dishName(trader: string, agents: AgentBook): { name: string; house: boolean } {
  const a = agents.of(trader);
  if (a) return { name: a.name, house: a.house };
  if (trader.startsWith("lane:")) return { name: "a visitor", house: false };
  return { name: trader.split(".")[0].slice(0, 18), house: false };
}

/** "An AI agent bet $1.50 that this is false. The price fell from 30% to 18%." */
export function tradeWords(t: Trade, agents: AgentBook): string {
  const a = agents.of(t.trader);
  const who = t.mine ? "You" : a ? `${a.name}, ${a.house ? "a house agent" : "an AI agent"},` : traderName(t.trader);
  const bet = t.side === "sell_yes" || t.side === "sell_no" ? `sold ${usd(t.amountUsd)} of ${t.side === "sell_yes" ? "yes" : "no"}` : `bet ${usd(t.amountUsd)} that this is ${t.side === "no" ? "false" : "true"}`;
  const move = t.priceBefore === null ? ` The price is now ${pct(t.priceAfter)}.` : Math.round(t.priceBefore * 100) === Math.round(t.priceAfter * 100) ? ` The price held at ${pct(t.priceAfter)}.` : ` The price ${t.priceAfter < t.priceBefore ? "fell" : "rose"} from ${pct(t.priceBefore)} to ${pct(t.priceAfter)}.`;
  return `${who} ${bet}.${move}`;
}

/** What the source says today, for a sentence the audit found out of date. */
export function todayLine(s: Sentence): Child {
  const t = todayFor(s.original) ?? todayFor(s.text);
  if (!t) return null;
  return h("span", { class: "today" }, "The ", t.source ? h("a", { href: t.source, target: "_blank", rel: "noopener nofollow" }, "source") : "source", ` says today: ${t.today.replace(/\.$/, "")}.`);
}

/** Plain words for the doubt in flight on a sentence, or null when there is none. */
export function doubtWords(d: DoubtState, s: Sentence, ctx: Ctx, onRetry: () => void): Child[] | null {
  if (!d.ctx || d.ctx.key !== s.key || d.stage === "idle") return null;
  const c = d.ctx;
  const before = c.priceBefore;
  const now = ctx.store.derived.price(s);
  const rec = ctx.mode === "recorded";
  const tx = c.txHash && !rec ? h("a", { href: explorerTx(ctx.config.network, c.txHash), target: "_blank", rel: "noopener" }, "See it on NEAR") : null;
  switch (d.stage) {
    case "quoting":
      return c.waitingFor === "lane"
        ? ["Preparing your $1 in this browser. The ink already moved on the quote."]
        : ["Your $1 says this is false. The ink moved on the quote."];
    case "signing":
      return [rec ? "Rehearsing your $1 on the recorded market." : "Signed in this browser. Sending it to NEAR."];
    case "optimistic":
      return [rec ? "Rehearsing your $1 on the recorded market." : "NEAR executed it. Waiting for it to be final.", c.finalNote ? h("span", { class: "note" }, c.finalNote) : null];
    case "final":
    case "rewritten":
    case "answered": {
      const moved = before !== null && now !== null ? `from ${pct(before)} to ${pct(now)}` : `to ${pct(now)}`;
      const out: Child[] = rec
        ? [h("b", {}, "Rehearsed."), ` Your $1 would move this line ${moved}. Nothing was sent: this is recorded data.`]
        : [`You moved this line ${moved}. `, tx, tx ? "." : null];
      if (d.stage === "rewritten" || d.stage === "answered") out.push(h("span", { class: "note rw-note" }, "The page rewrote the line to match its new price."));
      if (c.answer) {
        const a = c.answer;
        const src = a.source_url ? h("a", { href: a.source_url, target: "_blank", rel: "noopener nofollow" }, a.source_title || host(a.source_url) || "source") : null;
        const act = a.side === "agree" ? "agrees with the price" : a.side === "no_bet" ? "disagrees but didn't bet" : `bet ${usd(a.size_usd)} that it is ${a.side === "no" ? "false" : "true"}`;
        out.push(h("span", { class: "note" }, h("b", {}, a.agent), `${a.house ? ", a house agent," : ""} answered: it ${act}. `, h("q", {}, a.rationale || a.text), " ", src));
      }
      return out;
    }
    case "failed": {
      const f = d.failure!;
      const out: Child[] = [h("span", { class: "red" }, f.message), " "];
      if (f.readOnly) out.push("Every price still updates live. ");
      if (f.retryable) out.push(h("button", { class: "link-btn", type: "button", onclick: onRetry }, "Try again"));
      return out;
    }
  }
  return null;
}

/** The doubt button's words and state for a sentence. */
export function doubtButton(state: AppState, s: Sentence, priceable: boolean, recorded = false): { label: string; cls: string; disabled: boolean } {
  const d = state.doubt;
  const mine = d.ctx?.key === s.key;
  if (!priceable) return { label: s.status === "settled" ? "Settled" : "Nothing to bet on", cls: "", disabled: true };
  if (mine) {
    if (d.stage === "quoting" && d.ctx?.waitingFor === "lane") return { label: "Preparing your $1", cls: "busy", disabled: true };
    if (d.stage === "quoting" || d.stage === "signing" || d.stage === "optimistic") return { label: "Sending your $1", cls: "busy", disabled: true };
    if (d.stage === "final" || d.stage === "rewritten" || d.stage === "answered") return { label: recorded ? "Rehearsed." : "Priced.", cls: "done", disabled: true };
    if (d.stage === "failed" && d.failure && !d.failure.retryable) return { label: "Doubt it · $1", cls: "", disabled: true };
  } else if (d.stage === "quoting" || d.stage === "signing" || d.stage === "optimistic") {
    return { label: "Doubt it · $1", cls: "", disabled: true };
  }
  return { label: "Doubt it · $1", cls: "", disabled: false };
}

/** The half-filled full stop, the brand's mark. */
export function markSvg(fill = 0.5, size = 22) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const y = 1.8 + 16.4 * (1 - fill);
  svg.innerHTML = `<defs><clipPath id="m${size}${Math.round(fill * 100)}"><circle cx="10" cy="10" r="8.2"/></clipPath></defs><rect x="0" y="${y.toFixed(2)}" width="20" height="20" fill="currentColor" clip-path="url(#m${size}${Math.round(fill * 100)})"/><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
  return svg;
}
