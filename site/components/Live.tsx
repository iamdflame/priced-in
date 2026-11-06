"use client";
// Small live pieces: a countdown, a relative time that stays true, and the free-bet notes.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Explain, PAYOUT_WHY } from "./Explain";
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

/** What a free bet wins, one plain sentence beside every free-$1 button, with the score and the payout one tap away. */
export function FreeCashNote() {
  return (
    <span className="freecash">
      <span className="freecash-text">Free play: a right answer adds to your score. Bet real USDC to win real money.</span>
      <Explain label="What is the score, and what does $1 pay?">
        <b>Your score</b> adds up what your free bets win. You can see it on your <Link className="link" href="/portfolio">Portfolio</Link>. It isn’t money, so it can’t be cashed out. To win money you can keep, bet real USDC, a digital dollar, from a wallet.
        <span className="pop-next">{PAYOUT_WHY}</span>
      </Explain>
    </span>
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
