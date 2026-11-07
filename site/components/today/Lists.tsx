// What's settling next (the ones waiting for their result first) and what was just decided, as compact
// rows: the topic's object, the question, where it stands in words, the %, and your own pick.
import Link from "next/link";
import { Art } from "../Art";
import { Icon } from "../Icon";
import { More } from "./More";
import { MyPickBadge } from "./MyPick";
import { dayTimeUtc } from "@/lib/format";
import { blockArt, shortDate, type TodayLine } from "@/lib/news";

const SHOWN = 5;

function where(l: TodayLine, now: number): { text: string; tone: "" | "warn" | "done" } {
  if (l.status === "decided") return { text: `Ruled ${l.outcome === "true" ? "true" : "false"} by three AI judges${l.decided_at ? `, ${dayTimeUtc(l.decided_at)}` : ""}`, tone: "done" };
  if (l.status === "ruling") return { text: "Three AI judges are ruling on it now", tone: "warn" };
  if (l.overdue || now >= l.settles.due_at) return { text: `Waiting for its source: its date (${shortDate(l.settles.by)}) has passed and it isn’t settled yet`, tone: "warn" };
  return { text: `Settles by ${shortDate(l.settles.by)}: ${l.settles.source}`, tone: "" };
}

function Row({ l, now, art }: { l: TodayLine; now: number; art: string }) {
  const w = where(l, now);
  const p = l.price_yes ?? l.first_estimate;
  return (
    <li className="lrow">
      <span className="lr-art" aria-hidden="true"><Art name={art} width={112} height={64} /></span>
      <div className="lr-main">
        <Link className="lr-q" href={`/c/${l.claim_id}`} prefetch={false}>{l.question}</Link>
        <p className={`lr-s ${w.tone}`}>{w.tone === "warn" && <Icon name="clock" />}{w.text}</p>
      </div>
      <div className="lr-r">
        {l.status === "decided"
          ? <span className={`verdict ${l.outcome === "true" ? "true" : "false"}`}>{l.outcome === "true" ? "TRUE" : "FALSE"}</span>
          : <span className="lr-pct num" aria-label={`${Math.round(p * 100)}% chance it’s true`}>{Math.round(p * 100)}<i>%</i></span>}
        <MyPickBadge id={l.claim_id} outcome={l.status === "decided" ? l.outcome : null} />
      </div>
    </li>
  );
}

export function LineList({ id, title, sub, lines, now }: { id: string; title: string; sub: string; lines: TodayLine[]; now: number }) {
  if (!lines.length) return null;
  const art = blockArt(lines);
  return (
    <section className="tlist" aria-labelledby={id}>
      <div className="tlist-hd"><h3 id={id}>{title}</h3><p>{sub}</p></div>
      <More n={lines.length} shown={SHOWN} label={`Show all ${lines.length}`}>
        {lines.map((l) => <Row key={l.claim_id} l={l} now={now} art={art.get(l.claim_id)!} />)}
      </More>
    </section>
  );
}
