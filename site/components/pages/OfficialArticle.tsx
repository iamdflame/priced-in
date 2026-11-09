// The market's page for one article (OFFICIAL_PAGES=1): the head, the article written from the odds, its
// source and licence, and the side. With the official pages off, /p/[slug] never renders this.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../Icon";
import { MarketArticle } from "./MarketArticle";
import { modelShort, plural } from "@/lib/format";
import type { Fact } from "@/lib/model";
import { dateWords, pageMood, slimPage, writtenWords, type OfficialPage } from "@/lib/pages";

const CC = "https://creativecommons.org/licenses/by-sa/4.0/";

/** `lead` sits under the title, above the article: the corrections, when the page has rulings. */
export function OfficialArticle({ page, facts, lead }: { page: OfficialPage; facts: Fact[]; lead?: ReactNode }) {
  const t = page.totals;
  const doubted = facts.filter((f) => f.status === "open").sort((a, b) => a.price - b.price).slice(0, 6);
  const models = t.models.map(modelShort).join(" and ");
  const decided = `${plural(t.facts_decided, "fact")} decided`;
  return (
    <div className="enc">
      <div className="panel">
        <header className="enc-head short">
          <nav className="crumb" aria-label="Breadcrumb"><Link href="/p">Encyclopedia</Link><span aria-hidden="true">/</span><span>{page.title}</span></nav>
          <h1>{page.title}</h1>
          {t.facts_decided > 0 && (
            <p className="crx-n"><Icon name="gavel" />{page.corrections?.length ? <a href="#corrected">{decided}</a> : <span>{decided}</span>}</p>
          )}
        </header>
        {lead}
        <MarketArticle paragraphs={slimPage(page)} facts={facts} written={writtenWords(t)} mood={pageMood(t)} lastChanged={t.last_changed} revised={dateWords(page.source.revised_at)} />
        <p className="fine attribution">
          {page.source.attribution} <a className="link" href={page.source.url} target="_blank" rel="noopener">The revision we read</a>. The market’s page is rewritten from it by AI and shared under the same licence, <a className="link" href={CC} target="_blank" rel="noopener license">CC BY-SA 4.0</a>.
        </p>
      </div>
      <aside className="enc-side" aria-label="On this page">
        <section className="panel wrote">
          <h2>Written by AI</h2>
          <p className="wrote-n"><b>{t.written_by_ai}</b> <span>of {plural(t.paragraphs, "paragraph")}</span></p>
          {t.rewrites > 0
            ? <p className="fine">Each is rewritten from the odds on its sentences. {t.signed} of {plural(t.rewrites, "rewrite")} signed in a TEE by {models || "the writer model"}; {t.anchored ? `${t.anchored} anchored on NEAR` : "none anchored on NEAR yet"}.</p>
            : t.facts_priced
              ? <p className="fine">The AI rewrites a paragraph once someone bets on one of its {t.facts_priced === 1 ? "priced sentence" : "priced sentences"}.</p>
              : <p className="fine">No sentence on this page has a market yet. <Link className="link" href="/new">Price one yourself</Link>.</p>}
          <Link className="src" href="/trust">How to check a signature<Icon name="arrow" /></Link>
        </section>
        {doubted.length > 0 && (
          <section className="panel">
            <h2>Most doubted here</h2>
            {doubted.map((f) => <Link key={f.id} className="mini" href={`/c/${f.id}`}><span>{f.question}</span><b>{Math.round(f.price * 100)}%</b></Link>)}
          </section>
        )}
      </aside>
    </div>
  );
}
