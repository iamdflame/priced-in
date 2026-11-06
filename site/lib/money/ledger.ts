"use client";
// What this browser did with a wallet, kept in localStorage: each transaction with its hash (so the
// portfolio's history has tx links the moment a trade lands, before the indexer has it), and each 1Click
// deposit or withdrawal in flight (so a reload, or coming back tomorrow, picks the tracking up again).
import type { BridgeQuote } from "./oneclick";

export type TxKind = "deposit" | "buy" | "sell" | "collect" | "withdraw" | "bridge_in" | "bridge_out" | "storage";

export interface TxRecord {
  kind: TxKind;
  hash: string | null;
  at: number;
  amountMicro: string | null;
  claimId?: number;
  side?: "yes" | "no";
  sharesMicro?: string;
  question?: string;
  note?: string;
}

export interface PendingBridge { quote: BridgeQuote; at: number; account: string; sentTx?: string | null; done?: string | null }

const TX_KEY = (a: string) => `pricedin.wallet.tx.${a}`;
const BR_KEY = (a: string) => `pricedin.wallet.bridge.${a}`;
const EVT = "pi:ledger";

function read<T>(k: string): T[] {
  try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; }
}
function write<T>(k: string, v: T[]) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: this visit still works */ }
  try { window.dispatchEvent(new Event(EVT)); } catch { /* no window */ }
}

export const txLog = (account: string) => read<TxRecord>(TX_KEY(account));
export function logTx(account: string, r: TxRecord) {
  const list = txLog(account).filter((x) => !(r.hash && x.hash === r.hash && x.kind === r.kind));
  write(TX_KEY(account), [r, ...list].slice(0, 100));
}

export const pendingBridges = (account: string) => read<PendingBridge>(BR_KEY(account));
export function savePendingBridge(p: PendingBridge) {
  const list = pendingBridges(p.account).filter((x) => x.quote.depositAddress !== p.quote.depositAddress);
  write(BR_KEY(p.account), [p, ...list].slice(0, 20));
}
export function updatePendingBridge(account: string, depositAddress: string, patch: Partial<PendingBridge>) {
  write(BR_KEY(account), pendingBridges(account).map((x) => (x.quote.depositAddress === depositAddress ? { ...x, ...patch } : x)));
}
export function dropPendingBridge(account: string, depositAddress: string) {
  write(BR_KEY(account), pendingBridges(account).filter((x) => x.quote.depositAddress !== depositAddress));
}

export function onLedger(fn: () => void) {
  const h = () => fn();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
}
