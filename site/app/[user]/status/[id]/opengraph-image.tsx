import { pageCard } from "@/lib/og/page";

export const alt = "Fact-check this post on Priced In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ user: string }> }) {
  const { user } = await params;
  return pageCard("Fact-check this post.", /^[A-Za-z0-9_]{1,15}$/.test(user) ? `@${user}’s checkable lines, priced` : "Its checkable lines, priced");
}
