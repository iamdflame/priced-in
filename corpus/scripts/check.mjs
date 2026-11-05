// npm run corpus:check. Re-validates the JSON, recomputes the headline from pages/*.json, and prints it.
// Works without corpus/raw/, which is gitignored; when raw evidence is present, verify.mjs also re-tests every receipt.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ARTICLES } from './articles.mjs';
import { summarise } from './headline.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const fail = [];
const pages = ARTICLES.map(([slug]) => JSON.parse(readFileSync(`${root}pages/${slug}.json`, 'utf8')));
const revs = JSON.parse(readFileSync(root + 'revisions.json', 'utf8')).articles;
for (const p of pages) {
  const rev = revs.find((a) => a.slug === p.slug);
  if (!rev || rev.revid !== p.revid) fail.push(`${p.slug}: revid differs from revisions.json`);
  if (!p.attribution.includes('CC BY-SA 4.0')) fail.push(`${p.slug}: attribution`);
  p.sentences.forEach((s, i) => {
    if (s.id !== `${p.slug}-${String(i + 1).padStart(4, '0')}`) fail.push(`${s.id}: page order`);
    if (!['data', 'sourced', 'opinion'].includes(s.class)) fail.push(`${s.id}: class`);
    if (s.class !== 'data') { if (s.verdict) fail.push(`${s.id}: verdict on non-data`); return; }
    if (!s.claim) fail.push(`${s.id}: no claim`);
    if (!['current', 'stale', 'wrong', 'undecidable', 'reclassified'].includes(s.verdict)) fail.push(`${s.id}: verdict ${s.verdict}`);
    if (['current', 'stale', 'wrong'].includes(s.verdict) && !s.receipts?.length) fail.push(`${s.id}: ${s.verdict} without a receipt`);
    if (['current', 'stale', 'wrong'].includes(s.verdict) && !s.checkedValue) fail.push(`${s.id}: no checked value`);
    if (['current', 'stale', 'wrong'].includes(s.verdict) && s.checkedOn !== '2026-11-05') fail.push(`${s.id}: no check date`);
    if (s.verdict === 'stale' && !s.thenReceipts?.length) fail.push(`${s.id}: stale without evidence for then`);
    if (s.verdict === 'wrong' && s.receipts.length < 2) fail.push(`${s.id}: wrong without a second check`);
  });
}
const s = summarise(pages);
const m = JSON.parse(readFileSync(root + 'MANIFEST.json', 'utf8'));
if (JSON.stringify(m.headline) !== JSON.stringify(s.headline)) fail.push('MANIFEST headline differs from the recomputed one');
if (JSON.stringify(m.counts) !== JSON.stringify(s.counts)) fail.push('MANIFEST counts differ from the recomputed ones');
const errs = JSON.parse(readFileSync(root + 'ERRORS.json', 'utf8')).items;
if (errs.length !== 10) fail.push('ERRORS.json must hold ten items');
const all = new Map(pages.flatMap((p) => p.sentences.map((x) => [x.id, x])));
for (const e of errs) {
  const x = all.get(e.id);
  if (!x || !['stale', 'wrong'].includes(x.verdict)) fail.push(`${e.id}: in ERRORS but not stale or wrong`);
  if (!e.receipts?.length || !/oldid=\d+/.test(e.revision)) fail.push(`${e.id}: ERRORS row lacks a receipt or revision link`);
  if (x && x.text !== e.sentence) fail.push(`${e.id}: ERRORS sentence differs from the page`);
}
if (existsSync(root + 'raw/ev')) {
  try { execSync('node corpus/scripts/verify.mjs --no-write', { cwd: root + '..', stdio: 'pipe' }); console.log('receipts re-tested against saved evidence'); } catch (e) { fail.push('verify: ' + e.stdout); }
} else console.log('corpus/raw/ absent: receipts checked for presence only; node corpus/scripts/ev.mjs refetches them');
try {
  const log = (p) => execSync(`git log --format=%ct --reverse -- ${p}`, { cwd: root + '..', encoding: 'utf8' }).trim().split('\n')[0];
  const method = +log('corpus/METHOD.md'), verdict = +log('corpus/verdicts.tsv');
  if (!(method && verdict && method < verdict)) fail.push('METHOD.md commit must precede the first verdict commit');
  else console.log('METHOD.md was committed before the first verdict');
} catch { console.log('git not available: commit order not checked'); }
if (fail.length) { console.error(fail.join('\n')); console.error(`${fail.length} problems`); process.exit(1); }
const h = s.headline, c = s.counts;
console.log(`${h.numerator} of ${h.denominator} decided data sentences are stale or wrong: ${(h.share * 100).toFixed(1)}% (95% Wilson ${(h.wilson95[0] * 100).toFixed(1)}%-${(h.wilson95[1] * 100).toFixed(1)}%)`);
console.log(`checked ${c.checked}: current ${c.current} (dated ${c.currentDated}), stale ${c.stale}, wrong ${c.wrong}, undecidable ${c.undecidable} (contradicted ${c.undecidableContradicted}), reclassified ${c.reclassified}`);
console.log(`sentences ${s.byClass.total}: data ${s.byClass.data}, sourced ${s.byClass.sourced}, opinion ${s.byClass.opinion}`);
