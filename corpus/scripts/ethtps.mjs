// Samples transaction counts and timestamps from Ethereum RPC. Usage: node corpus/scripts/ethtps.mjs <rpc> <from> <to> <n> <outfile>
import { writeFileSync } from 'node:fs';
const [rpc, from, to, n, out] = process.argv.slice(2);
const a = +from, b = +to, N = +n;
const blocks = Array.from({ length: N }, (_, i) => Math.round(a + (b - a) * i / (N - 1)));
const rows = [];
for (let i = 0; i < N; i += 20) {
  const batch = blocks.slice(i, i + 20).map((x, j) => ({ jsonrpc: '2.0', id: j, method: 'eth_getBlockByNumber', params: ['0x' + x.toString(16), false] }));
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
  const j = await r.json();
  for (const e of j) if (e.result) rows.push({ n: parseInt(e.result.number), t: parseInt(e.result.timestamp), tx: e.result.transactions.length, gas: parseInt(e.result.gasUsed), gasLimit: parseInt(e.result.gasLimit) });
  await new Promise((r) => setTimeout(r, 400));
}
rows.sort((x, y) => x.n - y.n);
const span = rows.at(-1).t - rows[0].t, blk = rows.at(-1).n - rows[0].n;
const mean = rows.reduce((s, x) => s + x.tx, 0) / rows.length;
const res = { rpc, sampledBlocks: rows.length, from: rows[0].n, to: rows.at(-1).n, firstTime: new Date(rows[0].t * 1000).toISOString(), lastTime: new Date(rows.at(-1).t * 1000).toISOString(), meanBlockTimeSec: +(span / blk).toFixed(3), meanTxPerBlock: +mean.toFixed(3), meanTps: +(mean / (span / blk)).toFixed(3), gasLimitLast: rows.at(-1).gasLimit };
console.log(JSON.stringify(res));
writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
