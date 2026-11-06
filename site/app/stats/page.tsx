// The numbers, in public: live facts, topics, bets, money bet, fees taken, the AI traders' profit,
// rulings and how fast they run, calibration once facts settle, and the contract's own books, which
// must close to the micro-dollar. Every figure is read from the market contract or its event log on
// each visit; small numbers are shown as they are.
import "../styles/pages.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ErrorState } from "@/components/States";
import { Kpis, PageHero, SHead } from "@/components/pages/Kit";
import { Calibration, Spread, TopicBars, VolumeChart } from "@/components/pages/StatCharts";
import { clockUtc, dayTimeUtc, explorerAccount, money, plural, signedMoney, span } from "@/lib/format";
import { MARKET_ID } from "@/lib/nav";
import { rulingRecord } from "@/lib/rulings";
import { api } from "@/lib/server/api";
import { proof } from "@/lib/server/proof";
import { getSite } from "@/lib/server/site";

export const revalidate = 30;
export const metadata: Metadata = {
  title: "The numbers, in public",
  description: "Every number on Priced In, read live from the market contract: facts, bets, money bet, fees, the AI traders’ profit, rulings, calibration and the books.",
};

const usd = (micro: string | number) => Number(micro) / 1e6;

export default async function StatsPage() {
  const site = await getSite();
  const [st, ag, ev] = await Promise.all([proof.stats(), proof.agents(), api.events()]);
  if (!site.ok) return <main id="main" className="wrap"><Head asOf={null} /><div className="result-gap"><ErrorState message={site.error ?? "The numbers didn’t load."} /></div></main>;
  const pfs = ag.ok ? await Promise.all(ag.value.agents.map((a) => proof.portfolio(a.account_id))) : [];
  const agentPnl = pfs.reduce((n, p) => n + (p.ok ? p.value.totals.pnl_usd : 0), 0);
  const agentPnlKnown = pfs.length > 0 && pfs.every((p) => p.ok);
  const s = st.ok ? st.value : null;

  const bets = [...site.bets].sort((a, b) => a.at - b.at);
  let cum = 0;
  const curve = bets.map((b, i) => { cum += b.usd; return { at: b.at, usd: cum, n: i + 1 }; });
  const firstAt = Math.min(...(Object.values(site.history).map((p) => p[0]?.[0]).filter(Boolean) as number[]), bets[0]?.at ?? Date.now());
  const volume = site.totals.volumeUsd;
  const visitors = bets.filter((b) => b.kind === "visitor").length;
  const agentBets = bets.filter((b) => b.kind === "agent").length;
  const sales = site.totals.trades - bets.length;

  const topics = new Map<string, { topic: string; usd: number; bets: number; facts: number }>();
  for (const f of site.facts) {
    const t = topics.get(f.topic) ?? { topic: f.topic, usd: 0, bets: 0, facts: 0 };
    t.usd += f.volumeUsd; t.bets += f.trades; t.facts += 1;
    topics.set(f.topic, t);
  }
  const topicRows = [...topics.values()].sort((a, b) => b.usd - a.usd || b.facts - a.facts);
  const open = site.facts.filter((f) => f.status === "open");
  const untouched = open.filter((f) => f.trades === 0).length;

  const feeEv = (ev.ok ? ev.value : []).filter((e) => e.event === "fee").sort((a, b) => (b.blockTimestampMs ?? 0) - (a.blockTimestampMs ?? 0))[0];
  const feeSince = feeEv?.blockTimestampMs ?? null;
  const betsSinceFee = feeSince ? bets.filter((b) => b.at > feeSince).length : null;

  const record = rulingRecord(site.rulings?.rulings ?? []);
  const facts = new Map(site.facts.map((f) => [f.id, f]));
  const settled = site.facts.filter((f) => f.status === "settled" && f.outcome !== null);
  const cal = settled.map((f) => ({ id: f.id, p: f.price, o: f.outcome ? 1 : 0 }));
  const unbet = settled.filter((f) => f.trades === 0).length;
  const brier = cal.length ? cal.reduce((n, x) => n + (x.p - x.o) ** 2, 0) / cal.length : null;

  const buckets = s ? [
    ["treasury_micro", "Treasury", "the house’s own money, fees included"],
    ["reserved_micro", "Reserved for markets", "the house’s backing for every open fact"],
    ["balances_micro", "Traders’ balances", "cash people and AI traders hold here"],
    ["collected_micro", "In open bets", "what bets put into fact pots"],
    ["payouts_micro", "Owed to winners", "won, not yet collected"],
    ["bonds_micro", "Challenge bonds", "posted against doubted facts"],
    ["bounties_micro", "Bounties", "rewards for finding wrong facts"],
  ] as const : [];
  const sum = s ? buckets.reduce((n, [k]) => n + BigInt(s[k]), BigInt(0)) : BigInt(0);
  const closes = s ? sum === BigInt(s.held_micro) : false;
  const thinking = ag.ok ? Object.values(ag.value.state.inference ?? {}).reduce((n, x) => n + (x.cost_usd ?? 0), 0) : null;

  return (
    <main id="main" className="wrap">
      <Head asOf={site.asOf} side={s ? (
        <div className="clockc">
          <span className="k"><Icon name="shield" />USDC held by the market contract</span>
          <div className="bignum">{money(usd(s.held_micro))}</div>
          <p>{closes ? <><b>The books close</b> to the micro-dollar: every cent is accounted for below.</> : <>The parts don’t add up; see the books below.</>}</p>
        </div>
      ) : null} />
      <Kpis label="The market today" items={[
        { v: site.totals.open, l: "facts open for bets", s: `${site.totals.facts} in all, across ${site.totals.topics} topics` },
        { v: site.totals.trades, l: "bets and sales", s: `${agentBets} by AI traders, ${visitors} free $1 bets${sales > 0 ? `, ${plural(sales, "sale")}` : ""}` },
        { v: money(volume), l: "bet so far", s: "real USDC, every bet on-chain" },
        { v: s ? money(usd(s.fees_micro)) : "—", l: "fees collected", s: s ? `${s.fee_bps / 100}% per bet${feeSince ? `, since ${dayTimeUtc(feeSince)}` : ""}` : "couldn’t read the contract" },
        { v: agentPnlKnown ? signedMoney(agentPnl) : "—", l: "AI traders’ profit", s: "all three together", tone: agentPnl >= 0.005 ? "pos" : agentPnl <= -0.005 ? "neg" : undefined },
      ]} />
      {s && usd(s.fees_micro) === 0 && betsSinceFee === 0 && (
        <p className="fine result-note">No fee yet: the 1% fee was switched on {feeSince ? clockUtc(feeSince) : "recently"}, and no bet has been placed since. The first one will show here.</p>
      )}

      <SHead id="money" title="Money bet, over time" sub="One step for every bet, from the market’s own event log. Sales are left out." right={`${plural(curve.length, "bet")} · ${money(cum)} in`} />
      <div className="charts2">
        <div className="panel chartc">
          <h3>Total bet so far</h3>
          <p className="sub">Since the first fact opened, {dayTimeUtc(firstAt)}</p>
          <VolumeChart points={curve} start={firstAt} now={site.asOf} />
        </div>
        <div className="panel chartc">
          <h3>Where the money is</h3>
          <p className="sub">Money bet on each topic’s facts</p>
          <TopicBars rows={topicRows} />
        </div>
      </div>

      <SHead id="spread" title="What the market thinks" sub="Every open fact, placed by its chance of being true. Filled dots have bets behind them; hollow ones are still at our AI’s starting estimate." right={`${open.length - untouched} with bets · ${untouched} waiting for a first bet`} />
      <div className="panel chartc spreadwrap"><Spread facts={open} /></div>

      <SHead id="rulings" title="Rulings and calibration" sub="How fast doubts get decided, and whether the market’s prices turn out right." />
      <div className="charts2">
        <div className="panel chartc">
          <h3>From doubt to paid</h3>
          <p className="sub">{record.settled.length ? `${plural(record.settled.length, "ruling")} settled` : "No ruling has settled yet"}</p>
          <div className="books three">
            <div><b>{record.all.length}</b><span>{record.all.length === 1 ? "fact challenged" : "facts challenged"}</span></div>
            <div><b>{record.medianMs === null ? "—" : span(record.medianMs)}</b><span>{record.settled.length > 1 ? "median, doubt to paid" : "doubt to paid"}</span></div>
            <div><b>{money(record.paidUsd)}</b><span>paid to winners</span></div>
          </div>
          <div className="settled-list">
            {record.settled.map((r) => (
              <Link key={r.challenge_id} className="mini" href={`/c/${r.claim_id}`}>
                <span>{facts.get(r.claim_id)?.question ?? r.claim}</span>
                <b>{span(r.settled_at! - r.opened_at)}</b>
              </Link>
            ))}
          </div>
          <p className="note">Three AI judges sign within minutes, then 10 minutes for objections, then the keeper settles. <Link className="link" href="/rulings">See every ruling</Link></p>
        </div>
        <div className="panel chartc calib">
          <div>
            <h3>Calibration</h3>
            <p className="sub">Settled facts: last price against the outcome</p>
            {cal.length < 20 ? (
              <p className="note"><b>Too early to judge: {plural(cal.length, "settled fact")}.</b> Calibration needs dozens. {brier !== null ? <>So far the Brier score is <b>{brier.toFixed(3)}</b> (0 is perfect, 0.25 is a coin flip){unbet ? <>, and {plural(unbet, "of them", "of them")} had no bets, so its price is our AI’s estimate, not the market’s</> : null}.</> : null} This chart fills in as facts settle.</p>
            ) : (
              <p className="note">Brier score <b>{brier!.toFixed(3)}</b> over {cal.length} settled facts (0 is perfect, 0.25 is a coin flip).</p>
            )}
          </div>
          <Calibration pts={cal} />
        </div>
      </div>

      <SHead id="books" title="The books" sub="Every dollar the market contract holds, by where it belongs, read from its stats view just now. They must add up to the micro-dollar." />
      {s ? (
        <div className="panel bookspanel">
          <div className="books">
            <div className="held"><b>{money(usd(s.held_micro))}</b><span>USDC held by the contract</span></div>
            {buckets.map(([k, l, d]) => <div key={k}><b>{money(usd(s[k]))}</b><span><em>{l}</em>: {d}</span></div>)}
          </div>
          <p className="closes">
            {closes ? <span className="ok"><Icon name="check" />The books close: the seven parts add up to exactly what the contract holds.</span> : <span className="sig bad"><Icon name="alert" />The parts don’t add up to what’s held. Check the contract.</span>}
            <a className="link" href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener">{MARKET_ID}</a>
          </p>
          <p className="fine result-note">{plural(s.rewrites_anchored, "corrected sentence")} anchored on-chain · free-bet budget {money(usd(s.lane_budget_micro))}, {money(usd(s.lane_credit_micro))} given out · {s.paused ? "the market is paused" : "the market is live"}{thinking !== null ? <> · the AI traders and judges spent ${thinking.toFixed(3)} thinking today</> : null}.</p>
        </div>
      ) : <ErrorState message={st.ok ? "" : st.error} />}
    </main>
  );
}

function Head({ asOf, side }: { asOf: number | null; side?: ReactNode }) {
  return (
    <PageHero
      kick={<>Live numbers{asOf ? ` · read ${clockUtc(asOf)}` : ""}</>}
      side={side}
      title="The whole market, in public."
      lede={<>Every number here is read from the market contract and its event log on each visit. <b>Small numbers are shown as they are</b>: this market is days old, and you should see that.</>}
    />
  );
}
