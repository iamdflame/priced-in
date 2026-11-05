// Checks verdicts.tsv against saved evidence, writes receipts/extracts.json (the matched text, kept in git),
// and folds verdicts into pages/<slug>.json. Usage: node corpus/scripts/verify.mjs [verdict file] [--no-write]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : root + 'verdicts.tsv';
const noWrite = process.argv.includes('--no-write');
const idx = JSON.parse(readFileSync(root + 'receipts/evidence-index.json', 'utf8'));
const claims = new Map();
for (const l of readFileSync(root + 'claims.tsv', 'utf8').split('\n')) { if (l.trim() && !l.startsWith('#')) claims.set(l.split('|')[0], l.split('|')); }
const norm = (s) => s.replace(/\s+/g, ' ');
const cache = new Map();
const load = (k) => {
  if (cache.has(k)) return cache.get(k);
  const p = k.startsWith('file:') ? root + k.slice(5) : `${root}raw/ev/${k}.txt`;
  const t = existsSync(p) ? norm(readFileSync(p, 'utf8')) : null;
  cache.set(k, t); return t;
};
const problems = [];
const extracts = {};
function check(id, spec, slot) {
  const out = [];
  for (const part of spec.split(';;').filter(Boolean)) {
    const [key, ...rest] = part.split('~');
    const re = rest.join('~');
    if (!key.startsWith('file:') && !idx[key]) { problems.push(`${id}: no index entry for ${key}`); continue; }
    const t = load(key);
    if (t === null) { problems.push(`${id}: no saved evidence for ${key}`); continue; }
    const m = new RegExp(re, 'i').exec(t);
    if (!m) { problems.push(`${id}: ${slot} regex misses in ${key}: ${re}`); continue; }
    out.push({ key, url: key.startsWith('file:') ? key.slice(5) : idx[key].url, ...(key.startsWith('file:') || !idx[key].post ? {} : { post: idx[key].post }), fetchedAt: key.startsWith('file:') ? null : idx[key].fetchedAt, match: t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80) });
  }
  return out;
}
const rows = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const f = line.replace(/\r$/, '').split('¦');
  if (f.length !== 7) { problems.push(`bad columns (${f.length}): ${line.slice(0, 60)}`); continue; }
  const [id, verdict, dated, checked, receipts, then, note] = f;
  if (!['current', 'stale', 'wrong', 'undecidable', 'reclassified'].includes(verdict)) problems.push(`${id}: bad verdict ${verdict}`);
  if (!claims.has(id)) problems.push(`${id}: not a data sentence`);
  const r = check(id, receipts, 'receipt');
  const th = check(id, then, 'then');
  if (['current', 'stale', 'wrong'].includes(verdict) && !r.length) problems.push(`${id}: ${verdict} has no receipt`);
  if (verdict === 'stale' && !th.length) problems.push(`${id}: stale has no then-receipt`);
  if (verdict === 'wrong' && receipts.split(';;').length < 2) problems.push(`${id}: wrong needs a second check`);
  rows.push({ id, verdict, dated: dated === '1', checked, note, contradicted: /^CONTRADICTED/.test(note), receipts: r, then: th });
  extracts[id] = { receipts: r, then: th };
}
const seen = new Set(rows.map((r) => r.id));
for (const id of claims.keys()) if (!seen.has(id)) problems.push(`${id}: no verdict`);
if (seen.size !== rows.length) problems.push('duplicate ids');
if (problems.length) { console.log(problems.join('\n')); console.log(`${problems.length} problems`); process.exit(1); }
if (!noWrite) {
  writeFileSync(root + 'receipts/extracts.json', JSON.stringify(extracts, null, 0).replace(/\},"/g, '},\n"') + '\n');
  const bySlug = new Map();
  for (const r of rows) { const s = r.id.replace(/-\d{4}$/, ''); (bySlug.get(s) || bySlug.set(s, []).get(s)).push(r); }
  for (const [slug, rs] of bySlug) {
    const p = `${root}pages/${slug}.json`;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const r of rs) {
      const s = j.sentences.find((x) => x.id === r.id);
      s.verdict = r.verdict; s.dated = r.dated; s.checkedValue = r.checked; s.checkedOn = '2026-11-05';
      s.contradicted = r.contradicted; s.note = r.note;
      s.receipts = r.receipts.map((x) => ({ url: x.url, ...(x.post ? { post: x.post } : {}), match: x.match }));
      s.thenReceipts = r.then.map((x) => ({ url: x.url, match: x.match }));
    }
    writeFileSync(p, JSON.stringify(j, null, 1) + '\n');
  }
}
const c = {}; rows.forEach((r) => { c[r.verdict] = (c[r.verdict] || 0) + 1; });
console.log(rows.length, JSON.stringify(c));
