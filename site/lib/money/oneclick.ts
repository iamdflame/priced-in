// NEAR Intents 1Click (https://docs.near-intents.org/integration/distribution-channels/1click-api):
// money in from another chain and out to another chain, through public endpoints only.
//  - GET  /v0/tokens   the assets it routes, with prices
//  - POST /v0/quote    a quote; dry:false also issues a one-time deposit address and a deadline
//  - GET  /v0/status   PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, SUCCESS, INCOMPLETE_DEPOSIT, REFUNDED, FAILED
//  - POST /v0/deposit/submit   optional: tells 1Click the deposit's tx hash, to speed it up
// No key is needed. 1Click's docs list a 25 bps fee on quotes without a partner JWT, yet keyless quotes
// measured on 6 Nov 2026 came back about 1 to 2 bps under the input, so the screens quote no fee rate:
// the quote's own amounts already include what is charged. ONECLICK_JWT (optional, server only) selects
// the partner schedule. The browser only talks to this site's /bridge routes, which build every request
// themselves from a few checked fields.

export const ONECLICK = "https://1click.chaindefuser.com/v0";

export type AddrKind = "evm" | "sol" | "btc" | "tron" | "near";

export interface BridgeRoute {
  /** "base:USDC" */
  key: string;
  chain: string;
  chainName: string;
  symbol: string;
  assetId: string;
  decimals: number;
  /** USD per unit, from 1Click */
  price: number | null;
  addr: AddrKind;
  /** can money come in from it, go out to it */
  in: boolean;
  out: boolean;
  /** a typical confirmation wait on the origin chain, for the deadline */
  slowMin: number;
}

/** The routes this site offers, by 1Click (blockchain, symbol). Anything 1Click stops listing drops out. */
export const CURATED: { chain: string; chainName: string; symbol: string; addr: AddrKind; in: boolean; out: boolean; slowMin: number; assetId?: string }[] = [
  { chain: "base", chainName: "Base", symbol: "USDC", addr: "evm", in: true, out: true, slowMin: 5 },
  { chain: "eth", chainName: "Ethereum", symbol: "USDC", addr: "evm", in: true, out: true, slowMin: 10 },
  { chain: "arb", chainName: "Arbitrum", symbol: "USDC", addr: "evm", in: true, out: true, slowMin: 5 },
  { chain: "sol", chainName: "Solana", symbol: "USDC", addr: "sol", in: true, out: true, slowMin: 5 },
  { chain: "eth", chainName: "Ethereum", symbol: "USDT", addr: "evm", in: true, out: true, slowMin: 10 },
  { chain: "tron", chainName: "Tron", symbol: "USDT", addr: "tron", in: true, out: true, slowMin: 10 },
  { chain: "sol", chainName: "Solana", symbol: "USDT", addr: "sol", in: true, out: true, slowMin: 5 },
  { chain: "base", chainName: "Base", symbol: "ETH", addr: "evm", in: true, out: false, slowMin: 5 },
  { chain: "eth", chainName: "Ethereum", symbol: "ETH", addr: "evm", in: true, out: false, slowMin: 10 },
  { chain: "arb", chainName: "Arbitrum", symbol: "ETH", addr: "evm", in: true, out: false, slowMin: 5 },
  { chain: "sol", chainName: "Solana", symbol: "SOL", addr: "sol", in: true, out: false, slowMin: 5 },
  { chain: "btc", chainName: "Bitcoin", symbol: "BTC", addr: "btc", in: true, out: false, slowMin: 90 },
  { chain: "near", chainName: "NEAR", symbol: "USDT", addr: "near", in: true, out: false, slowMin: 5, assetId: "nep141:usdt.tether-token.near" },
];

export interface TokenRow { assetId: string; decimals: number; blockchain: string; symbol: string; price?: number | null }

/** The curated routes that 1Click lists today, with their asset ids, decimals and prices. */
export function routesFrom(tokens: TokenRow[]): BridgeRoute[] {
  const out: BridgeRoute[] = [];
  for (const c of CURATED) {
    const t = tokens.find((x) => (c.assetId ? x.assetId === c.assetId : x.blockchain === c.chain && x.symbol === c.symbol && x.assetId.startsWith("nep141:")));
    if (!t) continue;
    out.push({ key: `${c.chain}:${c.symbol}`, chain: c.chain, chainName: c.chainName, symbol: c.symbol, assetId: t.assetId, decimals: t.decimals, price: typeof t.price === "number" ? t.price : null, addr: c.addr, in: c.in, out: c.out, slowMin: c.slowMin });
  }
  return out;
}

const ADDR: Record<AddrKind, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  btc: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  near: /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/,
};
export const validAddress = (kind: AddrKind, a: string) => ADDR[kind].test(a.trim()) && (kind !== "near" || (a.length >= 2 && a.length <= 64));
export const validNearAccount = (a: string) => validAddress("near", a);

export type BridgeStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export interface BridgeQuote {
  dir: "in" | "out";
  route: string;
  depositAddress: string | null;
  depositMemo: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  timeEstimate: number;
  /** the deadline this site asked for. 1Click's own answer runs days later, when refunds begin; the price is only promised to this one */
  sendBy: string;
  recipient: string;
  refundTo: string;
  /** a failed swap refunds inside NEAR Intents, to the NEAR account, not on the origin chain */
  refundsInIntents: boolean;
}

export interface BridgeStatusView {
  status: BridgeStatus;
  /** base units delivered, once known */
  amountOut: string | null;
  refundedFormatted: string | null;
  refundReason: string | null;
  destinationTx: string | null;
  nearTxs: string[];
}

/** What each 1Click status means, said plainly. */
export const STATUS_WORDS: Record<BridgeStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen, waiting for confirmations",
  PROCESSING: "Swapping and delivering",
  SUCCESS: "Delivered",
  INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived: it will be refunded",
  REFUNDED: "Refunded",
  FAILED: "It failed: anything sent is refunded",
};

export const bridgeDone = (s: BridgeStatus) => s === "SUCCESS" || s === "REFUNDED" || s === "FAILED";
