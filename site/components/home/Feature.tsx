// The lead of the home page (chosen by lib/lead.ts): one open question, its % with what it means, its
// real bets drawn as a step chart, and its Yes/No directly under it.
import Link from "next/link";
import { BetLinks } from "../Bet";
import { TopicIcon } from "../Brand";
import { FromWikipedia } from "../FactCard";
import { Spark } from "../Chart";
import { Dial } from "../Dial";
import { WhyEstimate, WrongExplain } from "../Explain";
import { Icon } from "../Icon";
import { FreeCashNote } from "../Live";
import { PickButtons } from "../today/PickButtons";
import { bettor, type Bet } from "@/lib/bets";
import { money, plural } from "@/lib/format";
import { priceWords, type Fact } from "@/lib/model";
import { payoutWords } from "@/lib/quote";

function LastBet({ b }: { b: Bet }) {
  return <li>{bettor(b)} · {b.free ? "free $1" : money(b.usd)} on <b className={b.side === "yes" ? "pos" : "neg"}>{b.side === "yes" ? "Yes" : "No"}</b></li>;
}

export function Feature({ f, points, bets, picks = false }: { f: Fact; points: [number, number][]; bets: Bet[]; picks?: boolean }) {
  const words = priceWords(f);
  const pct = Math.round(f.price * 100);
  return (
    <section className="feature" aria-labelledby="lead-q">
      <div className="ftext">
        <div className="chips">
          <span className="chip"><TopicIcon icon={f.icon} />{f.topic}</span>
          {f.caught && <span className="chip warn"><Icon name="flag" />A newer source disagrees<WrongExplain caught={f.caught} /></span>}
        </div>
        <div className="fhd">
          <div>
            <h2 id="lead-q"><Link href={`/c/${f.id}`}>{f.question}</Link></h2>
            <FromWikipedia f={f} />
          </div>
          <div className="feature-dial phone"><Dial p={f.price} sizes="96px" /><p className="mini">chance it’s true</p></div>
        </div>
        {f.caught?.line && <p className="ev hide-phone"><Icon name="flag" /><span>A newer source says {f.caught.line}.</span></p>}
        {picks ? (
          <>
            <PickButtons id={f.id} question={f.question} quotes={f.quotes} size="lead" pays />
            <p className="payline">A tap picks for free. Bet the free $1 on your pick and, if you’re right, you get what its button says.</p>
          </>
        ) : (
          <>
            <BetLinks id={f.id} quotes={f.quotes} question={f.question} />
            <p className="payline">{f.quotes ? `${payoutWords(f.quotes.yes).wrong}. ` : ""}<FreeCashNote /></p>
          </>
        )}
      </div>
      <div className="fside">
        <div className="feature-dial"><Dial p={f.price} sizes="150px" priority /><p className="mini">chance it’s true</p></div>
        <div className="fstats">
          <p className="dialcap"><b>{pct}% {words.means}</b><span>{words.whose}</span>{words.firstRead && <WhyEstimate pct={Math.round((f.openPrice ?? f.price) * 100)} />}</p>
          {f.trades > 0 && <Spark points={points} w={200} h={48} label={`${plural(f.trades, "bet")}, from ${Math.round((f.openPrice ?? f.price) * 100)}% to ${pct}%`} />}
          {bets.length > 0 && <ul className="lastbets" aria-label="Latest bets">{bets.slice(0, 2).map((b, i) => <LastBet key={`${b.tx}${i}`} b={b} />)}</ul>}
        </div>
      </div>
    </section>
  );
}
