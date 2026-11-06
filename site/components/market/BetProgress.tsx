// The bet on its way, step by step, so a slow key or RPC never looks like a dead button.
import { Icon } from "../Icon";
import type { DoubtState } from "@/lib/core/store";

export function BetProgress({ bet, recorded }: { bet: DoubtState; recorded: boolean }) {
  const preparing = bet.stage === "quoting" && bet.ctx?.waitingFor === "lane";
  const steps = [
    ...(recorded ? [] : [{ label: "Preparing your free $1 in this browser", on: preparing, done: !preparing }]),
    { label: recorded ? "Replaying the real transaction" : "Signing it here, no wallet needed", on: !preparing, done: bet.stage === "optimistic" },
    { label: recorded ? "Final on NEAR" : "Sending it to NEAR", on: bet.stage === "optimistic", done: false },
  ];
  return (
    <ol className="progress" aria-live="polite">
      {steps.map((s) => (
        <li key={s.label} className={`pstep ${s.done ? "done" : s.on ? "on" : ""}`}><span className="b">{s.done ? <Icon name="check" /> : null}</span>{s.label}</li>
      ))}
    </ol>
  );
}
