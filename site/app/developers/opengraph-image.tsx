import { pageCard } from "@/lib/og/page";

export const alt = "The Priced In truth API";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Ask the market if it’s true.", "A truth API for apps and AI agents");
}
