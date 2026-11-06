"use client";
// Small live pieces: a countdown, a relative time that stays true, and the first-visit coach mark.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Explain } from "./Explain";
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

/** Set before paint by app/layout.tsx once dismissed or once this browser has bet, so the hint is
 * rendered on the server and never moves the page after load. */
export const COACH_KEY = "pi-coach-v1";

/** What the free $1 is, one plain sentence beside every free-$1 button, with the score one tap away. */
export function FreeCashNote() {
  return (
    <span className="freecash">
      <span className="freecash-text">The free $1 is on us. If you’re right it adds to your score, not your wallet. Bet your own money to cash out.</span>
      <Explain label="What is the score?">
        <b>The free $1 is on us.</b> Your score is what your free bets have won. It stays in the market, shows on your Portfolio, and can’t be withdrawn. To cash out, bet your own money: that takes a wallet, and pays in USDC, a digital dollar.
      </Explain>
    </span>
  );
}

/** The one-time hint on the lead's Yes/No: shown until dismissed or until this browser has bet. */
export function CoachHint() {
  const close = () => {
    try { localStorage.setItem(COACH_KEY, "1"); } catch { /* private mode: hidden for this visit */ }
    document.documentElement.dataset.coach = "off";
  };
  return (
    <p className="coach" role="status">
      <Icon name="gift" /><span>Your free $1 is ready: tap Yes or No.</span>
      <button type="button" className="iconbtn" aria-label="Hide this hint" onClick={close}><Icon name="x" /></button>
    </p>
  );
}

/** When free bets are off: why, with the replay as the way on. */
export function FreeBetsOff({ reason }: { reason: string }) {
  return (
    <div className="notice" role="status">
      <Icon name="info" />
      <p><b>Free bets are paused right now.</b> {reason} <Link href={REPLAY_HREF}>Watch a replay of a real bet</Link></p>
    </div>
  );
}
