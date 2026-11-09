// Results: every doubted fact, decided by three AI judges on real money. The first real one (the
// Tether T-Bills fact, ruled FALSE) is the hero, told as a story: the doubt and its bond, the three
// signed verdicts in the judges' own words with a one-tap verify, the window, the payout and the
// corrected fact as a new market. Then what's being decided now, what's next, and the full record.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Art } from "@/components/Art";
import { TopicIcon } from "@/components/Brand";
import { Dial } from "@/components/Dial";
import { FactCard } from "@/components/FactCard";
import { Icon } from "@/components/Icon";
import { ReplayRuling } from "@/components/ReplayRuling";
import { RulingBlock } from "@/components/Ruling";
import { ErrorState } from "@/components/States";
import { Kpis, ModelBadge, PageHero, SHead, modelMaker } from "@/components/pages/Kit";
import { Receipts } from "@/components/pages/Receipts";
import { NextRuling, RulingClock } from "@/components/pages/RulingClock";
import { VerifyVerdict } from "@/components/pages/VerifyVerdict";
import { clockUtc, dayTimeUtc, explorerAccount, explorerTx, money, plural, span } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { priceBeforeRuling, rulingNote, rulingRecord, verdictOf, winningSide } from "@/lib/rulings";
import type { Ruling, Scheduled } from "@/lib/server/api";
import { judgeWords, verdictTx } from "@/lib/server/proof";
import { getNews } from "@/lib/server/news";
import { getSite } from "@/lib/server/site";

export const revalidate = 15;
export const metadata: Metadata = {
  title: "Results: facts decided by three AI judges",
  description: "Every doubted fact on Priced In, decided by three attested AI models that sign their verdicts on NEAR, with the money paid and the corrected fact reopened.",
};

export default async function RulingsPage({ searchParams }: { searchParams: Promise<{ recorded?: string }> }) {
  const { recorded } = await searchParams;
  const replay = recorded === "1";
  const [site, news] = await Promise.all([getSite(), getNews()]);
  const R = site.rulings;
  if (!site.ok || !R) {
    return <main id="main" className="wrap pg"><Head next={null} checker={null} /><div className="result-gap"><ErrorState message={site.error ?? "The results didn’t load."} /></div></main>;
  }
  const byId = new Map(site.facts.map((f) => [f.id, f]));
  const { all, settled, medianMs, paidUsd, unanimous } = rulingRecord(R.rulings);
  // the first ruling on real money leads; the record below carries the rest
  const hero = settled.at(-1) ?? null;
  const live = R.ruling_now;
  const ruledIds = new Set(all.map((r) => r.claim_id));
  const queue = site.facts.filter((f) => f.caught && f.status === "open" && !ruledIds.has(f.id)).sort((a, b) => b.trades - a.trades || a.id - b.id);
  const reopened = all.flatMap((r) => (r.correction ? [r.correction.claim_id] : []));
  // up next, soonest first: every fact the AI judges have a time for, then the doubted ones still waiting for a bet
  const next = upNext(R.schedule, queue, byId, site.asOf);

  return (
    <main id="main" className="wrap pg">
      <Head next={R.next_ruling_at} note={rulingNote(R)} checker={R.checker ?? null} live={live} />
      <Kpis label="The record so far" items={[
        { v: settled.length, l: settled.length === 1 ? "fact decided" : "facts decided", s: all.length > settled.length ? `${all.length - settled.length} still running` : "every one settled on-chain" },
        { v: medianMs === null ? "—" : span(medianMs), l: "from doubt to paid", s: settled.length > 1 ? "the median" : "the one so far" },
        { v: money(paidUsd), l: "paid to the winners", s: "in USDC, on-chain" },
        { v: <>{unanimous}<i> of {settled.length}</i></>, l: "with all three judges agreeing", s: "each verdict signed separately" },
        { v: queue.length, l: queue.length === 1 ? "fact Wikipedia may have wrong" : "facts Wikipedia may have wrong", s: "queued for the Checker" },
      ]} />

      {hero && <Case r={hero} f={byId.get(hero.claim_id) ?? null} before={priceBeforeRuling(site.history[String(hero.claim_id)], hero.settled_at)} corrected={hero.correction ? byId.get(hero.correction.claim_id) ?? null : null} />}

      {hero && (
        <>
          <SHead id="judges" title="The three AI judges, in their own words" sub="Each model read the Checker’s evidence and the sentence, answered inside a secure chip, and signed its answer. The market checked each signature against the model’s registered key before it counted. Check one yourself: it takes a second." />
          <Judges r={hero} />
          <SHead id="timeline" title="How it unfolded" sub="Every step is a transaction on NEAR. Tap a time to open it in the explorer." />
          {replay ? <ReplayRuling r={hero} correctedQuestion={hero.correction ? byId.get(hero.correction.claim_id)?.question ?? null : null} /> : <RulingBlock r={hero} correctedQuestion={hero.correction ? byId.get(hero.correction.claim_id)?.question ?? null : null} />}
        </>
      )}

      <SHead id="now" title="Being decided now" sub="A decision runs in three stages: the AI judges read (minutes), 10 minutes for objections, then settlement." />
      {live ? <RulingBlock r={live} /> : (
        <div className="panel quiet">
          <Icon name="clock" />
          <div>
            <b>Nothing is being decided this minute.</b>
            <p>{rulingNote(R) ?? ((R.next_challenge_at ?? R.next_ruling_at ?? 0) > R.asOf ? <>The next decision starts at {clockUtc((R.next_challenge_at ?? R.next_ruling_at)!)}: the Checker bets a bond against the next fact Wikipedia may have wrong, and three AI judges read it.</> : <>Nothing is scheduled. A decision starts whenever anyone bonds a challenge against a fact.</>)}</p>
          </div>
        </div>
      )}

      {next.length > 0 && (
        <>
          <SHead id="next" title="Up next for the AI judges" sub={`Soonest first, with when each is decided.${news.on ? " Call it before then: a pick is free, and a bet is on its page." : " You can bet until then."}`} right={plural(next.length, "fact")} />
          <div className="grid upnext">
            {next.map(({ f, at }) => (
              <div key={f.id} className="upnext-i">
                <p className="when"><Icon name="clock" />{at ? <>AI judges decide <b>{dayTimeUtc(at)}</b></> : "Waits for its first bet"}</p>
                <FactCard f={f} points={site.history[String(f.id)]} reopened={reopened.includes(f.id)} picks={news.on} />
              </div>
            ))}
          </div>
        </>
      )}

      <SHead id="record" title="The full record" sub={`${hero ? "Every challenge since the first one, told in full above" : "Every challenge ever filed on the market"}, newest first. Each one’s receipts are checked where they live before our AI judges read them, and the Sentinel disputes any decision that rests on receipts that failed.`} right={plural(all.length, "result")} />
      {/* the first one is the story above: listed again here, it read as the same case three times */}
      <div className="panel rlist">
        {all.length ? all.filter((r) => r.challenge_id !== hero?.challenge_id).map((r) => <RecordRow key={r.challenge_id} r={r} f={byId.get(r.claim_id) ?? null} />) : (
          <div className="quiet"><Icon name="gavel" /><div><b>No results yet.</b><p>The first one will appear here the moment a challenge is filed.</p></div></div>
        )}
      </div>
      <p className="fine devfoot">
        Read live from the market’s log{site.rulings?.asOf ? <> at {clockUtc(site.rulings.asOf)}</> : null}. The Checker is <a className="link" href={explorerAccount(R.checker?.account ?? "checker.isitpriced.near")} target="_blank" rel="noopener">{R.checker?.account ?? "checker.isitpriced.near"}</a>; anyone can file a challenge with a bond.
      </p>
    </main>
  );
}

function Head({ next, note, checker, live }: { next: number | null; note?: string | null; checker: { account: string; balance_usd: number; lines_left: number; note?: string } | null; live?: Ruling | null }) {
  return (
    <PageHero
      kick="Results · decided by three AI judges"
      title="Doubt a fact. Three AI judges decide it."
      lede={<>When a fact looks wrong, a Checker bets a bond against it. <b>Three AI models</b> read the sources and sign their verdicts on-chain<span className="long">, anyone can object for 10 minutes, then the winners are paid and the corrected fact opens as a new market</span>.</>}
      side={
        <div className="clockc" aria-live="off">
          {live ? (
            <>
              <span className="k"><span className="dot" aria-hidden="true" />Being decided right now</span>
              <RulingClock windowEndsAt={live.window_ends_at} />
            </>
          ) : (
            <NextRuling
              at={next}
              ahead={note ?? <>{checker ? <><b>{plural(checker.lines_left, "fact")}</b> queued for the Checker, with <b>{money(checker.balance_usd)}</b> ready for bonds.</> : null} Three AI judges read it, then 10 minutes for objections.</>}
              none={note ?? "Nothing is scheduled right now. A decision starts whenever someone bonds a challenge."}
            />
          )}
        </div>
      }
    />
  );
}

function Case({ r, f, before: last, corrected }: { r: Ruling; f: Fact | null; before: number | null; corrected: Fact | null }) {
  const verdict = verdictOf(r);
  // with no bets, the last price is our AI's estimate, not what a market said
  const before = f && f.trades > 0 ? last : null;
  const took = r.settled_at ? span(r.settled_at - r.opened_at) : null;
  const lastJudge = r.verdicts.length ? span(Math.max(...r.verdicts.map((v) => v.at)) - r.opened_at) : null;
  return (
    <section className="panel case" aria-labelledby="case-h">
      <div>
        <div className="chips">
          <span className={`verdict-big ${verdict === "TRUE" ? "true" : ""}`}><Icon name="gavel" />Decided: {verdict.toLowerCase()}</span>
          {f && <span className="chip"><TopicIcon icon={f.icon} />{f.topic}</span>}
          <span className="chip">First decision on real money · {dayTimeUtc(r.opened_at)}</span>
        </div>
        <h2 id="case-h">{f ? <Link href={`/c/${r.claim_id}`}>{f.question}</Link> : r.claim}</h2>
        <div className="ba">
          <span>Wikipedia</span><del>{r.claim}</del>
          {f?.caught && <><span>Newer source</span><ins>{f.caught.today}</ins></>}
        </div>
        {f?.caught && <a className="src" href={f.caught.source} target="_blank" rel="noopener">{f.caught.label}<Icon name="ext" /></a>}
        <Receipts r={r} />
        <div className="facts3">
          <div><b>{lastJudge ?? "—"}</b>for all three AI judges to decide</div>
          <div><b>{took ?? "—"}</b>from doubt to paid</div>
          <div><b>{r.payout_usd ? money(r.payout_usd) : "—"}</b>paid to {winningSide(verdict)}</div>
        </div>
        {corrected && (
          <div className="corrected">
            <p><b>Corrected → new market.</b> <span>{corrected.question}</span></p>
            <Link className="btn primary" href={`/c/${corrected.id}`}>Bet on the corrected fact<Icon name="arrow" /></Link>
          </div>
        )}
      </div>
      {f && (
        <div className="case-side">
          <div className="case-dial"><Dial p={before ?? f.price} label="chance it’s true" sizes="230px" /></div>
          {/* the market's last price before the ruling: the settled price is the outcome itself, never what the money said */}
          <p className="dialcap">{before !== null ? <><b>What the market said</b>{Math.round(before * 100)}% chance it’s true after {plural(f.trades, "bet")}, before the AI judges decided it {verdict.toLowerCase()}</> : <><b>Decided {verdict.toLowerCase()}</b>Nobody had bet before the AI judges decided it</>}</p>
        </div>
      )}
    </section>
  );
}

async function Judges({ r }: { r: Ruling }) {
  const txs = await Promise.all(r.verdicts.map((v) => verdictTx(v.tx)));
  return (
    <div className="judges3">
      {r.verdicts.map((v, i) => {
        const m = modelMaker(v.model);
        const t = txs[i];
        const words = t.ok ? judgeWords(t.value.text) : null;
        return (
          <article key={v.tx} className="panel jcard" aria-label={`${m.short}: ${v.verdict}`}>
            <div className="top">
              <ModelBadge model={v.model} note={`judge ${i + 1} of ${r.verdicts.length}`} />
              <span className={`verdict ${v.verdict === "TRUE" ? "true" : "false"}`}>{v.verdict}</span>
            </div>
            {words ? <blockquote>{words}</blockquote> : <p className="fine">The judge’s words are in its transaction; open it below.</p>}
            <div className="meta2">
              <span>Decided in {span(v.at - r.opened_at)}</span>
              <span>{v.runner?.attestation?.ok ? "Attested secure chip" : "Signed"}</span>
              <a href={explorerTx(v.tx)} target="_blank" rel="noopener">See the verdict<Icon name="ext" /></a>
              <Link href="/trust#judges">Its proof</Link>
            </div>
            {v.request_hash && v.response_hash && <VerifyVerdict tx={v.tx} model={v.model} requestHash={v.request_hash} responseHash={v.response_hash} sender={t.ok ? t.value.signer : undefined} />}
          </article>
        );
      })}
    </div>
  );
}

function RecordRow({ r, f }: { r: Ruling; f: Fact | null }) {
  const verdict = verdictOf(r);
  const status = r.status === "settled" ? `Settled in ${span((r.settled_at ?? r.opened_at) - r.opened_at)} · ${r.payout_usd ? `${money(r.payout_usd)} paid` : "nobody had bet on the winning side"}` : r.status === "window" ? "Open for objections" : r.status === "escalated" ? "With the market’s council after three objections" : r.status === "void" ? "Voided by the council: every bond came back" : r.status === "jury" ? "The AI judges are reading" : r.status === "expired" ? "Expired: the AI judges didn’t reach a verdict in time" : r.status;
  return (
    <div className="rrow" id={`ruling-${r.challenge_id}`}>
      {f ? <span className="ti" aria-hidden="true"><Art name={f.art} width={72} height={72} /></span> : <span className="ti mono" aria-hidden="true">#</span>}
      <div className="shrink">
        <Link className="q" href={`/c/${r.claim_id}`}>{f?.question ?? r.claim}</Link>
        <p className="s">Challenged by {r.challenger_name.replace(/^the /, "the ")} with a {money(r.bond_usd)} bond · {dayTimeUtc(r.opened_at)} · {status}{r.disputes.length ? ` · ${plural(r.disputes.length, "objection")}` : ""}</p>
        <Receipts r={r} />
      </div>
      <div className="r">
        {verdict && <span className={`verdict ${verdict === "TRUE" ? "true" : "false"}`}>{verdict}</span>}
        {r.correction && <Link className="btn soft" href={`/c/${r.correction.claim_id}`}>Corrected<Icon name="arrow" /></Link>}
      </div>
    </div>
  );
}

/**
 * Up next, soonest first: the facts the AI judges have a time for (the API's schedule), then doubted
 * facts still waiting for a first bet. One row's worth, so the section never stands half empty when
 * the news has lines coming due.
 */
function upNext(schedule: Scheduled[] | undefined, queue: Fact[], byId: Map<number, Fact>, now: number, max = 4): { f: Fact; at: number | null }[] {
  const out: { f: Fact; at: number | null }[] = [];
  const seen = new Set<number>();
  for (const s of schedule ?? []) {
    const f = byId.get(s.claim_id);
    if (!f || f.status !== "open" || s.at <= now || seen.has(f.id)) continue;
    out.push({ f, at: s.at });
    seen.add(f.id);
  }
  for (const f of queue) if (!seen.has(f.id)) { out.push({ f, at: null }); seen.add(f.id); }
  return out.slice(0, max);
}
