// Fetches evidence listed in corpus/sources.txt (key|url|optional JSON-RPC POST body) into corpus/raw/ev/<key>.txt
// as readable text and records url, time, sha256, status in corpus/receipts/evidence-index.json. Existing keys are skipped
// unless named on the command line. Usage: node corpus/scripts/ev.mjs [key ...]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { UA } from './articles.mjs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(root + 'raw/ev', { recursive: true });
mkdirSync(root + 'receipts', { recursive: true });
const idxPath = root + 'receipts/evidence-index.json';
const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : {};
const only = new Set(process.argv.slice(2));
const lines = readFileSync(root + 'sources.txt', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
function text(html) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
async function one(line) {
  const [key, url, ...rest] = line.split('|');
  const body = rest.join('|') || null;
  if (only.size ? !only.has(key) : idx[key]?.status === 200) return;
  try {
    const ctl = AbortSignal.timeout(40000);
    const r = await fetch(url, { method: body ? 'POST' : 'GET', body: body || undefined, signal: ctl, redirect: 'follow',
      headers: { 'User-Agent': UA, ...(body ? { 'content-type': 'application/json' } : {}), accept: '*/*' } });
    const ct = r.headers.get('content-type') || '';
    const isPdf = /pdf/.test(ct) || /\.pdf($|\?)/i.test(url);
    const buf = Buffer.from(await r.arrayBuffer());
    let raw = buf.toString('utf8');
    let t = /html/.test(ct) ? text(raw) : raw;
    if (isPdf && r.ok) { const f = `${tmpdir()}/${key}.pdf`; writeFileSync(f, buf); t = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }); raw = buf; }
    writeFileSync(`${root}raw/ev/${key}.txt`, t);
    idx[key] = { url, ...(body ? { post: body } : {}), fetchedAt: new Date().toISOString(), status: r.status, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
    console.log(r.status, key, t.length);
  } catch (e) {
    idx[key] = { url, fetchedAt: new Date().toISOString(), status: 0, error: String(e.message || e).slice(0, 100) };
    console.log('ERR', key, idx[key].error);
  }
}
const q = [...lines];
await Promise.all(Array.from({ length: 5 }, async () => { while (q.length) { await one(q.shift()); await new Promise((r) => setTimeout(r, 300)); } }));
writeFileSync(idxPath, JSON.stringify(Object.fromEntries(Object.entries(idx).sort()), null, 0).replace(/\},"/g, '},\n"') + '\n');
