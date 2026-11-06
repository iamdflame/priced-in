"use client";
// In the replay, the ruling plays after the bet: the Checker's challenge, then the three verdicts at
// their real offsets (8.0, 9.8 and 16.7 s), the objection window (10 minutes, shortened here and said
// so), the settlement and the correction. Before the bet it waits, with a way to skip ahead.
import { useEffect, useState } from "react";
import { RulingBlock } from "./Ruling";
import { recordedEngine } from "@/lib/engine";
import type { Ruling } from "@/lib/server/api";

export function ReplayRuling({ r, correctedQuestion }: { r: Ruling; correctedQuestion: string | null }) {
  const [upTo, setUpTo] = useState(-1);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    let off = () => {};
    void recordedEngine().then((e) => {
      off = e.store.subscribe((s) => { if (s.doubt.stage === "answered") setStarted(true); }) as unknown as () => void;
    });
    return () => off();
  }, []);
  useEffect(() => {
    if (!started) return;
    const at = (ms: number, step: number) => setTimeout(() => setUpTo((u) => Math.max(u, step)), ms);
    const v = r.verdicts.map((x, i) => at(1500 + (x.at - r.opened_at), 1 + i));
    const t = [at(0, 0), ...v, at(1500 + (r.verdicts.at(-1)!.at - r.opened_at) + 1200, 4), at(1500 + (r.verdicts.at(-1)!.at - r.opened_at) + 7200, 5), at(1500 + (r.verdicts.at(-1)!.at - r.opened_at) + 8400, 6)];
    return () => t.forEach(clearTimeout);
  }, [started, r]);
  if (upTo < 0) {
    return (
      <section className="panel rulingp" id="ruling" aria-label="The ruling, coming up">
        <h2>Then the AI judges ruled on it</h2>
        <p className="sub">After your replayed bet, the ruling plays here as it happened: a challenge, three signed verdicts and the settlement.</p>
        <button type="button" className="btn soft" style={{ marginTop: 12 }} onClick={() => setStarted(true)}>Play the ruling now</button>
      </section>
    );
  }
  return <RulingBlock r={r} correctedQuestion={correctedQuestion} upTo={upTo} replay />;
}
