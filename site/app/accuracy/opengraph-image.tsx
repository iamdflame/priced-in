import data from "@/data/accuracy.json";
import { pageCard } from "@/lib/og/page";

export const alt = "How often the AI judges are right, on Priced In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  const s = data.bench.sources;
  return pageCard(`When the AI judges decide, they’re right ${Math.round((s.right / s.ruled) * 100)}% of the time.`, `Tested on ${s.facts} facts we had already checked by hand`);
}
