// The lead of the home page: one open question, its % with what it means, its real bets drawn as a
// step chart, and its Yes/No directly under it. The first-visit hint sits on the buttons it points at.
import Link from "next/link";
import { BetLinks } from "../Bet";
import { TopicIcon } from "../Brand";
import { Spark } from "../Chart";
import { Dial } from "../Dial";
import { WrongExplain } from "../Explain";
import { Icon } from "../Icon";
import { CoachHint, FreeCashNote } from "../Live";
import type { Bet } from "@/lib/bets";
import { money, plural } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";

/** The fact to lead with: the open fact with the most real bets (the doubted one first on a tie). */
export function leadFact(facts: Fact[]): Fact | null {
  const open = facts.filter((f) => f.status === "open" && f.quotes);
  return [...open].sort((a, b) => b.trades - a.trades || Number(!!b.caught) - Number(!!a.caught) || b.volumeUsd - a.volumeUsd)[0] ?? null;
}

function LastBet({ b }: { b: Bet }) {
  return <li>{b.free ? "Someone" : b.who} · {b.free ? "free $1" : money(b.usd)} on <b className={b.side === "yes" ? "pos" : "neg"}>{b.side === "yes" ? "Yes" : "No"}</b>{b.priceBefore !== null ? <> · {Math.round(b.priceBefore * 100)}→{Math.round(b.priceAfter * 100)}%</> : null}</li>;
}

export function Feature({ f, points, bets, freeOpen }: { f: Fact; points: [number, number][]; bets: Bet[]; freeOpen: boolean }) {
  const words = priceWords(f);
  const pct = Math.round(f.price * 100);
  return (
    <section className="feature" aria-labelledby="lead-q">
      <div className="ftext">
        <div className="chips">
          <span className="chip"><TopicIcon icon={f.icon} />{f.topic}</span>
          {f.caught && <span className="chip warn"><Icon name="flag" />Wikipedia may be wrong<WrongExplain /></span>}
        </div>
        <div className="fhd">
          <h2 id="lead-q"><Link href={`/c/${f.id}`}>{f.question}</Link></h2>
          <div className="feature-dial phone"><Dial p={f.price} sizes="96px" /><p className="mini">chance it’s true</p></div>
        </div>
        {f.caught?.line && <p className="ev hide-phone"><Icon name="flag" /><span>A newer source says {f.caught.line}.</span></p>}
        {freeOpen && <CoachHint />}
        <BetLinks id={f.id} quotes={f.quotes} question={f.question} />
        <p className="payline">Wrong: you lose $1 · <FreeCashNote /></p>
      </div>
      <div className="fside">
        <div className="feature-dial"><Dial p={f.price} label="chance it’s true" sizes="150px" priority /></div>
        <div className="fstats">
          <p className="dialcap"><b>{pct}% {words.means}</b><span>{words.whose}</span></p>
          {f.trades > 0 && <Spark points={points} w={200} h={48} label={`${plural(f.trades, "bet")}, from ${Math.round((f.openPrice ?? f.price) * 100)}% to ${pct}%`} />}
          {bets.length > 0 && <ul className="lastbets" aria-label="Latest bets">{bets.slice(0, 2).map((b, i) => <LastBet key={`${b.tx}${i}`} b={b} />)}</ul>}
        </div>
      </div>
    </section>
  );
}
