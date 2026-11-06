"use client";
// Hand transactions to the wallet and keep their state: which step is waiting for approval, done, or
// failed with the reason in plain words and whatever landed before it. Each landed transaction goes into
// this browser's ledger, and the balances are read again from the chain.
import { useCallback, useState } from "react";
import type { TxResult } from "@/lib/money/chain";
import { refreshAccount } from "@/lib/money/hooks";
import { logTx, type TxRecord } from "@/lib/money/ledger";
import type { TxSpec } from "@/lib/money/tx";
import { wallet } from "@/lib/money/wallet";

export type SendState =
  | { phase: "idle" }
  | { phase: "wallet"; step: number; of: number }
  | { phase: "done"; results: TxResult[]; ms: number }
  | { phase: "failed"; error: string; unknown: boolean; landed: TxResult[] };

/** What to record for a landed step, by its index. */
export type Recorder = (result: TxResult, index: number) => TxRecord | null;

export function useSend() {
  const [st, setSt] = useState<SendState>({ phase: "idle" });
  const run = useCallback(async (txs: TxSpec[], record: Recorder): Promise<TxResult[]> => {
    const account = wallet().st.accountId;
    if (!account) { setSt({ phase: "failed", error: "Connect a wallet first.", unknown: false, landed: [] }); return []; }
    const started = performance.now();
    const results = await wallet().send(txs, (i) => setSt({ phase: "wallet", step: i + 1, of: txs.length }));
    results.forEach((r, i) => {
      const rec = r.ok ? record(r, i) : null;
      if (rec) logTx(account, rec);
    });
    void refreshAccount(account);
    const bad = results.find((r) => !r.ok);
    setSt(bad
      ? { phase: "failed", error: bad.error ?? "The transaction failed on NEAR.", unknown: bad.unknown, landed: results.filter((r) => r.ok) }
      : { phase: "done", results, ms: performance.now() - started });
    return results;
  }, []);
  const reset = useCallback(() => setSt({ phase: "idle" }), []);
  // sending, or an outcome nobody can confirm: a second tap could pay twice, so the button stays shut
  const locked = st.phase === "wallet" || (st.phase === "failed" && st.unknown);
  return { st, run, reset, locked };
}
