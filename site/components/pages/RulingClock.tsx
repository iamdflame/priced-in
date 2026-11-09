"use client";
// The live clock in /rulings' hero while a ruling runs: the objection window counting down, then, once
// it closes, the honest next step (the keeper settles it) instead of a stopped clock.
import type { ReactNode } from "react";
import { Icon } from "../Icon";
import { useClock } from "../Live";
import { longDayTimeUtc, mmss, waitWords } from "@/lib/format";

export function RulingClock({ windowEndsAt }: { windowEndsAt: number | null }) {
  const at = useClock() ?? Date.now();
  if (windowEndsAt === null) return <><div className="bignum">Reading</div><p>The three AI judges are reading the sources. Each signs its verdict on-chain.</p></>;
  if (windowEndsAt > at) return <><div className="bignum num" suppressHydrationWarning>{mmss(windowEndsAt - at)}</div><p>left for objections. Then the keeper settles it and pays the winners.</p></>;
  return <><div className="bignum" suppressHydrationWarning>Settling</div><p>The 10 minutes for objections are over. The keeper settles it next and pays the winners.</p></>;
}

/** The hero's clock between decisions, with the exact time it counts to: the time only while it's a real future time, then the sentence alone. */
export function NextRuling({ at, ahead, none }: { at: number | null; ahead: ReactNode; none: ReactNode }) {
  const now = useClock();
  const left = at === null ? 0 : at - (now ?? Date.now());
  if (at === null || left <= 0) return <><span className="k"><Icon name="clock" />Next decision</span><p className="clockline" suppressHydrationWarning>{none}</p></>;
  // a wait of a day or more reads as days and hours, not 181:23:45
  return <><span className="k"><Icon name="clock" />Next decision in</span><div className="bignum num" suppressHydrationWarning>{waitWords(left)}</div><p className="clockat">{longDayTimeUtc(at)}</p><p>{ahead}</p></>;
}
