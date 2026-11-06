// The lead of the home page: a fact with real bets and a real ruling, with its corrected sentence open
// for bets. Before anything has been ruled, the most-bet open fact leads instead.
import Link from "next/link";
import { BetLinks } from "../Bet";
import { TopicIcon } from "../Brand";
import { Dial } from "../Dial";
import { Icon } from "../Icon";
import { explorerTx, judgeName, money, plural, span } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";
import { verdictOf, winningSide } from "@/lib/rulings";
import type { Ruling } from "@/lib/server/api";

function Reopened({ f }: { f: Fact }) {
  return (
    <div className="reopen">
      <p className="k"><Icon name="sparkle" /><span>Corrected and reopened<span className="long">. Is the new sentence true?</span></span></p>
      <h3><Link href={`/c/${f.id}`}>{f.question}</Link></h3>
      <BetLinks id={f.id} quotes={f.quotes} question={f.question} size="feature" />
      <p className="first"><span className="dot" />{f.trades ? `${plural(f.trades, "bet")} so far · ${Math.round(f.price * 100)}% chance it’s true` : priceWords(f, true).whose}</p>
    </div>
  );
}

function Judges({ r }: { r: Ruling }) {
  return (
    <ul className="judges" aria-label="The judges’ verdicts">
      {r.verdicts.map((v) => (
        <li key={v.tx} className="judge">
          <Icon name="check" />
          <b title={v.model}>{judgeName(v.model)}</b>
          <span className="t">{v.verdict} · <a href={explorerTx(v.tx)} target="_blank" rel="noopener">{span(v.at - r.opened_at)}</a></span>
        </li>
      ))}
    </ul>
  );
}

export function RulingFeature({ ruled, corrected, ruling }: { ruled: Fact; corrected: Fact | null; ruling: Ruling }) {
  const verdict = verdictOf(ruling);
  const word = verdict.toLowerCase();
  const judges = ruling.verdicts.length;
  const took = ruling.settled_at ? span(ruling.settled_at - ruling.opened_at) : null;
  const lastPct = Math.round(ruled.price * 100);
  const side = winningSide(verdict);
  return (
    <section className="feature" aria-label="Featured: a fact the AI judges ruled on">
      <div>
        <div className="chips">
          <span className="chip no"><Icon name="gavel" />Ruled {verdict} by {judges} AI judges</span>
          <span className="chip"><TopicIcon icon={ruled.icon} />{ruled.topic}</span>
        </div>
        <div className="fhd">
          <div>
            <h2><Link href={`/c/${ruled.id}`}>{ruled.question}</Link></h2>
            {ruled.caught?.line && <p className="ev hide-phone"><Icon name="flag" /><span><b>Wikipedia may be wrong.</b> A newer source says {ruled.caught.line}.</span></p>}
            <p className="story">
              <span className="short">{plural(ruled.trades, "bet")} · ruled {word}{took ? ` in ${took}` : ""}{ruling.payout_usd ? <> · <b>{money(ruling.payout_usd)}</b> paid to {side}</> : null}</span>
              <span className="long">
                {plural(ruled.trades, "bet")} moved it from {Math.round((ruled.openPrice ?? 0.5) * 100)}% to <b>{lastPct}% chance it’s true</b>.
                {" "}Then {judges} AI judges ruled it <span className="neg">{word}</span>{took ? <> in {took}</> : null}{ruling.payout_usd ? <>, and <b>{money(ruling.payout_usd)}</b> went to the people and AI traders who bet {side}</> : null}.
              </span>
            </p>
          </div>
          <div className="feature-dial phone"><Dial p={ruled.price} sizes="104px" /><p className="mini">chance it’s true</p></div>
        </div>
        {corrected?.quotes && <Reopened f={corrected} />}
      </div>
      <div className="feature-side">
        <div className="feature-dial"><Dial p={ruled.price} label="chance it’s true" sizes="300px" priority /></div>
        <p className="dialcap"><b>The money said {lastPct}%. The judges said {word}.</b></p>
        <Judges r={ruling} />
      </div>
    </section>
  );
}

export function PlainFeature({ f }: { f: Fact }) {
  const words = priceWords(f);
  return (
    <section className="feature" aria-label="Featured fact">
      <div>
        <div className="chips">
          {f.caught && <span className="chip warn"><Icon name="flag" />Wikipedia may be wrong</span>}
          <span className="chip"><TopicIcon icon={f.icon} />{f.topic}</span>
        </div>
        <div className="fhd">
          <h2><Link href={`/c/${f.id}`}>{f.question}</Link></h2>
          <div className="feature-dial phone"><Dial p={f.price} sizes="104px" /><p className="mini">chance it’s true</p></div>
        </div>
        {f.caught && <p className="story">A newer source says {f.caught.today}.</p>}
        <div className="reopen plain">
          <BetLinks id={f.id} quotes={f.quotes} question={f.question} size="feature" />
          <p className="first"><span className="dot" />{f.trades ? `${plural(f.trades, "bet")} · ${money(f.volumeUsd)} so far` : "No bets yet. Be the first."}</p>
        </div>
      </div>
      <div className="feature-side">
        <div className="feature-dial"><Dial p={f.price} label="chance it’s true" sizes="300px" priority /></div>
        <p className="dialcap"><b>{Math.round(f.price * 100)}% {words.means}</b><span>{words.whose}</span></p>
      </div>
    </section>
  );
}
