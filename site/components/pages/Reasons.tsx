"use client";
// The AI traders' reasons, newest first: every bet and every time one held off, with why. A filter
// switches between all, bets only and held off.
import Link from "next/link";
import { useState } from "react";
import { Ago } from "../Live";
import { Icon } from "../Icon";
import { explorerTx, money } from "@/lib/format";
import { isBetSide, type ReasonItem } from "@/lib/reasons";

/** A source's name for the screen: its title, or its host when the title is only the address (a long raw URL overflowed a phone). */
function sourceName(title: string | null | undefined, url: string): string {
  const s = (title ?? "").trim();
  if (s && !/^https?:\/\//i.test(s)) return s;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Its source"; }
}

function sideWords(r: ReasonItem) {
  if (r.side === "yes") return <span className="chip yes">Bet {money(r.sizeUsd)} on true</span>;
  if (r.side === "no") return <span className="chip no">Bet {money(r.sizeUsd)} on false</span>;
  if (r.side.startsWith("sell")) return <span className="chip">Sold {r.side.endsWith("no") ? "its No" : "its Yes"}</span>;
  if (r.side === "agree") return <span className="chip">Agrees with the price</span>;
  return <span className="chip warn">Held off</span>;
}

export function Reasons({ items, limit = 30 }: { items: ReasonItem[]; limit?: number }) {
  const [f, setF] = useState<"all" | "bets" | "held">("all");
  const [more, setMore] = useState(false);
  const all = items.filter((r) => (f === "all" ? true : f === "bets" ? isBetSide(r.side) : !isBetSide(r.side)));
  const list = more ? all : all.slice(0, limit);
  const n = { all: items.length, bets: items.filter((r) => isBetSide(r.side)).length, held: items.filter((r) => !isBetSide(r.side)).length };
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Filter reasons">
        {(["all", "bets", "held"] as const).map((k) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={f === k} onClick={() => setF(k)}>
            {k === "all" ? "All reasons" : k === "bets" ? "Bets" : "Held off"}<span className="n">{n[k]}</span>
          </button>
        ))}
      </div>
      <div className="panel reasons">
        {list.length ? list.map((r, i) => (
          <article key={`${r.at}-${r.persona}-${i}`} className="rsn">
            <span className={`ag big ${r.persona}`} aria-hidden="true">{r.persona.charAt(0)}</span>
            <div className="shrink">
              <div className="h">
                <b>The {r.persona}</b>{sideWords(r)}
                <span>thinks <b>{Math.round(r.credence * 100)}%</b> chance it’s true; the market said {Math.round(r.priceBefore * 100)}%</span>
                <span className="when"><Ago at={r.at} /></span>
              </div>
              <Link className="fq" href={`/c/${r.claimId}`}>{r.question}</Link>
              <p className="t">{r.rationale}</p>
              {(r.why || r.tx || r.source) && (
                <p className="why">
                  {r.why && !isBetSide(r.side) ? <>Why it held off: {r.why}. </> : null}
                  {r.source ? <a className="link" href={r.source} target="_blank" rel="noopener">{sourceName(r.sourceTitle, r.source)}</a> : null}
                  {r.tx ? <> · <a className="link" href={explorerTx(r.tx)} target="_blank" rel="noopener">the bet on NEAR</a></> : null}
                </p>
              )}
            </div>
          </article>
        )) : <p className="emptyfeed">Nothing here yet.</p>}
      </div>
      {!more && all.length > limit && (
        <button type="button" className="btn soft result-note" onClick={() => setMore(true)}><Icon name="down" />Show all {all.length}</button>
      )}
    </div>
  );
}
