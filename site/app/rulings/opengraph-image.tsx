import { pageCard } from "@/lib/og/page";
import { money, plural, span } from "@/lib/format";
import { rulingRecord } from "@/lib/record";
import { api } from "@/lib/server/api";

export const alt = "Results on Priced In: facts decided by three AI judges";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

export default async function Image() {
  const r = await api.rulings();
  if (!r.ok) return pageCard("Doubt a fact. Three AI judges decide it.", "Signed on-chain, within minutes");
  const { settled, medianMs, paidUsd } = rulingRecord(r.value.rulings);
  return pageCard("Doubt a fact. Three AI judges decide it.", `${plural(settled.length, "fact")} decided · ${money(paidUsd)} paid${medianMs === null ? "" : ` · ${span(medianMs)} from doubt to paid`}`);
}
