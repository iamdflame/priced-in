// The live fact closest to a sentence, found in the browser from the facts the page already has: no
// lookup to spend, so every priced line on a post can show its next step at once. Words are weighed by
// how rare they are among the live facts, dates and numbers never count (a "14 November" matches every
// news line), and only names tie a sentence to a fact: a common word shared is not a topic shared.
import type { Quotes } from "./quote";

export interface LiveFact { id: number; question: string; text: string; topic: string; pct: number; quotes: Quotes | null }

const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its just more most my no not of on or our out over so some than that the their them then there these they this those to too up us very was we were what when where which who why will with would you your also about after before all any each few here how many much new now off only own same should still such today true false yes see get got make made like love built things ideas idea thing way ways need".split(" ")));
const MONTHS = /^(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/;

/** A sentence's words that can carry meaning: camelCase handles split ("NEARProtocol" is near, protocol), lower case, no stop words, dates or numbers. */
export function words(s: string): string[] {
  const split = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const out = split.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];
  return [...new Set(out.filter((w) => w.length >= 3 && !/\d/.test(w) && !STOP.has(w) && !MONTHS.test(w)))];
}

/**
 * The names in a sentence, the only words that can tie it to a fact: a capitalised word that doesn't open
 * the sentence, an acronym or camelCase word, a handle, a hashtag or a cashtag. Each name is one group
 * ("@NEARProtocol" is near and protocol), so a handle's parts count once.
 */
export function names(sentence: string): string[][] {
  const out: string[][] = [];
  const raw = sentence.split(/\s+/).filter(Boolean);
  raw.forEach((t, i) => {
    const bare = t.replace(/^[^A-Za-z0-9@#$]+|[^A-Za-z0-9]+$/g, "");
    // a word that opens the sentence (or a dashed list item) is capitalised anyway: not a name by that alone
    const opens = i === 0 || /[.!?:]$/.test(raw[i - 1]) || /^[–—-]/.test(t);
    const name = /^[@#$]/.test(bare) || /[A-Z]/.test(bare.slice(1)) || (/^[A-Z]/.test(bare) && !opens);
    const parts = name ? words(bare) : [];
    if (parts.length) out.push(parts);
  });
  return out;
}

/**
 * The closest live fact, or null when none shares a name with the sentence. Each shared name scores its
 * rarest matching part, ln(N / facts with that word); a fact on the name's own topic scores 1.5 more.
 */
export function closestLive(sentence: string, facts: LiveFact[], minScore = 1): LiveFact | null {
  if (!facts.length) return null;
  const bags = facts.map((f) => new Set(words(`${f.question} ${f.text} ${f.topic}`)));
  const topics = facts.map((f) => new Set(words(f.topic)));
  const df = new Map<string, number>();
  for (const b of bags) for (const w of b) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log(facts.length / (df.get(w) ?? facts.length));
  const mine = names(sentence);
  let best: { f: LiveFact; score: number } | null = null;
  facts.forEach((f, i) => {
    let score = 0, onTopic = false;
    for (const group of mine) {
      const hit = group.filter((w) => bags[i].has(w));
      if (!hit.length) continue;
      score += Math.max(...hit.map(idf));
      if (hit.some((w) => topics[i].has(w))) onTopic = true;
    }
    if (onTopic) score += 1.5;
    if (score >= minScore && (!best || score > best.score)) best = { f, score };
  });
  return (best as { f: LiveFact; score: number } | null)?.f ?? null;
}
