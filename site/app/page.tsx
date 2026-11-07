// Home: the promise and the three steps, the market in numbers, then (while the API has today's news on
// and today has lines) today's claims as the front door; then one open Wikipedia fact with its Yes/No, the
// ruling with the most bets and what is being decided, and every fact as a card. With the news off the page
// is what it always was: on a 1440x900 screen the lead and the first row of cards share the first screen.
// With it on, every card's Yes and No is a free pick (one rule for the whole page); money is the next step.
import { Feature } from "@/components/home/Feature";
import { HomeGrid } from "@/components/home/HomeGrid";
import { Intro } from "@/components/home/Intro";
import { ProofBar } from "@/components/home/ProofBar";
import { DecidingCard, RuledCard } from "@/components/home/Rails";
import { FreeBetsOff } from "@/components/Live";
import { ErrorState } from "@/components/States";
import { TodayBlock } from "@/components/today/TodayBlock";
import { feedOrder, leadFact } from "@/lib/lead";
import { isNewsPage } from "@/lib/news";
import { leadRuling, rulingRecord } from "@/lib/rulings";
import { getNews } from "@/lib/server/news";
import { getSite, proofOf, type Site } from "@/lib/server/site";

export const revalidate = 15;

function freeBetsOffReason({ lane }: Site): string | null {
  if (!lane) return "We couldn’t check the free bets just now.";
  if (lane.paused) return "The market is paused.";
  if (lane.creditsLeft === 0) return "Today’s free bets are all taken; more tomorrow.";
  return lane.open ? null : "Free bets are switched off right now.";
}

export default async function Home() {
  const [site, news] = await Promise.all([getSite(), getNews()]);
  if (!site.ok) return <main id="main" className="wrap home"><Intro /><ErrorState message={site.error ?? "The market didn’t answer."} /></main>;
  const byId = new Map(site.facts.map((f) => [f.id, f]));
  // a news line is never a Wikipedia card, whatever the API says about news
  const wiki = site.facts.filter((f) => !f.news && !isNewsPage(f.page));
  const lead = leadFact(wiki);
  const ruling = leadRuling(site.settled, (id) => byId.get(id)?.trades ?? 0);
  const record = rulingRecord(site.rulings?.rulings ?? []);
  const off = freeBetsOffReason(site);
  const today = news.on && news.today.lines.length ? news.today : null;
  return (
    <main id="main" className={`wrap home${today ? " has-today" : ""}`}>
      <Intro />
      <ProofBar p={proofOf(site)} />
      {off && <FreeBetsOff reason={off} />}
      {today && <TodayBlock today={today} facts={byId} history={site.history} now={site.asOf} />}
      {today && (
        <div className="wikihd">
          <h2>Facts from Wikipedia</h2>
          <p>Sentences from Wikipedia with a price on them. When a newer source disagrees, three AI judges decide.</p>
        </div>
      )}
      <div className="hero">
        {lead && <Feature f={lead} points={site.history[String(lead.id)] ?? []} bets={site.bets.filter((b) => b.claimId === lead.id).reverse()} picks={news.on} />}
        <aside className="rail" aria-label="Rulings">
          {ruling && <RuledCard r={ruling} ruled={byId.get(ruling.claim_id)} corrected={ruling.correction ? byId.get(ruling.correction.claim_id) : undefined} settledCount={record.settled.length} now={site.asOf} />}
          <DecidingCard rulings={site.rulings} facts={byId} />
        </aside>
      </div>
      <HomeGrid initial={feedOrder(wiki, lead)} points={site.history} reopened={site.reopened} picks={news.on} />
    </main>
  );
}
