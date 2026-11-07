// The record: claims from the news once they are decided, in the market's words. It exists only while the
// official pages and today's news are both on. No loading.tsx here or above: this route calls notFound().
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorState } from "@/components/States";
import { PageHero } from "@/components/pages/Kit";
import { dayTimeUtc, plural } from "@/lib/format";
import type { RecordLine } from "@/lib/pages";
import { getNews } from "@/lib/server/news";
import { getOfficial, getRecord } from "@/lib/server/pages";

export const revalidate = 30;
export const metadata: Metadata = {
  title: "The record",
  description: "Claims from the news, as three AI judges ruled them on the evidence, with their sources.",
};

const KIND: Record<string, string> = { settled_by: "Settled by", headline: "The headline", receipt: "A receipt", coverage: "Coverage" };
const host = (url: string) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };

function Line({ l }: { l: RecordLine }) {
  return (
    <li className="panel recl">
      <div className="recl-top">
        <span className={`verdict ${l.outcome ?? ""}`}>Ruled {l.outcome}</span>
        <span className="fine">{l.decided_at !== null ? `Decided ${dayTimeUtc(l.decided_at)}` : "Decided"}{l.outcome === "true" ? ` by ${l.by}` : ""}{l.topic ? `, ${l.topic}` : ""}</span>
      </div>
      <h2>{l.question}</h2>
      <p className="recl-text">{l.text}</p>
      <ul className="recl-src" aria-label="Sources">
        {l.sources.map((s) => <li key={s.url}><span>{KIND[s.kind] ?? "Source"}</span> <a className="link" href={s.url} target="_blank" rel="noopener">{s.label ?? host(s.url)}</a></li>)}
      </ul>
      <p className="recl-go"><Link className="link" href={l.ruling.url}>The ruling</Link><Link className="link" href={l.market_url}>The market</Link></p>
    </li>
  );
}

export default async function RecordPage() {
  const [official, news] = await Promise.all([getOfficial(), getNews()]);
  if (!official.on || !news.on) notFound();
  const r = await getRecord();
  return (
    <main id="main" className="wrap pg narrow">
      <PageHero live={false} kick="The encyclopedia" title="The record." lede={<>Claims from the news, as they were ruled. Each one was a bet until the named source settled it and <b>three AI judges</b> ruled on the evidence.</>} />
      {!r.ok ? <ErrorState message={r.error} /> : r.value.lines.length ? (
        <>
          <p className="fine reccount">{plural(r.value.count, "claim")} decided so far.</p>
          <ol className="reclist">{r.value.lines.map((l) => <Line key={l.claim_id} l={l} />)}</ol>
        </>
      ) : <p className="panel recnone">No claim from the news has been decided yet. <Link className="link" href="/">See today’s claims</Link>.</p>}
    </main>
  );
}
