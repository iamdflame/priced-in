"use client";
// React bridges for real money: the wallet, the visitor's region (from the geofence cookie), the
// connected account's balances (polled from the chain while the tab is visible), and the open sheet.
import { useEffect, useSyncExternalStore } from "react";
import { moneyChain } from "./chain";
import { decodeGeo, GEO_COOKIE, type Access } from "./geo";
import { wallet, type WalletState } from "./wallet";

// ---------- the wallet ----------

const SERVER_WALLET: WalletState = { status: "idle", accountId: null, walletName: null, options: [], error: null };

export function useWallet(): WalletState {
  const w = wallet();
  useEffect(() => { w.boot(); }, [w]);
  return useSyncExternalStore(w.subscribe, () => w.st, () => SERVER_WALLET);
}

// ---------- the region ----------

export interface Geo { access: Access; country: string | null; known: boolean }
const GEO_UNKNOWN: Geo = { access: "unknown", country: null, known: false };
let geoCache: { raw: string; geo: Geo } | null = null;

function readGeo(): Geo {
  if (typeof document === "undefined") return GEO_UNKNOWN;
  const raw = document.cookie.split("; ").find((x) => x.startsWith(`${GEO_COOKIE}=`))?.slice(GEO_COOKIE.length + 1) ?? "";
  if (geoCache?.raw === raw) return geoCache.geo;
  const d = decodeGeo(decodeURIComponent(raw));
  geoCache = { raw, geo: { ...d, known: d.access !== "unknown" } };
  return geoCache.geo;
}

export function useGeo(): Geo {
  return useSyncExternalStore(() => () => {}, readGeo, () => GEO_UNKNOWN);
}

// ---------- the account ----------

export interface AccountState {
  accountId: string | null;
  /** the Priced In balance, micro-USDC */
  balanceMicro: bigint | null;
  /** USDC in the wallet itself, micro-USDC */
  usdcMicro: bigint | null;
  canReceiveUsdc: boolean | null;
  loading: boolean;
  error: string | null;
  at: number;
}

const EMPTY: AccountState = { accountId: null, balanceMicro: null, usdcMicro: null, canReceiveUsdc: null, loading: false, error: null, at: 0 };
let acct: AccountState = EMPTY;
const acctListeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setAcct(p: Partial<AccountState>) { acct = { ...acct, ...p }; for (const f of acctListeners) f(); }

/** Read the account's balances again (after every transaction, and every 15 s while visible). */
export function refreshAccount(accountId = acct.accountId): Promise<void> {
  if (!accountId) return Promise.resolve();
  if (acct.accountId !== accountId) setAcct({ ...EMPTY, accountId, loading: true });
  if (inflight) return inflight;
  const c = moneyChain();
  inflight = Promise.allSettled([c.balance(accountId), c.usdcBalance(accountId), c.canReceiveUsdc(accountId)]).then(([b, u, s]) => {
    if (acct.accountId !== accountId) return;
    setAcct({
      balanceMicro: b.status === "fulfilled" ? b.value : acct.balanceMicro,
      usdcMicro: u.status === "fulfilled" ? u.value : acct.usdcMicro,
      canReceiveUsdc: s.status === "fulfilled" ? s.value : acct.canReceiveUsdc,
      loading: false,
      error: b.status === "rejected" ? "We couldn’t read your balance from NEAR just now." : null,
      at: Date.now(),
    });
  }).finally(() => { inflight = null; });
  return inflight;
}

export function useAccount(accountId: string | null): AccountState {
  useEffect(() => {
    if (!accountId) { setAcct(EMPTY); return; }
    void refreshAccount(accountId);
    const t = setInterval(() => { if (!document.hidden) void refreshAccount(accountId); }, 15_000);
    const vis = () => { if (!document.hidden) void refreshAccount(accountId); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [accountId]);
  return useSyncExternalStore((f) => { acctListeners.add(f); return () => { acctListeners.delete(f); }; }, () => acct, () => EMPTY);
}

// ---------- the sheet ----------

export type SheetReq =
  | { kind: "connect"; then?: SheetReq | null }
  | { kind: "deposit"; tab?: "near" | "chain" }
  | { kind: "withdraw"; tab?: "near" | "chain" }
  | { kind: "trade"; claimId: number; question: string; mode: "buy" | "sell"; side?: "yes" | "no" }
  | { kind: "collect"; claimId: number; question: string; winMicro: string }
  | { kind: "challenge"; claimId: number; question: string; receipt?: { says: "false" | "true"; url: string; quote: string; note: string } };

let sheet: SheetReq | null = null;
const sheetListeners = new Set<() => void>();
export function openSheet(s: SheetReq | null) { sheet = s; for (const f of sheetListeners) f(); }
export const closeSheet = () => openSheet(null);
export function useSheet(): SheetReq | null {
  return useSyncExternalStore((f) => { sheetListeners.add(f); return () => { sheetListeners.delete(f); }; }, () => sheet, () => null);
}
