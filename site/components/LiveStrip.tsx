"use client";
// The live strip: the real bets, newest first, as sentences, from the market contract's own log. It
// renders from the server's read and refreshes while the tab is visible. The scrolling copy is
// decorative; the first copy is the readable, focusable one.
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopicIcon } from "./Brand";
import { money } from "@/lib/format";
import { betsFrom, type Bet } from "@/lib/live";

export interface StripFact { id: number; name: string; icon: string }

export function LiveStrip({ initial, facts, agents, totals }: {
  initial: Bet[];
  facts: Record<number, StripFact>;
  agents: Record<string, string>;
  totals: { facts: number; trades: number; volumeUsd: number };
}) {
  const [bets, setBets] = useState(initial);
  const [live, setLive] = useState(true);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/events/recent?since=0", { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (!stop) { setBets(betsFrom(j.events || [], agents).reverse().slice(0, 16)); setLive(true); }
      } catch { if (!stop) setLive(false); }
    };
    const t = setInterval(tick, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [agents]);
  const items = (hidden: boolean) => bets.map((b, i) => {
    const f = facts[b.claimId];
    return (
      <Link key={`${hidden ? "h" : "v"}${b.tx}${i}`} className="tk" href={`/c/${b.claimId}`} tabIndex={hidden ? -1 : undefined} prefetch={false}>
        {f && <TopicIcon icon={f.icon} />}
        <span>{b.free ? <>Someone bet their <b>free $1</b></> : <>{b.who} bet <b>{money(b.usd)}</b></>} that {f?.name ?? `fact ${b.claimId}`} is <b className={b.side}>{b.side === "yes" ? "true" : "false"}</b></span>
      </Link>
    );
  });
  return (
    <div className="ticker" aria-label="Live bets">
      <div className="wrap">
        <span className={`live ${live ? "" : "off"}`}><span className="dot" />{live ? "Live · real money" : "Reconnecting…"}</span>
        <span className="net">{totals.facts} facts open · {totals.trades} bets · {money(totals.volumeUsd)} bet so far</span>
        {bets.length ? (
          <div className="tape">
            <div className="tape-in">
              {items(false)}
              <span aria-hidden="true" style={{ display: "contents" }}>{items(true)}</span>
            </div>
          </div>
        ) : (
          <span className="net" style={{ display: "inline" }}>No bets yet today. Yours could be the first.</span>
        )}
      </div>
    </div>
  );
}
