"use client";
// Hand transactions to the wallet and keep their state: waiting for the wallet, done with each hash, or
// failed with the reason in plain words. Each landed transaction goes into this browser's ledger, and
// the balances are read again from the chain.
import { useCallback, useState } from "react";
import { refreshAccount } from "@/lib/money/hooks";
import { logTx, type TxRecord } from "@/lib/money/ledger";
import type { TxResult } from "@/lib/money/chain";
import type { TxSpec } from "@/lib/money/tx";
import { wallet, walletError } from "@/lib/money/wallet";

export type SendState =
  | { phase: "idle" }
  | { phase: "wallet"; step: number; of: number }
  | { phase: "done"; results: TxResult[]; ms: number }
  | { phase: "failed"; error: string; results: TxResult[] };

export function useSend() {
  const [st, setSt] = useState<SendState>({ phase: "idle" });
  const run = useCallback(async (txs: TxSpec[], record?: (r: TxResult[]) => TxRecord[]): Promise<TxResult[] | null> => {
    const account = wallet().st.accountId;
    if (!account) { setSt({ phase: "failed", error: "Connect a wallet first.", results: [] }); return null; }
    const t0 = performance.now();
    setSt({ phase: "wallet", step: 1, of: txs.length });
    let results: TxResult[];
    try {
      results = await wallet().send(txs);
    } catch (e) {
      setSt({ phase: "failed", error: walletError(e), results: [] });
      return null;
    }
    for (const rec of record?.(results) ?? []) logTx(account, rec);
    void refreshAccount(account);
    const bad = results.find((r) => !r.ok);
    if (bad) { setSt({ phase: "failed", error: bad.error ?? "The transaction failed on NEAR.", results }); return results; }
    setSt({ phase: "done", results, ms: performance.now() - t0 });
    return results;
  }, []);
  const reset = useCallback(() => setSt({ phase: "idle" }), []);
  return { st, run, reset };
}
