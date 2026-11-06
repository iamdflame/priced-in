// An AI trader's reason, as the /agents feed shows it. Kept out of the client component so the server
// page and the feed count bets and holds by the same rule.
export interface ReasonItem {
  persona: string;
  claimId: number;
  question: string;
  /** "yes", "no", "sell_yes", "sell_no", "agree" or "no_bet" */
  side: string;
  sizeUsd: number;
  /** its own estimate, written before it saw the price */
  credence: number;
  priceBefore: number;
  rationale: string;
  /** the policy's reason for holding off */
  why: string | null;
  at: number;
  tx: string | null;
  source: string | null;
  sourceTitle: string | null;
}

/** True when the agent moved money; false when it agreed with the price or held off. */
export const isBetSide = (side: string) => side === "yes" || side === "no" || side.startsWith("sell");
