// Home: the promise and the three steps, the market in numbers, one open question with its Yes/No, the
// ruling with the most bets and what is being decided, then every fact as a card. On a 1440x900 screen
// the lead and the first row of cards share the first screen.
import { Feature } from "@/components/home/Feature";
import { HomeGrid } from "@/components/home/HomeGrid";
import { Intro } from "@/components/home/Intro";
import { ProofBar } from "@/components/home/ProofBar";
import { DecidingCard, RuledCard } from "@/components/home/Rails";
import { FreeBetsOff } from "@/components/Live";
import { ErrorState } from "@/components/States";
import { feedOrder, leadFact } from "@/lib/lead";
import { leadRuling, rulingRecord } from "@/lib/rulings";
import { getSite, type Site } from "@/lib/server/site";

export const revalidate = 15;

function freeBetsOffReason({ lane }: Site): string | null {
  if (!lane) return "We couldn’t check the free bets just now.";
  if (lane.paused) return "The market is paused.";
  if (lane.creditsLeft === 0) return "Today’s free bets are all taken; more tomorrow.";
  return lane.open ? null : "Free bets are switched off right now.";
}

export default async function Home() {
  const site = await getSite();
  if (!site.ok) return <main id="main" className="wrap"><Intro /><ErrorState message={site.error ?? "The market didn’t answer."} /></main>;
  const byId = new Map(site.facts.map((f) => [f.id, f]));
  const lead = leadFact(site.facts);
  const ruling = leadRuling(site.settled, (id) => byId.get(id)?.trades ?? 0);
  const record = rulingRecord(site.rulings?.rulings ?? []);
  const off = freeBetsOffReason(site);
  const live = site.facts.filter((f) => f.status !== "settled");
  return (
    <main id="main" className="wrap home">
      <Intro />
      <ProofBar p={{ liveFacts: live.length, topics: new Set(live.map((f) => f.topic)).size, bets: site.totals.trades, paidUsd: record.paidUsd, ruled: record.settled.length }} />
      {off && <FreeBetsOff reason={off} />}
      <div className="hero">
        {lead && <Feature f={lead} points={site.history[String(lead.id)] ?? []} bets={site.bets.filter((b) => b.claimId === lead.id).reverse()} freeOpen={!off} />}
        <aside className="rail" aria-label="Rulings">
          {ruling && <RuledCard r={ruling} ruled={byId.get(ruling.claim_id)} corrected={ruling.correction ? byId.get(ruling.correction.claim_id) : undefined} settledCount={record.settled.length} now={site.asOf} />}
          <DecidingCard rulings={site.rulings} facts={byId} />
        </aside>
      </div>
      <HomeGrid initial={feedOrder(site.facts, lead)} points={site.history} reopened={site.reopened} />
    </main>
  );
}
