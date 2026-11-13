// The live strip's items: the AI judges' rulings, newest first, from /api/rulings. Each item reads on its
// own ("Ruled false by 3 AI judges: Did weekly DEX volume average about $18.6B in mid-2025?"). A ruling
// still open to objection says so; a challenge that expired without a quorum isn't a ruling and is left out.
import type { Ruling } from "./server/api";

export interface StripRuling {
  claimId: number;
  /** the outcome the judges gave: final once settled, provisional while the window is open */
  outcome: boolean;
  /** settled, or still open to objection */
  final: boolean;
  /** how many judges signed that outcome */
  judges: number;
  /** when it settled, or when the judges ruled */
  at: number;
  /** the challenge, so two rulings on one claim stay two items */
  key: string;
}

const asBool = (v: string | null | undefined) => (v === "TRUE" || v === "true" ? true : v === "FALSE" || v === "false" ? false : null);

/** Rulings for the strip, newest first: settled ones and those open to objection. */
export function stripRulings(rulings: Ruling[]): StripRuling[] {
  const out: StripRuling[] = [];
  for (const r of rulings) {
    const final = r.status === "settled";
    const outcome = asBool(final ? r.outcome : r.status === "window" ? r.provisional : null);
    if (outcome === null) continue;
    const at = (final ? r.settled_at : r.provisional_at) ?? r.opened_at;
    const judges = r.verdicts.filter((v) => asBool(v.verdict) === outcome).length;
    out.push({ claimId: r.claim_id, outcome, final, judges, at, key: `${r.challenge_id}` });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** "Ruled false by 3 AI judges" or, inside the window, "Ruled false, open to objection". */
export function rulingWords(r: StripRuling): { verdict: string; rest: string } {
  const verdict = `Ruled ${r.outcome ? "true" : "false"}`;
  if (!r.final) return { verdict, rest: ", open to objection" };
  return { verdict, rest: r.judges > 0 ? ` by ${r.judges} AI judge${r.judges === 1 ? "" : "s"}` : "" };
}
