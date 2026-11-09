// The ruling record, as plain rules. Every count on screen comes from /api/rulings through these.
import type { BondResult, Dispute, Ruling, Rulings, RulingsWire, Scheduled } from "./server/api";

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

/**
 * What the market said just before a ruling: the last price in its history before the settlement, 0 to 1.
 * A settled fact's own price is its outcome (0 or 1), never what the money thought. With no settlement time,
 * trailing points at exactly 0 or 1 are the settlement itself and are skipped (an open market never sits
 * there). Null when there is no such point.
 * @param points [t_ms, price_yes_ppm] in time order
 */
export function priceBeforeRuling(points: [number, number][] | undefined, settledAt: number | null | undefined): number | null {
  if (!points?.length) return null;
  const before = typeof settledAt === "number" && Number.isFinite(settledAt) ? points.filter(([t]) => t < settledAt) : [...points];
  while (settledAt == null && before.length > 1 && (before.at(-1)![1] <= 0 || before.at(-1)![1] >= 1e6)) before.pop();
  const last = before.at(-1);
  return last ? last[1] / 1e6 : null;
}

/** When the AI judges take this fact, from the API's schedule; null when it isn't queued (or the API is older). */
export function decideTime(doc: { schedule?: Scheduled[] } | null | undefined, claimId: number, now = Date.now()): Scheduled | null {
  const hit = doc?.schedule?.find((s) => s.claim_id === claimId) ?? null;
  return hit && hit.at > now ? hit : null;
}

/**
 * The API's sentence about the next ruling, for the rail and /rulings. Sentences for people start with a
 * capital; the older API's internal notes ("the Checker challenges the next caught line…") never reach a page.
 */
export function rulingNote(doc: { next_ruling_note?: string }): string | null {
  const note = doc.next_ruling_note?.trim();
  return note && /^[A-Z]/.test(note) ? note : null;
}

/**
 * The API sends ruling_now as a short summary (a stage, no challenger, verdicts without transactions).
 * Readers get the full record from the same answer, so `ruling_now` really is a Ruling.
 */
export function resolveRulingNow(doc: RulingsWire): Rulings {
  const id = doc.ruling_now?.challenge_id;
  return { ...doc, ruling_now: id === undefined ? null : doc.rulings.find((r) => r.challenge_id === id) ?? null };
}

export interface RulingRecord {
  /** newest first */
  all: Ruling[];
  /** newest first */
  settled: Ruling[];
  /** doubt to paid, in ms; null before the first settlement */
  medianMs: number | null;
  paidUsd: number;
  /** settled rulings where all three judges gave the same verdict */
  unanimous: number;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The record /rulings, /stats and their share cards all show, computed in one place. */
export function rulingRecord(rulings: Ruling[]): RulingRecord {
  const settled = settledRulings(rulings).filter((r) => r.settled_at !== null);
  return {
    all: [...rulings].sort((a, b) => b.opened_at - a.opened_at),
    settled,
    medianMs: median(settled.map((r) => r.settled_at! - r.opened_at)),
    paidUsd: settled.reduce((n, r) => n + (r.payout_usd ?? 0), 0),
    unanimous: settled.filter((r) => r.verdicts.length >= 3 && new Set(r.verdicts.map((v) => v.verdict)).size === 1).length,
  };
}

// ---------- objections ----------

const usd = (x: number) => `$${x.toFixed(2)}`;
const said = (outcome: string | null | undefined) => (String(outcome).toUpperCase() === "TRUE" ? "true" : "false");

/** What a new objection posts now: the API's figure from get_challenge, else twice the last bond posted. */
export const nextBondUsd = (r: Pick<Ruling, "dispute_bond_usd" | "disputes" | "bond_usd">): number => r.dispute_bond_usd ?? 2 * (r.disputes.at(-1)?.bond_usd ?? r.bond_usd);

/** What became of one bond, in one sentence ("Its", or "The challenger’s"); null while the ruling runs. */
export function bondFate(result: BondResult | undefined, bondUsd: number, paidUsd: number | null | undefined, whose = "Its"): string | null {
  const b = usd(bondUsd);
  if (result === "won") {
    const extra = paidUsd !== null && paidUsd !== undefined ? paidUsd - bondUsd : 0;
    return extra >= 0.005 ? `${whose} ${b} bond came back with ${usd(extra)} from the losing side: ${usd(paidUsd!)} in all.` : `${whose} ${b} bond came back.`;
  }
  if (result === "lost") return `${whose} ${b} bond paid the winning side.`;
  if (result === "forfeit") return `No bond was on the winning side, so ${whose.charAt(0).toLowerCase()}${whose.slice(1)} ${b} went to the treasury.`;
  if (result === "returned") return `${whose} ${b} bond came back in full.`;
  return null;
}

/** One objection, as a sentence: who, which way, what it cost and what it did. */
export function objectionWords(d: Dispute, max = 3): string {
  const what = Number(d.round) >= max ? "The third objection sends it to the market’s council" : `It flipped the ruling to ${said(d.proposed)} and opened a new window`;
  return `${String(d.who ?? d.trader).replace(/^the /, "The ")} says it’s ${said(d.proposed)}, with a ${usd(d.bond_usd)} bond (twice the last). ${what}.`;
}

/** The window line: open now, how many objections, or nobody objected. */
export function objectionsSummary(r: Pick<Ruling, "status" | "disputes" | "escalated">): string {
  const n = r.disputes.length;
  if (r.escalated || r.status === "escalated") return `${n} filed: the market’s council decides`;
  if (r.status === "window") return n ? `${n} filed so far, and still open` : "open now";
  return n ? `${n} filed` : "nobody objected";
}
