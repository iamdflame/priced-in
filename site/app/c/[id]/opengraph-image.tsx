import { ImageResponse } from "next/og";
import { ShareCard, ogAssets } from "@/lib/og/card";
import { api } from "@/lib/server/api";
import { toFact } from "@/lib/server/facts";
import { priceBeforeRuling } from "@/lib/rulings";

export const alt = "A fact on Priced In, with the chance it’s true";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { fonts, dial } = await ogAssets();
  const r = /^\d{1,9}$/.test(id) ? await api.claim(Number(id)) : null;
  if (!r || !r.ok) {
    return new ImageResponse(<ShareCard title="Bet on whether facts are true." pct={null} sub="Your first $1 is free: no wallet, no sign-up." dial={dial} />, { ...size, fonts });
  }
  const f = toFact(r.value);
  const settled = f.status === "settled";
  // a decided fact's price is its outcome: the card shows what the market said before the AI judges decided it
  const before = settled && f.trades > 0 ? await api.history(f.id).then((h) => (h.ok ? priceBeforeRuling(h.value, null) : null)) : null;
  const pct = Math.round((settled ? before ?? f.price : f.price) * 100);
  const sub = settled ? (before !== null ? `The market said ${pct}% before the AI judges decided · ${f.trades} bets` : `Decided by AI judges · ${f.trades} bets`) : f.trades ? `${pct}% chance it’s true · ${f.trades} bets so far` : `${pct}% chance it’s true · no bets yet`;
  return new ImageResponse(
    <ShareCard title={f.question} pct={pct} sub={sub} kicker={settled ? `Decided ${f.outcome ? "true" : "false"} by AI judges` : null} dial={dial} />,
    { ...size, fonts },
  );
}
