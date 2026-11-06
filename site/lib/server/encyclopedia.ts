// The encyclopedia: a corpus page's sentences joined to the market. Each sentence that has a market
// carries its fact; a ruled sentence carries the fact that corrected it; a fact the page's revision
// doesn't contain (a correction, a line opened later) is listed at the end, never dropped.
import "server-only";
import pageIndex from "@/data/pages/index.json";
import type { Fact } from "../model";
import type { Ruling } from "./api";

export interface ArticleEntry { slug: string; title: string; sentences: number }

interface CorpusSentence { section: string; text: string; opinion: boolean }
interface CorpusPage { slug: string; title: string; url: string; attribution: string; revisedAt: string; sentences: CorpusSentence[] }

export interface ArticleLine { text: string; opinion: boolean; factId: number | null; correctedBy: number | null }
export interface ArticleSection { title: string; paragraphs: ArticleLine[][] }
export interface Article extends Omit<CorpusPage, "sentences"> { sections: ArticleSection[]; opened: number[] }

export const ARTICLES: ArticleEntry[] = pageIndex;

const PER_PARAGRAPH = 4;
const LEAD = "(lead)";

async function readPage(slug: string): Promise<CorpusPage | null> {
  if (!ARTICLES.some((a) => a.slug === slug)) return null;
  return (await import(`@/data/pages/${slug}.json`)).default as CorpusPage;
}

export async function articleOf(slug: string, facts: Fact[], rulings: Ruling[]): Promise<Article | null> {
  const page = await readPage(slug);
  if (!page) return null;
  const onPage = facts.filter((f) => f.page === slug);
  const byText = new Map(onPage.map((f) => [f.text, f]));
  const corrections = new Map(rulings.flatMap((r) => (r.correction ? [[r.claim_id, r.correction.claim_id] as const] : [])));
  const placed = new Set<number>();
  const sections = new Map<string, ArticleLine[]>();
  for (const s of page.sentences) {
    const fact = byText.get(s.text) ?? null;
    const correctedBy = fact ? corrections.get(fact.id) ?? null : null;
    if (fact) placed.add(fact.id);
    if (correctedBy !== null) placed.add(correctedBy);
    const lines = sections.get(s.section) ?? [];
    lines.push({ text: s.text, opinion: s.opinion, factId: fact?.id ?? null, correctedBy });
    sections.set(s.section, lines);
  }
  const { sentences: _sentences, ...meta } = page;
  return {
    ...meta,
    sections: [...sections].map(([title, lines]) => ({
      title: title === LEAD ? "" : title,
      paragraphs: Array.from({ length: Math.ceil(lines.length / PER_PARAGRAPH) }, (_, i) => lines.slice(i * PER_PARAGRAPH, (i + 1) * PER_PARAGRAPH)),
    })),
    opened: onPage.filter((f) => !placed.has(f.id)).map((f) => f.id),
  };
}
