import { pageCard } from "@/lib/og/page";
import { money } from "@/lib/format";
import { getSite } from "@/lib/server/site";

export const alt = "Priced In’s numbers, in public";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

export default async function Image() {
  const site = await getSite();
  return pageCard("The whole market, in public.", site.ok ? `${site.totals.open} facts open · ${site.totals.trades} bets and sales · ${money(site.totals.volumeUsd)} bet` : "Read live from the market contract");
}
