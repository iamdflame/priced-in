// Compares audit/verdicts.tsv with the first verdicts (the commit named by FIRST), checks the audit receipts,
// and writes audit/result.json. Usage: node corpus/scripts/audit-compare.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const FIRST = 'fe013b9';
const parse = (t) => t.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.replace(/\r$/, '').split('¦'));
const first = new Map(parse(execSync(`git show ${FIRST}:corpus/verdicts.tsv`, { encoding: 'utf8', maxBuffer: 1 << 26 })).map((f) => [f[0], f]));
const audit = parse(readFileSync(root + 'audit/verdicts.tsv', 'utf8'));
const packet = JSON.parse(readFileSync(root + 'audit/packet.json', 'utf8'));
if (audit.length !== packet.rows.length || audit.some((f, i) => f[0] !== packet.rows[i].id)) throw new Error('audit rows do not match the packet');
const idx = JSON.parse(readFileSync(root + 'receipts/evidence-index.json', 'utf8'));
const extracts = {};
for (const f of audit) {
  extracts[f[0]] = [];
  for (const part of [f[4], f[5]].join(';;').split(';;').filter(Boolean)) {
    const [k, ...r] = part.split('~');
    const p = `${root}raw/ev/${k}.txt`;
    if (!existsSync(p)) continue; // raw files are gitignored; extracts below were made when they existed
    const t = readFileSync(p, 'utf8').replace(/\s+/g, ' ');
    const m = new RegExp(r.join('~'), 'i').exec(t);
    if (!m) throw new Error(`${f[0]}: ${part}`);
    extracts[f[0]].push({ url: idx[k].url, fetchedAt: idx[k].fetchedAt, match: t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80) });
  }
}
const disagreements = audit.filter((f) => first.get(f[0])[1] !== f[1]).map((f) => ({ id: f[0], first: first.get(f[0])[1], audit: f[1], checked: f[3] }));
const decided = audit.filter((f) => ['current', 'stale', 'wrong'].includes(f[1]) && ['current', 'stale', 'wrong'].includes(first.get(f[0])[1]));
const res = {
  seed: packet.seed, population: packet.population, sampled: audit.length,
  agree: audit.length - disagreements.length,
  agreementRate: +((audit.length - disagreements.length) / audit.length).toFixed(4),
  bothDecided: decided.length,
  bothDecidedAgree: decided.filter((f) => first.get(f[0])[1] === f[1]).length,
  disagreements,
  limit: 'Same agent in the same session; first verdicts were not displayed during the audit but cannot be unlearned. Treat the rate as an upper bound.',
  extracts,
};
writeFileSync(root + 'audit/result.json', JSON.stringify(res, null, 1) + '\n');
console.log(res.sampled, res.agree, res.agreementRate, res.bothDecided, res.bothDecidedAgree, JSON.stringify(disagreements.map((d) => [d.id, d.first, d.audit])));
