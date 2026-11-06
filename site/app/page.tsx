// Home: the promise, the three steps, the lead (a fact with real bets and a real ruling), "Being decided"
// and "Results", then every fact as a card. Server-rendered from the live API.
import { PlainFeature, RulingFeature } from "@/components/home/Feature";
import { HomeGrid } from "@/components/home/HomeGrid";
import { Intro } from "@/components/home/Intro";
import { DecidingRail, ResultsRail } from "@/components/home/Rails";
import { CoachMark } from "@/components/Live";
import { ErrorState } from "@/components/States";
import type { Fact } from "@/lib/model";
import { leadRuling } from "@/lib/rulings";
import { agentsByClaim, getSite, type Site } from "@/lib/server/site";

export const revalidate = 15;

/** One fact per topic in turn, so a page of mostly Tether still reads as varied. Results go last. */
function feedOrder(facts: Fact[]): Fact[] {
  const live = facts.filter((f) => f.status !== "settled");
  const byTopic = new Map<string, Fact[]>();
  for (const f of [...live].sort((a, b) => b.trades - a.trades || Number(!!b.caught) - Number(!!a.caught) || a.id - b.id)) {
    byTopic.set(f.topic, [...(byTopic.get(f.topic) ?? []), f]);
  }
  const bets = (l: Fact[]) => l.reduce((n, f) => n + f.trades, 0);
  const lists = [...byTopic.values()].sort((a, b) => bets(b) - bets(a));
  const out: Fact[] = [];
  for (let i = 0; out.length < live.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return [...out, ...facts.filter((f) => f.status === "settled")];
}

function freeBetState({ lane }: Site): { open: boolean; reason: string | null } {
  if (!lane) return { open: false, reason: "We couldn’t check the free bets just now." };
  if (lane.paused) return { open: false, reason: "The market is paused." };
  if (lane.creditsLeft === 0) return { open: false, reason: "Today’s free bets are all taken; more tomorrow." };
  return { open: lane.open, reason: lane.open ? null : "Free bets are switched off right now." };
}

function Lead({ site, byId }: { site: Site; byId: Map<number, Fact> }) {
  const ruling = leadRuling(site.settled, (id) => byId.get(id)?.trades ?? 0);
  const ruled = ruling ? byId.get(ruling.claim_id) : undefined;
  if (ruling && ruled) return <RulingFeature ruled={ruled} corrected={ruling.correction ? byId.get(ruling.correction.claim_id) ?? null : null} ruling={ruling} />;
  const mostBet = [...site.facts].filter((f) => f.status === "open").sort((a, b) => b.trades - a.trades)[0];
  return mostBet ? <PlainFeature f={mostBet} /> : null;
}

export default async function Home() {
  const site = await getSite();
  if (!site.ok) return <main id="main" className="wrap"><Intro /><ErrorState message={site.error ?? "The market didn’t answer."} /></main>;
  const byId = new Map(site.facts.map((f) => [f.id, f]));
  const free = freeBetState(site);
  return (
    <main id="main" className="wrap">
      <Intro />
      <CoachMark open={free.open} reason={free.reason} />
      <div className="hero">
        <Lead site={site} byId={byId} />
        <aside className="rail" aria-label="Rulings">
          <DecidingRail rulings={site.rulings} facts={byId} />
          <ResultsRail settled={site.settled} read={site.rulings !== null} facts={byId} />
        </aside>
      </div>
      <p className="scale-line">
        <span><b>{site.totals.facts} facts</b> from {new Set(site.facts.map((f) => f.page)).size} Wikipedia articles</span>
        <span><b>{site.totals.trades} bets</b> so far</span>
        {site.settled.length > 0 && <span><b>{site.settled.length} ruled</b> by AI judges</span>}
        <span><b>{Object.keys(site.agents).length} AI traders</b> betting their own money</span>
        <span>Every bet is a public transaction</span>
      </p>
      <HomeGrid initial={feedOrder(site.facts)} points={site.history} agents={agentsByClaim(site.bets)} reopened={site.reopened} />
    </main>
  );
}
