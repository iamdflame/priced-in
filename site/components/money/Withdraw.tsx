"use client";
// Withdraw: the Priced In balance out to the person's NEAR wallet as USDC, or on to another chain through
// NEAR Intents 1Click. Out to another chain is two approvals, one at a time: if the second doesn't land,
// the USDC is in the NEAR wallet, the screen says so, and trying again sends only what is left to send.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { AmountInput, ApproveBox, Done, Failed, GeoLine, Loading, Sheet, TxLink } from "./ui";
import { useBridgeRoutes, useBridgeStatus } from "./useBridge";
import { useSend } from "./useSend";
import { quoteOut, submitDeposit } from "@/lib/money/bridge";
import { moneyChain } from "@/lib/money/chain";
import { moneyConfig } from "@/lib/money/config";
import { canTakeOut } from "@/lib/money/geo";
import { closeSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { dropPendingBridge, pendingBridges, savePendingBridge, type PendingBridge } from "@/lib/money/ledger";
import { bridgeDone, STATUS_WORDS, validAddress, type BridgeQuote } from "@/lib/money/oneclick";
import { checkWithdraw } from "@/lib/money/rules";
import { bridgeOutTxs, storageTx, withdrawTx, type TxSpec } from "@/lib/money/tx";
import { fmtMicro, microToInput, parseUsd } from "@/lib/money/units";

const cfg = moneyConfig();

export function WithdrawSheet({ tab: initialTab, onClose }: { tab?: "near" | "chain"; onClose: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [tab, setTab] = useState<"near" | "chain">(initialTab ?? "near");
  return (
    <Sheet title="Withdraw" sub={acct.balanceMicro !== null ? `Your Priced In balance: ${fmtMicro(acct.balanceMicro)}` : undefined} onClose={onClose}>
      {canTakeOut(geo.access) ? (
        <>
          <div className="m-tabs" role="tablist" aria-label="Where the money goes">
            <button type="button" role="tab" aria-selected={tab === "near"} onClick={() => setTab("near")}>My NEAR wallet</button>
            <button type="button" role="tab" aria-selected={tab === "chain"} onClick={() => setTab("chain")}>Another chain</button>
          </div>
          {tab === "near" ? <ToNear /> : <ToChain />}
          <p className="fine">Withdrawals pay no Priced In fee. No identity check is run at these limits; see the <a className="linkbtn" href="/terms#kyc">withdrawal policy</a>.</p>
        </>
      ) : <button type="button" className="btn soft full" onClick={onClose}>Close</button>}
      <GeoLine always={false} />
    </Sheet>
  );
}

function ToNear() {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [amt, setAmt] = useState("");
  const { st, run, reset, locked } = useSend();
  const amount = parseUsd(amt);
  const balance = acct.balanceMicro;
  const refusal = amt ? checkWithdraw(amount, balance, geo.access) : null;
  const txs = useMemo<TxSpec[]>(() => {
    if (!amount || refusal || !w.accountId) return [];
    return acct.canReceiveUsdc === false ? [storageTx(cfg, w.accountId), withdrawTx(cfg, amount)] : [withdrawTx(cfg, amount)];
  }, [amount, refusal, w.accountId, acct.canReceiveUsdc]);

  if (st.phase === "done") {
    return (
      <Done title={`${fmtMicro(amount ?? 0n)} withdrawn`} actions={<button type="button" className="btn primary full" onClick={closeSheet}>Done</button>}>
        <p>The USDC is in your NEAR wallet, {w.accountId}. Done in {(st.ms / 1000).toFixed(1)} s.</p>
        <TxLink hash={st.results.at(-1)?.hash ?? null} />
      </Done>
    );
  }
  return (
    <>
      <AmountInput label="Amount" value={amt} onChange={(v) => { setAmt(v); if (st.phase === "failed") reset(); }} invalid={refusal}
        max={balance && balance > 0n ? fmtMicro(balance) : null} onMax={() => { if (balance) setAmt(microToInput(balance)); }} />
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed state={st} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || locked} data-testid="withdraw-confirm"
        onClick={() => run(txs, (r, i) => (i === txs.length - 1 ? { kind: "withdraw", hash: r.hash, at: Date.now(), amountMicro: String(amount) } : { kind: "storage", hash: r.hash, at: Date.now(), amountMicro: null }))}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet ({st.step} of {st.of})…</> : amount ? `Withdraw ${fmtMicro(amount)}` : "Withdraw"}
      </button>
    </>
  );
}

function ToChain() {
  const w = useWallet();
  const account = w.accountId!;
  const acct = useAccount(account);
  const geo = useGeo();
  const { routes, error, retry } = useBridgeRoutes("out");
  const [pending, setPending] = useState<PendingBridge | null>(() => pendingBridges(account).find((p) => p.quote.dir === "out") ?? null);
  const [key, setKey] = useState("base:USDC");
  const [dest, setDest] = useState("");
  const [amt, setAmt] = useState("");
  const [preview, setPreview] = useState<BridgeQuote | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ quote: BridgeQuote; txs: TxSpec[] } | null>(null);
  // step 1 landed and step 2 didn't: the USDC is already in the wallet, so a retry must not withdraw again
  const [inWallet, setInWallet] = useState(false);
  const { st, run, reset, locked } = useSend();

  const route = routes?.find((r) => r.key === key) ?? null;
  const amount = parseUsd(amt);
  const balance = acct.balanceMicro;
  const refusal = amt ? checkWithdraw(amount, inWallet ? acct.usdcMicro : balance, geo.access) : null;
  const destBad = dest && route && !validAddress(route.addr, dest) ? `That isn’t a ${route.chainName} address.` : null;
  const request = useMemo(
    () => (route && amount && dest && !destBad && !refusal ? { route: route.key, amountMicro: amount.toString(), recipient: dest, refundTo: account } : null),
    [route, amount, dest, destBad, refusal, account],
  );

  useEffect(() => {
    setPreview(null);
    setFailure(null);
    setPlan(null);
    if (!request) return;
    let off = false;
    const t = setTimeout(() => {
      quoteOut({ ...request, dry: true }).then((q) => { if (!off) setPreview(q); }, (e: Error) => { if (!off) setFailure(e.message); });
    }, 500);
    return () => { off = true; clearTimeout(t); };
  }, [request]);

  /** A real quote, and the transactions it needs, shown before the wallet is asked anything. */
  const prepare = async () => {
    if (!request || !route || !amount) return;
    setFailure(null);
    reset();
    try {
      const quote = await quoteOut({ ...request, dry: false });
      if (!quote.depositAddress) throw new Error("NEAR Intents didn’t issue a deposit address. Try again.");
      const needsStorage = !(await moneyChain().canReceiveUsdc(quote.depositAddress));
      setPlan({ quote, txs: bridgeOutTxs(cfg, { amountMicro: amount, depositAddress: quote.depositAddress, needsStorage, fromBalance: !inWallet, destination: `${dest.slice(0, 6)}…${dest.slice(-4)} on ${route.chainName}` }) });
    } catch (e) { setFailure((e as Error).message); }
  };

  const send = async () => {
    if (!plan) return;
    const last = plan.txs.length - 1;
    const results = await run(plan.txs, (r, i) => (i === last
      ? { kind: "bridge_out", hash: r.hash, at: Date.now(), amountMicro: plan.quote.amountIn, note: `to ${route?.chainName ?? "another chain"}` }
      : { kind: "withdraw", hash: r.hash, at: Date.now(), amountMicro: plan.quote.amountIn }));
    const sent = results[last];
    if (!sent?.ok) {
      if (plan.txs.length > 1 && results[0]?.ok) setInWallet(true);
      setPlan(null);
      return;
    }
    if (sent.hash) void submitDeposit(plan.quote.depositAddress!, sent.hash);
    const p: PendingBridge = { quote: plan.quote, at: Date.now(), account, stage: "waiting" };
    savePendingBridge(p);
    setPending(p);
  };

  if (pending) return <OutTracker p={pending} onNew={() => { dropPendingBridge(account, pending.quote.depositAddress!); setPending(null); setPlan(null); reset(); }} />;
  if (error) return <div className="notice err" role="alert"><Icon name="alert" /><p>{error} <button type="button" className="linkbtn" onClick={retry}>Try again</button></p></div>;
  if (!routes) return <Loading>Loading chains from NEAR Intents…</Loading>;

  return (
    <>
      <div className="m-field">
        <label htmlFor="wd-route">Receive</label>
        <select id="wd-route" value={key} onChange={(e) => { setKey(e.target.value); setDest(""); }}>
          {routes.map((r) => <option key={r.key} value={r.key}>{r.symbol} on {r.chainName}</option>)}
        </select>
      </div>
      <div className="m-field">
        <label htmlFor="wd-dest">Your {route?.chainName} address</label>
        <input id="wd-dest" autoComplete="off" spellCheck={false} placeholder={route?.addr === "evm" ? "0x…" : "Your address"} value={dest} onChange={(e) => setDest(e.target.value.trim())} />
        {destBad ? <p className="bad" role="alert">{destBad}</p> : <p className="hint">Check it twice: a transfer to the wrong address can’t be undone.</p>}
      </div>
      <AmountInput label="Amount" value={amt} onChange={setAmt} invalid={refusal} max={balance && balance > 0n ? fmtMicro(balance) : null} onMax={() => { if (balance) setAmt(microToInput(balance)); }} />
      {preview ? <div className="m-get"><span className="k">{route?.symbol} arriving on {route?.chainName}<small>at least {preview.minAmountOut && route ? (Number(preview.minAmountOut) / 10 ** route.decimals).toFixed(2) : "…"} · about {preview.timeEstimate} s</small></span><span className="v">{Number(preview.amountOutFormatted).toFixed(2)}</span></div> : request && !failure ? <Loading>Getting a quote…</Loading> : null}
      {failure ? <div className="notice err" role="alert"><Icon name="alert" /><p>{failure}</p></div> : null}
      {plan ? <ApproveBox txs={plan.txs} /> : null}
      {st.phase === "failed" ? <Failed state={st} /> : null}
      {inWallet ? <div className="notice info"><Icon name="info" /><p>Your USDC is in your NEAR wallet. Review again to send it on; it won’t be withdrawn twice.</p></div> : null}
      {plan ? (
        <button type="button" className="btn primary lg full" disabled={locked} data-testid="bridge-out-confirm" onClick={send}>
          {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet ({st.step} of {st.of})…</> : "Approve and send"}
        </button>
      ) : (
        <button type="button" className="btn primary lg full" disabled={!preview || locked} data-testid="bridge-out-review" onClick={prepare}>Review</button>
      )}
      <p className="fine">Routed by NEAR Intents. Routing fees are already in this quote. A failed swap refunds the USDC to your NEAR wallet.</p>
    </>
  );
}

function OutTracker({ p, onNew }: { p: PendingBridge; onNew: () => void }) {
  const { status: s, error } = useBridgeStatus(p.quote);
  const status = s?.status ?? "PENDING_DEPOSIT";
  if (status === "SUCCESS") {
    return <Done title="Delivered" actions={<button type="button" className="btn primary full" onClick={() => { onNew(); closeSheet(); }}>Done</button>}><p>{p.quote.amountOutFormatted} arrived at {p.quote.recipient}.</p></Done>;
  }
  return (
    <>
      <p className="decide" role="status" aria-live="polite"><b>{STATUS_WORDS[status]}.</b> {status === "PENDING_DEPOSIT" ? "NEAR Intents is picking up your USDC." : ""}</p>
      {status === "REFUNDED" || status === "FAILED" ? <div className="notice err" role="alert"><Icon name="alert" /><p>It goes back to your NEAR wallet, {p.quote.refundTo}. {s?.refundReason ?? ""}</p></div> : null}
      {error ? <p className="fine">We couldn’t check the status just now. Still trying.</p> : null}
      {bridgeDone(status) ? <button type="button" className="btn soft full" onClick={onNew}>Done</button> : <p className="fine">You can close this: your portfolio keeps tracking it.</p>}
    </>
  );
}
