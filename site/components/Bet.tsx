"use client";
// Yes and No, saying what they mean and what $1 gets back. On a card they open the fact's page with the
// side picked (a real link, so it works before scripts load); the tap marks intent, so the ticket can
// ask for the free $1 key at once.
import Link from "next/link";
import { markIntent } from "@/lib/engine";
import { backUsd, type Quotes } from "@/lib/quote";

export function BetLinks({ id, quotes, question, recorded = false, size = "card" }: { id: number; quotes: Quotes | null; question: string; recorded?: boolean; size?: "card" | "feature" }) {
  if (!quotes) return null;
  const href = (side: "yes" | "no") => `/c/${id}?side=${side}${recorded ? "&recorded=1" : ""}`;
  const line = (side: "yes" | "no") => (size === "feature" ? <>Bet $1 → get {backUsd(quotes[side])}<span className="bk"> back</span></> : <>Bet $1 → get {backUsd(quotes[side])}</>);
  return (
    <div className="bets">
      <Link className="bet yes" href={href("yes")} onClick={markIntent} prefetch={false}
        aria-label={`Yes, it’s true. Bet $1, get ${backUsd(quotes.yes)} back if you’re right. ${question}`}>
        <b>Yes, it’s true</b><small>{line("yes")}</small>
      </Link>
      <Link className="bet no" href={href("no")} onClick={markIntent} prefetch={false}
        aria-label={`No, it’s false. Bet $1, get ${backUsd(quotes.no)} back if you’re right. ${question}`}>
        <b>No, it’s false</b><small>{line("no")}</small>
      </Link>
    </div>
  );
}
