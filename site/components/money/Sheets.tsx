"use client";
// Which money sheet a request opens.
import { CollectSheet } from "./Collect";
import { ConnectSheet } from "./Connect";
import { DepositSheet } from "./Deposit";
import { TradeSheet } from "./Trade";
import { WithdrawSheet } from "./Withdraw";
import { closeSheet, type SheetReq } from "@/lib/money/hooks";

export function Sheets({ req }: { req: SheetReq }) {
  switch (req.kind) {
    case "connect": return <ConnectSheet then={req.then} onClose={closeSheet} />;
    case "deposit": return <DepositSheet tab={req.tab} onClose={closeSheet} />;
    case "withdraw": return <WithdrawSheet tab={req.tab} onClose={closeSheet} />;
    case "trade": return <TradeSheet claimId={req.claimId} question={req.question} mode={req.mode} side={req.side} onClose={closeSheet} />;
    case "collect": return <CollectSheet claimId={req.claimId} question={req.question} winMicro={req.winMicro} onClose={closeSheet} />;
  }
}
