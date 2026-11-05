// Finds the first revision of a page whose wikitext contains a needle, by bisecting the page's history
// from the pinned revision backwards. Usage: node corpus/scripts/bisect.mjs <slug> <regex>   Prints JSON.
import { readFileSync } from 'node:fs';
import { UA } from './articles.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const API = 'https://en.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) u.searchParams.set(k, v);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    await sleep(3000 * (i + 1));
  }
  throw new Error('api failed');
}
export async function history(title, revid) {
  const out = [];
  let cont;
  do {
    const j = await api({ action: 'query', prop: 'revisions', titles: title, rvprop: 'ids|timestamp', rvlimit: 500, rvstartid: revid, rvdir: 'older', ...(cont ? { rvcontinue: cont } : {}) });
    out.push(...j.query.pages[0].revisions);
    cont = j.continue?.rvcontinue;
    await sleep(300);
  } while (cont);
  return out.reverse();
}
const content = async (revid) => { await sleep(350); const j = await api({ action: 'query', prop: 'revisions', revids: revid, rvprop: 'content', rvslots: 'main' }); return j.query.pages[0].revisions[0].slots.main.content || ''; };
export async function firstWith(title, revid, re) {
  const h = await history(title, revid);
  const has = async (i) => re.test(await content(h[i].revid));
  if (!(await has(h.length - 1))) return { error: 'needle not in pinned revision' };
  let lo = 0, hi = h.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (await has(m)) hi = m; else lo = m + 1; }
  return { revid: h[lo].revid, timestamp: h[lo].timestamp, revisions: h.length, note: 'bisection assumes the text stayed once added; it dates the last continuous appearance at best' };
}
if (process.argv[1].endsWith('bisect.mjs')) {
  const [slug, needle] = process.argv.slice(2);
  const a = JSON.parse(readFileSync(root + 'revisions.json', 'utf8')).articles.find((x) => x.slug === slug);
  console.log(JSON.stringify({ slug, needle, ...(await firstWith(a.title, a.revid, new RegExp(needle))) }));
}
