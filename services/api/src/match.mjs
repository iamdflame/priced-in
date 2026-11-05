// Matching a question or claim against the market's claims, with no model and no network:
// an exact page sentence first, then the closest claims by text. Lexical only: tokens are
// normalised, stemmed and weighted by how rare they are across the market (BM25-style idf),
// near-misses of long words (one typo) still count, and a few names have aliases
// (USDT -> Tether). A match must cover enough of what the question asks, or it is no match:
// "nothing matches" is a real answer, never the least-bad claim dressed up as one.

const STOP = new Set((
  "a an the and or but nor of to in on at by for from with without as into onto over under about above below " +
  "is are was were be been being am do does did done doing have has had having will would shall should can could may might must " +
  "it its this that these those there here their them they he she his her him we us our you your i me my mine " +
  "what which who whom whose when where why how whether if then than so such too very just also only even ever " +
  "true false really actually still yet any some all each every no not" +
  " sure claim claims say says said tell told right correct fact many much often" // the question's frame, not its content
).split(/\s+/));

// Names that mean the same thing on these pages. Both sides are normalised tokens.
const ALIASES = new Map([
  ["usdt", "tether"], ["usd₮", "tether"], ["usdtether", "tether"],
  ["btc", "bitcoin"], ["eth", "ethereum"], ["sol", "solana"], ["trx", "tron"],
  ["nearprotocol", "near"], ["tbill", "treasury"],
]);

/** Lowercase, fold quotes/dashes/diacritics, keep letters, digits, ₮ and decimal points. */
export function normalize(s) {
  return String(s ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/'s\b/g, "")
    .replace(/[^\p{L}\p{N}₮.$%\s-]/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A small, deterministic suffix stemmer: enough to meet "issues"/"issued"/"issuing". */
export function stem(w) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  let s = w;
  if (s.endsWith("ies") && s.length > 4) s = s.slice(0, -3) + "y";
  else if (s.endsWith("sses")) s = s.slice(0, -2);
  else if (s.endsWith("es") && /(?:sh|ch|x|z|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) s = s.slice(0, -1);
  if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  if (s.endsWith("ly") && s.length > 5) s = s.slice(0, -2);
  if (s.endsWith("e") && s.length > 4) s = s.slice(0, -1);
  return s;
}

/** Content tokens of a text, stemmed, aliased, without stopwords; numbers kept whole. */
export function tokens(text) {
  const out = [];
  for (let raw of normalize(text).split(" ")) {
    raw = raw.replace(/^[-$%]+|[-%]+$/g, "");
    if (!raw) continue;
    for (const part of raw.includes("-") && !/^\d/.test(raw) ? [raw.replace(/-/g, ""), ...raw.split("-")] : [raw]) {
      if (!part || STOP.has(part)) continue;
      const a = ALIASES.get(part) ?? part;
      if (a.length < 2 && !/\d/.test(a)) continue;
      const st = stem(a);
      out.push(ALIASES.get(st) ?? st);
    }
  }
  return out;
}

/** Levenshtein distance capped at 2 (enough to tell "one typo" from "different word"). */
function within1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * An index over claims. Build once per claims list; search many times.
 * @param {{ id: number, text: string }[]} claims
 */
export class ClaimIndex {
  constructor(claims) {
    this.claims = claims;
    this.docs = claims.map((c) => {
      const toks = tokens(c.text);
      return { claim: c, norm: normalize(c.text), toks, set: new Set(toks) };
    });
    this.df = new Map();
    for (const d of this.docs) for (const t of d.set) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.n = this.docs.length;
    this.vocab = [...this.df.keys()];
  }

  idf(t) {
    const df = this.df.get(t) || 0;
    return Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
  }

  /** The word in a claim a query token meets: itself, or a one-typo neighbour of a long word. */
  meet(t, doc) {
    if (doc.set.has(t)) return { tok: t, weight: 1 };
    if (t.length >= 5 && !/\d/.test(t)) {
      for (const u of doc.set) if (u.length >= 5 && within1(t, u)) return { tok: u, weight: 0.8 };
    }
    // a number written two ways: "350 million" vs "350m" is out of scope; "2024" vs "2024s" is not
    return null;
  }

  /**
   * @param {string} q the question or claim
   * @param {{ limit?: number, minScore?: number, page?: string|null }} [o]
   * @returns {{ matches: { claim: object, score: number, kind: "exact"|"sentence"|"close", matched: string[], missing: string[] }[], queryTokens: string[] }}
   */
  search(q, { limit = 3, minScore = 0.45, minRecall = 0.6, minWeight = 1, page = null } = {}) {
    const qn = normalize(q).replace(/[?!]+$/, "").trim();
    const qt = [...new Set(tokens(q))];
    const docs = page ? this.docs.filter((d) => d.claim.page === page) : this.docs;
    const out = [];
    for (const d of docs) {
      if (qn && d.norm.replace(/[?!]+$/, "") === qn) { out.push({ claim: d.claim, score: 1, kind: "exact", matched: qt, missing: [] }); continue; }
      if (!qt.length) continue;
      // query coverage: how much of what the question asks this claim speaks to, idf-weighted
      let qw = 0, hit = 0;
      const matched = [], missing = [];
      for (const t of qt) {
        // a query word no claim on the market uses still counts against every claim
        const w = this.df.has(t) ? this.idf(t) : Math.log(1 + this.n + 0.5);
        qw += w;
        const m = this.meet(t, d);
        if (m) { hit += w * m.weight; matched.push(t); } else missing.push(t);
      }
      if (!matched.length) continue;
      const recall = hit / qw;
      // claim coverage: a claim that says much more than the question is a weaker match
      let dw = 0, dhit = 0;
      const qset = new Set(matched.map((t) => this.meet(t, d)?.tok));
      for (const t of d.set) { const w = this.idf(t); dw += w; if (qset.has(t)) dhit += w; }
      const precision = dw ? dhit / dw : 0;
      // covering the question is what counts; a claim that says much more is only mildly discounted
      // (a sentence that lists thirteen chains still answers "does it run on NEAR?")
      const score = recall * Math.pow(precision, 0.2);
      // a sentence quoted whole inside the question, or the question inside the sentence
      const contained = qn.length >= 24 && (d.norm.includes(qn) || qn.includes(d.norm));
      out.push({ claim: d.claim, score: contained ? Math.max(score, 0.9) : score, kind: contained ? "sentence" : "close", matched, missing, recall, hit });
    }
    out.sort((a, b) => b.score - a.score || a.claim.id - b.claim.id);
    // a match must cover most of the question, and with words that say something on this market:
    // "tether" alone is on nearly every line of the Tether page, so it matches none of them
    const good = out.filter((m) => m.kind !== "close" || (m.score >= minScore && m.recall >= minRecall && m.hit >= minWeight));
    return { matches: good.slice(0, limit).map(({ recall, hit, ...m }) => ({ ...m, score: Math.round(m.score * 1000) / 1000 })), queryTokens: qt };
  }
}
