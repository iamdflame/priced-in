#!/usr/bin/env node
// pricedin-mcp: Priced In for any MCP client. stdio by default; --http [--port N] [--host H]
// serves streamable HTTP at /mcp. Settings come from the environment of whoever runs it:
//   PRICEDIN_API_URL   the Priced In API (default https://isitpriced.com)
//   NEAR_NETWORK       mainnet with the hosted API; testnet by default with an API of your own
//   NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY   your own key: pays x402 beyond the free tier, signs bets
//   PRICEDIN_MAX_BET_USD (1 on mainnet, 5 on testnet), PRICEDIN_MAX_PAY_USD (0.05), PRICEDIN_PAY=0 to never pay
import { McpServer } from "../src/protocol.mjs";
import { makeTools } from "../src/tools.mjs";
import { serveStdio, serveHttp } from "../src/transports.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
if (flag("--help") || flag("-h")) {
  process.stdout.write("pricedin-mcp [--http [--port 8788] [--host 127.0.0.1]]\nTools: ask, get_claim, quote, bet. Settings: https://www.npmjs.com/package/pricedin-mcp\n");
  process.exit(0);
}
const log = (m) => process.stderr.write(`${m}\n`);
const make = () => {
  const t = makeTools({ env: process.env });
  return new McpServer({ tools: t.tools, log });
};
const s = makeTools({ env: process.env }).settings;
if (s.errors.length) log(`pricedin-mcp: configuration refused: ${s.errors.join("; ")}`);
log(`pricedin-mcp: API ${s.apiUrl}, ${s.network}, ${s.accountId ? `key of ${s.accountId}` : "no NEAR key (ask and quote work; bet is refused; paid calls are not made)"}`);
if (flag("--http")) {
  const h = await serveHttp(make, { port: Number(opt("--port", process.env.PORT || 8788)), host: opt("--host", "127.0.0.1"), log });
  const stop = async () => { await h.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  const st = serveStdio(make, { log });
  await st.done;
}
