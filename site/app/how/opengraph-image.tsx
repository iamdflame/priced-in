import { pageCard } from "@/lib/og/page";

export const alt = "How Priced In works";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  return pageCard("Pick true or false. AI judges decide. Right answers win.", "One real fact, from first price to payout");
}
