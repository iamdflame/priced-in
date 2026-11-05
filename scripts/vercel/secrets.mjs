// The project's environment on Vercel, from the local files. Secrets go in as encrypted
// variables and are never printed: this script prints names only.
//   node scripts/vercel/secrets.mjs              set every variable on the pricedin project (production and preview)
//   node scripts/vercel/secrets.mjs --dry        list the names it would set
//   node scripts/vercel/secrets.mjs --local <f>  write the same variables to a local env file (for a local harness; keep it outside the repo)
// Sources: .env (NEARAI_API_KEY2, the $20 key for the live site), .apex-test/vercel/ (scripts/vercel/keys.mjs),
// .apex-test/judge-planner.json (the deployment's test planner key), deployments/testnet.json (public ids).
// Mainnet is configured later, by environment only: NEAR_NETWORK=mainnet with mainnet ids and keys.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, dotEnv, vercelApi, projectId } from "./env.mjs";

const local = dotEnv();
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet") throw new Error("this stream configures testnet only");
const V = path.join(ROOT, ".apex-test/vercel");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const RPCS = "https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs";
const BROWSER_RPCS = "https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://testnet-rpc.intea.rs";

const keystore = {};
for (const f of fs.readdirSync(path.join(V, "keystore"))) if (f.endsWith(".json")) keystore[f] = read(path.join(V, "keystore", f));
const bundle = Buffer.from(JSON.stringify({ keystore, signerKeys: read(path.join(V, "signer-keys.json")) })).toString("base64");
const jury = read(path.join(V, "jury-key.json"));
const lane = read(path.join(V, "lane-key.json"));
const planner = read(path.join(ROOT, ".apex-test/judge-planner.json"));
if (!local.NEARAI_API_KEY2) throw new Error("NEARAI_API_KEY2 is not set in .env");

const plain = {
  NEAR_NETWORK: "testnet",
  MARKET_CONTRACT_ID: dep.accounts.market,
  USDC_CONTRACT_ID: dep.accounts.usdc,
  SWARM_CONTRACT_ID: dep.accounts.swarm,
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
  // the browser build
  VITE_NEAR_NETWORK: "testnet",
  VITE_API_BASE: "/api",
  VITE_LIVE: "poll",
  VITE_RPC_URLS: BROWSER_RPCS,
};
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
    if (dry) { console.log(`would set ${key} (${kind})`); continue; }
    const body = { key, value: String(value), type: kind, target: ["production", "preview"] };
    const cur = has(key);
    if (cur) await v.call("PATCH", `/v9/projects/${pid}/env/${cur.id}`, { value: String(value), type: kind, target: ["production", "preview"] });
    else await v.call("POST", `/v10/projects/${pid}/env`, body);
    console.log(`${cur ? "updated" : "set"} ${key} (${kind})`);
  }
}
