// Writes the blinded audit packet: the seeded 15% (rounded up) of checked rows, with only id, sentence and claim.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ARTICLES } from './articles.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rows = [];
for (const [slug] of ARTICLES) for (const s of JSON.parse(readFileSync(`${root}pages/${slug}.json`, 'utf8')).sentences) if (s.class === 'data') rows.push({ id: s.id, text: s.text, claim: s.claim, asOf: s.asOf });
const n = Math.ceil(rows.length * 0.15);
const key = (id) => createHash('sha256').update('pricedin-audit-2026-11-05|' + id).digest('hex');
const pick = rows.map((r) => [key(r.id), r]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, n).map((x) => x[1]).sort((a, b) => (a.id < b.id ? -1 : 1));
mkdirSync(root + 'audit', { recursive: true });
writeFileSync(root + 'audit/packet.json', JSON.stringify({ seed: 'pricedin-audit-2026-11-05', population: rows.length, sampled: n, rows: pick }, null, 1) + '\n');
for (const r of pick) console.log(`${r.id} [${r.asOf || ''}] ${r.text.slice(0, 200)}`);
