"use client";
// Yes and No, saying what they mean and, in plain money, what you get if you're right. On a card they
// open the fact's page with the side picked (a real link, so it works before scripts load); the tap marks
// intent, so the ticket can ask for the free $1 key at once.
import Link from "next/link";
import { markIntent } from "@/lib/client/intent";
import { payoutWords, type Quotes } from "@/lib/quote";

export function BetLinks({ id, quotes, question }: { id: number; quotes: Quotes | null; question: string }) {
  if (!quotes) return null;
  const href = (side: "yes" | "no") => `/c/${id}?side=${side}`;
  const yes = payoutWords(quotes.yes), no = payoutWords(quotes.no);
  return (
    <div className="bets">
      <Link className="bet yes" href={href("yes")} onClick={markIntent} prefetch={false} aria-label={`Yes, it’s true. ${yes.right}. ${yes.wrong}. ${question}`}>
        <b>Yes, it’s true</b><small>{yes.right}</small>
      </Link>
      <Link className="bet no" href={href("no")} onClick={markIntent} prefetch={false} aria-label={`No, it’s false. ${no.right}. ${no.wrong}. ${question}`}>
        <b>No, it’s false</b><small>{no.right}</small>
      </Link>
    </div>
  );
}
