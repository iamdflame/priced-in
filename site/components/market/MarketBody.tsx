// The market page's parts. MarketHead needs only the claim, so it paints at once; MarketBody reads the
// rest and streams in behind MarketSkeleton.
import Link from "next/link";
import { TopicIcon } from "../Brand";
import { Chart } from "../Chart";
import { Dial } from "../Dial";
import { JudgesLine, WhyEstimate, WrongExplain } from "../Explain";
import { Icon } from "../Icon";
import { ReplayRuling } from "../ReplayRuling";
import { RulingBlock } from "../Ruling";
import { Sk } from "../States";
import { MarketTabs } from "./MarketTabs";
import { Rules, Sources } from "./Sources";
import { Ticket } from "./Ticket";
import { money, plural } from "@/lib/format";
import { priceWords, type ClaimView, type Fact } from "@/lib/model";
import { REPLAY } from "@/lib/replay/record";
import { verdictOf } from "@/lib/rulings";
import { wikiOf } from "@/lib/server/facts";
import { getMarket, type Market } from "@/lib/server/market";

export function MarketHead({ f }: { f: Fact }) {
  return (
    <header className="mk-head">
      <div className="crumb">
        <TopicIcon icon={f.icon} /><span>{f.topic}</span>
        {f.caught && f.status !== "settled" && <span className="chip warn"><Icon name="flag" />A newer source disagrees<WrongExplain caught={f.caught} /></span>}
        {f.status === "settled" && <span className={`chip ${f.outcome ? "yes" : "no"}`}><Icon name="gavel" />Ruled {f.outcome ? "TRUE" : "FALSE"}</span>}
        {f.status === "deciding" && <span className="chip warn"><Icon name="clock" />Being decided</span>}
      </div>
      <h1>{f.question}</h1>
      <p className="how">Yes means {wikiOf(f.page).attribution ? "Wikipedia’s sentence" : "the sentence"} is true as written. No means it’s false.</p>
    </header>
  );
}

function PricePanel({ m, recorded }: { m: Market; recorded: boolean }) {
  const f = m.fact;
  const words = priceWords(f, !!m.corrects);
  const ruled = m.ruling?.settled_at && !recorded ? { outcome: verdictOf(m.ruling), at: m.ruling.settled_at } : null;
  return (
    <div className="panel chartp">
      <div className="dialbox">
        <Dial p={f.price} sizes="(max-width: 760px) 112px, 236px" priority />
        <p className="dialcap"><b>{Math.round(f.price * 100)}% {words.means}</b><span>{words.whose}</span>{words.firstRead && <WhyEstimate pct={Math.round((f.openPrice ?? f.price) * 100)} />}</p>
      </div>
      <div>
        <div className="hd"><span>Chance it’s true, after each bet</span><span>{f.trades ? `${money(f.volumeUsd)} bet so far · ${plural(f.trades, "bet")}` : "No bets yet"}</span></div>
        {f.trades > 0 ? (
          <Chart points={m.points} bets={m.bets} now={f.price} nowAt={m.nowAt} ruled={ruled} openLabel={m.corrects ? "Reopened at" : "At the start"} />
        ) : (
          <div className="chartempty">
            <b>No bets yet</b>
            <span>{f.status === "settled" ? "Nobody bet on it before the judges ruled." : `The first bet draws the line. It opens at ${Math.round((f.openPrice ?? f.price) * 100)}%, ${m.corrects ? "the reopening price" : "our AI’s starting estimate"}.`}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export async function MarketBody({ claim, recorded, side }: { claim: ClaimView; recorded: boolean; side: "yes" | "no" | null }) {
  const m = await getMarket(claim, recorded);
  const f = m.fact;
  const { ruling, corrects } = m;
  const settled = ruling && f.status === "settled" ? { verdict: verdictOf(ruling), payoutUsd: ruling.payout_usd, correctedId: ruling.correction?.claim_id ?? null, correctedQuestion: m.correctedQuestion ?? ruling.correction?.text ?? null } : null;
  return (
    <>
      <div className="mk-l">
        <PricePanel m={m} recorded={recorded} />
        {f.quotes && <JudgesLine className="phone-only" />}
        {ruling && (recorded ? <ReplayRuling r={ruling} correctedQuestion={m.correctedQuestion} /> : <RulingBlock r={ruling} correctedQuestion={m.correctedQuestion} />)}
        {corrects && (
          <section className="panel corrected">
            <p><b>This sentence replaced one the AI judges ruled {verdictOf(corrects).toLowerCase()}.</b> <span>Wikipedia’s line was out of date; this corrected version opened as its own market.</span></p>
            <Link className="btn soft" href={`/c/${corrects.claim_id}`}>See the ruling</Link>
          </section>
        )}
        <Sources f={f} wiki={m.wiki} corrected={!!corrects} />
        <Rules f={f} wiki={m.wiki} />
        <MarketTabs bets={m.bets} rationales={m.rationales} history={m.history} />
      </div>
      <Ticket id={f.id} question={f.question} sentence={f.text} claim={claim} lane={m.lane} initialSide={f.quotes ? side : null} recorded={recorded} replayBlock={recorded ? REPLAY.betBlock : null} settled={settled} />
    </>
  );
}

export function MarketSkeleton() {
  return (
    <>
      <div className="mk-l" aria-busy="true" aria-label="Loading the market">
        <div className="panel chartp"><Sk h={236} r={118} /><Sk h={236} /></div>
        <div className="panel wiki"><div><Sk h={14} w="60%" /><Sk h={44} className="mt-2" /></div><div><Sk h={14} w="60%" /><Sk h={44} className="mt-2" /></div></div>
      </div>
      <aside className="panel ticket dock" aria-hidden="true"><Sk h={20} w="50%" /><div className="seg"><Sk h={66} r={14} /><Sk h={66} r={14} /></div></aside>
    </>
  );
}
