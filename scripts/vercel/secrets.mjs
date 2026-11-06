// The project's environment on Vercel, from the local files. Secrets go in as encrypted
// variables and are never printed: this script prints names only.
//   node scripts/vercel/secrets.mjs              set every variable on the pricedin project (production and preview)
//   node scripts/vercel/secrets.mjs --dry        list the names it would set
//   node scripts/vercel/secrets.mjs --local <f>  write the same variables to a local env file (for a local harness; keep it outside the repo)
//   node scripts/vercel/secrets.mjs --network mainnet   the same for the mainnet deployment (deployments/mainnet.json,
//                                                       keys from .apex-test/mainnet/, written by scripts/mainnet/keys.mjs and fund.mjs)
// Sources: .env (NEARAI_API_KEY2, the $20 key for the live site), .apex-test/vercel/ (scripts/vercel/keys.mjs),
// .apex-test/judge-planner.json (the deployment's test planner key), deployments/testnet.json (public ids).
// Mainnet is the same code with other values: NEAR_NETWORK=mainnet, mainnet ids, keys and RPCs, no swarm
// (it stays on testnet), and caps sized to the real money each house agent holds.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, dotEnv, vercelApi, projectId } from "./env.mjs";

const local = dotEnv();
const ni = process.argv.indexOf("--network");
const NET = ni > 0 ? process.argv[ni + 1] : "testnet";
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
  // the lane account holds 1 NEAR for the visitors' gas and key storage
  LANE_MIN_BALANCE_NEAR: "0.3",
});
const secret = {
  NEARAI_API_KEY: local.NEARAI_API_KEY2,
  LANE_PRIVATE_KEY: lane.privateKey,
  PLANNER_PRIVATE_KEY: planner.seed_hex,
  JURY_PRIVATE_KEY: jury.privateKey,
  PRICEDIN_KEYSTORE: bundle,
  CRON_SECRET: null, // made below, once
};

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
