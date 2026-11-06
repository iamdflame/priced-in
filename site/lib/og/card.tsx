// Share cards with next/og: the kit's share card (screens/share.html) as 1200x630. Real data only: the
// question and the % come from the API at request time. Fonts are the kit's, as TTF for the renderer.
import { readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.join(process.cwd(), "lib/og");
let assets: Promise<{ fonts: { name: string; data: Buffer; weight: 500 | 700; style: "normal" }[]; dial: string }> | null = null;

export function ogAssets() {
  assets ??= (async () => {
    const [g7, g5, dial] = await Promise.all([
      readFile(path.join(dir, "GeneralSans-700.ttf")),
      readFile(path.join(dir, "GeneralSans-500.ttf")),
      readFile(path.join(dir, "dial.png")),
    ]);
    return {
      fonts: [
        { name: "General Sans", data: g7, weight: 700 as const, style: "normal" as const },
        { name: "General Sans", data: g5, weight: 500 as const, style: "normal" as const },
      ],
      dial: `data:image/png;base64,${dial.toString("base64")}`,
    };
  })();
  return assets;
}

const INK = "#F5F7F9", INK2 = "#B9BEC6", CYAN = "#00ECFF", BG = "#0B0F13";

function Mark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill={INK} fillRule="evenodd" d="M10 40.25V19A14 14 0 1 1 15.5 30.12V40.25A2.75 2.75 0 0 1 10 40.25ZM24 10.5A8.5 8.5 0 1 0 24 27.5A8.5 8.5 0 1 0 24 10.5Z" />
      <path fill={CYAN} d="M25.41 20.27L29.14 14.34A0.7 0.7 0 0 0 28.1 13.4L22.59 17.73Z" />
      <circle fill={CYAN} cx="24" cy="19" r="3" />
    </svg>
  );
}

/** The dial with the needle at p (0..1): the render, a rotated needle and the hub. */
function DialArt({ p, dial, size }: { p: number; dial: string; size: number }) {
  const deg = -120 + 240 * Math.min(1, Math.max(0, p));
  const nh = size * 0.405, nw = size * 0.084;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dial} width={size} height={size} alt="" style={{ borderRadius: size }} />
      <div style={{ position: "absolute", left: size / 2 - nw / 2, top: size / 2 - nh, width: nw, height: nh, display: "flex", transform: `rotate(${deg}deg)`, transformOrigin: "50% 100%" }}>
        <svg width={nw} height={nh} viewBox="0 0 20 100" preserveAspectRatio="none"><path d="M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z" fill={CYAN} /></svg>
      </div>
      <div style={{ position: "absolute", left: size * 0.44, top: size * 0.44, width: size * 0.12, height: size * 0.12, borderRadius: size, background: "#3a4048", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: size * 0.04, height: size * 0.04, borderRadius: size, background: CYAN }} />
      </div>
    </div>
  );
}

export function ShareCard({ title, pct, sub, kicker, dial }: { title: string; pct: number | null; sub: string; kicker?: string | null; dial: string }) {
  const long = title.length > 90;
  return (
    <div style={{ width: 1200, height: 630, display: "flex", background: BG, backgroundImage: "radial-gradient(60% 90% at 82% 46%, rgba(38,74,92,0.85), rgba(11,15,19,0) 72%)", color: INK, padding: "48px 56px", fontFamily: "General Sans" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, paddingRight: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mark />
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Priced In</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", marginBottom: "auto" }}>
          {kicker && <span style={{ fontSize: 24, fontWeight: 500, color: "#FF7072", marginBottom: 14 }}>{kicker}</span>}
          <span style={{ fontSize: long ? 46 : 58, fontWeight: 700, lineHeight: 1.06, letterSpacing: -1.6 }}>{title}</span>
          <span style={{ marginTop: 22, fontSize: 26, fontWeight: 500, color: INK2 }}>{sub}</span>
        </div>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: INK2 }}>
          <span>Is it true?&nbsp;</span><span style={{ color: CYAN }}>Bet on it.</span><span style={{ marginLeft: "auto" }}>Your first $1 is free</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 440, position: "relative" }}>
        <DialArt p={pct === null ? 0.5 : pct / 100} dial={dial} size={420} />
        {pct !== null && (
          <div style={{ position: "absolute", top: 300, display: "flex", alignItems: "baseline", color: INK }}>
            <span style={{ fontSize: 104, fontWeight: 700, letterSpacing: -5 }}>{pct}</span>
            <span style={{ fontSize: 54, fontWeight: 700 }}>%</span>
          </div>
        )}
      </div>
    </div>
  );
}
