"use client";
// Activity (the real bets), Discussion (the AI traders' reasons, including why they held off) and
// History (what happened to the fact), as tabs with arrow-key support.
import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { Ago } from "./Live";
import type { Rationale } from "@/lib/core/api";
import { explorerTx, money, modelShort, shortHash } from "@/lib/format";
import type { Bet } from "@/lib/live";

export interface HistoryItem { at: number; icon: "pulse" | "flag" | "chip" | "scale" | "coin" | "sparkle"; text: string; tx?: string | null }

const persona = (r: Rationale) => (r as any).persona || r.agent.replace(/^house-/, "").replace(/^./, (c) => c.toUpperCase());

function heldOff(r: Rationale): string | null {
  if (r.side !== "no_bet" && r.side !== "agree") return null;
  const t = (r.text || "").replace(/^no bet:\s*/i, "");
  if (r.side === "agree") return "Held off: it agrees with the price.";
  if (/edge too thin/i.test(t)) return "Held off: the edge was too thin once its own bet moved the price.";
  if (/daily spend cap/i.test(t)) return "Held off: it had reached its daily spending limit.";
  return t ? `Held off: ${t}` : "Held off.";
}

export function MarketTabs({ bets, rationales, history }: { bets: Bet[]; rationales: Rationale[]; history: HistoryItem[] }) {
  const tabs = [
    { id: "dis", label: "Discussion", n: rationales.length },
    { id: "act", label: "Activity", n: bets.length },
    { id: "his", label: "History", n: history.length },
  ];
  const [on, setOn] = useState(rationales.length ? "dis" : "act");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    const j = (i + d + tabs.length) % tabs.length;
    setOn(tabs[j].id);
    refs.current[j]?.focus();
  };
  return (
    <section aria-label="Activity and discussion">
      <div className="ptabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`tab-${t.id}`} className="ptab" aria-selected={on === t.id} aria-controls={`pane-${t.id}`} tabIndex={on === t.id ? 0 : -1} onClick={() => setOn(t.id)} onKeyDown={(e) => key(e, i)}>
            {t.label}<span className="n">{t.n}</span>
          </button>
        ))}
      </div>
      <div className="feed" role="tabpanel" id="pane-dis" aria-labelledby="tab-dis" hidden={on !== "dis"}>
        {rationales.length ? rationales.map((r) => {
          const p = persona(r);
          const held = heldOff(r);
          return (
            <div key={`${r.account_id}${r.at}`} className="row">
              <span className={`ag big ${p}`} title={`The ${p}, an AI trader`}>{p[0]}</span>
              <div>
                <div className="t"><b>The {p}</b>, an AI trader ({modelShort(r.model)}), puts it at <b>{Math.round(r.credence * 100)}% chance it’s true</b>{held ? "" : <> and bet {money(r.size_usd)} that it’s <span className={r.side === "yes" ? "pos" : "neg"}>{r.side === "yes" ? "true" : "false"}</span></>}.</div>
                <p className="reason">{r.rationale}</p>
                {held && <p className="held">{held}</p>}
                {r.source_url && <a className="src" href={r.source_url} target="_blank" rel="noopener nofollow">{r.source_title || new URL(r.source_url).host}<Icon name="ext" /></a>}
              </div>
              <span className="w"><Ago at={r.at} />{r.tx_hash ? <><br /><a href={explorerTx(r.tx_hash)} target="_blank" rel="noopener">bet tx</a></> : null}</span>
            </div>
          );
        }) : <p className="emptyfeed">No AI trader has written about this fact yet. They read every open fact on a schedule; their reasons will show here.</p>}
      </div>
      <div className="feed" role="tabpanel" id="pane-act" aria-labelledby="tab-act" hidden={on !== "act"}>
        {bets.length ? bets.map((b, i) => (
          <div key={`${b.tx}${i}`} className="row">
            <span className={`ag big ${b.kind === "agent" ? b.who.replace(/^The /, "") : "visitor"}`}>{b.kind === "agent" ? b.who.replace(/^The /, "")[0] : "$"}</span>
            <div className="t"><b>{b.who}</b> bet {b.free ? "their free $1" : money(b.usd)} that it’s <span className={b.side === "yes" ? "pos" : "neg"}>{b.side === "yes" ? "true" : "false"}</span>{b.priceBefore !== null ? <>: {Math.round(b.priceBefore * 100)}% to {Math.round(b.priceAfter * 100)}% chance it’s true</> : <>: now {Math.round(b.priceAfter * 100)}%</>}.</div>
            <span className="w"><Ago at={b.at} />{b.tx ? <><br /><a href={explorerTx(b.tx)} target="_blank" rel="noopener" aria-label={`Transaction ${b.tx}`}>{shortHash(b.tx, 5, 4)}</a></> : null}</span>
          </div>
        )) : <p className="emptyfeed">No bets yet. Every bet shows here with its NEAR transaction, the moment it lands.</p>}
      </div>
      <div className="feed" role="tabpanel" id="pane-his" aria-labelledby="tab-his" hidden={on !== "his"}>
        {history.map((h, i) => (
          <div key={i} className="row">
            <span className="ag big visitor"><Icon name={h.icon} /></span>
            <div className="t">{h.text}</div>
            <span className="w"><Ago at={h.at} />{h.tx ? <><br /><a href={explorerTx(h.tx)} target="_blank" rel="noopener">tx</a></> : null}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
