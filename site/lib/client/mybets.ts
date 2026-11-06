// The bets this browser placed, kept in localStorage: the free $1 is one per browser key, so the ticket
// can say "you've used your free $1" before a tap.

export interface MyBet {
  claimId: number;
  question: string;
  side: "yes" | "no";
  tx: string | null;
  at: number;
  shares: number | null;
}

export const BETS_KEY = "pricedin.bets.v1";

export function myBets(): MyBet[] {
  try { return JSON.parse(localStorage.getItem(BETS_KEY) || "[]"); } catch { return []; }
}

export function saveBet(b: MyBet) {
  try {
    localStorage.setItem(BETS_KEY, JSON.stringify([b, ...myBets().filter((x) => x.tx !== b.tx)].slice(0, 20)));
  } catch { /* private mode: this visit still works */ }
}
