import { pageCard } from "@/lib/og/page";
import { ARTICLES } from "@/lib/server/encyclopedia";

export const alt = "A Wikipedia article with the odds on";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = ARTICLES.find((a) => a.slug === slug);
  return pageCard(article ? `${article.title}, priced` : "Read Wikipedia with the odds on.", "Every sentence tinted by what the money says");
}
