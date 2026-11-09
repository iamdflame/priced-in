// Where the ticket stood on a settled fact: who won, what was paid, and the corrected fact to bet on.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../Icon";
import { money } from "@/lib/format";
import { REPLAY_HREF } from "@/lib/nav";
import { winningSide } from "@/lib/rulings";

export interface SettledInfo {
  verdict: string;
  payoutUsd: number | null;
  correctedId: number | null;
  correctedQuestion: string | null;
}

export function SettledTicket({ s, wallet }: { s: SettledInfo; wallet: ReactNode }) {
  const side = winningSide(s.verdict);
  return (
    <aside className={`panel ticket ${s.correctedId !== null ? "dock" : ""}`} aria-label="Result">
      <div className="settledbox">
        <p className="big hide-dock">{side} won.</p>
        <p className="decide hide-dock">The AI judges decided it {s.verdict.toLowerCase()}, {s.payoutUsd ? `and ${money(s.payoutUsd)} went to everyone who bet ${side}` : `and nobody had bet ${side}, so nothing was paid`}. It can’t be bet on any more.</p>
        {s.correctedId !== null && (
          <>
            <p className="decide hide-dock"><b>Corrected and reopened:</b> {s.correctedQuestion}</p>
            <Link className="btn soft" href={`/c/${s.correctedId}`}>See the corrected question<Icon name="arrow" /></Link>
          </>
        )}
        <Link className="link hide-dock replaylink" href={REPLAY_HREF}>Watch a replay of a decision</Link>
      </div>
      {wallet}
    </aside>
  );
}
