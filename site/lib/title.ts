// Card titles and short labels. A card's title is a short question: the planner's (data/questions.json)
// or the news scout's when there is one; a sentence nobody has titled yet becomes "Is it true that …?"
// from its main clause. Nothing here cuts a word in half, and no title is a bare statement.

/** Words a clipped phrase must not end on: "built on the Polygon Chain that…" reads as broken. */
const DANGLING = new Set(["a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "with", "from", "that", "which", "who", "as", "its", "their", "is", "are", "was", "were", "has", "have", "than", "per", "about", "up", "into"]);

/** Openers that start a sentence but not a name: these lose their capital after "Is it true that". */
const OPENERS = new Set(["the", "a", "an", "as", "per", "in", "on", "by", "since", "it", "there", "this", "these", "those", "according", "after", "before", "during", "from", "until", "its", "their", "most", "some", "many", "all", "each", "every", "over", "under", "about", "around", "between", "at", "for", "with", "nearly", "almost", "more", "less", "fewer", "if", "when", "while", "although", "though", "because", "they", "we", "he", "she", "one"]);

/** Connectives that lean on a sentence the card doesn't show. */
const LEADS = /^(however|but|also|still|meanwhile|moreover|furthermore|additionally|in addition|by contrast|instead),?\s+/i;

/**
 * Cut `text` to at most `max` characters at a word boundary, never mid-word, with "…" when it was cut.
 * A cut drops trailing punctuation and words that leave the phrase hanging ("the", "that", "of").
 */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const words = t.slice(0, max).split(" ");
  // the last piece was cut in half unless the next character was a space
  if (t[max] !== " ") words.pop();
  while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[^\p{L}]/gu, ""))) words.pop();
  const out = words.join(" ").replace(/[\s,;:.\-–(]+$/u, "");
  return `${out || t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** The sentence's main clause: up to its first colon, semicolon or dash, when that leaves a real clause. */
function mainClause(sentence: string): string {
  let s = sentence.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").replace(LEADS, "");
  // "checked on 2026-11-05" is provenance, not the claim: the market page shows it in full
  s = s.replace(/,?\s*(?:as )?checked(?: on)? \d{4}-\d{2}-\d{2},?/g, ",").replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
  const cut = /[:;]\s|\s[–—]\s/.exec(s);
  if (cut && s.slice(0, cut.index).split(" ").length >= 4) s = s.slice(0, cut.index);
  return s.replace(/[,\s]+$/, "");
}

const MAX_TITLE = 90;

/**
 * A short question for a sentence nobody has titled: "Is it true that …?" from its main clause, cut at a
 * word boundary to fit three lines of a card. A sentence that is already a question stays one.
 */
export function questionFromSentence(sentence: string, max = MAX_TITLE): string {
  const t = sentence.replace(/\s+/g, " ").trim();
  if (t.endsWith("?")) return t.length <= max ? t : `${clip(t.slice(0, -1), max - 1).replace(/…$/, "")}…?`;
  const lead = "Is it true that ";
  let clause = mainClause(t);
  const first = clause.split(" ")[0] ?? "";
  if (OPENERS.has(first.toLowerCase())) clause = clause.charAt(0).toLowerCase() + clause.slice(1);
  const room = max - lead.length - 2; // the "?" and a possible "…"
  const body = clause.length <= room ? clause : clip(clause, room);
  return `${lead}${body}?`;
}

/** The card's title: the given question when there is one, else a question made from the sentence. */
export function titleFor(question: string | null | undefined, sentence: string): string {
  const q = question?.trim();
  return q ? q : questionFromSentence(sentence);
}
