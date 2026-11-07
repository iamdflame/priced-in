"use client";
// The market ticket's real-money line, next to the free $1: bet with the wallet, sell what you hold, or
// collect what you won. It reads this wallet's position in this market from the chain.
import { useEffect, useState } from "react";
import { moneyChain, type Position } from "@/lib/money/chain";
import { canAddMoney, canTakeOut } from "@/lib/money/geo";
import { openSheet, useGeo, useWallet, type SheetReq } from "@/lib/money/hooks";
import { canBuy, canSell, type ClaimStatus } from "@/lib/money/rules";
import type { Side } from "@/lib/money/tx";
import { fmtMicro, fmtShares } from "@/lib/money/units";
import { GeoLine } from "./ui";

export interface WalletEntryProps {
  claimId: number;
  question: string;
  status: ClaimStatus;
  /** true or false once decided */
  outcome: boolean | null;
  side: Side | null;
  /** this site takes no new bets on the line (a news line past its date): sell and collect only */
  noBuy?: boolean;
}

export function WalletEntry({ claimId, question, status, outcome, side, noBuy = false }: WalletEntryProps) {
  const w = useWallet();
  const geo = useGeo();
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    if (!w.accountId) { setPosition(null); return; }
    let off = false;
    moneyChain().position(claimId, w.accountId).then((p) => { if (!off) setPosition(p); }, () => {});
    return () => { off = true; };
  }, [claimId, w.accountId]);

  const yes = BigInt(position?.yes_micro ?? 0), no = BigInt(position?.no_micro ?? 0);
  const trade: SheetReq = { kind: "trade", claimId, question, mode: "buy", side: side ?? undefined };

  if (status === "Settled") {
    const win = outcome === true ? yes : outcome === false ? no : 0n;
    if (win === 0n || !canTakeOut(geo.access)) return null;
    return (
      <div className="wentry">
        <div className="held"><span>You called it</span><b>{fmtMicro(win)}</b></div>
        <button type="button" className="btn primary" onClick={() => openSheet({ kind: "collect", claimId, question, winMicro: win.toString() })}>Collect {fmtMicro(win)}</button>
      </div>
    );
  }

  const holding = yes > 0n || no > 0n;
  const mayBuy = !noBuy && canBuy(status) && canAddMoney(geo.access);
  const maySell = holding && canSell(status) && canTakeOut(geo.access);
  return (
    <div className="wentry">
      {mayBuy ? (
        <div className="row2">
          <span><span className="t">Bet real USDC</span><br /><span className="s">Any amount, from your wallet</span></span>
          <button type="button" className="btn soft" data-testid="wallet-bet" onClick={() => openSheet(w.status === "in" ? trade : { kind: "connect", then: trade })}>{w.status === "in" ? "Bet with your wallet" : "Connect wallet"}</button>
        </div>
      ) : null}
      {holding ? (
        <div className="held">
          <span>You hold <b>{yes > 0n ? `${fmtShares(yes)} Yes` : ""}{yes > 0n && no > 0n ? " and " : ""}{no > 0n ? `${fmtShares(no)} No` : ""}</b></span>
          {maySell ? <button type="button" className="btn ghost" onClick={() => openSheet({ kind: "trade", claimId, question, mode: "sell" })}>Sell</button> : null}
        </div>
      ) : null}
      <GeoLine always={false} />
    </div>
  );
}
