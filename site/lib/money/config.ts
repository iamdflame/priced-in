// The accounts real money moves through, per network, from deployments/<network>.json. Public values
// only: no key is here. Nothing in the browser can sign for these accounts; the person's own wallet
// signs every transaction, and each one says in a plain sentence what it does before it is approved.
export type MoneyNetwork = "mainnet" | "testnet";

export interface MoneyConfig {
  network: MoneyNetwork;
  market: string;
  usdc: string;
  rpcUrls: string[];
  explorer: string;
  /** the 1Click asset id of the market's USDC ("" where 1Click has none) */
  usdcAsset: string;
}

const NETS: Record<MoneyNetwork, MoneyConfig> = {
  mainnet: {
    network: "mainnet",
    market: "market.isitpriced.near",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    rpcUrls: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
    explorer: "https://nearblocks.io",
    usdcAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  },
  testnet: {
    network: "testnet",
    market: "market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet",
    usdc: "tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet",
    rpcUrls: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
    explorer: "https://testnet.nearblocks.io",
    usdcAsset: "",
  },
};

export function moneyConfig(network = process.env.NEXT_PUBLIC_NEAR_NETWORK || "mainnet"): MoneyConfig {
  return NETS[network === "testnet" ? "testnet" : "mainnet"];
}

/** Gas per call, in TGas. Unused gas is refunded, so these are ceilings, not costs. */
export const GAS = { buy: 60n, sell: 60n, redeem: 30n, withdraw: 60n, depositCall: 80n, storage: 10n, transfer: 15n } as const;

/** NEP-145 registration on the USDC contract, in yoctoNEAR (0.00125 NEAR): needed once per receiving account. */
export const USDC_STORAGE_YOCTO = 1_250_000_000_000_000_000_000n;
export const ONE_YOCTO = 1n;

export const MICRO = 1_000_000n;
export const usdToMicro = (usd: number): bigint => (Number.isFinite(usd) && usd > 0 ? BigInt(Math.round(usd * 1e6)) : 0n);
export const microToUsd = (m: bigint | string | number): number => Number(BigInt(m)) / 1e6;
/** $1.81 from micro-USDC, rounded down to the cent: never promise more than the chain pays. */
export const fmtMicroDown = (m: bigint | string | number) => `$${(Math.floor(Number(BigInt(m)) / 1e4) / 100).toFixed(2)}`;
/** $1.81 from micro-USDC, to the nearest cent, for amounts already moved. */
export const fmtMicro = (m: bigint | string | number) => `$${(Number(BigInt(m)) / 1e6).toFixed(2)}`;
/** 1.81 shares from micro-shares. */
export const fmtShares = (m: bigint | string | number) => (Number(BigInt(m)) / 1e6).toFixed(2);
