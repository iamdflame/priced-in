// Splits the pinned rendered HTML into sentences, following METHOD.md, and gives each a mechanical pre-label.
// Reads corpus/raw/<slug>.html, writes corpus/work/<slug>.sentences.json. Usage: node corpus/scripts/split.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ARTICLES } from './articles.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(root + 'work', { recursive: true });

const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'area', 'base', 'col', 'source', 'track']);
const DROP_TAGS = new Set(['table', 'figure', 'style', 'script', 'math', 'img', 'audio', 'video', 'semantics']);
const DROP_CLASS = /(^|\s)(reference|mw-references-wrap|reflist|references|infobox|sidebar|navbox|vertical-navbox|hatnote|ambox|mbox-small|metadata|noprint|thumb|mw-editsection|toc|portalbox|shortdescription|mwe-math-element|mw-empty-elt|gallery|navigation-not-searchable|side-box|tmulti)(\s|$)/;
const DROP_SECTION = /^(see also|references|notes|footnotes|citations|sources|bibliography|further reading|external links|explanatory notes|works cited)$/i;

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—');
}

// Walks the tags, keeps text of p and li blocks outside dropped subtrees and dropped sections.
function blocks(html) {
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const stack = [];
  let dropDepth = 0;
  let heading = null;
  let section = '(lead)';
  let sub = '';
  let sectionDropped = false;
  const out = [];
  const open = []; // open block buffers
  let m;
  while ((m = re.exec(html))) {
    const raw = m[0];
    if (raw.startsWith('<!--')) continue;
    if (m[3] !== undefined) {
      const t = decode(m[3]);
      if (heading !== null && !dropDepth) heading += t;
      else if (!dropDepth && open.length) open[open.length - 1].text += t;
      continue;
    }
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    const closing = raw.startsWith('</');
    if (!closing) {
      const selfClose = VOID.has(tag) || attrs.trimEnd().endsWith('/');
      const cls = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
      const drop = DROP_TAGS.has(tag) || DROP_CLASS.test(cls);
      if (selfClose) {
        if (tag === 'br' && open.length && !dropDepth) open[open.length - 1].text += ' ';
        continue;
      }
      stack.push({ tag, drop });
      if (drop) dropDepth++;
      if (!dropDepth) {
        if (/^h[1-6]$/.test(tag)) heading = '';
        if (tag === 'p' || tag === 'li') open.push({ tag, text: '', section, sub, dropped: sectionDropped });
      }
    } else {
      // pop to the matching tag
      let i = stack.length - 1;
      while (i >= 0 && stack[i].tag !== tag) i--;
      if (i < 0) continue;
      while (stack.length > i) {
        const e = stack.pop();
        if (e.drop) dropDepth--;
        else if (!dropDepth) {
          if (/^h[1-6]$/.test(e.tag) && heading !== null) {
            const h = heading.trim();
            heading = null;
            if (e.tag === 'h2') {
              section = h; sub = '';
              sectionDropped = DROP_SECTION.test(h);
            } else {
              sub = h;
              if (DROP_SECTION.test(h)) sectionDropped = true;
            }
          }
          if (e.tag === 'p' || e.tag === 'li') {
            const b = open.pop();
            if (b) out.push(b);
          }
        }
      }
    }
  }
  return out.filter((b) => !b.dropped);
}

const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Corp|Co|Jr|Sr|St|vs|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Gov|Sen|Rep|al|approx|ca|cf|Fig|ed|eds|Vol|pp|p)\.|\b[A-Z]\.|\be\.g\.|\bi\.e\.|\bU\.S\.|\bU\.K\.|\bD\.C\.)$/;

function sentences(text) {
  const t = text.replace(/\[\s*\d+\s*\]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = [];
  let start = 0;
  const re = /[.!?]["”’')\]]*\s+(?=["“‘'(\[$€£]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].trimEnd().length;
    const head = t.slice(start, end);
    if (ABBR.test(head)) {
      // "U.S." or "Inc." may still end a sentence when the next word starts one, but splitting is the rarer case: keep joined.
      continue;
    }
    parts.push(head.trim());
    start = m.index + m[0].length;
  }
  parts.push(t.slice(start).trim());
  return parts.filter(Boolean);
}

// Mechanical pre-label (METHOD step one). The annotator reads every sentence and overrides this.
const DATE_MARK = /\b(as of|currently|today|at present|presently|at the time of writing|to date|nowadays|now\b)/i;
const PRESENT = /\b(is|are|has|have|uses?|runs?|supports?|offers?|holds?|processes|allows?|enables?|remains?|operates?|maintains?|consists?|employs?|provides?|includes?|issues?|costs?|takes?|requires?|ranks?)\b/i;
const NUMERIC = /\d|\b(largest|second|third|first|most|majority|million|billion|trillion)\b/i;
const EVAL = /\b(critics?|argued?|claims?|believes?|should|may|might|could|would|according to|described|called|suggests?|considered|criticized|praised)\b/i;
function prelabel(s) {
  if (DATE_MARK.test(s)) return 'data';
  if (PRESENT.test(s) && NUMERIC.test(s)) return 'data';
  if (EVAL.test(s) && !/\b(was|were)\b/.test(s)) return 'opinion';
  return 'sourced';
}

let total = 0;
for (const [slug] of ARTICLES) {
  const html = readFileSync(`${root}raw/${slug}.html`, 'utf8');
  const rows = [];
  for (const b of blocks(html)) {
    const text = b.text.replace(/\s+/g, ' ').trim();
    if (b.tag === 'li' && !(text.split(' ').length >= 6 && /[.!?]["”’')\]]*$/.test(text))) continue;
    if (!text) continue;
    for (const s of sentences(text)) {
      if (s.split(' ').length < 3) continue;
      rows.push({ section: b.sub ? `${b.section} / ${b.sub}` : b.section, text: s, pre: prelabel(s) });
    }
  }
  rows.forEach((r, i) => { r.id = `${slug}-${String(i + 1).padStart(4, '0')}`; });
  writeFileSync(`${root}work/${slug}.sentences.json`, JSON.stringify(rows, null, 0));
  const c = { data: 0, sourced: 0, opinion: 0 };
  rows.forEach((r) => c[r.pre]++);
  total += rows.length;
  console.log(slug, rows.length, JSON.stringify(c));
}
console.log('total', total);
