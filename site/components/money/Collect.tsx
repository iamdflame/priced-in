"use client";
// "You called it · collect": a settled market's winning shares pay $1 each, into the Priced In balance.
import { useMemo } from "react";
import { ApproveBox, Done, Failed, GeoLine, Sheet, TxLink } from "./ui";
import { useSend } from "./useSend";
import { moneyConfig } from "@/lib/money/config";
import { openSheet, useGeo } from "@/lib/money/hooks";
import { checkCollect } from "@/lib/money/rules";
import { redeemTx } from "@/lib/money/tx";
import { fmtMicro } from "@/lib/money/units";

const cfg = moneyConfig();

export function CollectSheet({ claimId, question, winMicro, onClose }: { claimId: number; question: string; winMicro: string; onClose: () => void }) {
  const geo = useGeo();
  const { st, run, locked } = useSend();
  const win = BigInt(winMicro);
  const refusal = checkCollect("Settled", geo.access);
  const txs = useMemo(() => (refusal ? [] : [redeemTx(cfg, claimId, win)]), [refusal, claimId, win]);

  return (
    <Sheet title="You called it" onClose={onClose}>
      <p className="m-q">{question}</p>
      {st.phase === "done" ? (
        <Done title={`${fmtMicro(win)} collected`} actions={<button type="button" className="btn primary full" onClick={() => openSheet({ kind: "withdraw" })}>Withdraw</button>}>
          <p>It’s in your Priced In balance. Done in {(st.ms / 1000).toFixed(1)} s.</p>
          <TxLink hash={st.results[0]?.hash ?? null} />
        </Done>
      ) : (
        <>
          <div className="m-get"><span className="k">Your winnings<small>$1 for every winning share</small></span><span className="v">{fmtMicro(win)}</span></div>
          <ApproveBox txs={txs} />
          {st.phase === "failed" ? <Failed state={st} /> : null}
          <button type="button" className="btn primary lg full" disabled={!txs.length || locked} data-testid="collect-confirm"
            onClick={() => run(txs, (r) => ({ kind: "collect", hash: r.hash, at: Date.now(), amountMicro: winMicro, claimId, question }))}>
            {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : `Collect ${fmtMicro(win)}`}
          </button>
        </>
      )}
      <GeoLine />
    </Sheet>
  );
}
