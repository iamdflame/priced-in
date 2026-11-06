"use client";
// The bets this browser placed, kept in localStorage (the free $1 is one per browser key), so the ticket
// can say "you've used your free $1" before a tap, and the receipt can be opened again.

export interface MyBet {
  claimId: number;
  question: string;
  side: "yes" | "no";
  tx: string | null;
  at: number;
  before: number | null;
  after: number | null;
  shares: number | null;
  finalMs: number | null;
  recorded: boolean;
}

export const BETS_KEY = "pricedin.bets.v1";

export function myBets(): MyBet[] {
  try { return JSON.parse(localStorage.getItem(BETS_KEY) || "[]"); } catch { return []; }
}

export function saveBet(b: MyBet) {
  if (b.recorded) return; // a replay is not a bet
  try {
    const list = myBets().filter((x) => !(x.tx && x.tx === b.tx));
    localStorage.setItem(BETS_KEY, JSON.stringify([b, ...list].slice(0, 20)));
  } catch { /* private mode: this visit still works */ }
}
