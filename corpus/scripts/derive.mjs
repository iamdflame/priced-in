// Derives small receipt files from saved evidence, so the arithmetic behind two rows is in git and can be replayed.
// Needs corpus/raw/ev (run ev.mjs first). Usage: node corpus/scripts/derive.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rows = readFileSync(root + 'raw/ev/etherscan_txcsv.txt', 'utf8').split('\n').slice(1).map((l) => l.replace(/["\r]/g, '').split(',')).filter((r) => r[0]);
const month = (m, y) => rows.filter((r) => new RegExp(`^${m}/\\d+/${y}$`).test(r[0]));
const tps = (a) => +(a.reduce((s, r) => s + +r[2], 0) / (a.length * 86400)).toFixed(3);
const last = rows.at(-1);
writeFileSync(root + 'receipts/eth-tps-etherscan.json', JSON.stringify({
  source: 'https://etherscan.io/chart/tx?output=csv', method: 'sum of daily transaction counts / seconds in the days counted',
  jan2016: { days: month(1, 2016).length, tps: tps(month(1, 2016)) }, sep2022: { days: month(9, 2022).length, tps: tps(month(9, 2022)) }, latestDay: { date: last[0], tps: tps([last]) },
}, null, 1) + '\n');
const c = JSON.parse(readFileSync(root + 'raw/ev/llama_dexs_chart.txt', 'utf8')).totalDataChart;
const jun = c.filter(([t]) => t >= 1748736000 && t < 1751328000);
const q2 = c.filter(([t]) => t >= 1743465600 && t < 1751328000);
const avg = (a) => a.reduce((s, x) => s + x[1], 0) / a.length;
writeFileSync(root + 'receipts/dex-volume-2025.json', JSON.stringify({
  source: 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true', method: 'mean daily volume x 7',
  june2025: { days: jun.length, weeklyUsdBillions: +(avg(jun) * 7 / 1e9).toFixed(1) }, q2_2025: { days: q2.length, weeklyUsdBillions: +(avg(q2) * 7 / 1e9).toFixed(1) },
  coingeckoViaCointelegraph: { q2_2025SpotDexUsdBillions: 877, weeklyUsdBillions: +(877 / 13).toFixed(1), url: 'https://cointelegraph.com/news/dex-volumes-hit-record-q2-2025-pancakeswap-hyperliquid-lead' },
}, null, 1) + '\n');
console.log(readFileSync(root + 'receipts/eth-tps-etherscan.json', 'utf8'), readFileSync(root + 'receipts/dex-volume-2025.json', 'utf8'));
