// Beside the lead: the ruling with the most real bets ("Just ruled"), and what is before the judges now
// (or, honestly, when the next ruling starts). Every count comes from /api/rulings.
import Link from "next/link";
import { Icon } from "../Icon";
import { Until } from "../Live";
import { money, plural, span } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { rulingNote, verdictOf, winningSide } from "@/lib/rulings";
import type { Ruling, Rulings } from "@/lib/server/api";

const DAY_MS = 86_400_000;

export function RuledCard({ r, ruled, corrected, settledCount, now }: { r: Ruling; ruled: Fact | undefined; corrected: Fact | undefined; settledCount: number; now: number }) {
  const verdict = verdictOf(r);
  const recent = r.settled_at !== null && now - r.settled_at < DAY_MS;
  return (
    <section className="railcard ruled" aria-labelledby="ruled-h">
      <div className="rbody">
        <h2 id="ruled-h"><span className={`verdict ${verdict.toLowerCase()}`}>{recent ? "Just ruled" : "Ruled"}: {verdict}</span></h2>
        <Link className="rq" href={`/c/${r.claim_id}`}>{ruled?.question ?? r.claim}</Link>
        <p className="rs">{r.verdicts.length} AI judges · in {r.settled_at ? span(r.settled_at - r.opened_at) : "—"}{r.payout_usd ? ` · ${money(r.payout_usd)} paid to ${winningSide(verdict)}` : ""}{ruled?.trades ? ` · ${plural(ruled.trades, "bet")}` : ""}</p>
        <p className="rlinks">
          {corrected && <Link className="link" href={`/c/${corrected.id}`}>See the new question</Link>}
          <Link className="link" href="/rulings">All {plural(settledCount, "result")}</Link>
        </p>
      </div>
    </section>
  );
}

/** The next real moment, while it's ahead. No time means no line: the sentence below says what's true. */
function Timer({ now, nextAt }: { now: Ruling | null; nextAt: number | null }) {
  if (now) {
    const inWindow = now.status === "window" && now.window_ends_at;
    return <Until to={inWindow ? now.window_ends_at! : now.jury_deadline_at} label={inWindow ? "Objections close in" : "AI judges rule in"} />;
  }
  return nextAt ? <Until to={nextAt} label="Next fact to the judges in" /> : null;
}

export function DecidingCard({ rulings, facts }: { rulings: Rulings | null; facts: Map<number, Fact> }) {
  const now = rulings?.ruling_now ?? null;
  const f = now ? facts.get(now.claim_id) : undefined;
  return (
    <section className="railcard deciding" id="deciding" aria-labelledby="deciding-h">
      <div className="rbody">
        <h2 id="deciding-h"><Icon name="clock" />Being decided</h2>
        {!rulings ? (
          <p>We couldn’t read the rulings just now. They’re on-chain either way.</p>
        ) : now && f ? (
          <Link className="rq" href={`/c/${f.id}`}>{f.question}</Link>
        ) : (
          <p>{rulingNote(rulings) ?? `${rulings.checker ? `${plural(rulings.checker.lines_left, "doubted fact")} queued. ` : ""}Three AI judges rule within minutes.`}</p>
        )}
        {/* last, and always a line tall: when the time passes, nothing on the page moves */}
        <div className="timer" data-live><Timer now={now} nextAt={rulings?.next_challenge_at ?? null} /></div>
      </div>
    </section>
  );
}
