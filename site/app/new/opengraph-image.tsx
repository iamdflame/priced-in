import { pageCard } from "@/lib/og/page";

export const alt = "Price your own claim on Priced In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Is it true? Paste it and find out.", "Any sentence or X link, priced by our AI");
}
