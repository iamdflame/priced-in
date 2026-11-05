// Pins each article to its newest revision at or before CUTOFF and saves rendered HTML + wikitext under corpus/raw/.
// Re-running reproduces the same revids. Usage: node corpus/scripts/fetch.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { ARTICLES, CUTOFF, UA } from './articles.mjs';
const API = 'https://en.wikipedia.org/w/api.php';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(root + 'raw', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
}
const out = [];
for (const [slug, title] of ARTICLES) {
  const q = await api({ action: 'query', titles: title, prop: 'revisions', rvprop: 'ids|timestamp|size|content', rvslots: 'main', rvstart: CUTOFF, rvdir: 'older', rvlimit: 1 });
  const rev = q.query.pages[0].revisions[0];
  await sleep(400);
  const p = await api({ action: 'parse', oldid: rev.revid, prop: 'text', disableeditsection: 1 });
  writeFileSync(`${root}raw/${slug}.html`, p.parse.text);
  writeFileSync(`${root}raw/${slug}.wikitext`, rev.slots.main.content);
  out.push({
    slug, title, revid: rev.revid, timestamp: rev.timestamp, bytes: rev.size,
    url: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&oldid=${rev.revid}`,
    history: `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=history`,
    licence: 'CC BY-SA 4.0',
    attribution: `"${title}", English Wikipedia, revision ${rev.revid} (${rev.timestamp}), by Wikipedia contributors, licensed CC BY-SA 4.0.`,
  });
  console.log(slug, rev.revid, rev.timestamp, rev.size);
  await sleep(400);
}
writeFileSync(root + 'revisions.json', JSON.stringify({ cutoff: CUTOFF, licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', articles: out }, null, 1) + '\n');
