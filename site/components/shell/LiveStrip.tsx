"use client";
// The live strip: the AI judges' rulings, newest first, from /api/rulings (lib/rulingStrip.ts). Each item
// reads on its own ("Ruled false by 3 AI judges: Did weekly DEX volume average about $18.6B in mid-2025?"),
// and one still open to objection says so. The strip never cuts one in half:
// only whole items show (the row wraps out of sight), and every few seconds the oldest shown steps aside
// for the next. It renders from the server's read and refreshes while the tab is visible. An encyclopedia
// page (/p/…) and a fact's page (/c/…) have no strip: nothing talks over the one thing being read. On a phone (760 px and
// below (SMALL_PHONE, and .proofline in shell.css) the rulings give way to one still line of real counts.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TopicIcon } from "../Brand";
import { filming } from "@/lib/client/film";
import { money, plural } from "@/lib/format";
import { rulingWords, stripRulings, type StripRuling } from "@/lib/rulingStrip";
import type { Proof } from "@/lib/server/site";

/** What the strip says about a fact: its question, clipped at a word, and its topic icon. */
export interface StripFact { short: string; icon: string }

const REFRESH_MS = 60_000;
const SHOWN = 16;
const ROTATE_MS = 5_000;
const SMALL_PHONE = "(max-width: 760px)";
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

/** "Ruled false by 3 AI judges: Did weekly DEX volume average about $18.6B in mid-2025?" */
function RulingSentence({ r, f }: { r: StripRuling; f: StripFact | undefined }) {
  const w = rulingWords(r);
  return (
    <Link className="tk" href={`/c/${r.claimId}`} prefetch={false}>
      {f && <TopicIcon icon={f.icon} />}
      <span><b className={r.outcome ? "yes" : "no"}>{w.verdict}</b>{r.final ? <span className="hide-phone">{w.rest}</span> : w.rest}: {f?.short ?? `fact ${r.claimId}`}</span>
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

export function LiveStrip({ initial, facts, proof }: { initial: StripRuling[] | null; facts: Record<number, StripFact>; proof: Proof | null }) {
  const [rulings, setRulings] = useState(initial);
  const [live, setLive] = useState(true);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden || filming() || (proof && smallPhone())) return; // film mode keeps the first items
      try {
        const r = await fetch("/api/rulings", { headers: { accept: "application/json" } });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (!stop && Array.isArray(j.rulings)) { setRulings(stripRulings(j.rulings).slice(0, SHOWN)); setLive(true); }
      } catch { if (!stop) setLive(false); }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [proof]);
  const items = useMemo(() => rulings ?? [], [rulings]);
  const rot = useRotation(items);
  const tape = useRef<HTMLDivElement>(null);
  useWrappedInert(tape, rot.shown);
  const path = usePathname();
  if (path.startsWith("/p/") || path.startsWith("/c/")) return null;
  return (
    <div className={`ticker ${proof ? "has-proof" : ""}`} aria-label="Latest rulings">
      <div className="wrap">
        <span className={`live ${live ? "" : "off"}`}><span className="dot" /><span>{live ? <>Rulings<span className="hide-phone"> · on NEAR</span></> : "Reconnecting…"}</span></span>
        {items.length ? (
          <div className="tape" ref={tape} onMouseEnter={rot.hold} onMouseLeave={rot.release} onFocus={rot.hold} onBlur={rot.release}>
            {rot.shown.map((r) => <RulingSentence key={r.key} r={r} f={facts[r.claimId]} />)}
          </div>
        ) : rulings ? (
          <span className="net">No rulings yet. The AI judges sit daily at 15:00 UTC.</span>
        ) : null}
        {proof && <span className="proofline"><b>{plural(proof.wikiFacts, "fact")}</b> · <b>{proof.decided}</b> decided · <b>{money(proof.paidUsd)}</b> paid out</span>}
      </div>
    </div>
  );
}

/** While the strip's read is on its way: the same height, so nothing jumps. */
export function LiveStripSkeleton() {
  return <div className="ticker" aria-hidden="true"><div className="wrap"><span className="live"><span className="dot" />Rulings<span className="hide-phone"> · on NEAR</span></span></div></div>;
}
