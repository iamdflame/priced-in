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
import { NewsRules, NewsSources, Rules, Sources } from "./Sources";
import { Ticket } from "./Ticket";
import { CatchPanel, ReportButton } from "../today/Report";
import { dayTimeUtc, money, plural } from "@/lib/format";
import { priceWords, type ClaimView, type Fact } from "@/lib/model";
import { shortDate } from "@/lib/news";
import { REPLAY } from "@/lib/replay/record";
import { verdictOf } from "@/lib/rulings";
import { wikiOf } from "@/lib/server/facts";
import { getMarket, type Market } from "@/lib/server/market";
import { getNews } from "@/lib/server/news";

/** A news line past its date and still open: it takes no picks and no new bets while it settles. */
export const waiting = (f: Fact, now = Date.now()) => !!f.news && f.status === "open" && now >= f.news.settles.due_at;

export function MarketHead({ f, report = false }: { f: Fact; report?: boolean }) {
  const n = f.news;
  return (
    <header className="mk-head">
      <div className="crumb">
        <TopicIcon icon={f.icon} /><span>{f.topic}</span>
        {n && <span className="chip"><Icon name="pulse" />From today’s news</span>}
        {f.caught && f.status !== "settled" && <span className="chip warn"><Icon name="flag" />A newer source disagrees<WrongExplain caught={f.caught} /></span>}
        {f.status === "settled" && <span className={`chip ${f.outcome ? "yes" : "no"}`}><Icon name="gavel" />Ruled {f.outcome ? "TRUE" : "FALSE"}</span>}
        {f.status === "deciding" && <span className="chip warn"><Icon name="clock" />Being decided</span>}
        {waiting(f) && <span className="chip warn"><Icon name="clock" />Waiting for its source</span>}
        {f.bountyUsd > 0 && f.status !== "settled" && <span className="chip brand"><Icon name="coin" />{money(f.bountyUsd)} bounty</span>}
      </div>
      <h1>{f.question}</h1>
      <div className="how-row">
        <p className="how">{n ? <>Yes means {n.settles.source} confirms it by {n.settles.by_words}. No means the date passes without that, or the source denies it.</> : <>Yes means {wikiOf(f.page).attribution ? "Wikipedia’s sentence" : "the sentence"} is true as written. No means it’s false.</>}</p>
        {report && <ReportButton claimId={f.id} question={f.question} news={!!n} className="btn ghost sm" />}
      </div>
    </header>
  );
}

/** Past its date and not settled: say so plainly, then the settler's own last note (the API's words, as they are). */
function Waiting({ f, note, lookedAt }: { f: Fact; note: string | null; lookedAt: number | null }) {
  return (
    <section className="panel waiting-p" aria-label="Waiting for its source">
      <Icon name="clock" />
      <div>
        <b>Its date has passed: it’s waiting for its source.</b>
        <p>Nothing from {f.news!.settles.source} has checked out yet, so it isn’t settled. We look again every 12 hours. It takes no picks and no new bets meanwhile: we’d rather wait than pay the wrong side.</p>
        {note && <blockquote className="settler-note"><span>Our settler’s last note{lookedAt ? `, ${dayTimeUtc(lookedAt)}` : ""}:</span> {note}</blockquote>}
      </div>
    </section>
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
  const [m, news] = await Promise.all([getMarket(claim, recorded), getNews()]);
  const f = m.fact;
  const on = news.on && !recorded;
  const line = news.on && f.news ? news.today.lines.find((l) => l.claim_id === f.id) ?? null : null;
  const late = waiting(f);
  const { ruling, corrects } = m;
  const settled = ruling && f.status === "settled" ? { verdict: verdictOf(ruling), payoutUsd: ruling.payout_usd, correctedId: ruling.correction?.claim_id ?? null, correctedQuestion: m.correctedQuestion ?? ruling.correction?.text ?? null } : null;
  return (
    <>
      <div className="mk-l">
        <PricePanel m={m} recorded={recorded} />
        {late && <Waiting f={f} note={line?.settler?.note ?? null} lookedAt={line?.settler?.last_look_at ?? null} />}
        {f.quotes && !late && <JudgesLine className="phone-only" />}
        {ruling && (recorded ? <ReplayRuling r={ruling} correctedQuestion={m.correctedQuestion} /> : <RulingBlock r={ruling} correctedQuestion={m.correctedQuestion} />)}
        {corrects && (
          <section className="panel corrected">
            <p><b>This sentence replaced one the AI judges ruled {verdictOf(corrects).toLowerCase()}.</b> <span>Wikipedia’s line was out of date; this corrected version opened as its own market.</span></p>
            <Link className="btn soft" href={`/c/${corrects.claim_id}`}>See the ruling</Link>
          </section>
        )}
        {f.news ? <><NewsSources f={f} /><NewsRules f={f} /></> : <><Sources f={f} wiki={m.wiki} corrected={!!corrects} /><Rules f={f} wiki={m.wiki} /></>}
        {on && claim.status === "Open" && <CatchPanel claimId={f.id} question={f.question} news={!!f.news} bountyUsd={f.bountyUsd} />}
        <MarketTabs bets={m.bets} rationales={m.rationales} history={m.history} />
      </div>
      <Ticket id={f.id} question={f.question} sentence={f.text} claim={claim} lane={m.lane} initialSide={f.quotes && !late ? side : null} recorded={recorded} replayBlock={recorded ? REPLAY.betBlock : null} settled={settled}
        picks={on && f.status === "open" && !late} closed={late ? `Its date (${shortDate(f.news!.settles.by)}) has passed: it takes no new bets while it settles.` : null} settlesBy={f.news ? shortDate(f.news.settles.by) : null} />
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
