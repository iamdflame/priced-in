// The two rails beside the lead. "Being decided": a ruling in progress or, honestly, when the next one
// starts. "Results": the ruling record, every count from /api/rulings.
import Image from "next/image";
import Link from "next/link";
import { Icon } from "../Icon";
import { Countdown } from "../Live";
import { explorerTx, money, plural, span } from "@/lib/format";
import type { Fact } from "@/lib/model";
import type { Ruling, Rulings } from "@/lib/server/api";

const RESULTS_SHOWN = 3;

function Timer({ now, nextAt }: { now: Ruling | null; nextAt: number | null }) {
  if (now) {
    const inWindow = now.status === "window" && now.window_ends_at;
    return <><div className="sm">{inWindow ? "Objections close in" : "AI judges rule in"}</div><div className="big"><Countdown to={inWindow ? now.window_ends_at! : now.jury_deadline_at} /></div></>;
  }
  if (nextAt) return <><div className="sm">The next fact goes to the judges in</div><div className="big"><Countdown to={nextAt} done="a moment" /></div></>;
  return <div className="big sm-big">Nothing being decided</div>;
}

export function DecidingRail({ rulings, facts }: { rulings: Rulings | null; facts: Map<number, Fact> }) {
  const now = rulings?.ruling_now ?? null;
  const f = now ? facts.get(now.claim_id) : undefined;
  return (
    <section className="railcard" id="deciding" aria-labelledby="deciding-h">
      <Link className="art" href={f ? `/c/${f.id}` : "/rulings"} tabIndex={-1} aria-hidden="true">
        <Image src={`/art/${f?.art ?? "reserves"}.webp`} alt="" width={560} height={320} sizes="392px" />
        <div className="timer"><Timer now={now} nextAt={rulings?.next_challenge_at ?? null} /></div>
      </Link>
      <div className="rbody">
        <h2 id="deciding-h"><Icon name="clock" />Being decided</h2>
        {!rulings ? (
          <p>We couldn’t read the rulings just now. They’re on-chain either way; try again in a moment.</p>
        ) : now && f ? (
          <>
            <Link className="rq" href={`/c/${f.id}`}>{f.question}</Link>
            <p>{now.challenger_name.replace(/^the /, "The ")} says it’s {now.claimed.toLowerCase()} and put up {money(now.bond_usd)}. {now.verdicts.length} of 3 judges have ruled.</p>
          </>
        ) : (
          <p>Nothing is before the judges right now. Our Checker challenges facts a newer source contradicts, one at a time{rulings.checker ? <> ({plural(rulings.checker.lines_left, "fact")} queued)</> : null}. Three AI judges rule within minutes, then anyone can object for 10 minutes.</p>
        )}
      </div>
    </section>
  );
}

function ResultRow({ r, f }: { r: Ruling; f: Fact | undefined }) {
  const word = (r.outcome ?? "").toLowerCase();
  return (
    <div className="resrow">
      <Link className="rq" href={`/c/${r.claim_id}`}>{f?.question ?? r.claim}</Link>
      <span className={`verdict ${word}`}>{word.toUpperCase()}</span>
      <span className="rs">
        Ruled {word} by {r.verdicts.length} AI judges · settled in {r.settled_at ? span(r.settled_at - r.opened_at) : "—"}{r.payout_usd ? ` · ${money(r.payout_usd)} paid` : ""}
        {r.correction ? <> · <Link className="link" href={`/c/${r.correction.claim_id}`}>corrected</Link></> : null}
        {r.settle_tx ? <> · <a className="link" href={explorerTx(r.settle_tx)} target="_blank" rel="noopener">tx</a></> : null}
      </span>
    </div>
  );
}

export function ResultsRail({ settled, read, facts }: { settled: Ruling[]; read: boolean; facts: Map<number, Fact> }) {
  return (
    <section className="railcard" id="results" aria-labelledby="results-h">
      <div className="rbody">
        <h2 id="results-h"><Icon name="gavel" />Results{settled.length ? ` · ${plural(settled.length, "fact")} ruled` : ""}</h2>
        {settled.slice(0, RESULTS_SHOWN).map((r) => <ResultRow key={r.challenge_id} r={r} f={facts.get(r.claim_id)} />)}
        {settled.length > 0 && <Link className="link all" href="/rulings">See every result</Link>}
        {!settled.length && <p>{read ? "No fact has been ruled on yet. The first result will show here, with the judges’ signed verdicts." : "We couldn’t read the results just now."}</p>}
      </div>
    </section>
  );
}
