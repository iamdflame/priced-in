// The market page for one fact, in the order a stranger needs it: the question and the % with its
// meaning; the chart; the ticket; what Wikipedia says and what a newer source says; the rules and who
// decides; the activity, the AI traders' reasons and the history; and the ruling when there is one.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicIcon } from "@/components/Brand";
import { Chart } from "@/components/Chart";
import { Dial } from "@/components/Dial";
import { WhyEstimate } from "@/components/Explain";
import { Icon } from "@/components/Icon";
import { MarketTabs, type HistoryItem } from "@/components/MarketTabs";
import { ReplayRuling } from "@/components/ReplayRuling";
import { RulingBlock } from "@/components/Ruling";
import { ErrorState } from "@/components/States";
import { Ticket } from "@/components/Ticket";
import { modelShort, money, plural } from "@/lib/format";
import { priceWords, toFact, wikiOf } from "@/lib/model";
import { preBetClaim, REPLAY } from "@/lib/recorded";
import { api } from "@/lib/server/api";
import { getSite } from "@/lib/server/site";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const idOf = (raw: string) => (/^\d{1,9}$/.test(raw) ? Number(raw) : null);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = idOf((await params).id);
  if (id === null) return { title: "Not found" };
  const r = await api.claim(id);
  if (!r.ok) return { title: "A fact on Priced In" };
  const f = toFact(r.value);
  const pct = Math.round(f.price * 100);
  const desc = f.status === "settled" ? `Ruled ${f.outcome ? "true" : "false"} by 3 AI judges. ${f.text}` : `${pct}% chance it’s true. Bet $1 free on Yes or No: three AI judges decide, right answers get paid.`;
  return { title: f.question, description: desc, openGraph: { title: f.question, description: desc }, twitter: { title: f.question, description: desc } };
}

export default async function Market({ params, searchParams }: { params: Params; searchParams: Search }) {
  const id = idOf((await params).id);
  if (id === null) notFound();
  const sp = await searchParams;
  const recorded = sp.recorded === "1" && id === REPLAY.claimId;
  const initialSide = sp.side === "yes" || sp.side === "no" ? sp.side : null;

  const [site, claimR, histR, ratR] = await Promise.all([getSite(), api.claim(id), api.history(id), api.rationales(id)]);
  if (!claimR.ok) {
    if (claimR.status === 404) notFound();
    return <main id="main" className="wrap" style={{ paddingTop: 24 }}><ErrorState message={claimR.error} /></main>;
  }
  // the replay starts from the claim as it stood just before the real free $1
  const claim = recorded ? { ...claimR.value, ...preBetClaim() } : claimR.value;
  let points = histR.ok ? histR.value : [];
  if (recorded) points = points.filter(([t]) => t < REPLAY.betAt);
  const opens = points[0]?.[1] ?? null;
  const f = toFact(claim, opens);
  const ruling = (site.rulings?.rulings ?? []).find((r) => r.claim_id === id) ?? null;
  const corrects = (site.rulings?.rulings ?? []).find((r) => r.correction?.claim_id === id) ?? null;
  const correctedFact = ruling?.correction ? site.facts.find((x) => x.id === ruling.correction!.claim_id) ?? null : null;
  const bets = site.bets.filter((b) => b.claimId === id && (!recorded || b.at < REPLAY.betAt)).reverse();
  const rationales = (ratR.ok ? ratR.value : []).filter((r) => !recorded || r.at < REPLAY.betAt).sort((a, b) => b.at - a.at);
  const wiki = wikiOf(f.page);
  const words = priceWords(f, !!corrects);
  const pct = Math.round(f.price * 100);
  const nowAt = recorded ? REPLAY.betAt - 1 : site.asOf;

  const history: HistoryItem[] = [];
  if (points[0]) history.push({ at: points[0][0], icon: "pulse", text: corrects ? `Opened as the corrected sentence, at ${Math.round(points[0][1] / 1e4)}% chance it’s true.` : `Opened for bets at ${Math.round(points[0][1] / 1e4)}% chance it’s true: our AI’s starting estimate.`, tx: corrects?.correction?.open_tx ?? null });
  if (f.caught) history.push({ at: Date.parse(`${f.caught.checked}T12:00:00Z`), icon: "flag", text: `Wikipedia may be wrong: checked against ${f.caught.label}.` });
  for (const b of [...bets].reverse()) history.push({ at: b.at, icon: "coin", text: `${b.who} bet ${b.free ? "a free $1" : money(b.usd)} on ${b.side === "yes" ? "Yes" : "No"}: now ${Math.round(b.priceAfter * 100)}%.`, tx: b.tx });
  if (ruling && !recorded) {
    history.push({ at: ruling.opened_at, icon: "flag", text: `${ruling.challenger_name.replace(/^the /, "The ")} challenged it, saying it’s ${ruling.claimed.toLowerCase()}.`, tx: ruling.open_tx });
    for (const v of ruling.verdicts) history.push({ at: v.at, icon: "scale", text: `${modelShort(v.model)} ruled ${v.verdict}, signed on-chain.`, tx: v.tx });
    if (ruling.settled_at) history.push({ at: ruling.settled_at, icon: "coin", text: `Settled ${ruling.outcome}${ruling.payout_usd ? `: ${money(ruling.payout_usd)} paid` : ""}.`, tx: ruling.settle_tx });
    if (ruling.correction) history.push({ at: ruling.correction.at, icon: "sparkle", text: "Corrected: the rewritten sentence opened as its own market.", tx: ruling.correction.open_tx });
  }
  history.sort((a, b) => b.at - a.at);

  const settledInfo = ruling && f.status === "settled" ? { verdict: (ruling.outcome ?? "").toUpperCase(), payoutUsd: ruling.payout_usd, correctedId: ruling.correction?.claim_id ?? null, correctedQuestion: correctedFact?.question ?? ruling.correction?.text ?? null } : null;

  return (
    <main id="main" className="wrap">
      <div className="mk">
        <div className="mk-l">
          <div className="crumb">
            <TopicIcon icon={f.icon} /><span>{f.topic}</span>
            {f.caught && <span className="chip warn"><Icon name="flag" />Wikipedia may be wrong</span>}
            {corrects && <span className="chip brand"><Icon name="sparkle" />Corrected sentence</span>}
            {f.status === "settled" && <span className={`chip ${f.outcome ? "yes" : "no"}`}><Icon name="gavel" />Ruled {f.outcome ? "TRUE" : "FALSE"}</span>}
            {f.status === "deciding" && <span className="chip warn"><Icon name="clock" />Being decided</span>}
          </div>
          <h1>{f.question}</h1>
          <p className="how">Yes means the sentence below is true as written. No means it’s false.</p>

          <div className="panel chartp">
            <div className="dialbox">
              <Dial p={f.price} label="chance it’s true" sizes="(max-width: 760px) 150px, 236px" priority />
              <p className="dialcap"><b>{pct}% {words.means}</b><span>{words.whose}</span>{words.firstRead && <WhyEstimate pct={Math.round((f.openPrice ?? f.price) * 100)} />}</p>
            </div>
            <div>
              <div className="hd"><span>Chance it’s true, after each bet</span><span>{f.trades ? `${money(f.volumeUsd)} bet so far · ${plural(f.trades, "bet")}` : "No bets yet"}</span></div>
              <Chart points={points} bets={bets} now={f.price} nowAt={nowAt} ruled={ruling?.settled_at && !recorded ? { outcome: (ruling.outcome ?? "").toUpperCase(), at: ruling.settled_at } : null} openLabel={corrects ? "Reopened at" : "At the start"} />
            </div>
          </div>

          {ruling && (recorded ? <ReplayRuling r={ruling} correctedQuestion={correctedFact?.question ?? null} /> : <RulingBlock r={ruling} correctedQuestion={correctedFact?.question ?? null} />)}
          {corrects && (
            <section className="panel corrected" style={{ marginTop: 14 }}>
              <p><b>This sentence replaced one the AI judges ruled false.</b> <span>Wikipedia’s line was out of date; three AI judges agreed, and this corrected version opened as its own market.</span></p>
              <a className="btn soft" href={`/c/${corrects.claim_id}`}>See the ruling</a>
            </section>
          )}

          <div className="panel wiki">
            <div>
              <div className="h"><Icon name="book" />What Wikipedia says (what you’re betting on)</div>
              <p className="quote">“{f.text}”</p>
              <a className="src" href={wiki.url} target="_blank" rel="noopener">Wikipedia: {wiki.title}<Icon name="ext" /></a>
            </div>
            <div>
              <div className="h"><Icon name="flag" />What a newer source says</div>
              {f.caught ? (
                <><p className="big-v">{f.caught.today}</p><a className="src" href={f.caught.source} target="_blank" rel="noopener nofollow">{f.caught.label}, checked {f.caught.checked}<Icon name="ext" /></a></>
              ) : corrects ? (
                <p className="big-v">This is the newer source’s figure, now in the sentence.</p>
              ) : (
                <p className="quote" style={{ fontFamily: "var(--text)", fontSize: 15, color: "var(--ink2)" }}>Our check found no newer source that contradicts it. The AI traders’ own sources are on the Discussion tab.</p>
              )}
            </div>
          </div>

          <div className="panel rules">
            <div><h3>How Yes or No wins</h3><p>Yes wins if the sentence is accurate as written on the day it’s decided. No wins if a newer, cited source contradicts it.</p></div>
            <div><h3>Who decides</h3><p>Three AI judges, each a different attested model, rule within minutes of a challenge and sign on-chain. Then anyone can object for 10 minutes.</p></div>
            <div><h3>Where it’s from</h3><p>{wiki.attribution ?? `Wikipedia: ${wiki.title}.`}{f.caught ? ` Checked against ${f.caught.label}.` : ""}</p></div>
          </div>

          <MarketTabs bets={bets} rationales={rationales} history={history} />
          <div className="mk-pad" />
        </div>
        <Ticket id={id} question={f.question} sentence={f.text} claim={claim as any} open={f.status === "open"} lane={site.lane} initialSide={f.status === "open" ? initialSide : null}
          recorded={recorded} replayBlock={recorded ? REPLAY.betBlock : null} settled={settledInfo} />
      </div>
    </main>
  );
}
