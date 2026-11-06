// The encyclopedia's front page: the articles that have markets, each with a strip of its facts' heat.
import "../styles/pages.css";
import type { Metadata } from "next";
import { Art } from "@/components/Art";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ErrorState } from "@/components/States";
import { PageHero } from "@/components/pages/Kit";
import { plural } from "@/lib/format";
import { ARTICLES } from "@/lib/server/encyclopedia";
import { getSite } from "@/lib/server/site";

export const revalidate = 30;
export const metadata: Metadata = {
  title: "The encyclopedia, priced",
  description: "Wikipedia articles with every checkable sentence tinted by what the market thinks.",
};

export default async function EncyclopediaPage() {
  const site = await getSite();
  const shelf = ARTICLES
    .map((a) => ({ ...a, facts: site.facts.filter((f) => f.page === a.slug) }))
    .filter((a) => a.facts.length > 0)
    .sort((a, b) => b.facts.length - a.facts.length);
  return (
    <main id="main" className="wrap pg">
      <PageHero kick="The encyclopedia, priced" title="Read Wikipedia with the odds on." lede={<>Every sentence with a market is tinted by what the money says: <b>red if it looks false, green if it looks true</b>. Tap one to bet.</>} />
      {site.ok ? (
        <div className="pagelist shelf">
          {shelf.map((a) => (
            <Link key={a.slug} className="pagec" href={`/p/${a.slug}`}>
              <span className="art"><Art name={a.facts[0].art} width={560} height={320} sizes="(max-width: 760px) 100vw, 420px" /></span>
              <div className="b">
                <h2>{a.title}</h2>
                <p>{plural(a.facts.length, "fact")} priced in {a.sentences} sentences</p>
                <span className="heatstrip" aria-hidden="true">{a.facts.map((f) => <i key={f.id} style={{ "--h": f.price } as CSSProperties} />)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : <ErrorState message={site.error ?? "The prices didn’t load."} />}
    </main>
  );
}
