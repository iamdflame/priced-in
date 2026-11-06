"use client";
// The live strip: the real bets, newest first, from the market contract's own log. Each item reads on its
// own ("AI trader Skeptic · $0.22 on False · Tether T-Bills $72.6B") and the strip never cuts one in half:
// only whole items show (the row wraps out of sight), and every few seconds the oldest shown steps aside
// for the next. It renders from the server's read and refreshes while the tab is visible.
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopicIcon } from "../Brand";
import { bettor, betsFrom, type Bet } from "@/lib/bets";
import { filming } from "@/lib/client/film";
import { money, type AgentNames } from "@/lib/format";

export interface StripFact { short: string; icon: string }

const REFRESH_MS = 30_000;
const SHOWN = 16;
const ROTATE_MS = 5_000;

/** Step the list round every few seconds, unless the visitor asked for less motion or is reading it. */
function useRotation<T>(items: T[]) {
  const [start, setStart] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || items.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("still")) return;
    const t = setInterval(() => setStart((s) => (s + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [held, items.length]);
  const shown = [...items.slice(start % Math.max(1, items.length)), ...items.slice(0, start % Math.max(1, items.length))];
  return { shown, hold: () => setHeld(true), release: () => setHeld(false) };
}

function BetSentence({ b, f }: { b: Bet; f: StripFact | undefined }) {
  return (
    <Link className="tk" href={`/c/${b.claimId}`} prefetch={false}>
      {f && <TopicIcon icon={f.icon} />}
      <span><b>{bettor(b)}</b> · {b.free ? "free $1" : money(b.usd)} on <b className={b.side}>{b.side === "yes" ? "True" : "False"}</b> · {f?.short ?? `fact ${b.claimId}`}</span>
    </Link>
  );
}

export function LiveStrip({ initial, facts, agents }: { initial: Bet[]; facts: Record<number, StripFact>; agents: AgentNames }) {
  const [bets, setBets] = useState(initial);
  const [live, setLive] = useState(true);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden || filming()) return; // film mode keeps the first items
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
  const rot = useRotation(bets);
  return (
    <div className="ticker" aria-label="Live bets">
      <div className="wrap">
        <span className={`live ${live ? "" : "off"}`}><span className="dot" /><span>{live ? <>Live<span className="hide-phone"> · real money</span></> : "Reconnecting…"}</span></span>
        {bets.length ? (
          <div className="tape" onMouseEnter={rot.hold} onMouseLeave={rot.release} onFocus={rot.hold} onBlur={rot.release}>
            {rot.shown.map((b) => <BetSentence key={`${b.tx}:${b.claimId}:${b.at}`} b={b} f={facts[b.claimId]} />)}
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
