// Prints matches of a regex in a saved evidence file with context. Usage: node corpus/scripts/q.mjs key 'regex' [ctx] [max]
import { readFileSync } from 'node:fs';
const [key, re, ctx = '90', max = '4'] = process.argv.slice(2);
const t = readFileSync(`corpus/raw/ev/${key}.txt`, 'utf8').replace(/\s+/g, ' ');
let n = 0;
for (const m of t.matchAll(new RegExp(re, 'gi'))) {
  console.log(`[${key}] ` + t.slice(Math.max(0, m.index - +ctx), m.index + m[0].length + +ctx));
  if (++n >= +max) break;
}
if (!n) console.log(`[${key}] NO MATCH: ${re}`);
