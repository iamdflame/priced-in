// The project's environment on Vercel, from the local files. Secrets go in as encrypted
// variables and are never printed: this script prints names only.
//   node scripts/vercel/secrets.mjs              set every variable on the pricedin project (production and preview), for
//                                                mainnet: the project serves the live mainnet site, so mainnet is the default
//   node scripts/vercel/secrets.mjs --dry        list the names it would set
//   node scripts/vercel/secrets.mjs --local <f>  write the same variables to a local env file (for a local harness; keep it outside the repo)
//   node scripts/vercel/secrets.mjs --network mainnet   the same, said out loud (deployments/mainnet.json,
//                                                       keys from .apex-test/mainnet/, written by scripts/mainnet/keys.mjs and fund.mjs)
//   node scripts/vercel/secrets.mjs --network testnet --switch-network   the testnet values (deployments/testnet.json); a project
//                                                       that serves mainnet refuses them without --switch-network, because they
//                                                       take the live site down (8 Nov: a run without --network did exactly that)
// Sources: .env (NEARAI_API_KEY2, the $20 key for the live site), .apex-test/vercel/ (scripts/vercel/keys.mjs),
// .apex-test/judge-planner.json (the deployment's test planner key), deployments/testnet.json (public ids).
// Mainnet is the same code with other values: NEAR_NETWORK=mainnet, mainnet ids, keys and RPCs, no swarm
// (it stays on testnet), caps sized to the real money each house agent holds, and the truth API's X402_*
// values once scripts/mainnet/x402.mjs has made the relayer (deployments/mainnet.json and its key file).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, dotEnv, vercelApi, projectId, x402Env } from "./env.mjs";

const local = dotEnv();
const ni = process.argv.indexOf("--network");
const NET = ni > 0 ? process.argv[ni + 1] : "mainnet";
if (NET !== "testnet" && NET !== "mainnet") throw new Error("--network is testnet or mainnet");
const MAIN = NET === "mainnet";
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `deployments/${NET}.json`), "utf8"));
if (dep.network !== NET) throw new Error(`deployments/${NET}.json is not a ${NET} deployment`);
const V = path.join(ROOT, MAIN ? ".apex-test/mainnet" : ".apex-test/vercel");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
// measured on 2026-11-05 with a real get_claims: mainnet dRPC 197 ms, FastNEAR 232 ms, free FastNEAR 236 ms,
// intea 1.7 s (Lava's mainnet endpoint is discontinued)
const RPCS = MAIN ? "https://near.drpc.org,https://rpc.fastnear.com,https://free.rpc.fastnear.com,https://rpc.intea.rs" : "https://near-testnet.drpc.org,https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs";
const BROWSER_RPCS = MAIN ? "https://near.drpc.org,https://rpc.fastnear.com,https://free.rpc.fastnear.com" : "https://near-testnet.drpc.org,https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com";

const keystore = {};
for (const f of fs.readdirSync(path.join(V, "keystore"))) if (f.endsWith(".json")) keystore[f] = read(path.join(V, "keystore", f));
const bundle = Buffer.from(JSON.stringify({ keystore, signerKeys: read(path.join(V, "signer-keys.json")) })).toString("base64");
const jury = read(path.join(V, "jury-key.json"));
const lane = read(path.join(V, "lane-key.json"));
const planner = read(MAIN ? path.join(V, "planner.json") : path.join(ROOT, ".apex-test/judge-planner.json"));
if (!local.NEARAI_API_KEY2) throw new Error("NEARAI_API_KEY2 is not set in .env");
const relayerFile = path.join(V, "x402-relayer-key.json");
const x402 = x402Env(dep, MAIN && fs.existsSync(relayerFile) ? read(relayerFile) : null);
if (MAIN && !x402.secret.X402_RELAYER_PRIVATE_KEY) console.log("no x402 relayer yet (node scripts/mainnet/x402.mjs --plan): the truth API stays on its free tier");

const plain = {
  NEAR_NETWORK: NET,
  MARKET_CONTRACT_ID: dep.accounts.market,
  USDC_CONTRACT_ID: dep.accounts.usdc,
  SWARM_CONTRACT_ID: dep.accounts.swarm || "", // "" removes it: no swarm on mainnet
  HOUSE_OWNER_IDS: dep.root,
  RPC_URLS: RPCS,
  PUBLIC_RPC_URLS: BROWSER_RPCS,
  LANE_ACCOUNT_ID: dep.accounts.lane,
  PLANNER_MODEL: "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  WRITER_MODEL: dep.keys.writer_model || "z-ai/glm-5.3-flash",
  JURY_ACCOUNT_ID: jury.accountId,
  NEARAI_DAILY_CAP_USD: "1",
  AGENT_BILLING: "none",
  AGENT_WEB_SEARCH: "0",
  TRUST_PROXY: "1",
  CORS_ORIGINS: "*",
  POST_SELF_HOSTS: "isitpriced.com,www.isitpriced.com",
  // the cron calls the jury at this project's own address, whichever project serves the domain
  SELF_URL: "https://pricedin-fawn.vercel.app",
  // the browser build
  VITE_NEAR_NETWORK: NET,
  VITE_API_BASE: "/api",
  VITE_LIVE: "poll",
  VITE_RPC_URLS: BROWSER_RPCS,
};
if (MAIN) Object.assign(plain, {
  // each house agent holds $2.50 of real USDC: at most $0.75 of bets a day, $1 of losses
  SIGNER_DAILY_SPEND_MICRO: "750000",
  AGENT_DAILY_LOSS_USD: "1",
  // the market's taker fee (v3): an agent's edge must beat it; before the upgrade this only asks a little more edge
  AGENT_FEE_POINTS: "0.01",
  // small bets, so the daily cap reaches the whole catalog: at $0.75 a day, 6 or 7 bets each instead of 2
  AGENT_MAX_BET_USD: "0.12",
  // the AI jury sits once a day at 15:00 UTC, on the doubted fact with the most bets; a fact with none waits
  CHECKER_PER_DAY: "1",
  CHECKER_SITTING_HOUR_UTC: "15",
  CHECKER_MIN_BETS: "1",
  // the corpus's last two caught lines go on trial before the 14 November freeze, so the judged repo and the
  // week's posts carry their rulings: Wikipedia sittings resume on 12 and 13 November at 15:00 UTC (news lines
  // still go to the jury as they come due, through judging week)
  CHECKER_FROM: "2026-11-12T00:00:00Z",
  // the lane account holds 1 NEAR for the visitors' gas and key storage; below 0.3 spare, /lane/key refuses new keys
  LANE_MIN_BALANCE_NEAR: "0.3",
  // the free $1 is real USDC from a treasury that holds about a dozen of them through judging: at the code's
  // defaults (10 per address, 1,000 a day) one visitor clearing cookies, or one script, could take them all in a
  // minute and leave the seven judges none. 2 per address a day still lets a judge retry on a second browser,
  // and 8 a day spreads the rest over the judging days. Both limits hold across function instances
  // (LIMITED in api/index.mjs) as well as in each instance (services/api/src/app.mjs laneKey)
  LANE_KEYS_PER_IP_PER_DAY: "2",
  LANE_KEYS_PER_DAY: "8",
  // the last 4 free bets wait for the judges: the AI screen and judging start once submissions close on
  // 14 November, so from 15 November 00:00 UTC every credit is open to anyone again
  LANE_RESERVE: "4",
  LANE_RESERVE_UNTIL: "2026-11-15T00:00:00Z",
  // news lines, when they are on (NEWS_ENABLED below): at most 4 a day, each with $0.50 of liquidity, so the
  // money already in the treasury carries them: each reserves about $0.35 to $0.80, by its opening price.
  // Most of their traffic is free picks, which move no price; raise this once the treasury can carry more
  NEWS_PER_DAY: "4",
  NEWS_B_MICRO: "500000",
}, x402.plain);
// Today's claims (api/news.mjs, /api/today, picks, reports, the leaderboard) stay off unless this is
// "1". Unset by default: the script leaves it alone. To turn it on, put NEWS_ENABLED=1 in .env and run
// this script; NEWS_ENABLED=0 there removes it again.
if (local.NEWS_ENABLED !== undefined) plain.NEWS_ENABLED = local.NEWS_ENABLED === "1" ? "1" : "";
// The official pages (api/_lib/pages.mjs) work the same way: OFFICIAL_PAGES=1 in .env and this script
// turn them on, OFFICIAL_PAGES=0 there removes them. The site reads the API, so it follows on its own.
if (local.OFFICIAL_PAGES !== undefined) plain.OFFICIAL_PAGES = local.OFFICIAL_PAGES === "1" ? "1" : "";
// The store (api/_lib/store.mjs): STATE_STORE=postgres in .env, with SUPABASE_DB_URL (Supabase's transaction pooler,
// port 6543), moves the API's state to Postgres once scripts/vercel/pg-migrate.mjs has copied it there. STATE_STORE=blob
// goes back to the Blob store at the next deploy; the URL stays, encrypted, for the next try.
if (local.STATE_STORE !== undefined) plain.STATE_STORE = local.STATE_STORE === "postgres" ? "postgres" : "";
const secret = {
  NEARAI_API_KEY: local.NEARAI_API_KEY2,
  LANE_PRIVATE_KEY: lane.privateKey,
  PLANNER_PRIVATE_KEY: planner.seed_hex,
  JURY_PRIVATE_KEY: jury.privateKey,
  PRICEDIN_KEYSTORE: bundle,
  CRON_SECRET: null, // made below, once
  ...x402.secret,
};
// encrypted, as every key is: the database password is in it
if (local.SUPABASE_DB_URL) secret.SUPABASE_DB_URL = local.SUPABASE_DB_URL;

const i = process.argv.indexOf("--local");
if (i > 0) {
  const out = process.argv[i + 1];
  if (!out || path.resolve(out).startsWith(ROOT)) throw new Error("--local needs a file outside the repo");
  secret.CRON_SECRET = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(out, Object.entries({ ...plain, ...secret }).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  console.log(`wrote ${Object.keys({ ...plain, ...secret }).length} variables to ${out}: ${Object.keys({ ...plain, ...secret }).join(", ")}`);
  process.exit(0);
}

const v = vercelApi(local);
const pid = await projectId(v);
const existing = (await v.call("GET", `/v10/projects/${pid}/env?decrypt=false`)).envs || [];
const has = (k) => existing.find((e) => e.key === k);
// the live site is mainnet: testnet values over it break every route, so moving away from mainnet must be asked for
const liveNet = existing.find((e) => e.key === "NEAR_NETWORK" && e.type === "plain")?.value;
if (liveNet === "mainnet" && NET !== "mainnet" && !process.argv.includes("--switch-network")) {
  console.error(`refusing: the project serves mainnet, and these ${NET} values would take the live site down. Run with --network mainnet, or add --switch-network if you really mean ${NET}.`);
  process.exit(1);
}
console.log(`network: ${NET}`);
if (!has("CRON_SECRET")) secret.CRON_SECRET = crypto.randomBytes(24).toString("hex");
else delete secret.CRON_SECRET;
const dry = process.argv.includes("--dry");
for (const [kind, map] of [["plain", plain], ["encrypted", secret]]) {
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined || value === null) continue;
    if (value === "") {
      const cur = has(key);
      if (dry) { console.log(`would remove ${key}`); continue; }
      if (cur) { await v.call("DELETE", `/v9/projects/${pid}/env/${cur.id}`); console.log(`removed ${key}`); }
      continue;
    }
    if (dry) { console.log(`would set ${key} (${kind})`); continue; }
    const body = { key, value: String(value), type: kind, target: ["production", "preview"] };
    const cur = has(key);
    if (cur) await v.call("PATCH", `/v9/projects/${pid}/env/${cur.id}`, { value: String(value), type: kind, target: ["production", "preview"] });
    else await v.call("POST", `/v10/projects/${pid}/env`, body);
    console.log(`${cur ? "updated" : "set"} ${key} (${kind})`);
  }
}
