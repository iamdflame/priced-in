// The encyclopedia's front page: the articles that have markets, each with a strip of its facts' heat. With
// the official pages on (OFFICIAL_PAGES=1 on the API), each says how much of it the AI has written, and the
// record of decided news claims is one tap away while today's news is on too.
import "../styles/pages.css";
import type { Metadata } from "next";
import { Art } from "@/components/Art";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ErrorState } from "@/components/States";
import { PageHero } from "@/components/pages/Kit";
import { plural } from "@/lib/format";
import { writtenWords, type PageSummary } from "@/lib/pages";
import { ARTICLES } from "@/lib/server/encyclopedia";
import { getNews } from "@/lib/server/news";
import { getOfficial } from "@/lib/server/pages";
import { getSite } from "@/lib/server/site";

export const revalidate = 30;
export const metadata: Metadata = {
  title: "The encyclopedia, priced",
  description: "Wikipedia articles with every checkable sentence tinted by what the market thinks.",
};

export default async function EncyclopediaPage() {
  const [site, official] = await Promise.all([getSite(), getOfficial()]);
  const record = official.on && (await getNews()).on;
  const written = new Map<string, PageSummary>(official.on ? official.index.pages.map((x) => [x.slug, x]) : []);
  const shelf = ARTICLES
    .map((a) => ({ ...a, facts: site.facts.filter((f) => f.page === a.slug) }))
    .filter((a) => a.facts.length > 0)
    .sort((a, b) => b.facts.length - a.facts.length);
  return (
    <main id="main" className="wrap pg">
      {official.on
        ? <PageHero kick="The encyclopedia, written from the odds" title="The encyclopedia the market writes." lede={<>Each page starts as Wikipedia’s. Where a sentence has a market, AI rewrites it from the odds and signs it: <b>plain where the money is sure, hedged where it isn’t</b>. Sentences with no market keep Wikipedia’s words.</>} actions={record ? <Link className="btn ghost" href="/record">See the record of decided claims</Link> : undefined} />
        : <PageHero kick="The encyclopedia, priced" title="Read Wikipedia with the odds on." lede={<>Every sentence with a market is tinted by what the money says: <b>red if it looks false, green if it looks true</b>. Tap one to bet.</>} />}
      {site.ok ? (
        <div className="pagelist shelf">
          {shelf.map((a) => (
            <Link key={a.slug} className="pagec" href={`/p/${a.slug}`}>
              <span className="art"><Art name={a.facts[0].art} width={560} height={320} sizes="(max-width: 760px) 100vw, 420px" /></span>
              <div className="b">
                <h2>{a.title}</h2>
                <p>{plural(a.facts.length, "fact")} priced in {a.sentences} sentences</p>
                {written.has(a.slug) && <p className="aiw">{writtenWords(written.get(a.slug)!)}</p>}
                <span className="heatstrip" aria-hidden="true">{a.facts.map((f) => <i key={f.id} style={{ "--h": f.price } as CSSProperties} />)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : <ErrorState message={site.error ?? "The prices didn’t load."} />}
    </main>
  );
}
