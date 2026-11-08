// Configuration from the environment. Every value has a safe default except the secrets.
// Mainnet is only reachable when NEAR_NETWORK=mainnet is set explicitly, and account IDs or
// RPC URLs that belong to the other network are refused at startup.

const DEFAULT_RPC = {
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};

const NEAR = 10n ** 24n;

// Circle's native USDC on NEAR mainnet: the x402 asset only when NEAR_NETWORK=mainnet.
export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

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
      // no claim_lane: a free bet's winnings stay in the market as score and never leave it
      methods: ["buy", "sell", "open_and_buy", "redeem"],
      allowanceYocto: laneAllowanceYocto,
      // the allowance is one $1 per browser key; this cap (per address, per /64 on IPv6) and the
      // total below are the abuse checks, sized so a venue's shared network can still play
      perIpPerDay: num("LANE_KEYS_PER_IP_PER_DAY", 10),
      perDay: num("LANE_KEYS_PER_DAY", 1000),
      // the last free bets wait for the judges: until LANE_RESERVE_UNTIL, a new free key is refused once
      // only LANE_RESERVE credits are left (off unless both are set; the contract's budget stays the hard limit)
      reserve: num("LANE_RESERVE", 0),
      reserveUntilMs: Date.parse((env.LANE_RESERVE_UNTIL || "").trim()) || 0,
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
    post: {
      // public oEmbed: no key, no login
      oembedUrl: (env.POST_OEMBED_URL || "https://publish.x.com/oembed").trim(),
      userAgent: (env.POST_USER_AGENT || "Mozilla/5.0 (compatible; PricedIn/1.0)").trim(),
      timeoutMs: num("POST_OEMBED_TIMEOUT_MS", 5000),
      retries: num("POST_OEMBED_RETRIES", 2),
      backoffMs: num("POST_OEMBED_BACKOFF_MS", 300),
      // a cached post is re-checked this often, so deletions are honoured within the hour
      recheckMs: num("POST_RECHECK_MS", 3_600_000),
      // new posts read (cache misses) per IP and in all per UTC day; views of cached posts are free
      perIpPerDay: num("POST_NEW_PER_IP_PER_DAY", 40),
      perDay: num("POST_NEW_PER_DAY", 3000),
      cacheMax: num("POST_CACHE_MAX", 5000),
      planTtlMs: num("POST_PLAN_TTL_MS", 7 * 86_400_000),
      // our own domains: a link with x.com changed to one of these reads as a post link
      selfHosts: list(env.POST_SELF_HOSTS || "isitpriced.in,pricedin.app"),
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
    // the truth API: GET /v1/credence
    credence: {
      freePerIpPerDay: num("CREDENCE_FREE_PER_IP_PER_DAY", 20),
      maxResults: Math.min(10, Math.max(1, num("CREDENCE_MAX_RESULTS", 3))),
      maxQueryChars: 600,
      rationalesPerClaim: 3,
      tradesPerClaim: 3,
      // JSON files holding signed rewrite records to serve as provenance (e.g. tools/judge/evidence/rewrite.json)
      rewriteEvidence: list(env.REWRITE_EVIDENCE_FILES),
    },
    // x402 payments beyond the free tier: $0.01 a call, in the network's USDC
    x402: {
      network: net,
      priceMicro: num("X402_PRICE_MICRO", 10_000),
      asset: (env.X402_ASSET || "").trim() || (env.USDC_CONTRACT_ID || "").trim() || (net === "mainnet" ? MAINNET_USDC : null),
      payTo: (env.X402_PAY_TO || "").trim() || null,
      maxTimeoutS: num("X402_MAX_TIMEOUT_S", 60),
      facilitatorUrl: (env.X402_FACILITATOR_URL || "").trim().replace(/\/+$/, "") || null,
      relayerId: (env.X402_RELAYER_ACCOUNT_ID || "").trim() || null,
      relayerKey: (env.X402_RELAYER_PRIVATE_KEY || "").trim() || null,
      // the RPC our facilitator reads and settles through (default: the first of RPC_URLS)
      rpcUrl: (env.X402_RPC_URL || "").trim() || null,
      // /health flags the relayer below this: a settlement burns about 0.0003 NEAR
      relayerMinNear: num("X402_RELAYER_MIN_NEAR", 0.02),
      // with a relayer held here, also serve the facilitator's own HTTP interface at /x402/*
      facilitatorRoutes: env.X402_FACILITATOR_ROUTES !== "0",
    },
  };

  // network guards: never let a testnet config touch mainnet or the reverse
  const wrongSuffix = net === "testnet" ? ".near" : ".testnet";
  for (const [name, id] of [["MARKET_CONTRACT_ID", config.marketId], ["USDC_CONTRACT_ID", config.usdcId], ["LANE_ACCOUNT_ID", config.lane.accountId], ["X402_PAY_TO", config.x402.payTo], ["X402_RELAYER_ACCOUNT_ID", config.x402.relayerId], ["X402_ASSET", config.x402.asset]]) {
    if (id && id.endsWith(wrongSuffix)) errors.push(`${name}=${id} looks like a ${net === "testnet" ? "mainnet" : "testnet"} account but NEAR_NETWORK=${net}`);
    if (id && !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)) errors.push(`${name}=${id} is not a valid NEAR account ID`);
  }
  for (const u of [...config.rpcUrls, ...config.publicRpcUrls, ...(config.x402.rpcUrl ? [config.x402.rpcUrl] : [])]) {
    let parsed;
    try { parsed = new URL(u); } catch { errors.push(`RPC URL is not a URL: ${u}`); continue; }
    if (!/^https?:$/.test(parsed.protocol)) errors.push(`RPC URL must be http(s): ${u}`);
    const h = parsed.host;
    if (net === "testnet" && /mainnet|free\.rpc\.fastnear|^rpc\.fastnear/.test(h)) errors.push(`RPC ${u} looks like mainnet but NEAR_NETWORK=testnet`);
    if (net === "mainnet" && /testnet|test\.rpc/.test(h)) errors.push(`RPC ${u} looks like testnet but NEAR_NETWORK=mainnet`);
  }
  try {
    if (!/^https?:$/.test(new URL(config.post.oembedUrl).protocol)) errors.push(`POST_OEMBED_URL must be http(s): ${config.post.oembedUrl}`);
  } catch { errors.push(`POST_OEMBED_URL is not a URL: ${config.post.oembedUrl}`); }
  if (config.post.timeoutMs < 100 || config.post.retries < 0 || config.post.retries > 5) errors.push("POST_OEMBED_TIMEOUT_MS must be at least 100 and POST_OEMBED_RETRIES 0..5");
  if (config.post.cacheMax < 1) errors.push("POST_CACHE_MAX must be at least 1");
  const x = config.x402;
  if (x.priceMicro < 1 || x.priceMicro > 1_000_000) errors.push("X402_PRICE_MICRO must be 1..1000000 (at most $1 a call)");
  if (x.maxTimeoutS < 10 || x.maxTimeoutS > 600) errors.push("X402_MAX_TIMEOUT_S must be 10..600");
  if (net === "testnet" && x.asset === MAINNET_USDC) errors.push("X402_ASSET is mainnet USDC but NEAR_NETWORK=testnet");
  if (x.relayerId && !x.relayerKey) warnings.push("X402_RELAYER_ACCOUNT_ID is set without X402_RELAYER_PRIVATE_KEY: no in-process facilitator");
  if (x.payTo && !x.relayerKey && !x.facilitatorUrl) warnings.push("X402_PAY_TO is set but no facilitator (X402_RELAYER_* or X402_FACILITATOR_URL): calls beyond the free tier get 429, not 402");
  if (x.facilitatorUrl) { try { if (!/^https?:$/.test(new URL(x.facilitatorUrl).protocol)) errors.push("X402_FACILITATOR_URL must be http(s)"); } catch { errors.push(`X402_FACILITATOR_URL is not a URL: ${x.facilitatorUrl}`); } }
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
    credence: { freePerIpPerDay: c.credence.freePerIpPerDay },
    x402: { network: `near:${c.x402.network}`, priceMicro: c.x402.priceMicro, asset: c.x402.asset, payTo: c.x402.payTo, facilitator: c.x402.relayerKey ? "in-process" : c.x402.facilitatorUrl || "none", relayer: c.x402.relayerId, relayerKey: c.x402.relayerKey ? "set" : "unset" },
  };
}
