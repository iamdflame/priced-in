"use client";
// The chart: the chance it's true after each real bet, one step per logged trade on a true 0-100 axis,
// from /history (the contract's own log). Hover or focus a step to read who bet and what it did.
// A ruled fact ends with the ruling's line. A market with no bets is honestly flat and says so.
import { useId, useMemo, useState } from "react";
import type { Bet } from "@/lib/live";
import { clockUtc, money } from "@/lib/format";

export interface ChartProps {
  points: [number, number][];
  bets: Bet[];
  /** the current price, 0..1, appended as "now" */
  now: number;
  nowAt: number;
  /** "FALSE" when a ruling ended it */
  ruled?: { outcome: string; at: number } | null;
  openLabel?: string;
}

export function Chart({ points, bets, now, nowAt, ruled, openLabel = "At the start" }: ChartProps) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 262, L = 8, R = 44, T = 14, B = 26;
  const steps = useMemo(() => {
    // the settlement's 0 or 1 is not a price: stop the line at the last trade
    const pts = points.filter(([t]) => !ruled || t < ruled.at);
    // the history ends with a "now" point; a move under a tenth of a point is rounding, not a bet
    const s: { t: number; p: number }[] = [];
    for (const [t, ppm] of pts) { const p = ppm / 1e6; if (!s.length || Math.abs(p - s[s.length - 1].p) >= 0.001) s.push({ t, p }); }
    if (!s.length) s.push({ t: nowAt, p: now });
    const last = s[s.length - 1];
    if (!ruled && Math.abs(last.p - now) > 1e-6) s.push({ t: nowAt, p: now });
    s.push({ t: ruled ? ruled.at : nowAt, p: ruled ? last.p : now });
    return s;
  }, [points, now, nowAt, ruled]);
  const n = steps.length - 1;
  const X = (i: number) => L + (i / Math.max(1, n)) * (W - L - R);
  const Y = (p: number) => T + (1 - p) * (H - T - B);
  let d = `M${X(0).toFixed(1)} ${Y(steps[0].p).toFixed(1)}`;
  for (let i = 1; i <= n; i++) d += `H${X(i).toFixed(1)}V${Y(steps[i].p).toFixed(1)}`;
  const area = `${d}V${H - B}H${X(0).toFixed(1)}Z`;
  // match each step after the first to the bet that made it (same time, to the second)
  const betAt = (i: number) => (i === 0 || i === n ? null : bets.find((b) => Math.abs(b.at - steps[i].t) < 1500) ?? null);
  const first = Math.round(steps[0].p * 100), last = Math.round(steps[n].p * 100);
  const trades = Math.max(0, steps.length - 2);
  const tip = hover !== null ? tipFor(hover) : null;
  function tipFor(i: number) {
    const b = betAt(i);
    const p = Math.round(steps[i].p * 100);
    if (i === 0) return `${openLabel}: ${p}%`;
    if (b) return `${b.who} bet ${b.free ? "a free $1" : money(b.usd)} on ${b.side === "yes" ? "Yes" : "No"} · ${p}% · ${clockUtc(b.at)}`;
    if (i === n && ruled) return `Ruled ${ruled.outcome} · ${clockUtc(ruled.at)}`;
    return `${p}% · ${clockUtc(steps[i].t)}`;
  }
  return (
    <div className="chartwrap" onMouseLeave={() => setHover(null)}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={trades ? `Chance it’s true after each of ${trades} bets, from ${first}% at the start to ${last}%${ruled ? `, then ruled ${ruled.outcome}` : " now"}` : `No bets yet: flat at ${first}%`}>
        <defs><linearGradient id={`cg${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".16" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <g key={p}><line className="g" x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} /><text x={W - R + 8} y={Y(p) + 4}>{p * 100}%</text></g>
        ))}
        <path d={area} fill={`url(#cg${id})`} />
        <path className="ln" d={d} />
        {steps.map((s, i) => {
          if (i === 0 || i === n) return null;
          const b = betAt(i);
          if (!b) return null;
          return <circle key={i} className={`bd ${b.side === "no" ? "n" : "y"}`} cx={X(i)} cy={Y(s.p)} r={hover === i ? 5.5 : 3.5} />;
        })}
        {ruled && <><line className="rule" x1={X(n)} x2={X(n)} y1={T} y2={H - B} /><text className="rulet" x={X(n) - 6} y={T + 12} textAnchor="end">Ruled {ruled.outcome}</text></>}
        <circle className="endd" cx={X(n)} cy={Y(steps[n].p)} r={5} />
        <text x={X(0)} y={H - 6}>{openLabel}: {first}%</text>
        <text x={X(n)} y={H - 6} textAnchor="end">{ruled ? "Last price" : "Now"}: {last}%</text>
        {/* hover targets: one column per step */}
        {steps.map((_, i) => (
          <rect key={`h${i}`} x={X(i) - (W - L - R) / Math.max(1, n) / 2} y={T} width={(W - L - R) / Math.max(1, n)} height={H - T - B} fill="transparent"
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={i > 0 && i < n ? 0 : -1} aria-label={tipFor(i)} />
        ))}
      </svg>
      {tip && hover !== null && (
        <div className="charttip" style={{ left: `${(X(hover) / W) * 100}%`, top: `${(Y(steps[hover].p) / H) * 100}%` }}>{tip}</div>
      )}
    </div>
  );
}

/** A small step sparkline from the same log, for cards and rails. */
export function Spark({ points, w = 132, h = 44 }: { points: [number, number][]; w?: number; h?: number }) {
  const pts = points.map(([, ppm]) => ppm / 1e6);
  if (pts.length < 2) pts.push(pts[0] ?? 0.5);
  const n = pts.length - 1, pad = 3;
  const lo0 = Math.min(...pts), hi0 = Math.max(...pts);
  const span = Math.max(hi0 - lo0, 0.14), mid = (hi0 + lo0) / 2;
  const lo = mid - span / 2 - span * 0.1, hi = mid + span / 2 + span * 0.1;
  const X = (i: number) => pad + (i / n) * (w - pad * 2 - 3);
  const Y = (p: number) => pad + (1 - (p - lo) / (hi - lo)) * (h - pad * 2);
  let d = `M${X(0).toFixed(1)} ${Y(pts[0]).toFixed(1)}`;
  for (let i = 1; i <= n; i++) d += `H${X(i).toFixed(1)}V${Y(pts[i]).toFixed(1)}`;
  const flat = new Set(pts.map((p) => Math.round(p * 1000))).size === 1;
  return (
    <svg className={`spark ${flat ? "flat" : ""}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="ln" d={d} />
      <circle className="hd" cx={X(n)} cy={Y(pts[n])} r={3} />
      <circle className="hl" cx={X(n)} cy={Y(pts[n])} r={3} />
    </svg>
  );
}
