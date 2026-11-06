"use client";
// The live strip: the real bets, newest first, as sentences, from the market contract's own log. It
// renders from the server's read and refreshes while the tab is visible. The scrolling second copy is
// decorative; the first copy is the readable, focusable one.
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopicIcon } from "../Brand";
import { betsFrom, type Bet } from "@/lib/bets";
import { money, type AgentNames } from "@/lib/format";

export interface StripFact { name: string; icon: string }

const REFRESH_MS = 30_000;
const SHOWN = 16;

function BetSentence({ b, f, hidden }: { b: Bet; f: StripFact | undefined; hidden: boolean }) {
  return (
    <Link className="tk" href={`/c/${b.claimId}`} tabIndex={hidden ? -1 : undefined} prefetch={false}>
      {f && <TopicIcon icon={f.icon} />}
      <span>{b.free ? <>Someone bet their <b>free $1</b></> : <>{b.who} bet <b>{money(b.usd)}</b></>} that {f?.name ?? `fact ${b.claimId}`} is <b className={b.side}>{b.side === "yes" ? "true" : "false"}</b></span>
    </Link>
  );
}

export function LiveStrip({ initial, facts, agents, totals }: {
  initial: Bet[];
  facts: Record<number, StripFact>;
  agents: AgentNames;
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
        if (!stop) { setBets(betsFrom(j.events || [], agents).reverse().slice(0, SHOWN)); setLive(true); }
      } catch { if (!stop) setLive(false); }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [agents]);
  return (
    <div className="ticker" aria-label="Live bets">
      <div className="wrap">
        <span className={`live ${live ? "" : "off"}`}><span className="dot" />{live ? "Live · real money" : "Reconnecting…"}</span>
        <span className="net">{totals.facts} facts open · {totals.trades} bets · {money(totals.volumeUsd)} bet so far</span>
        {bets.length ? (
          <div className="tape">
            <div className="tape-in">
              {bets.map((b, i) => <BetSentence key={`${b.tx}${i}`} b={b} f={facts[b.claimId]} hidden={false} />)}
              <span aria-hidden="true" className="contents">{bets.map((b, i) => <BetSentence key={`${b.tx}${i}`} b={b} f={facts[b.claimId]} hidden />)}</span>
            </div>
          </div>
        ) : (
          <span className="net">No bets yet today. Yours could be the first.</span>
        )}
      </div>
    </div>
  );
}

/** While the strip's read is on its way: the same height, so nothing jumps. */
export function LiveStripSkeleton() {
  return <div className="ticker" aria-hidden="true"><div className="wrap"><span className="live"><span className="dot" />Live · real money</span></div></div>;
}
