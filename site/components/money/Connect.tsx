"use client";
// Connect a NEAR wallet: HOT, Meteor, MyNearWallet or Intear. Read-only until then; connecting signs
// nothing and moves nothing.
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { GeoLine, Sheet } from "./ui";
import { openSheet, useWallet, type SheetReq } from "@/lib/money/hooks";
import { wallet, walletFailure } from "@/lib/money/wallet";

export function ConnectSheet({ then, onClose }: { then?: SheetReq | null; onClose: () => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void wallet().load().catch(() => {}); }, []);
  useEffect(() => {
    if (w.status === "in" && busy) { setBusy(null); openSheet(then ?? null); }
  }, [w.status, busy, then]);

  const pick = async (id: string) => {
    setBusy(id);
    setErr(null);
    try { await wallet().connect(id); } catch (e) { setBusy(null); setErr(walletFailure(e).error); }
  };

  return (
    <Sheet title="Connect a wallet" sub="To bet real USDC, sell, collect and withdraw." onClose={onClose}>
      <ul className="m-wallets" aria-label="NEAR wallets">
        {w.options.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => pick(o.id)} disabled={!!busy} data-testid={`wallet-${o.id}`}>
              {o.iconUrl ? <img src={o.iconUrl} alt="" width={40} height={40} /> : <span className="wi" aria-hidden="true">{o.name[0]}</span>}
              <span><span className="n">{o.name}</span><br /><span className="d">{o.description}</span></span>
              <span className="go">{busy === o.id ? <span className="spin" /> : <Icon name="arrow" />}</span>
            </button>
          </li>
        ))}
      </ul>
      {w.status === "loading" && !w.options.length ? <p className="fine">Loading wallets…</p> : null}
      {err || w.error ? <div className="notice err" role="alert"><Icon name="alert" /><p>{err || w.error}</p></div> : null}
      <p className="fine">Connecting shares your NEAR account name with this page. It signs nothing and moves nothing: every payment asks you first, in one plain sentence. New to NEAR? MyNearWallet and Intear make an account in the browser, no install.</p>
      <GeoLine />
    </Sheet>
  );
}
