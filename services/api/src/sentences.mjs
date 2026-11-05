// Deterministic sentence splitting for pasted text. The same input always gives the same
// sentences, so the same paste always maps to the same page and the same planner receipts.
//
// Rules:
// - A blank line ends a sentence. A single line break ends one too, unless the next line
//   starts with a lowercase letter (hard-wrapped prose). Leading bullets are stripped.
// - . ! ? … end a sentence only when followed by whitespace and then something that is not
//   a lowercase letter, or by the end of the text. Closing quotes and brackets stay attached.
// - URLs, emails and domains are never split. Decimals and versions (3.14, v1.2.3) never are,
//   because a boundary needs whitespace after the dot.
// - A dot after a title or prefix abbreviation (Mr., Dr., e.g., i.e., vs., Jan., No.) never
//   ends a sentence; nor after a single initial (J. K. Rowling) or a dotted acronym (U.S.).
//   Suffix abbreviations (Inc., Ltd., etc.) end one when the next word is capitalised.

// never end a sentence after these when the next word is capitalised
const PREFIX_ABBR = new Set([
  "mr", "mrs", "ms", "mx", "dr", "prof", "sr", "jr", "st", "mt", "ft", "rev", "gen", "col", "lt", "sgt", "capt", "cmdr", "gov", "sen", "rep", "pres", "hon",
  "vs", "e.g", "i.e", "cf", "viz", "al", "approx", "dept", "univ", "assn",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "mon", "tue", "tues", "thu", "thur", "thurs", "fri",
]);
// never end a sentence after these when a number follows: "No. 5", "p. 12", "c. 1500"
const NUMBER_ABBR = new Set(["no", "nos", "p", "pp", "fig", "figs", "vol", "vols", "ch", "sec", "art", "op", "eq", "eqs", "ref", "est", "ca", "c", "v", "ver"]);

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|xyz|ai|app|dev|near|eth|gov|edu|co|uk|de|fr|jp|wiki|in|me|so|fi|finance|exchange|network|money|tech|info|tv|gg|sh)\b(?:\/[^\s<>"']*)?/gi;
const TERMINATOR = /[.!?…。！？]/;
const CLOSERS = /["'”’)\]»]/;
const BULLET = /^\s*(?:[-*•‣◦▪●–—]|\d{1,3}[.)])\s+/;

/** Mask spans that must never split (URLs, emails, domains) with placeholder letters. */
function maskUrls(s) {
  return s.replace(URL_RE, (m) => {
    // keep a trailing sentence dot outside the URL: "see near.org." ends a sentence
    const trail = m.match(/[.,;:!?)\]]+$/)?.[0] || "";
    const core = m.slice(0, m.length - trail.length);
    return "x".repeat(core.length) + trail;
  });
}

function tokenBefore(s, i) {
  // the run of non-space characters ending just before index i, without leading quotes/brackets
  let j = i;
  while (j > 0 && !/\s/.test(s[j - 1])) j--;
  return s.slice(j, i).replace(/^["'“‘(\[«]+/, "");
}

function splitBlock(orig) {
  const masked = maskUrls(orig);
  const out = [];
  let start = 0;
  let i = 0;
  while (i < masked.length) {
    const ch = masked[i];
    if (!TERMINATOR.test(ch)) { i++; continue; }
    // the whole run of terminators (... ?! etc.) plus closing quotes/brackets
    let end = i + 1;
    while (end < masked.length && TERMINATOR.test(masked[end])) end++;
    while (end < masked.length && CLOSERS.test(masked[end])) end++;
    const atEnd = end >= masked.length || /^\s*$/.test(masked.slice(end));
    if (!atEnd) {
      if (!/\s/.test(masked[end])) { i = end; continue; }
      let k = end;
      while (k < masked.length && /\s/.test(masked[k])) k++;
      const next = masked[k];
      if (/\p{Ll}/u.test(next)) { i = end; continue; }
      if (masked.slice(i, end).replace(/["'”’)\]»]/g, "") === ".") {
        const raw = tokenBefore(masked, i);
        const word = raw.toLowerCase().replace(/[^\p{L}\p{N}.]/gu, "");
        if (PREFIX_ABBR.has(word)) { i = end; continue; }
        if (NUMBER_ABBR.has(word) && /\p{N}/u.test(next)) { i = end; continue; }
        if (/^\p{Lu}$/u.test(raw)) { i = end; continue; } // an initial: J. K. Rowling
        if (/^(?:\p{L}\.)+\p{L}$/u.test(word)) { i = end; continue; } // a dotted acronym: U.S.
      }
    }
    out.push(orig.slice(start, end));
    start = end;
    i = end;
  }
  if (start < orig.length) out.push(orig.slice(start));
  return out;
}

/** Break the text into blocks at blank lines, bullets and line breaks that start a new line of thought. */
function blocks(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let cur = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) out.push(cur); cur = ""; continue; }
    const bullet = BULLET.test(raw);
    const stripped = bullet ? raw.replace(BULLET, "").trim() : line;
    if (!cur) { cur = stripped; continue; }
    if (!bullet && /^\p{Ll}/u.test(stripped)) cur += " " + stripped;
    else { out.push(cur); cur = stripped; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * @param {string} text
 * @param {{ maxSentences?: number, maxBytes?: number }} [o]
 * @returns {{ sentences: { index: number, text: string, bytes: number, tooLong: boolean }[], truncated: boolean, total: number }}
 */
export function splitSentences(text, { maxSentences = 12, maxBytes = 600 } = {}) {
  const all = [];
  for (const b of blocks(String(text ?? ""))) {
    for (const s of splitBlock(b)) {
      const t = s.replace(/\s+/g, " ").trim();
      if (t && /[\p{L}\p{N}]/u.test(t)) all.push(t);
    }
  }
  const sentences = all.slice(0, maxSentences).map((t, index) => {
    const bytes = Buffer.byteLength(t, "utf8");
    return { index, text: t, bytes, tooLong: bytes > maxBytes };
  });
  return { sentences, truncated: all.length > maxSentences, total: all.length };
}
