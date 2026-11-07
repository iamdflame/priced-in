// A claim from today's news, as a card and as the lead. Each one answers what a stranger needs in three
// seconds: the question, its topic, the % and what it means, Yes or No as a free pick, when it settles
// and by whose word, and the headline it came from. Every number is the API's (/api/today, /api/claims).
import Link from "next/link";
import { Art } from "../Art";
import { TopicIcon } from "../Brand";
import { Spark } from "../Chart";
import { Dial } from "../Dial";
import { Explain, WhyEstimate } from "../Explain";
import { Icon } from "../Icon";
import { PickButtons } from "./PickButtons";
import { MyPickBadge } from "./MyPick";
import { money, plural } from "@/lib/format";
import { priceWords, type Fact, type FactStatus } from "@/lib/model";
import { claimParts, headlineOf, newsArt, outletOf, shortDate, type TodayLine } from "@/lib/news";

/** The numbers priceWords needs, from the claim view when there is one, else from the line itself. */
function numbers(l: TodayLine, f: Fact | undefined) {
  const status: FactStatus = l.status === "decided" ? "settled" : l.status === "ruling" ? "deciding" : "open";
  const open = Math.min(0.8, Math.max(0.2, l.first_estimate));
  return {
    price: f?.price ?? l.price_yes ?? open,
    trades: f?.trades ?? l.trades,
    openPrice: f?.openPrice ?? open,
    status: f?.status ?? status,
    outcome: f ? f.outcome : l.outcome === "true" ? true : l.outcome === "false" ? false : null,
  };
}

const pct = (p: number) => Math.round(p * 100);

/** Where it came from: the headline, in quotes, and the outlet. One line on a card. */
export function FromNews({ l, lead = false }: { l: TodayLine; lead?: boolean }) {
  const h = headlineOf(l.source);
  if (!h || !l.source) return null;
  const outlet = outletOf(l.source);
  return (
    <a className={`fromnews${lead ? " lead" : ""}`} href={l.source.url} target="_blank" rel="noopener nofollow" title={`${h}${outlet ? ` (${outlet})` : ""}`}>
      <span className="fn-k">From the news{outlet ? `, ${outlet}` : ""}:</span> <span className="fn-h">“{h}”</span>
    </a>
  );
}

/** When it settles and by whose word, and the claim's own small print when there is room for it. */
export function SettlesLine({ l, fine }: { l: TodayLine; fine?: string | null }) {
  return (
    <p className="settles">
      <Icon name="clock" />
      <span>Settles by <b>{shortDate(l.settles.by)}</b>: {l.settles.source}{fine ? <>. {fine}</> : null}</span>
    </p>
  );
}

/** Exactly what Yes means: the claim itself, with its deadline and rule; and what No means, by the API's rule. */
export function YesIf({ l, yes }: { l: TodayLine; yes: string }) {
  const ended = l.status === "decided";
  return (
    <div className="yesif">
      <p><b>Yes if</b> <q>{yes}</q></p>
      <p className="noif"><b>No if</b> {l.settles.by_words} {ended ? "passed" : "passes"} without it, or the source denies it.</p>
    </div>
  );
}

/** What stands in for Yes and No when a line takes no picks. */
function Closed({ l }: { l: TodayLine }) {
  if (l.status === "decided") {
    return (
      <div className="result">
        <span>Ruled <b className={l.outcome === "true" ? "pos" : "neg"}>{l.outcome === "true" ? "true" : "false"}</b> by three AI judges</span>
        <MyPickBadge id={l.claim_id} outcome={l.outcome} />
      </div>
    );
  }
  if (l.status === "ruling") return <p className="closed"><Icon name="scale" /><span><b>Being decided.</b> Three AI judges are ruling, so picks are closed.</span></p>;
  return <p className="closed wait"><Icon name="clock" /><span><b>Waiting for its source.</b> {l.settler?.note ?? "Its date has passed and the source hasn’t settled it yet. We look again every 12 hours."}</span></p>;
}

function StatusTag({ l }: { l: TodayLine }) {
  if (l.status === "decided") return <span className={`tag plain ${l.outcome === "true" ? "" : "no"}`}><Icon name="gavel" />Ruled {l.outcome === "true" ? "TRUE" : "FALSE"}</span>;
  if (l.status === "ruling") return <span className="tag plain warn"><Icon name="clock" />Being decided</span>;
  if (l.overdue) return <span className="tag plain warn"><Icon name="clock" />Waiting for its source</span>;
  return null;
}

/** "3 picks: 2 Yes, 1 No", with a bar; picks are counted once per browser key. */
export function PickSplit({ l }: { l: TodayLine }) {
  const { yes, no, total } = l.picks;
  if (!total) return <p className="split none">No picks yet. Be the first.</p>;
  return (
    <div className="split" aria-label={`${plural(total, "pick")}: ${yes} Yes, ${no} No`}>
      <div className="split-bar" aria-hidden="true"><i className="y" style={{ width: `${(yes / total) * 100}%` }} /><i className="n" style={{ width: `${(no / total) * 100}%` }} /></div>
      <p><b>{plural(total, "pick")}</b> · <span className="pos">{yes} Yes</span> · <span className="neg">{no} No</span></p>
    </div>
  );
}

const takesPicks = (l: TodayLine, now: number) => l.status === "open" && !l.overdue && now < l.settles.due_at;

export function ClaimCard({ l, f, now, points, art }: { l: TodayLine; f?: Fact; now: number; points?: [number, number][]; art?: string }) {
  const n = numbers(l, f);
  const w = priceWords(n);
  const href = `/c/${l.claim_id}`;
  const open = takesPicks(l, now);
  return (
    <article className={`card ncard${l.status === "decided" ? " settled" : ""}`} aria-labelledby={`nq${l.claim_id}`}>
      <Link className="art" href={href} tabIndex={-1} aria-hidden="true" prefetch={false}>
        <Art name={art ?? newsArt(l.topic)} width={560} height={320} sizes="(max-width: 760px) 96px, (max-width: 1240px) 33vw, 330px" />
        <div className="top">
          <span className="tag"><TopicIcon icon={`news:${l.topic.toLowerCase()}`} />{l.topic}</span>
          <StatusTag l={l} />
        </div>
      </Link>
      <div className="cbody">
        <Link className="q" id={`nq${l.claim_id}`} href={href} prefetch={false} title={l.question}>{l.question}</Link>
        <FromNews l={l} />
        <div className="odds">
          <div>
            <div className="pct num">{pct(n.price)}<i>%</i></div>
            <span className="lab"><b>{w.means}</b><span>{w.whose}</span>{w.firstRead && <WhyEstimate pct={pct(n.openPrice)} />}</span>
          </div>
          {points && n.trades > 0 ? <Spark points={points} w={120} h={40} label={`${plural(n.trades, "bet")}, now ${pct(n.price)}%`} /> : null}
        </div>
        {l.bounty_usd > 0 && <p className="bounty"><Icon name="coin" /><span><b>{money(l.bounty_usd)} bounty</b> for the first challenger proven right</span></p>}
        {open ? <PickButtons id={l.claim_id} question={l.question} quotes={f?.quotes ?? null} settlesBy={shortDate(l.settles.by)} /> : <Closed l={l} />}
        <SettlesLine l={l} />
      </div>
    </article>
  );
}

/** The lead claim: the same answers, larger, with the dial and how people have picked so far. */
export function ClaimLead({ l, f, now, rules }: { l: TodayLine; f?: Fact; now: number; rules: string }) {
  const n = numbers(l, f);
  const w = priceWords(n);
  const open = takesPicks(l, now);
  const c = claimParts(l.claim);
  return (
    <section className="feature tlead" aria-labelledby="tlead-q">
      <div className="ftext">
        <div className="chips">
          <span className="chip"><TopicIcon icon={`news:${l.topic.toLowerCase()}`} />{l.topic}</span>
          {l.section === "today" && <span className="chip new"><span className="dot" aria-hidden="true" />New today</span>}
          {l.bounty_usd > 0 && <span className="chip brand"><Icon name="coin" />{money(l.bounty_usd)} bounty</span>}
        </div>
        <div className="fhd">
          <div>
            <h2 id="tlead-q"><Link href={`/c/${l.claim_id}`}>{l.question}</Link></h2>
            <FromNews l={l} lead />
          </div>
          <div className="feature-dial phone"><Dial p={n.price} sizes="96px" /><p className="mini">chance it’s true</p></div>
        </div>
        <YesIf l={l} yes={c.yes} />
        {open ? <PickButtons id={l.claim_id} question={l.question} quotes={f?.quotes ?? null} settlesBy={shortDate(l.settles.by)} size="lead" /> : <Closed l={l} />}
        <SettlesLine l={l} fine={c.fine} />
        <p className="payline">Picks are free and win nothing. Right calls climb the <span className="nowrap">leaderboard.<Explain label="What is a pick?"><b>A pick is your call, free.</b> {rules} Three AI traders are on the same board. Back your pick with your free $1 or with USDC if you want something on it.</Explain></span></p>
      </div>
      <div className="fside">
        <div className="feature-dial"><Dial p={n.price} sizes="150px" priority /><p className="mini">chance it’s true</p></div>
        <div className="fstats">
          <p className="dialcap"><b>{pct(n.price)}% {w.means}</b><span>{w.whose}</span>{w.firstRead && <WhyEstimate pct={pct(n.openPrice)} />}</p>
          <PickSplit l={l} />
        </div>
      </div>
    </section>
  );
}
