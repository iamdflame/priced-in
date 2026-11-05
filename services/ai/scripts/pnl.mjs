// npm run pnl: every swarm agent's P&L, inference bill included, rebuilt from chain events
// alone, checked against the chain's own state, and matched against the runner's ledger.
//
//   npm run pnl [-- --from <height>] [-- --json]
//
// Reads MARKET_CONTRACT_ID, SWARM_CONTRACT_ID, USDC_CONTRACT_ID, RPC_URLS, NEAR_NETWORK,
// INFERENCE_YOCTO_PER_MICRO_USD and DATA_DIR like the runner does. The scan starts at --from,
// PNL_FROM_HEIGHT or <DATA_DIR>/chain.json's from_height (written by house-agents.mjs before the
// first spawn), and is cached in <DATA_DIR>/pnl-scan.json so the next run only reads new blocks.
// The runner's ledger is <DATA_DIR>/ledger.jsonl. Exit 0 only when every agent matches.
import fs from "node:fs";
import path from "node:path";
import { loadAiConfig } from "../src/config.js";
import { Rpc } from "../../api/src/rpc.mjs";
import { Ledger } from "../src/ledger.js";
import { Journal } from "../src/journal.js";
import { scanEvents, rebuild, compare, checkState, priceSnapshot, pnlMicro, markMicro } from "../src/pnl.js";

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const { api, ai, errors } = loadAiConfig(process.env);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
if (!api.marketId || !ai.swarmId) { console.error("pnl: MARKET_CONTRACT_ID and SWARM_CONTRACT_ID are required"); process.exit(1); }
const dir = ai.dataDir;
const chainFile = path.join(dir, "chain.json");
const from = Number(arg("--from") ?? process.env.PNL_FROM_HEIGHT ?? (fs.existsSync(chainFile) ? JSON.parse(fs.readFileSync(chainFile, "utf8")).from_height : NaN));
if (!Number.isInteger(from)) { console.error("pnl: no start height (--from, PNL_FROM_HEIGHT or chain.json)"); process.exit(1); }
const rate = ai.agents.billing.yoctoPerMicro;
const rpc = new Rpc(api.rpcUrls, { timeoutMs: 15000 });

const cacheFile = path.join(dir, "pnl-scan.json");
let cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : null;
if (cache && (cache.market !== api.marketId || cache.swarm !== ai.swarmId || cache.from !== from)) cache = null;
const t0 = Date.now();
const scan = await scanEvents({ rpc, market: api.marketId, swarm: ai.swarmId, usdc: api.usdcId, from, cache, log: (m) => process.stderr.write(`${m}\n`) });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(scan));

const chain = rebuild(scan.events, { market: api.marketId, swarm: ai.swarmId, rate });
const ledgerFile = path.join(dir, "ledger.jsonl");
const runner = fs.existsSync(ledgerFile) ? new Ledger({ journal: new Journal(ledgerFile) }).pnl() : {};
const claimIds = [...new Set([...Object.values(chain), ...Object.values(runner)].flatMap((r) => Object.keys(r.positions)).map(Number))];
const prices = await priceSnapshot({ rpc, market: api.marketId, claimIds });
const rows = compare(chain, runner, prices);
const state = await checkState({ rpc, market: api.marketId, swarm: ai.swarmId, rows: chain });

const usd = (m) => `${m < 0n ? "-" : ""}$${(Number(m < 0n ? -m : m) / 1e6).toFixed(6)}`;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scan: { from: scan.from, to: scan.to, events: scan.events.length }, rows, state }, (k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
} else {
  console.log(`scanned blocks ${scan.from}..${scan.to} (${scan.events.length} events, ${((Date.now() - t0) / 1000).toFixed(1)} s); escrow rate ${rate} yoctoNEAR per micro-USD`);
  for (const r of rows) {
    const c = r.chain;
    const st = state.find((s) => s.account === r.account);
    console.log(`\n${r.account}${c.owner ? `  (owner ${c.owner}, ${c.model})` : ""}`);
    console.log(`  trades ${c.trades}: cost ${usd(c.cost_micro)}, proceeds ${usd(c.proceeds_micro)}, redeemed ${usd(c.redeemed_micro)}`);
    console.log(`  inference: charged ${usd(c.charged_micro)} from the bankroll, swept ${c.swept_yocto} yoctoNEAR from escrow (= ${usd(c.swept_micro)}), ${c.bills} bill(s)`);
    console.log(`  held: ${JSON.stringify(Object.fromEntries(Object.entries(c.positions).map(([k, p]) => [k, { yes: String(p.yes), no: String(p.no) }])))}, marked ${usd(markMicro(c.positions, prices))}`);
    console.log(`  P&L ${usd(pnlMicro(c, prices))}`);
    console.log(`  ${r.ok ? "MATCH" : "MISMATCH"} runner ledger${r.ok ? ": every field equal to the micro-USDC and the yoctoNEAR" : `: ${r.diffs.join("; ")}`}`);
    if (st) console.log(`  ${st.ok ? "MATCH" : "MISMATCH"} chain state${st.ok ? ": balance, positions and escrow equal what the events add up to" : `: ${st.problems.join("; ")}`}`);
  }
}
const bad = rows.filter((r) => !r.ok).length + state.filter((s) => !s.ok).length;
console.log(`\n${bad ? `FAIL: ${bad} mismatch(es)` : `OK: ${rows.length} agent(s), chain events = runner ledger = chain state`}`);
process.exit(bad ? 1 : 0);
