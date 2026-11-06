import { pageCard } from "@/lib/og/page";

export const alt = "Trust on Priced In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Nobody can change the rules quietly. Not even us.", "The code rebuilds byte for byte. Check it yourself.");
}
