// The home page's top: the promise, the three steps, the featured story and the two rails.
import Image from "next/image";
import Link from "next/link";
import { BetLinks } from "./Bet";
import { TopicIcon } from "./Brand";
import { Dial } from "./Dial";
import { PctBlock } from "./FactCard";
import { Icon } from "./Icon";
import { Countdown } from "./Live";
import { explorerTx, modelShort, money, plural, span } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";
import type { Ruling, Rulings } from "@/lib/server/api";

export function Intro() {
  return (
    <section className="intro" id="how" aria-label="What this is">
      <div>
        <h1>Bet on whether facts are true.</h1>
        <p>Your first $1 is free: no wallet, no sign-up.</p>
      </div>
      <ol className="steps" aria-label="How it works">
        <li><span className="n">1</span>Pick true or false</li>
        <li><span className="n">2</span>3 AI judges decide</li>
        <li><span className="n">3</span>Right answers get paid</li>
      </ol>
    </section>
  );
}

const judgeName = (m: string) => modelShort(m).replace(/-\d{4}$/, "");

/** The lead: a fact with real bets and a real ruling, and its corrected sentence open for bets. */
export function RulingFeature({ ruled, corrected, ruling, recorded = false }: { ruled: Fact; corrected: Fact | null; ruling: Ruling; recorded?: boolean }) {
  const verdict = (ruling.outcome ?? ruling.provisional ?? "").toUpperCase();
  const judged = ruling.verdicts.length;
  const took = ruling.settled_at ? span(ruling.settled_at - ruling.opened_at) : null;
  const openPct = Math.round((ruled.openPrice ?? 0.5) * 100);
  const lastPct = Math.round(ruled.price * 100);
  return (
    <section className="feature" aria-label="Featured: a fact the AI judges ruled on">
      <div>
        <div className="chips">
          <span className="chip no"><Icon name="gavel" />Ruled {verdict} by {judged} AI judges</span>
          <span className="chip"><TopicIcon icon={ruled.icon} />{ruled.topic}</span>
        </div>
        <div className="fhd">
          <div>
            <h2><Link href={`/c/${ruled.id}${recorded ? "?recorded=1" : ""}`}>{ruled.question}</Link></h2>
            {ruled.caught?.line && <p className="ev hide-phone"><Icon name="flag" /><span><b>Wikipedia may be wrong.</b> A newer source says {ruled.caught.line}.</span></p>}
            <p className="story">
              <span className="short">{plural(ruled.trades, "bet")} · ruled {verdict.toLowerCase()}{took ? ` in ${took}` : ""}{ruling.payout_usd ? <> · <b>{money(ruling.payout_usd)}</b> paid to No</> : null}</span>
              <span className="long">{plural(ruled.trades, "bet")} moved it from {openPct}% to <b>{lastPct}% chance it’s true</b>.
              {" "}Then {judged} AI judges ruled it <span className="neg">{verdict.toLowerCase()}</span>{took ? <> in {took}</> : null}{ruling.payout_usd ? <>, and <b>{money(ruling.payout_usd)}</b> went to the people and AI traders who bet No</> : null}.</span>
            </p>
          </div>
          <div className="feature-dial phone" aria-hidden="true"><Dial p={ruled.price} sizes="104px" /></div>
        </div>
        {corrected && corrected.status === "open" && (
          <div className="reopen">
            <p className="k"><Icon name="sparkle" /><span>Corrected and reopened<span className="long">. Is the new sentence true?</span></span></p>
            <h3><Link href={`/c/${corrected.id}${recorded ? "?recorded=1" : ""}`}>{corrected.question}</Link></h3>
            <BetLinks id={corrected.id} quotes={corrected.quotes} question={corrected.question} recorded={recorded} size="feature" />
            <p className="first"><span className="dot" />{corrected.trades ? `${plural(corrected.trades, "bet")} so far · ${Math.round(corrected.price * 100)}% chance it’s true` : priceWords(corrected, true).whose}</p>
          </div>
        )}
      </div>
      <div className="feature-side">
        <div className="feature-dial"><Dial p={ruled.price} label="chance it’s true" sizes="300px" priority /></div>
        <p className="dialcap"><b>The money said {lastPct}%. The judges said {verdict.toLowerCase()}.</b></p>
        <ul className="judges" aria-label="The judges’ verdicts">
          {ruling.verdicts.map((v) => (
            <li key={v.tx} className="judge">
              <Icon name="check" />
              <b title={v.model}>{judgeName(v.model)}</b>
              <span className="t">{v.verdict} · <a href={explorerTx(v.tx)} target="_blank" rel="noopener">{span(v.at - ruling.opened_at)}</a></span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The fallback lead when nothing has been ruled yet: the most-bet open fact. */
export function PlainFeature({ f, recorded = false }: { f: Fact; recorded?: boolean }) {
  return (
    <section className="feature" aria-label="Featured fact">
      <div>
        <div className="chips">
          {f.caught && <span className="chip warn"><Icon name="flag" />Wikipedia may be wrong</span>}
          <span className="chip"><TopicIcon icon={f.icon} />{f.topic}</span>
        </div>
        <div className="fhd">
          <h2><Link href={`/c/${f.id}`}>{f.question}</Link></h2>
          <div className="feature-dial phone" aria-hidden="true"><Dial p={f.price} sizes="104px" /></div>
        </div>
        {f.caught && <p className="story">A newer source says {f.caught.today}.</p>}
        <div className="reopen" style={{ borderTop: 0, paddingTop: 0 }}>
          <BetLinks id={f.id} quotes={f.quotes} question={f.question} recorded={recorded} size="feature" />
          <p className="first"><span className="dot" />{f.trades ? `${plural(f.trades, "bet")} · ${money(f.volumeUsd)} so far` : "No bets yet. Be the first."}</p>
        </div>
      </div>
      <div className="feature-side">
        <div className="feature-dial"><Dial p={f.price} label="chance it’s true" sizes="300px" priority /></div>
        <div className="dialcap"><PctBlock f={f} /></div>
      </div>
    </section>
  );
}

/** "Being decided": a ruling in progress, or honestly, when the next one starts. */
export function DecidingRail({ rulings, facts }: { rulings: Rulings | null; facts: Map<number, Fact> }) {
  const now = rulings?.ruling_now ?? null;
  const f = now ? facts.get(now.claim_id) : null;
  return (
    <section className="railcard" id="deciding" aria-labelledby="deciding-h">
      <Link className="art" href={f ? `/c/${f.id}` : "/#facts"} tabIndex={-1} aria-hidden="true">
        <Image src={`/art/${f?.art ?? "reserves"}.webp`} alt="" width={560} height={320} sizes="392px" />
        <div className="timer">
          {now ? (
            <><div className="sm">{now.status === "window" ? "Objections close in" : "AI judges rule in"}</div><div className="big"><Countdown to={now.status === "window" ? now.window_ends_at ?? now.jury_deadline_at : now.jury_deadline_at} /></div></>
          ) : rulings?.next_challenge_at ? (
            <><div className="sm">The next fact goes to the judges in</div><div className="big"><Countdown to={rulings.next_challenge_at} done="a moment" /></div></>
          ) : (
            <div className="big" style={{ fontSize: 24 }}>Nothing being decided</div>
          )}
        </div>
      </Link>
      <div className="rbody">
        <h2 id="deciding-h"><Icon name="clock" className="!w-4 !h-4" />Being decided</h2>
        {now && f ? (
          <>
            <Link className="rq resrow" style={{ border: 0, padding: 0 }} href={`/c/${f.id}`}><span className="rq">{f.question}</span></Link>
            <p>{now.challenger_name} says it’s {String(now.claimed).toLowerCase()} and put up {money(now.bond_usd)}. {now.verdicts.length} of 3 judges have ruled.</p>
          </>
        ) : (
          <p>
            Nothing is before the judges right now. Every hour, our Checker challenges a fact a newer source contradicts{rulings?.checker ? <> ({plural(rulings.checker.lines_left, "fact")} queued)</> : null}. Three AI judges rule within minutes, then anyone can object for 10 minutes.
          </p>
        )}
      </div>
    </section>
  );
}

/** "Results": the ruling record. */
export function ResultsRail({ rulings, facts }: { rulings: Rulings | null; facts: Map<number, Fact> }) {
  const done = (rulings?.rulings ?? []).filter((r) => r.status === "settled");
  return (
    <section className="railcard" id="results" aria-labelledby="results-h">
      <div className="rbody">
        <h2 id="results-h"><Icon name="gavel" className="!w-4 !h-4" />Results</h2>
        {done.length ? done.slice(0, 4).map((r) => {
          const f = facts.get(r.claim_id);
          const out = (r.outcome ?? "").toLowerCase();
          return (
            <div key={r.challenge_id} className="resrow">
              <Link className="rq" href={`/c/${r.claim_id}`}>{f?.question ?? r.claim}</Link>
              <span className={`verdict ${out}`}>{out.toUpperCase()}</span>
              <span className="rs">
                Ruled {out} by {r.verdicts.length} AI judges · settled in {r.settled_at ? span(r.settled_at - r.opened_at) : "—"}{r.payout_usd ? ` · ${money(r.payout_usd)} paid` : ""}
                {r.correction ? <> · <Link className="link" href={`/c/${r.correction.claim_id}`}>corrected</Link></> : null}
                {r.settle_tx ? <> · <a className="link" href={explorerTx(r.settle_tx)} target="_blank" rel="noopener">tx</a></> : null}
              </span>
            </div>
          );
        }) : <p>No fact has been ruled on yet. The first result will show here, with the judges’ signed verdicts.</p>}
      </div>
    </section>
  );
}
