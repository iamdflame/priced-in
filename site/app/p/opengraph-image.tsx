import { pageCard } from "@/lib/og/page";

export const alt = "The encyclopedia, priced";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Read Wikipedia with the odds on.", "Every sentence tinted by what the money says");
}
