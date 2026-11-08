// What sits beside a page hero's words, so its right half shows something true: on /p, one real sentence as
// Wikipedia has it and as the market's page reads it now, with its odds and the encyclopedia's counts; on
// /leaderboard, the three AI traders' real records, the bar a person has to beat. Server components.
import Link from "next/link";
import type { CSSProperties } from "react";
import { plural } from "@/lib/format";
import type { BoardRow } from "@/lib/news";
import type { OfficialPage, PagesIndex, PageSentence } from "@/lib/pages";

/** The AI-written sentence to show: the most-bet one whose words differ from Wikipedia's, the shortest first. */
export function specimenOf(page: OfficialPage | null): { s: PageSentence; page: OfficialPage } | null {
  if (!page) return null;
  const lines = page.paragraphs.flatMap((p) => p.sentences).filter((s) => s.written_by === "ai" && s.claim && s.claim.status === "open" && s.claim.trades > 0 && s.wikipedia && s.wikipedia !== s.text);
  lines.sort((a, b) => b.claim!.trades - a.claim!.trades || a.text.length - b.text.length);
  return lines[0] ? { s: lines[0], page } : null;
}

/** The market's words with what it added to Wikipedia's marked: the words between their common start and end. */
function added(wiki: string, text: string) {
  const a = wiki.split(" "), b = text.split(" ");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const mid = b.slice(i, b.length - j).join(" ");
  return { start: b.slice(0, i).join(" "), mid, end: b.slice(b.length - j).join(" ") };
}

export function EncSpecimen({ spec, index }: { spec: { s: PageSentence; page: OfficialPage } | null; index: PagesIndex }) {
  const pages = index.pages;
  const written = pages.reduce((n, p) => n + p.written_by_ai, 0);
  const paragraphs = pages.reduce((n, p) => n + p.paragraphs, 0);
  const signed = pages.reduce((n, p) => n + p.signed, 0);
  const rewrites = pages.reduce((n, p) => n + p.rewrites, 0);
  const s = spec?.s;
  const c = s?.claim;
  const d = s && s.wikipedia ? added(s.wikipedia, s.text) : null;
  const pct = c ? Math.round(c.price_yes * 100) : 0;
  return (
    <div className="hside">
      {s && c && d && spec ? (
        <figure className="spec" aria-label="One sentence, as Wikipedia has it and as the market's page reads now">
          <p className="spec-k">Wikipedia</p>
          <blockquote className="spec-wiki">{s.wikipedia}</blockquote>
          <p className="spec-k">The market’s page, now</p>
          <p className="spec-mkt">
            <Link className="hs" href={`/c/${c.id}`} style={{ "--h": c.price_yes } as CSSProperties}>
              {d.start}{d.start && " "}{d.mid && <ins>{d.mid}</ins>}{d.mid && d.end && " "}{d.end}<sup>{pct}%</sup>
            </Link>
          </p>
          <figcaption><b>{pct}% chance it’s true</b> after {plural(c.trades, "bet")}, so the AI wrote “{d.mid || "it"}”. <Link className="link" href={`/p/${spec.page.slug}`}>{spec.page.title}</Link></figcaption>
        </figure>
      ) : null}
      <dl className="hstats">
        <div><dt>Pages</dt><dd>{pages.length}<small>with markets</small></dd></div>
        <div><dt>Written by AI</dt><dd>{written}<small>of {paragraphs} paragraphs</small></dd></div>
        <div><dt>Signed</dt><dd>{signed}<small>of {plural(rewrites, "rewrite")}</small></dd></div>
      </dl>
    </div>
  );
}

/** The AI traders' records for a period, best first: the bar to beat, from /api/leaderboard. */
export function AiBar({ ai, minSettled, people }: { ai: BoardRow[]; minSettled: number; people: number }) {
  const rows = [...ai].sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.settled - a.settled || b.points - a.points);
  if (!rows.length) return null;
  return (
    <div className="hside aibar">
      <p className="spec-k">The AI traders to beat, all time</p>
      <ol>
        {rows.map((r) => {
          const acc = r.accuracy === null ? null : Math.round(r.accuracy * 100);
          return (
            <li key={r.id}>
              <span className="ab-n"><b>The {r.name}</b><small>{r.settled ? `${r.right} of ${r.settled} right` : "nothing settled yet"}</small></span>
              <span className="ab-v num">{acc === null ? "–" : <>{acc}<i>%</i></>}</span>
              <span className="ab-bar" aria-hidden="true"><i style={{ width: `${acc ?? 0}%` }} /></span>
            </li>
          );
        })}
      </ol>
      <p className="fine">{people ? `${plural(people, "person", "people")} picking so far.` : "Nobody has picked yet."} Ranked from {minSettled} settled picks, AIs included.</p>
      <Link className="btn primary" href="/#today">Pick today’s claims</Link>
    </div>
  );
}
