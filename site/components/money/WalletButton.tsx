"use client";
// The nav's wallet: "Connect wallet" until connected, then the balance and the account menu. MoneyLayer
// renders whichever money sheet is open, once for the whole site.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { ConnectSheet } from "./Connect";
import { CollectSheet } from "./Collect";
import { DepositSheet } from "./Deposit";
import { TradeSheet } from "./Trade";
import "@/app/styles/money.css";
import { WithdrawSheet } from "./Withdraw";
import { canAddMoney } from "@/lib/money/geo";
import { closeSheet, openSheet, useAccount, useGeo, useSheet, useWallet } from "@/lib/money/hooks";
import { fmtMicro } from "@/lib/money/units";
import { wallet } from "@/lib/money/wallet";

export function MoneyLayer() {
  const s = useSheet();
  if (!s) return null;
  switch (s.kind) {
    case "connect": return <ConnectSheet then={s.then} onClose={closeSheet} />;
    case "deposit": return <DepositSheet tab={s.tab} onClose={closeSheet} />;
    case "withdraw": return <WithdrawSheet tab={s.tab} onClose={closeSheet} />;
    case "trade": return <TradeSheet claimId={s.claimId} question={s.question} mode={s.mode} side={s.side} onClose={closeSheet} />;
    case "collect": return <CollectSheet claimId={s.claimId} question={s.question} winMicro={s.winMicro} onClose={closeSheet} />;
  }
}

export function WalletButton() {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (w.status !== "in" || !w.accountId) {
    return (
      <button type="button" className="wbtn out" onClick={() => openSheet({ kind: "connect" })} aria-label="Connect wallet" data-testid="connect-wallet">
        <Icon name="wallet" /><span className="lbl">Connect wallet</span>
      </button>
    );
  }
  const go = (s: Parameters<typeof openSheet>[0]) => { setOpen(false); openSheet(s); };
  const balance = acct.balanceMicro === null ? "…" : fmtMicro(acct.balanceMicro);
  return (
    <div className="wwrap" ref={ref}>
      <button type="button" className="wbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={`Your wallet, ${w.accountId}, balance ${balance}`} data-testid="wallet-menu">
        <span className="bal">{balance}</span>
        <span className="av" aria-hidden="true">{w.accountId[0].toUpperCase()}</span>
      </button>
      {open ? (
        <div className="wmenu">
          <div className="who">
            <div className="a">{w.accountId}</div>
            {w.walletName ? <div className="w">{w.walletName}</div> : null}
            <div className="bl"><b>{balance}</b><span>Priced In balance</span></div>
            <div className="acts2">
              <button type="button" className="btn primary" disabled={!canAddMoney(geo.access)} onClick={() => go({ kind: "deposit" })}>Deposit</button>
              <button type="button" className="btn soft" onClick={() => go({ kind: "withdraw" })}>Withdraw</button>
            </div>
          </div>
          <Link className="mi" href="/portfolio" onClick={() => setOpen(false)}><Icon name="pulse" />Portfolio</Link>
          <button type="button" className="mi" onClick={() => { setOpen(false); void wallet().disconnect(); }}><Icon name="x" />Disconnect</button>
        </div>
      ) : null}
    </div>
  );
}
