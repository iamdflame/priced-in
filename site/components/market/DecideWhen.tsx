"use client";
// When the AI judges decide this fact, on its page: the day and hour, a live countdown, and the one rule
// behind the time. Only for a fact the API has a time for (a doubted Wikipedia line queued for the
// Checker, or a news line coming due); it goes once the time passes, never standing at zero.
import { Icon } from "../Icon";
import { useClock } from "../Live";
import { longDayTimeUtc, waitWords } from "@/lib/format";

export function DecideWhen({ at, kind }: { at: number; kind: string }) {
  const now = useClock();
  const left = at - (now ?? Date.now());
  if (now !== null && left <= 0) return null;
  return (
    <section className="panel decidewhen" aria-label="When the AI judges decide this fact">
      <Icon name="scale" />
      <div className="dw-t">
        <p className="dw-k">AI judges decide this fact</p>
        <p className="dw-at"><b>{longDayTimeUtc(at)}</b><span className="dw-in num" suppressHydrationWarning>in {waitWords(Math.max(0, left))}</span></p>
        <p className="dw-s">{kind === "news"
          ? "Its date has passed by then: our settler reads its named source, and three AI judges decide it. New bets close when the date passes."
          : "Three AI judges read the newer source and decide whether Wikipedia’s sentence is true. Bets stay open until then. The doubted fact with the most bets goes first, so the day can move."}</p>
      </div>
    </section>
  );
}
