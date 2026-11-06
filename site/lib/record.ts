// The ruling record, computed once: /rulings and /stats show the same numbers because both read this.
import type { Ruling } from "./server/api";

export interface RulingRecord {
  /** newest first */
  all: Ruling[];
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

export function rulingRecord(rulings: Ruling[]): RulingRecord {
  const all = [...rulings].sort((a, b) => b.opened_at - a.opened_at);
  const settled = all.filter((r) => r.status === "settled" && r.settled_at !== null);
  return {
    all,
    settled,
    medianMs: median(settled.map((r) => r.settled_at! - r.opened_at)),
    paidUsd: settled.reduce((n, r) => n + (r.payout_usd ?? 0), 0),
    unanimous: settled.filter((r) => r.verdicts.length >= 3 && new Set(r.verdicts.map((v) => v.verdict)).size === 1).length,
  };
}
