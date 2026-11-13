// Small repairs to text that reaches us from feeds and models, so a page never shows a raw URL as a
// link's words, the same reason twice, or a headline with a phrase doubled by its feed.

/** A link's words: its title, unless the title is missing or is itself a URL; then the site's name. */
export function sourceLabel(title: string | null | undefined, url: string): string {
  const t = (title ?? "").trim();
  if (t && !/^https?:\/\//i.test(t) && !/^www\./i.test(t)) return t;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return "Its source"; }
}

/**
 * "White House set to extend set to extend Jones Act waiver" reads "…set to extend Jones Act waiver": a
 * phrase of two to five words said twice in a row is said once. One word twice ("had had") is left alone.
 */
export function undouble(text: string): string {
  return text.replace(/\b((?:[^\s,.;:!?]+\s+){1,4}[^\s,.;:!?]+)\s+\1(?=[\s,.;:!?]|$)/gi, "$1");
}

/** A feed of reasons with exact repeats dropped: the same writer, call, words and source, kept once (the first given). */
export function withoutRepeats<T extends { account_id: string; side: string; rationale: string; source_url?: string | null; credence: number }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.account_id}|${r.side}|${Math.round(r.credence * 100)}|${r.source_url ?? ""}|${r.rationale}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
