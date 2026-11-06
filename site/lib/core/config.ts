// Copied unchanged from web/src/core/config.ts (the proven engine). Fix bugs there first, then copy.
// Site configuration, from the build environment (web/.env.example lists every value).
// Testnet unless NEAR_NETWORK=mainnet (or VITE_NEAR_NETWORK=mainnet) is set explicitly; the
// tests never set it. Anything that belongs to the other network is refused, so a testnet
// build can never sign for a mainnet account or talk to a mainnet RPC.

export type Network = "testnet" | "mainnet";

export interface Config {
  network: Network;
  /** services/api (services/ai mounts its routes on the same server) */
  apiBase: string;
  /** RPCs to race when the lane key answer carries none */
  rpcUrls: string[];
  /** the $1 the doubt button spends, in micro-USDC */
  doubtMicro: bigint;
  /** liquidity assumed for a claim whose view gives no way to infer it */
  defaultBMicro: bigint;
  /** gas per lane transaction, in TGas (the lane key answer's maxGasTgas wins) */
  gasTgas: number;
  /** how long "preparing your $1" may last before it is a failure */
  laneReadyTimeoutMs: number;
  /** a send that has not executed by then is an RPC stall */
  stallMs: number;
}

declare const __PRICEDIN_NETWORK__: string | undefined;

const DEFAULT_RPC: Record<Network, string[]> = {
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};

export class ConfigError extends Error {}

const list = (s: string | undefined) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);

/** Which network an account id or RPC URL belongs to, if it says. */
export function networkOf(s: string): Network | null {
  const t = s.trim().toLowerCase();
  // account ids: the suffix decides
  if (/\.testnet$/.test(t)) return "testnet";
  if (/\.near$/.test(t)) return "mainnet";
  // RPC URLs: the host decides
  let host = "";
  try { host = new URL(t).host; } catch { return null; }
  if (/testnet/.test(host) || /^test\.rpc\./.test(host)) return "testnet";
  if (/mainnet/.test(host) || /^(free\.)?rpc\.fastnear\.com$/.test(host) || /^rpc\.near\.org$/.test(host)) return "mainnet";
  return null;
}

/** Throws ConfigError when an id or URL belongs to the other network. */
export function assertNetwork(network: Network, ...things: (string | null | undefined)[]): void {
  for (const x of things) {
    if (!x) continue;
    const n = networkOf(x);
    if (n && n !== network) throw new ConfigError(`${x} belongs to ${n}, but this site runs on ${network}`);
  }
}

export function loadConfig(env: Record<string, string | undefined> = readEnv()): Config {
  const raw = (env.VITE_NEAR_NETWORK || env.NEAR_NETWORK || "testnet").trim();
  if (raw !== "testnet" && raw !== "mainnet") throw new ConfigError(`NEAR_NETWORK must be testnet or mainnet, got "${raw}"`);
  const network = raw as Network;
  const rpcUrls = list(env.VITE_RPC_URLS).length ? list(env.VITE_RPC_URLS) : DEFAULT_RPC[network];
  assertNetwork(network, ...rpcUrls);
  const apiBase = (env.VITE_API_BASE || "http://127.0.0.1:8787").replace(/\/+$/, "");
  return {
    network,
    apiBase,
    rpcUrls,
    doubtMicro: BigInt(env.VITE_DOUBT_MICRO || "1000000"),
    defaultBMicro: BigInt(env.VITE_DEFAULT_B_MICRO || "1000000"),
    gasTgas: Number(env.VITE_GAS_TGAS || 20),
    laneReadyTimeoutMs: Number(env.VITE_LANE_READY_TIMEOUT_MS || 15000),
    stallMs: Number(env.VITE_STALL_MS || 12000),
  };
}

function readEnv(): Record<string, string | undefined> {
  const e: Record<string, string | undefined> = { ...((import.meta as any).env || {}) };
  if (!e.VITE_NEAR_NETWORK && typeof __PRICEDIN_NETWORK__ !== "undefined") e.VITE_NEAR_NETWORK = __PRICEDIN_NETWORK__;
  return e;
}
