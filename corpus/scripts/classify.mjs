// Builds corpus/pages/<slug>.json from the split sentences and the hand classification in claims.tsv.
// A sentence listed in claims.tsv is `data`. Every other sentence was read and is not `data`; it is `opinion` if it has
// no past-tense or year marker (definitions, explanations, attributed views) or the mechanical pre-label says opinion,
// otherwise `sourced`. Usage: node corpus/scripts/classify.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { ARTICLES } from './articles.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const claims = new Map();
for (const line of readFileSync(root + 'claims.tsv', 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [id, claim, asOf] = line.split('|');
  claims.set(id, { claim, asOf: asOf?.trim() || null });
}
const revs = JSON.parse(readFileSync(root + 'revisions.json', 'utf8')).articles;
const PAST = /\b(was|were|had|did|became|launched|founded|created|announced|reported|released|published|filed|raised|acquired|introduced|began|said|ended|sold|signed|\w+ed)\b|\b(1[0-9]|20)\d\d\b/i;
let seen = 0, total = 0;
for (const [slug] of ARTICLES) {
  const rows = JSON.parse(readFileSync(`${root}work/${slug}.sentences.json`, 'utf8'));
  const rev = revs.find((a) => a.slug === slug);
  const sentences = rows.map((r) => {
    const c = claims.get(r.id);
    if (c) { seen++; return { id: r.id, section: r.section, text: r.text, class: 'data', claim: c.claim, asOf: c.asOf }; }
    const cls = r.pre === 'opinion' || !PAST.test(r.text) ? 'opinion' : 'sourced';
    return { id: r.id, section: r.section, text: r.text, class: cls };
  });
  total += sentences.length;
  const counts = { data: 0, sourced: 0, opinion: 0 };
  sentences.forEach((s) => counts[s.class]++);
  writeFileSync(`${root}pages/${slug}.json`, JSON.stringify({ slug, title: rev.title, revid: rev.revid, timestamp: rev.timestamp, url: rev.url, licence: rev.licence, attribution: rev.attribution, counts, sentences }, null, 1) + '\n');
  console.log(slug, JSON.stringify(counts));
}
if (seen !== claims.size) throw new Error(`claims not matched: ${seen} of ${claims.size}`);
console.log('total', total, 'data', seen);
