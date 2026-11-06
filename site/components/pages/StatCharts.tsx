// The numbers page's charts, drawn as plain SVG on the server from real data: money bet over time
// (one step per logged bet), where the money is by topic, what the market thinks across every open
// fact, and calibration once facts settle. Colour follows the kit: ink lines, Yes and No only for
// true and false, the brand only on the live head dot.
import { money } from "@/lib/format";

export function VolumeChart({ points, start, now }: { points: { at: number; usd: number; n: number }[]; start: number; now: number }) {
  const W = 640, H = 330, L = 8, R = 54, T = 12, B = 26;
  const max = Math.max(1, ...points.map((p) => p.usd)) * 1.1;
  const t0 = Math.min(start, points[0]?.at ?? start), t1 = Math.max(now, t0 + 1);
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  let d = `M${X(t0).toFixed(1)} ${Y(0).toFixed(1)}`;
  for (const p of points) d += `H${X(p.at).toFixed(1)}V${Y(p.usd).toFixed(1)}`;
  d += `H${X(t1).toFixed(1)}`;
  const last = points.at(-1);
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  const hours = (t1 - t0) / 3_600_000;
  const label = (t: number) => { const dt = new Date(t); return hours > 48 ? `${dt.getUTCDate()} ${dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}` : `${String(dt.getUTCHours()).padStart(2, "0")}:00`; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Money bet over time: ${money(last?.usd ?? 0)} across ${last?.n ?? 0} bets`}>
      <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".16" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((v) => <g key={v}><line className="g" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text x={W - R + 8} y={Y(v) + 4}>{money(v)}</text></g>)}
      <path d={`${d}V${Y(0)}H${X(t0)}Z`} fill="url(#vg)" style={{ color: "var(--ink)" }} />
      <path className="ln" d={d} />
      {last && <circle className="hd" cx={X(t1)} cy={Y(last.usd)} r={4.5} />}
      <text x={L} y={H - 6}>{label(t0)} UTC</text>
      <text x={W - R} y={H - 6} textAnchor="end">now</text>
    </svg>
  );
}

export function TopicBars({ rows }: { rows: { topic: string; usd: number; bets: number; facts: number }[] }) {
  const W = 420, rowH = 34, L = 118, R = 70;
  const H = rows.length * rowH + 4;
  const max = Math.max(0.01, ...rows.map((r) => r.usd));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money bet by topic">
      {rows.map((r, i) => {
        const y = i * rowH + 6;
        const w = ((W - L - R) * r.usd) / max;
        return (
          <g key={r.topic}>
            <text className="lbl" x={0} y={y + 15}>{r.topic}</text>
            <rect className="barbg" x={L} y={y + 3} width={W - L - R} height={16} rx={5} />
            {r.usd > 0 && <rect className="bar" x={L} y={y + 3} width={Math.max(3, w)} height={16} rx={5} />}
            <text className="val" x={W - R + 8} y={y + 15}>{r.usd > 0 ? money(r.usd) : "no bets"}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Open facts by the chance the market gives them, in ten bands; facts nobody has bet on are hollow. */
export function Spread({ facts }: { facts: { price: number; trades: number; id: number }[] }) {
  const W = 1240, H = 230, L = 8, R = 8, T = 10, B = 30;
  const bands = Array.from({ length: 10 }, (_, i) => facts.filter((f) => Math.min(9, Math.floor(f.price * 10)) === i).sort((a, b) => b.trades - a.trades));
  const tall = Math.max(1, ...bands.map((b) => b.length));
  const bw = (W - L - R) / 10, r = Math.min(13, (H - T - B) / tall / 2 - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="How many open facts sit at each chance of being true">
      <line className="g" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      {bands.map((b, i) => b.map((f, j) => {
        const cx = L + bw * i + bw / 2, cy = H - B - r - 2 - j * (r * 2 + 2);
        const col = f.price >= 0.5 ? "var(--yes)" : "var(--no)";
        return <circle key={f.id} cx={cx} cy={cy} r={r} fill={f.trades ? col : "none"} stroke={col} strokeWidth={1.6} opacity={f.trades ? 0.9 : 0.75}><title>{`Fact ${f.id}: ${Math.round(f.price * 100)}%${f.trades ? "" : " (AI’s estimate, no bets yet)"}`}</title></circle>;
      }))}
      {[0, 25, 50, 75, 100].map((p) => <text key={p} x={L + ((W - L - R) * p) / 100} y={H - 8} textAnchor={p === 0 ? "start" : p === 100 ? "end" : "middle"}>{p}%</text>)}
    </svg>
  );
}

/** Calibration: settled facts' last price against how they were decided. */
export function Calibration({ pts }: { pts: { p: number; o: number; id: number }[] }) {
  const S = 220, P = 26;
  const X = (p: number) => P + p * (S - P * 2), Y = (o: number) => S - P - o * (S - P * 2);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Calibration: ${pts.length} settled ${pts.length === 1 ? "fact" : "facts"}`} style={{ maxWidth: 260 }}>
      <rect x={P} y={P} width={S - P * 2} height={S - P * 2} fill="none" className="g" stroke="var(--line)" />
      <line className="diag" x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} />
      {pts.map((x) => <circle key={x.id} className="pt" cx={X(x.p)} cy={Y(x.o)} r={6} style={{ fill: x.o ? "var(--yes)" : "var(--no)" }}><title>{`Fact ${x.id}: priced ${Math.round(x.p * 100)}%, decided ${x.o ? "true" : "false"}`}</title></circle>)}
      <text x={X(0)} y={S - 6}>0%</text><text x={X(1)} y={S - 6} textAnchor="end">100%</text>
      <text x={4} y={Y(1) + 4}>true</text><text x={4} y={Y(0) + 4}>false</text>
    </svg>
  );
}
