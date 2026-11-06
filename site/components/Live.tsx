"use client";
// Small live pieces: a countdown, a relative time that stays true, and the first-visit coach mark.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { ago, mmss } from "@/lib/format";
import { REPLAY_HREF } from "@/lib/nav";

export function Countdown({ to, done = "any minute now" }: { to: number; done?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (document.documentElement.classList.contains("still")) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="num" suppressHydrationWarning>{mmss(Math.max(0, to - Date.now()))}</span>;
  return <span className="num">{to - now > 0 ? mmss(to - now) : done}</span>;
}

export function Ago({ at }: { at: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return <time dateTime={new Date(at).toISOString()} suppressHydrationWarning>{ago(at, now ?? Date.now())}</time>;
}

/** Set before paint by app/layout.tsx once dismissed or once this browser has bet, so the coach mark is
 * rendered on the server and never pushes the page down after load. */
export const COACH_KEY = "pi-coach-v1";

/** First visit: the free $1 is ready. Or, when free bets are off, why, with the replay as the way on. */
export function CoachMark({ open, reason }: { open: boolean; reason: string | null }) {
  const close = () => {
    try { localStorage.setItem(COACH_KEY, "1"); } catch { /* private mode: hidden for this visit */ }
    document.documentElement.dataset.coach = "off";
  };
  if (!open) {
    return (
      <div className="notice coach-off" role="status">
        <Icon name="info" />
        <p><b>Free bets are paused right now.</b> {reason ?? "Every price still updates live."} <Link href={REPLAY_HREF}>Watch a replay of a real bet</Link></p>
        <button type="button" className="iconbtn" aria-label="Dismiss" onClick={close}><Icon name="x" /></button>
      </div>
    );
  }
  return (
    <div className="coach" role="status">
      <Icon name="gift" />
      <p>Your free $1 is ready: tap Yes or No on any card.</p>
      <button type="button" className="iconbtn" aria-label="Dismiss" onClick={close}><Icon name="x" /></button>
    </div>
  );
}
