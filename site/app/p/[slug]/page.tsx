// An encyclopedia page with odds heat: the Wikipedia article, every sentence with a market tinted by
// what the money says. With the official pages on (OFFICIAL_PAGES=1 on the API), it opens on the market's
// page instead: written by AI from the odds, one tap from Wikipedia's words (OfficialArticle).
// No loading.tsx here or above: this route calls notFound().
import "../../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ErrorState } from "@/components/States";
import { Corrections } from "@/components/pages/Corrections";
import { HeatArticle } from "@/components/pages/HeatArticle";
import { OfficialArticle } from "@/components/pages/OfficialArticle";
import { plural } from "@/lib/format";
import { api } from "@/lib/server/api";
import { ARTICLES, articleOf } from "@/lib/server/encyclopedia";
import { getOfficialPage } from "@/lib/server/pages";
import { getSite } from "@/lib/server/site";

export const revalidate = 30;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const a = ARTICLES.find((x) => x.slug === slug);
  if (a && (await getOfficialPage(slug))) return { title: `${a.title}, written from the odds`, description: `The ${a.title} article, written by AI from what the market believes and what the judges ruled, one tap from Wikipedia’s words.` };
  return a ? { title: `${a.title}, priced`, description: `The ${a.title} article with every checkable sentence tinted by what the market thinks.` } : {};
}

export default async function ArticlePage({ params }: Params) {
  const { slug } = await params;
  if (!ARTICLES.some((a) => a.slug === slug)) notFound();
  const [site, official] = await Promise.all([getSite(), getOfficialPage(slug)]);
  if (!site.ok) return <main id="main" className="wrap pg"><ErrorState message={site.error ?? "The prices didn’t load."} /></main>;
  if (official) return <main id="main" className="wrap pg"><OfficialArticle page={official} facts={site.facts.filter((f) => f.page === slug)} lead={<Corrections items={official.corrections} />} /></main>;
  const article = await articleOf(slug, site.facts, site.rulings?.rulings ?? []);
  if (!article) notFound();
  const facts = site.facts.filter((f) => f.page === slug);
  const open = facts.filter((f) => f.status === "open");
  const doubted = [...open].sort((a, b) => a.price - b.price).slice(0, 6);
  const rewrites = await api.rewrites(slug);
  const signed = rewrites.ok ? rewrites.value.filter((r) => r.status === "signed") : [];

  return (
    <main id="main" className="wrap pg">
      <div className="enc">
        <div className="panel">
          <header className="enc-head">
            <nav className="crumb" aria-label="Breadcrumb"><Link href="/p">Encyclopedia</Link><span aria-hidden="true">/</span><span>{article.title}</span></nav>
            <h1>{article.title}</h1>
            <p className="lede">{facts.length ? <>{plural(facts.length, "sentence")} on this page {facts.length === 1 ? "has" : "have"} a market. Tap one to see the odds and bet.</> : <>No sentence on this page has a market yet. <Link className="link" href="/new">Price one yourself</Link>.</>}</p>
            <div className="heatkey" aria-hidden="true"><span>Likely false</span><span className="heatbar" /><span>Likely true</span></div>
          </header>
          <HeatArticle sections={article.sections} opened={article.opened} facts={facts} />
          <p className="fine attribution">{article.attribution} <a className="link" href={article.url} target="_blank" rel="noopener">The revision we read</a>.</p>
        </div>
        <aside className="enc-side" aria-label="On this page">
          {doubted.length > 0 && (
            <section className="panel">
              <h2>Most doubted here</h2>
              {doubted.map((f) => <Link key={f.id} className="mini" href={`/c/${f.id}`}><span>{f.question}</span><b>{Math.round(f.price * 100)}%</b></Link>)}
            </section>
          )}
          <section className="panel">
            <h2>Signed by AI</h2>
            {signed.length ? <p className="fine">{plural(signed.length, "paragraph")} rewritten from the prices and signed by {signed[0].provenance?.model ?? "the writer model"}.</p> : <p className="fine">No paragraph on this page has been rewritten yet.</p>}
            <Link className="src" href="/trust">How to check a signature<Icon name="arrow" /></Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
