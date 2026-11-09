"use client";
// The live strip: the real bets, newest first, from the market contract's own log. Each item reads on its
// own ("AI trader Skeptic bet $0.22 that it’s false: Are most of Tether’s cash reserves U.S. T-Bills…")
// and identical bets read as one line ("twice"). The strip never cuts one in half:
// only whole items show (the row wraps out of sight), and every few seconds the oldest shown steps aside
// for the next. It renders from the server's read and refreshes while the tab is visible. At 390 px and
// below (SMALL_PHONE, and .proofline in shell.css) the bets give way to one still line of real counts.
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TopicIcon } from "../Brand";
import { betLines, bettor, betWords, betsFrom, type Bet, type BetLine } from "@/lib/bets";
import { filming } from "@/lib/client/film";
import { money, plural, type AgentNames } from "@/lib/format";
import type { Proof } from "@/lib/server/site";

/** What the strip says about a fact: its question, clipped at a word, and its topic icon. */
export interface StripFact { short: string; icon: string }

const REFRESH_MS = 30_000;
const SHOWN = 16;
const ROTATE_MS = 5_000;
const SMALL_PHONE = "(max-width: 390px)";
const smallPhone = () => matchMedia(SMALL_PHONE).matches;

/** Step the list round every few seconds, unless the visitor asked for less motion or is reading it. */
function useRotation<T>(items: T[]) {
  const [start, setStart] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held || items.length < 2 || smallPhone() || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("still")) return;
    const t = setInterval(() => setStart((s) => (s + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [held, items.length]);
  const shown = [...items.slice(start % Math.max(1, items.length)), ...items.slice(0, start % Math.max(1, items.length))];
  return { shown, hold: () => setHeld(true), release: () => setHeld(false) };
}

/** "AI trader Archivist bet $0.12 that it’s false: Is Tether issued only for dollars?" */
function BetSentence({ l, f }: { l: BetLine; f: StripFact | undefined }) {
  const b = l.bet;
  return (
    <Link className="tk" href={`/c/${b.claimId}`} prefetch={false}>
      {f && <TopicIcon icon={f.icon} />}
      <span><b>{bettor(b)}</b> {betWords(l)} <b className={b.side}>{b.side === "yes" ? "true" : "false"}</b>: {f?.short ?? `fact ${b.claimId}`}</span>
    </Link>
  );
}

/**
 * The tape wraps its row out of sight, so only whole items show. The wrapped ones still sat in the tab
 * order and were read out: each item below the first row is made inert (no focus, no reading) until a
 * rotation or a wider window brings it back up.
 */
function useWrappedInert(tape: RefObject<HTMLDivElement | null>, dep: unknown) {
  useLayoutEffect(() => {
    const el = tape.current;
    if (!el) return;
    const mark = () => {
      const items = [...el.children] as HTMLElement[];
      const top = items[0]?.offsetTop ?? 0;
      for (const it of items) {
        const away = it.offsetTop > top + 2;
        it.inert = away;
        if (away) { it.setAttribute("aria-hidden", "true"); it.tabIndex = -1; }
        else { it.removeAttribute("aria-hidden"); it.removeAttribute("tabindex"); }
      }
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tape, dep]);
}

export function LiveStrip({ initial, facts, agents, proof }: { initial: Bet[]; facts: Record<number, StripFact>; agents: AgentNames; proof: Proof | null }) {
  const [bets, setBets] = useState(initial);
  const [live, setLive] = useState(true);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden || filming() || (proof && smallPhone())) return; // film mode keeps the first items
      try {
        const r = await fetch("/api/events/recent?since=0", { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (!stop) { setBets(betsFrom(j.events || [], agents).reverse().slice(0, SHOWN)); setLive(true); }
      } catch { if (!stop) setLive(false); }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [agents, proof]);
  const lines = useMemo(() => betLines(bets), [bets]);
  const rot = useRotation(lines);
  const tape = useRef<HTMLDivElement>(null);
  useWrappedInert(tape, rot.shown);
  return (
    <div className={`ticker ${proof ? "has-proof" : ""}`} aria-label="Live bets">
      <div className="wrap">
        <span className={`live ${live ? "" : "off"}`}><span className="dot" /><span>{live ? <>Live<span className="hide-phone"> · real money</span></> : "Reconnecting…"}</span></span>
        {bets.length ? (
          <div className="tape" ref={tape} onMouseEnter={rot.hold} onMouseLeave={rot.release} onFocus={rot.hold} onBlur={rot.release}>
            {rot.shown.map((l) => <BetSentence key={`${l.bet.tx}:${l.bet.claimId}:${l.bet.at}`} l={l} f={facts[l.bet.claimId]} />)}
          </div>
        ) : (
          <span className="net">No bets yet today. Yours could be the first.</span>
        )}
        {proof && <span className="proofline"><b>{plural(proof.wikiFacts, "fact")}</b> · <b>{proof.decided}</b> decided · <b>{money(proof.paidUsd)}</b> paid out</span>}
      </div>
    </div>
  );
}

/** While the strip's read is on its way: the same height, so nothing jumps. */
export function LiveStripSkeleton() {
  return <div className="ticker" aria-hidden="true"><div className="wrap"><span className="live"><span className="dot" />Live · real money</span></div></div>;
}
