// Configuration from the environment. Every value has a safe default except the secrets.
// Mainnet is only reachable when NEAR_NETWORK=mainnet is set explicitly, and account IDs or
// RPC URLs that belong to the other network are refused at startup.

const DEFAULT_RPC = {
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};

const NEAR = 10n ** 24n;

const list = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const int = (v, d) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return Math.floor(n);
};

/** NEAR amount string ("0.25") to yocto bigint. */
export function nearToYocto(s) {
  const [w, f = ""] = String(s).trim().split(".");
  if (!/^\d+$/.test(w) || !/^\d*$/.test(f) || f.length > 24) throw new Error(`bad NEAR amount: ${s}`);
  return BigInt(w) * NEAR + BigInt((f + "0".repeat(24)).slice(0, 24));
}

/**
 * @returns {{ config: object, errors: string[], warnings: string[] }}
 */
export function loadConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const network = (env.NEAR_NETWORK || "testnet").trim();
  if (network !== "testnet" && network !== "mainnet") errors.push(`NEAR_NETWORK must be testnet or mainnet, got "${network}"`);
  const net = network === "mainnet" ? "mainnet" : "testnet";
  const rpcUrls = list(env.RPC_URLS).length ? list(env.RPC_URLS) : DEFAULT_RPC[net];

  let laneAllowanceYocto = 0n;
  try { laneAllowanceYocto = nearToYocto(env.LANE_ALLOWANCE_NEAR || "0.25"); } catch (e) { errors.push(`LANE_ALLOWANCE_NEAR: ${e.message}`); }

  const num = (name, d) => {
    try { return int(env[name], d); } catch (e) { errors.push(`${name}: ${e.message}`); return d; }
  };

  const config = {
    network: net,
    host: env.HOST || "0.0.0.0",
    port: num("PORT", 8787),
    corsOrigins: list(env.CORS_ORIGINS || "*"),
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    rpcUrls,
    publicRpcUrls: list(env.PUBLIC_RPC_URLS).length ? list(env.PUBLIC_RPC_URLS) : rpcUrls,
    rpcTimeoutMs: num("RPC_TIMEOUT_MS", 5000),
    marketId: (env.MARKET_CONTRACT_ID || "").trim() || null,
    usdcId: (env.USDC_CONTRACT_ID || "").trim() || null,
    lane: {
      accountId: (env.LANE_ACCOUNT_ID || "").trim() || null,
      privateKey: (env.LANE_PRIVATE_KEY || "").trim() || null,
      methods: ["buy", "sell", "open_and_buy", "redeem"],
      allowanceYocto: laneAllowanceYocto,
      perIpPerDay: num("LANE_KEYS_PER_IP_PER_DAY", 3),
      perDay: num("LANE_KEYS_PER_DAY", 1000),
      batchMax: num("LANE_BATCH_MAX", 10),
      issueDeadlineMs: num("LANE_ISSUE_DEADLINE_MS", 12000),
      // the budget check may use market stats this old (the contract is the hard limit)
      statsMaxStaleMs: num("LANE_STATS_MAX_STALE_MS", 10000),
      minBalanceNear: Number(env.LANE_MIN_BALANCE_NEAR || "1"),
    },
    planner: {
      apiKey: (env.NEARAI_API_KEY || "").trim() || null,
      baseUrl: (env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/+$/, ""),
      model: (env.PLANNER_MODEL || "").trim() || null,
      privateKey: (env.PLANNER_PRIVATE_KEY || "").trim() || null,
      bMicro: num("PLANNER_B_MICRO", 1_000_000),
      timeoutMs: num("PLANNER_TIMEOUT_MS", 12000),
    },
    paste: {
      perIpPerDay: num("PASTE_PER_IP_PER_DAY", 60),
      maxInputChars: num("PASTE_MAX_INPUT_CHARS", 20000),
      maxSentences: 12,
      maxSentenceBytes: 600,
    },
    scan: {
      intervalMs: num("SCAN_INTERVAL_MS", 400),
      finality: env.SCAN_FINALITY || "optimistic",
      maxCatchupBlocks: num("SCAN_MAX_CATCHUP_BLOCKS", 120),
      backfillBlocks: num("SCAN_BACKFILL_BLOCKS", 0),
    },
    events: { ringSize: num("EVENTS_RING_SIZE", 200), maxClients: num("SSE_MAX_CLIENTS", 1000) },
    health: {
      maxScanAgeS: num("HEALTH_MAX_SCAN_AGE_S", 30),
      maxEventAgeS: num("HEALTH_MAX_EVENT_AGE_S", 0), // 0 = report the age, don't assert it
    },
    claimsTtlMs: num("CLAIMS_TTL_MS", 1000),
  };

  // network guards: never let a testnet config touch mainnet or the reverse
  const wrongSuffix = net === "testnet" ? ".near" : ".testnet";
  for (const [name, id] of [["MARKET_CONTRACT_ID", config.marketId], ["USDC_CONTRACT_ID", config.usdcId], ["LANE_ACCOUNT_ID", config.lane.accountId]]) {
    if (id && id.endsWith(wrongSuffix)) errors.push(`${name}=${id} looks like a ${net === "testnet" ? "mainnet" : "testnet"} account but NEAR_NETWORK=${net}`);
    if (id && !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)) errors.push(`${name}=${id} is not a valid NEAR account ID`);
  }
  for (const u of [...config.rpcUrls, ...config.publicRpcUrls]) {
    let parsed;
    try { parsed = new URL(u); } catch { errors.push(`RPC URL is not a URL: ${u}`); continue; }
    if (!/^https?:$/.test(parsed.protocol)) errors.push(`RPC URL must be http(s): ${u}`);
    const h = parsed.host;
    if (net === "testnet" && /mainnet|free\.rpc\.fastnear|^rpc\.fastnear/.test(h)) errors.push(`RPC ${u} looks like mainnet but NEAR_NETWORK=testnet`);
    if (net === "mainnet" && /testnet|test\.rpc/.test(h)) errors.push(`RPC ${u} looks like testnet but NEAR_NETWORK=mainnet`);
  }
  if (config.lane.allowanceYocto > NEAR) errors.push("LANE_ALLOWANCE_NEAR above 1 NEAR is refused");
  if (config.planner.bMicro < 100_000 || config.planner.bMicro > 100_000_000) errors.push("PLANNER_B_MICRO must be 100000..100000000 (the contract's $0.10..$100)");
  if (!config.marketId) warnings.push("MARKET_CONTRACT_ID is not set: claims, events and the lane are off, and /health reports 503");
  if (config.lane.accountId && !config.lane.privateKey) warnings.push("LANE_ACCOUNT_ID is set without LANE_PRIVATE_KEY: the lane is off");
  if (config.planner.apiKey && (!config.planner.model || !config.planner.privateKey)) warnings.push("NEARAI_API_KEY is set but PLANNER_MODEL or PLANNER_PRIVATE_KEY is missing: /paste answers planner \"unavailable\"");
  return { config, errors, warnings };
}

/** A printable summary with every secret replaced by set/unset. */
export function describeConfig(c) {
  return {
    network: c.network,
    listen: `${c.host}:${c.port}`,
    rpcUrls: c.rpcUrls,
    marketId: c.marketId,
    usdcId: c.usdcId,
    lane: { accountId: c.lane.accountId, privateKey: c.lane.privateKey ? "set" : "unset", perIpPerDay: c.lane.perIpPerDay, perDay: c.lane.perDay },
    planner: { nearaiApiKey: c.planner.apiKey ? "set" : "unset", model: c.planner.model, privateKey: c.planner.privateKey ? "set" : "unset", bMicro: c.planner.bMicro },
  };
}
