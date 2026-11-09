// Real bets as plain sentences ("The Quant bet $0.13 that the “backed 100%” fact is true"), from the
// market contract's own event log (/events/recent). Shared by the server render and the live client.
import type { MarketEvent } from "./core/api";
import { traderName, type AgentNames } from "./format";

export interface Bet {
  claimId: number;
  /** "The Quant", "Someone" */
  who: string;
  kind: "agent" | "visitor" | "account";
  trader: string;
  side: "yes" | "no";
  /** dollars in */
  usd: number;
  shares: number;
  /** a free $1 from the lane */
  free: boolean;
  priceBefore: number | null;
  priceAfter: number;
  at: number;
  tx: string | null;
}

/** Every buy in the log, oldest first, with the price it moved from. Sells are left out. */
export function betsFrom(events: MarketEvent[], agents: AgentNames, opens: Record<number, number> = {}): Bet[] {
  const last = new Map<number, number>();
  const out: Bet[] = [];
  for (const e of [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    if (e.event !== "trade" || e.source === "ai") continue;
    const d = e.data || {};
    const id = Number(d.claim_id);
    const after = Number(d.price_yes_ppm) / 1e6;
    const before = last.has(id) ? last.get(id)! : opens[id] !== undefined ? opens[id] / 1e6 : null;
    last.set(id, after);
    if (d.side !== "yes" && d.side !== "no") continue;
    const t = traderName(String(d.trader || ""), agents);
    out.push({
      claimId: id, who: t.name, kind: t.kind, trader: String(d.trader || ""), side: d.side, usd: Number(d.amount_micro || 0) / 1e6,
      shares: Number(d.shares_micro || 0) / 1e6, free: String(d.trader || "").startsWith("lane:"), priceBefore: before, priceAfter: after,
      at: e.blockTimestampMs ?? e.seenAtMs ?? 0, tx: e.txHash ?? null,
    });
  }
  return out;
}

/** Who bet, for a line on its own: "AI trader Archivist", "Someone". */
export const bettor = (b: Bet) => (b.free ? "Someone" : b.kind === "agent" ? `AI trader ${b.who.replace(/^The /, "")}` : b.who);

/** One line of the live strip: a bet, and how many identical ones it stands for. */
export interface BetLine { bet: Bet; times: number }

/**
 * The live strip's lines, in the order given: bets that would read the same (same bettor, side, fact and
 * amount to the cent) become one line that says how many times, so the strip never shows two twins.
 */
export function betLines(bets: Bet[]): BetLine[] {
  const out: BetLine[] = [];
  const seen = new Map<string, BetLine>();
  for (const b of bets) {
    const key = `${bettor(b)}|${b.claimId}|${b.side}|${b.free ? "free" : Math.round(b.usd * 100)}`;
    const line = seen.get(key);
    if (line) { line.times++; continue; }
    const fresh = { bet: b, times: 1 };
    seen.set(key, fresh);
    out.push(fresh);
  }
  return out;
}

/** "bet $0.12 twice that it’s", "bet the free $1 that it’s": the middle of a strip line, in plain words. */
export function betWords(l: BetLine): string {
  const amount = l.bet.free ? "the free $1" : `$${l.bet.usd.toFixed(2)}`;
  const times = l.times === 2 ? " twice" : l.times > 2 ? ` ${l.times} times` : "";
  return `bet ${amount}${times} that it’s`;
}
