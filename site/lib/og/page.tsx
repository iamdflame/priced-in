// A proof page's share card: the kit's card with the page's own title and line, no dial reading.
import { ImageResponse } from "next/og";
import { ShareCard, ogAssets } from "./card";

export const OG_SIZE = { width: 1200, height: 630 };

export async function pageCard(title: string, sub: string, kicker: string | null = null) {
  const { fonts, dial } = await ogAssets();
  return new ImageResponse(<ShareCard title={title} pct={null} sub={sub} kicker={kicker} dial={dial} />, { ...OG_SIZE, fonts });
}
