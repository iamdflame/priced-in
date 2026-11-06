// The ruling record, as plain rules. Every count on screen comes from /api/rulings through these.
import type { Ruling } from "./server/api";

/** Settled rulings, newest first. */
export const settledRulings = (rulings: Ruling[]): Ruling[] => rulings.filter((r) => r.status === "settled").sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0));

/**
 * The ruling to lead with: the one with the most real bets behind it (then the largest payout, then
 * the newest). Never a fact nobody bet on: with no such ruling, there is no lead.
 */
export function leadRuling(rulings: Ruling[], betsOn: (claimId: number) => number): Ruling | null {
  const ranked = settledRulings(rulings).filter((r) => betsOn(r.claim_id) > 0);
  return ranked.sort((a, b) => betsOn(b.claim_id) - betsOn(a.claim_id) || (b.payout_usd ?? 0) - (a.payout_usd ?? 0))[0] ?? null;
}

export const verdictOf = (r: Pick<Ruling, "outcome" | "provisional">) => (r.outcome ?? r.provisional ?? "").toUpperCase();

/** "No" when a fact is ruled false: the side that gets paid. */
export const winningSide = (verdict: string) => (verdict === "FALSE" ? "No" : "Yes");

/** Corrected claim id to the claim it replaced. */
export function correctionsOf(rulings: Ruling[]): Map<number, number> {
  return new Map(rulings.flatMap((r) => (r.correction ? [[r.correction.claim_id, r.claim_id] as const] : [])));
}
