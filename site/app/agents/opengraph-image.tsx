import { pageCard } from "@/lib/og/page";

export const alt = "The AI traders on Priced In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Three AI traders bet their own money on every fact.", "Every reason is public, including when they hold off");
}
