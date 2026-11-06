"use client";
// Deposit from another chain, through NEAR Intents 1Click: pick a chain and asset, get a one-time deposit
// address (QR, amount, deadline), watch it until the USDC lands in the NEAR wallet, then one tap moves it
// into the balance. What is in flight survives a reload (lib/money/ledger.ts).
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { ApproveBox, CopyText, Countdown, Done, Failed, Loading, QR } from "./ui";
import { useBridgeStatus, useBridgeRoutes } from "./useBridge";
import { useSend } from "./useSend";
import { quoteIn } from "@/lib/money/bridge";
import { moneyConfig } from "@/lib/money/config";
import { closeSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { dropPendingBridge, logTx, pendingBridges, savePendingBridge, updatePendingBridge, type PendingBridge } from "@/lib/money/ledger";
import { STATUS_WORDS, validAddress, type BridgeQuote, type BridgeRoute } from "@/lib/money/oneclick";
import { checkBridgeIn } from "@/lib/money/rules";
import { depositTx } from "@/lib/money/tx";
import { fmtMicro, toUnits } from "@/lib/money/units";

const cfg = moneyConfig();
const seconds = (s: number) => (s < 90 ? `${s} s` : `${Math.round(s / 60)} min`);

export function FromChain() {
  const account = useWallet().accountId!;
  const geo = useGeo();
  const { routes, error, retry } = useBridgeRoutes("in");
  const [pending, setPending] = useState<PendingBridge | null>(() => pendingBridges(account).find((p) => p.quote.dir === "in") ?? null);
  const [chain, setChain] = useState("base");
  const [key, setKey] = useState("base:USDC");
  const [amt, setAmt] = useState("");
  const [refund, setRefund] = useState("");
  const [preview, setPreview] = useState<BridgeQuote | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const route = routes?.find((r) => r.key === key) ?? null;
  const chains = useMemo(() => [...new Map((routes ?? []).map((r) => [r.chain, r.chainName])).entries()], [routes]);
  const units = route ? toUnits(amt, route.decimals)?.toString() ?? null : null;
  const usd = route?.price && Number(amt) > 0 ? Number(amt) * route.price : null;
  const refundBad = refund && route && !validAddress(route.addr, refund) ? `That isn’t a ${route.chainName} address.` : null;
  const refusal = checkBridgeIn(usd, geo.access);
  const request = useMemo(
    () => (route && units && !refundBad && !refusal ? { route: route.key, amount: units, recipient: account, refundTo: refund || null } : null),
    [route, units, refund, refundBad, refusal, account],
  );

  // a dry quote as you type: what arrives, at least, and how long it takes
  useEffect(() => {
    setPreview(null);
    setFailure(null);
    if (!request) return;
    let off = false;
    const t = setTimeout(() => {
      quoteIn({ ...request, dry: true }).then((q) => { if (!off) setPreview(q); }, (e: Error) => { if (!off) setFailure(e.message); });
    }, 500);
    return () => { off = true; clearTimeout(t); };
  }, [request]);

  const start = async () => {
    if (!request) return;
    setBusy(true);
    setFailure(null);
    try {
      const quote = await quoteIn({ ...request, dry: false });
      if (!quote.depositAddress) throw new Error("NEAR Intents didn’t issue a deposit address. Try again.");
      const p: PendingBridge = { quote, at: Date.now(), account, stage: "waiting" };
      savePendingBridge(p);
      setPending(p);
    } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  };

  if (pending) return <Tracker p={pending} route={routes?.find((r) => r.key === pending.quote.route) ?? null} onNew={() => setPending(null)} />;
  if (error) return <div className="notice err" role="alert"><Icon name="alert" /><p>{error} <button type="button" className="linkbtn" onClick={retry}>Try again</button></p></div>;
  if (!routes) return <Loading>Loading chains from NEAR Intents…</Loading>;

  return (
    <>
      <div className="m-two">
        <div className="m-field">
          <label htmlFor="dep-chain">From chain</label>
          <select id="dep-chain" value={chain} onChange={(e) => { setChain(e.target.value); const first = routes.find((r) => r.chain === e.target.value); if (first) setKey(first.key); setRefund(""); }}>
            {chains.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label htmlFor="dep-asset">Asset</label>
          <select id="dep-asset" value={key} onChange={(e) => setKey(e.target.value)}>
            {routes.filter((r) => r.chain === chain).map((r) => <option key={r.key} value={r.key}>{r.symbol}</option>)}
          </select>
        </div>
      </div>
      <div className="m-field">
        <label htmlFor="dep-amt">You send ({route?.symbol} on {route?.chainName})</label>
        <div className="m-amt">
          <input id="dep-amt" inputMode="decimal" autoComplete="off" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))} />
          <div className="side"><b className="sym">{route?.symbol}</b>{usd !== null ? <span>≈ ${usd.toFixed(2)}</span> : null}</div>
        </div>
        {refusal ? <p className="bad" role="alert">{refusal}</p> : null}
      </div>
      <div className="m-field">
        <label htmlFor="dep-refund">Refund address on {route?.chainName} <span className="opt">(optional)</span></label>
        <input id="dep-refund" autoComplete="off" spellCheck={false} placeholder={route?.addr === "evm" ? "0x…" : "Your address"} value={refund} onChange={(e) => setRefund(e.target.value.trim())} />
        {refundBad ? <p className="bad">{refundBad}</p> : <p className="hint">If the swap can’t complete, it goes back here. Left empty, a refund goes to your NEAR account inside NEAR Intents.</p>}
      </div>
      {preview ? (
        <div className="m-get"><span className="k">USDC arriving in your NEAR wallet<small>at least {fmtMicro(BigInt(preview.minAmountOut))} · about {seconds(preview.timeEstimate)} after your deposit confirms</small></span><span className="v">{fmtMicro(BigInt(preview.amountOut))}</span></div>
      ) : request && !failure ? <Loading>Getting a quote…</Loading> : null}
      {failure ? <div className="notice err" role="alert"><Icon name="alert" /><p>{failure}</p></div> : null}
      <button type="button" className="btn primary lg full" disabled={!preview || busy} onClick={start} data-testid="bridge-start">
        {busy ? <><span className="spin" />Getting your address…</> : "Get my deposit address"}
      </button>
      <p className="fine">Routed by NEAR Intents: solvers swap it and deliver it to your wallet. Routing fees are already in this quote.</p>
    </>
  );
}

function Tracker({ p, route, onNew }: { p: PendingBridge; route: BridgeRoute | null; onNew: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const q = p.quote;
  const address = q.depositAddress!;
  const { status: s, error } = useBridgeStatus(q);
  const [moved, setMoved] = useState(false);
  const [expired, setExpired] = useState(() => Date.parse(q.sendBy) <= Date.now());
  const status = s?.status ?? (p.stage === "landed" ? "SUCCESS" : "PENDING_DEPOSIT");

  useEffect(() => {
    if (status !== "SUCCESS" || p.stage === "landed") return;
    updatePendingBridge(p.account, address, { stage: "landed" });
    logTx(p.account, { kind: "bridge_in", hash: s?.nearTxs[0] ?? null, at: Date.now(), amountMicro: s?.amountOut ?? q.amountOut, note: `${q.amountInFormatted} ${route?.symbol ?? ""} from ${route?.chainName ?? "another chain"}` });
  }, [status, p.stage, p.account, address, s, q.amountOut, q.amountInFormatted, route]);

  const arrived = BigInt(s?.amountOut ?? q.amountOut);
  const steps = [`Send ${q.amountInFormatted} ${route?.symbol ?? ""} to the address`, "Your deposit is seen on its chain", "Swapped and delivered to your NEAR wallet", "Move it into your Priced In balance"];
  const at = status === "SUCCESS" ? 3 : status === "PROCESSING" ? 2 : status === "KNOWN_DEPOSIT_TX" ? 1 : 0;
  const finish = () => { dropPendingBridge(p.account, address); };

  if (moved) return <Done title="Deposited" actions={<button type="button" className="btn primary full" onClick={closeSheet}>Start betting</button>}><p>Your Priced In balance is {acct.balanceMicro !== null ? fmtMicro(acct.balanceMicro) : "updating"}.</p></Done>;

  const waiting = status === "PENDING_DEPOSIT";
  return (
    <>
      {waiting && expired ? (
        <div className="notice err" role="alert"><Icon name="alert" /><p><b>This quote has run out. Don’t send to this address.</b> Start a new deposit for a fresh price.</p></div>
      ) : waiting || status === "KNOWN_DEPOSIT_TX" ? (
        <div className="m-qr" data-testid="deposit-address">
          <QR text={address} label={`Deposit address on ${route?.chainName ?? "the origin chain"}`} />
          <div className="m-qr-side">
            <span className="send">Send exactly<b>{q.amountInFormatted} {route?.symbol}</b>on {route?.chainName}, to:</span>
            <CopyText text={address} />
            {q.depositMemo ? <><span className="send">Memo (required)</span><CopyText text={q.depositMemo} /></> : null}
            {waiting ? <p className="m-timer"><Icon name="clock" />Send within <Countdown to={Date.parse(q.sendBy)} onEnd={() => setExpired(true)} /></p> : null}
          </div>
        </div>
      ) : null}
      <ol className="progress" aria-live="polite">
        {steps.map((x, i) => <li key={x} className={`pstep ${i < at ? "done" : i === at ? "on" : ""}`}><span className="b">{i < at ? <Icon name="check" /> : null}</span>{x}</li>)}
      </ol>
      {s && (status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT") ? (
        <div className="notice err" role="alert"><Icon name="alert" /><p><b>{STATUS_WORDS[status]}.</b> {s.refundedFormatted ? `${s.refundedFormatted} ${route?.symbol ?? ""}` : "Anything sent"} goes back to {q.refundTo}{q.refundsInIntents ? ", inside NEAR Intents" : ""}. {s.refundReason ?? ""}</p></div>
      ) : null}
      {error ? <p className="fine">We couldn’t check the status just now. Still trying.</p> : null}
      {status === "SUCCESS" ? (
        <>
          <div className="m-get"><span className="k">Arrived in your NEAR wallet</span><span className="v">{fmtMicro(arrived)}</span></div>
          <MoveIn amount={acct.usdcMicro !== null && acct.usdcMicro < arrived ? acct.usdcMicro : arrived} onDone={() => { finish(); setMoved(true); }} />
        </>
      ) : (
        <p className="fine">You can close this: your portfolio keeps tracking it until it lands. Follow it on the <a className="linkbtn" href={`https://explorer.near-intents.org/?search=${address}`} target="_blank" rel="noopener">NEAR Intents explorer</a>.</p>
      )}
      {status !== "SUCCESS" ? <button type="button" className="btn ghost full" onClick={() => { finish(); onNew(); }}>Start another deposit</button> : null}
    </>
  );
}

function MoveIn({ amount, onDone }: { amount: bigint; onDone: () => void }) {
  const { st, run, locked } = useSend();
  const txs = useMemo(() => (amount > 0n ? [depositTx(cfg, amount)] : []), [amount]);
  useEffect(() => { if (st.phase === "done") onDone(); }, [st.phase, onDone]);
  return (
    <>
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed state={st} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || locked} data-testid="move-in"
        onClick={() => run(txs, (r) => ({ kind: "deposit", hash: r.hash, at: Date.now(), amountMicro: amount.toString() }))}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : `Move ${fmtMicro(amount)} into my balance`}
      </button>
    </>
  );
}
