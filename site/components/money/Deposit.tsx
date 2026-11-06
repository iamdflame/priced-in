"use client";
// Deposit: USDC already in the NEAR wallet moves into the Priced In balance with ft_transfer_call. From
// another chain, DepositChain.tsx routes it through NEAR Intents first.
import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { FromChain } from "./DepositChain";
import { AmountInput, ApproveBox, Done, Failed, GeoLine, Sheet, TxLink } from "./ui";
import { useSend } from "./useSend";
import { moneyConfig } from "@/lib/money/config";
import { canAddMoney } from "@/lib/money/geo";
import { closeSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { checkDeposit, MAX_DEPOSIT_MICRO } from "@/lib/money/rules";
import { depositTx } from "@/lib/money/tx";
import { fmtMicro, microToInput, parseUsd } from "@/lib/money/units";

const cfg = moneyConfig();

export function DepositSheet({ tab: initialTab, onClose }: { tab?: "near" | "chain"; onClose: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [picked, setPicked] = useState<"near" | "chain" | null>(initialTab ?? null);
  const tab = picked ?? (acct.usdcMicro === 0n ? "chain" : "near");
  return (
    <Sheet title="Deposit" sub={acct.balanceMicro !== null ? `Your Priced In balance: ${fmtMicro(acct.balanceMicro)}` : "Add USDC to bet with"} onClose={onClose}>
      {canAddMoney(geo.access) ? (
        <>
          <div className="m-tabs" role="tablist" aria-label="Where the money comes from">
            <button type="button" role="tab" aria-selected={tab === "near"} onClick={() => setPicked("near")}>USDC on NEAR</button>
            <button type="button" role="tab" aria-selected={tab === "chain"} onClick={() => setPicked("chain")}>Another chain</button>
          </div>
          {tab === "near" ? <FromNear onChain={() => setPicked("chain")} /> : <FromChain />}
        </>
      ) : <button type="button" className="btn soft full" onClick={onClose}>Close</button>}
      <GeoLine />
    </Sheet>
  );
}

function FromNear({ onChain }: { onChain: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [amt, setAmt] = useState("");
  const { st, run, reset, locked } = useSend();
  const amount = parseUsd(amt);
  const have = acct.usdcMicro;
  const refusal = amt ? checkDeposit(amount, have, geo.access) : null;
  const txs = useMemo(() => (amount && !refusal ? [depositTx(cfg, amount)] : []), [amount, refusal]);

  if (st.phase === "done") {
    return (
      <Done title={`${fmtMicro(amount ?? 0n)} added`} actions={<button type="button" className="btn primary full" onClick={closeSheet}>Start betting</button>}>
        <p>It’s in your Priced In balance. Done in {(st.ms / 1000).toFixed(1)} s.</p>
        <TxLink hash={st.results[0]?.hash ?? null} />
      </Done>
    );
  }
  const max = have && have > 0n ? (have > MAX_DEPOSIT_MICRO ? MAX_DEPOSIT_MICRO : have) : null;
  return (
    <>
      <AmountInput label="Amount" value={amt} onChange={(v) => { setAmt(v); if (st.phase === "failed") reset(); }} invalid={refusal}
        side={<span>In your wallet: {have === null ? "…" : fmtMicro(have)}</span>}
        max={max ? fmtMicro(max) : null} onMax={() => { if (max) setAmt(microToInput(max)); }} presets={[5, 10, 25, 50]} onPreset={(n) => setAmt(String(n))} />
      {have === 0n ? (
        <div className="notice info"><Icon name="info" /><p>Your wallet has no USDC on NEAR yet. <button type="button" className="linkbtn" onClick={onChain}>Deposit from another chain</button> instead: Base, Ethereum, Solana, Arbitrum, Tron or Bitcoin.</p></div>
      ) : null}
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed state={st} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || locked} data-testid="deposit-confirm"
        onClick={() => run(txs, (r) => ({ kind: "deposit", hash: r.hash, at: Date.now(), amountMicro: String(amount) }))}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : amount ? `Deposit ${fmtMicro(amount)}` : "Deposit"}
      </button>
      <p className="fine">No fee from Priced In. NEAR’s network fee is paid in NEAR by your wallet.</p>
    </>
  );
}
