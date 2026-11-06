// Home: the promise, the three steps, the featured story (a fact with real bets and a real ruling),
// "Being decided" and "Results", then every live fact as a card. Server-rendered from the live API.
import { DecidingRail, Intro, PlainFeature, ResultsRail, RulingFeature } from "@/components/Home";
import { HomeGrid } from "@/components/HomeGrid";
import { CoachMark } from "@/components/Live";
import { ErrorState } from "@/components/States";
import { agentsByClaim, getSite } from "@/lib/server/site";
import type { Fact } from "@/lib/model";

export const revalidate = 15;

function interleave(facts: Fact[]): Fact[] {
  const by = new Map<string, Fact[]>();
  for (const f of [...facts].sort((a, b) => b.trades - a.trades || Number(!!b.caught) - Number(!!a.caught) || a.id - b.id)) {
    const l = by.get(f.topic) ?? [];
    l.push(f);
    by.set(f.topic, l);
  }
  const lists = [...by.values()].sort((a, b) => b.reduce((n, f) => n + f.trades, 0) - a.reduce((n, f) => n + f.trades, 0));
  const out: Fact[] = [];
  for (let i = 0; out.length < facts.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

export default async function Home() {
  const site = await getSite();
  if (!site.ok) {
    return <main id="main" className="wrap"><Intro /><ErrorState message={site.error ?? "The market didn’t answer."} /></main>;
  }
  const byId = new Map(site.facts.map((f) => [f.id, f]));
  // lead with the latest ruling that came with a correction; else the most-bet open fact
  const ruling = (site.rulings?.rulings ?? []).filter((r) => r.status === "settled" && byId.has(r.claim_id)).sort((a, b) => (b.settled_at ?? 0) - (a.settled_at ?? 0))[0] ?? null;
  const ruled = ruling ? byId.get(ruling.claim_id)! : null;
  const corrected = ruling?.correction ? byId.get(ruling.correction.claim_id) ?? null : null;
  const lead = ruled ? null : [...site.facts].filter((f) => f.status === "open").sort((a, b) => b.trades - a.trades)[0] ?? null;
  const reopened = (site.rulings?.rulings ?? []).flatMap((r) => (r.correction ? [r.correction.claim_id] : []));
  const lane = site.lane;
  const laneOpen = !!lane && lane.open && (lane.creditsLeft === null || lane.creditsLeft > 0);
  const laneReason = !lane ? "We couldn’t check the free bets just now." : lane.paused ? "The market is paused." : lane.creditsLeft === 0 ? "Today’s free bets are all taken; more tomorrow." : null;
  // the grid leads with variety: one fact per topic in turn (the most bet on, and the doubted, first);
  // results go last
  const grid = interleave(site.facts.filter((f) => f.status !== "settled")).concat(site.facts.filter((f) => f.status === "settled"));

  return (
    <main id="main" className="wrap">
      <Intro />
      <CoachMark open={laneOpen} reason={laneReason} />
      <div className="hero">
        {ruled && ruling ? <RulingFeature ruled={ruled} corrected={corrected} ruling={ruling} /> : lead ? <PlainFeature f={lead} /> : null}
        <aside className="rail" aria-label="Rulings">
          <DecidingRail rulings={site.rulings} facts={byId} />
          <ResultsRail rulings={site.rulings} facts={byId} />
        </aside>
      </div>
      <p className="scale-line">
        <span><b>{site.totals.facts} facts</b> from {new Set(site.facts.map((f) => f.page)).size} Wikipedia articles</span>
        <span><b>{site.totals.trades} bets</b> so far</span>
        <span><b>{Object.keys(site.agents).length} AI traders</b> betting their own money</span>
        <span>Every bet is a public transaction</span>
      </p>
      <HomeGrid initial={grid} points={site.history} agents={agentsByClaim(site.bets)} reopened={reopened} />
    </main>
  );
}
