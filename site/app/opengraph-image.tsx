import { ImageResponse } from "next/og";
import { ShareCard, ogAssets } from "@/lib/og/card";

export const alt = "Priced In: bet on whether facts are true";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const { fonts, dial } = await ogAssets();
  return new ImageResponse(
    <ShareCard title="Bet on whether facts are true." pct={null} sub="Pick true or false · 3 AI judges decide · right answers get paid" dial={dial} />,
    { ...size, fonts },
  );
}
