"use client";
// The live clock in /rulings' hero while a ruling runs: the objection window counting down, then, once
// it closes, the honest next step (the keeper settles it) instead of a stopped clock.
import { useEffect, useState } from "react";
import { mmss } from "@/lib/format";

export function RulingClock({ windowEndsAt }: { windowEndsAt: number | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (document.documentElement.classList.contains("still")) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const at = now ?? Date.now();
  if (windowEndsAt === null) return <><div className="bignum">Reading</div><p>The three AI judges are reading the sources. Each signs its verdict on-chain.</p></>;
  if (windowEndsAt > at) return <><div className="bignum num" suppressHydrationWarning>{mmss(windowEndsAt - at)}</div><p>left for objections. Then the keeper settles it and pays the winners.</p></>;
  return <><div className="bignum" suppressHydrationWarning>Settling</div><p>The 10 minutes for objections are over. The keeper settles it next and pays the winners.</p></>;
}
