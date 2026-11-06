"use client";
// Deposit: (a) USDC already in the NEAR wallet, moved into the Priced In balance with ft_transfer_call;
// (b) from another chain through NEAR Intents 1Click: pick a chain and asset, get a one-time deposit
// address (QR, amount, deadline), watch it until the USDC lands in the NEAR wallet, then one tap moves
// it into the balance.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { AmountInput, ApproveBox, CopyText, Countdown, Done, Failed, GeoLine, QR, Sheet } from "./ui";
import { useSend } from "./useSend";
import { fmtMicro, microToUsd, moneyConfig, usdToMicro } from "@/lib/money/config";
import { canAddMoney, LIMITS } from "@/lib/money/geo";
import { openSheet, refreshAccount, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { dropPendingBridge, logTx, pendingBridges, savePendingBridge, updatePendingBridge, type PendingBridge } from "@/lib/money/ledger";
import { bridgeDone, STATUS_WORDS, toBaseUnits, validAddress, type BridgeQuote, type BridgeStatusView, type Route } from "@/lib/money/oneclick";
import { depositTx } from "@/lib/money/tx";
import { explorerTx, shortHash } from "@/lib/format";

const cfg = moneyConfig();

export function DepositSheet({ tab: initialTab, onClose }: { tab?: "near" | "chain"; onClose: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [tab, setTab] = useState<"near" | "chain">(initialTab ?? "near");
  useEffect(() => { if (!initialTab && acct.usdcMicro === 0n) setTab("chain"); }, [acct.usdcMicro, initialTab]);
  const blocked = !canAddMoney(geo.access);
  return (
    <Sheet title="Deposit" sub={acct.balanceMicro !== null ? `Your Priced In balance: ${fmtMicro(acct.balanceMicro)}` : "Add USDC to bet with"} onClose={onClose}>
      {blocked ? (
        <><GeoLine /><button type="button" className="btn soft full" onClick={onClose}>Close</button></>
      ) : (
        <>
          <div className="m-tabs" role="tablist" aria-label="Where the money comes from">
            <button type="button" role="tab" aria-selected={tab === "near"} onClick={() => setTab("near")}>USDC on NEAR</button>
            <button type="button" role="tab" aria-selected={tab === "chain"} onClick={() => setTab("chain")}>Another chain</button>
          </div>
          {tab === "near" ? <FromNear onChain={() => setTab("chain")} /> : <FromChain />}
          <GeoLine />
        </>
      )}
    </Sheet>
  );
}

function FromNear({ onChain, preset }: { onChain?: () => void; preset?: bigint | null }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const [amt, setAmt] = useState(preset ? String(microToUsd(preset)) : "");
  const { st, run, reset } = useSend();
  const micro = usdToMicro(Number(amt));
  const have = acct.usdcMicro;
  const invalid = !amt ? null : micro <= 0n ? "Enter an amount above zero." : have !== null && micro > have ? `Your wallet holds ${fmtMicro(have)} USDC on NEAR.` : microToUsd(micro) > LIMITS.maxDepositUsd ? `The research preview takes up to $${LIMITS.maxDepositUsd} per deposit.` : null;
  const txs = useMemo(() => (micro > 0n && !invalid ? [depositTx(cfg, micro)] : []), [micro, invalid]);

  if (st.phase === "done") {
    const h = st.results[0]?.hash;
    return (
      <Done title={`${fmtMicro(micro)} added`} actions={<button type="button" className="btn primary full" onClick={() => openSheet(null)}>Start betting</button>}>
        <p>It’s in your Priced In balance now{acct.balanceMicro !== null ? `: ${fmtMicro(acct.balanceMicro)}` : ""}. Done in {(st.ms / 1000).toFixed(1)} s.</p>
        {h ? <a className="hashv mono" href={explorerTx(h)} target="_blank" rel="noopener">See the transaction {shortHash(h)} <Icon name="ext" /></a> : null}
      </Done>
    );
  }
  return (
    <>
      <AmountInput label="Amount" value={amt} onChange={(v) => { setAmt(v); if (st.phase === "failed") reset(); }} invalid={invalid}
        side={<span>In your wallet: {have === null ? "…" : fmtMicro(have)}</span>}
        max={have && have > 0n ? fmtMicro(have) : null} onMax={() => have && setAmt(String(microToUsd(have > usdToMicro(LIMITS.maxDepositUsd) ? usdToMicro(LIMITS.maxDepositUsd) : have)))} presets={[5, 10, 25, 50]} onPreset={(n) => setAmt(String(n))} />
      {have === 0n ? (
        <div className="notice info"><Icon name="info" /><p>Your wallet has no USDC on NEAR yet. <button type="button" className="link" style={{ textDecoration: "underline", fontWeight: 600 }} onClick={onChain}>Deposit from another chain</button> instead: Base, Ethereum, Solana, Arbitrum, Tron or Bitcoin.</p></div>
      ) : null}
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed text={st.error} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || st.phase === "wallet"} onClick={() => run(txs, (r) => [{ kind: "deposit", hash: r[0]?.hash ?? null, at: Date.now(), amountMicro: micro.toString() }])} data-testid="deposit-confirm">
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : micro > 0n ? `Deposit ${fmtMicro(micro)}` : "Deposit"}
      </button>
      <p className="fine">No fee from Priced In. NEAR’s network fee is under $0.01, paid in NEAR by your wallet.</p>
    </>
  );
}

// ---------- from another chain ----------

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `It answered ${r.status}.`);
  return j as T;
}

export function useRoutes(dir: "in" | "out") {
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    getJson<{ routes: Route[] }>("/bridge/tokens").then((j) => setRoutes(j.routes.filter((r) => r[dir]))).catch((e) => setErr((e as Error).message));
  }, [dir]);
  useEffect(load, [load]);
  return { routes, err, retry: load };
}

function FromChain() {
  const w = useWallet();
  const account = w.accountId!;
  const { routes, err, retry } = useRoutes("in");
  const [pending, setPending] = useState<PendingBridge | null>(() => pendingBridges(account).find((p) => p.quote.dir === "in" && !p.done) ?? null);
  const [chain, setChain] = useState("base");
  const [key, setKey] = useState("base:USDC");
  const [amt, setAmt] = useState("");
  const [refund, setRefund] = useState("");
  const [preview, setPreview] = useState<BridgeQuote | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const route = routes?.find((r) => r.key === key) ?? null;
  const chains = useMemo(() => [...new Map((routes ?? []).map((r) => [r.chain, r.chainName])).entries()], [routes]);
  const units = route ? toBaseUnits(amt, route.decimals) : null;
  const usd = route?.price && Number(amt) > 0 ? Number(amt) * route.price : null;
  const refundBad = refund && route && !validAddress(route.addr, refund) ? `That isn’t a ${route.chainName} address.` : null;
  const overCap = usd !== null && usd > LIMITS.maxDepositUsd ? `The research preview takes up to $${LIMITS.maxDepositUsd} per deposit.` : null;

  // a dry quote as you type: what arrives, at least, and how long it takes
  useEffect(() => {
    setPreview(null); setPErr(null);
    if (!route || !units || refundBad || overCap) return;
    const t = setTimeout(() => {
      getJson<{ quote: BridgeQuote }>("/bridge/quote?dir=in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ route: route.key, amount: units, recipient: account, refundTo: refund || null, dry: true }) })
        .then((j) => setPreview(j.quote)).catch((e) => setPErr((e as Error).message));
    }, 500);
    return () => clearTimeout(t);
  }, [route, units, refund, refundBad, overCap, account]);

  const start = async () => {
    if (!route || !units) return;
    setBusy(true); setPErr(null);
    try {
      const j = await getJson<{ quote: BridgeQuote }>("/bridge/quote?dir=in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ route: route.key, amount: units, recipient: account, refundTo: refund || null, dry: false }) });
      if (!j.quote.depositAddress) throw new Error("NEAR Intents didn’t issue a deposit address. Try again.");
      const p: PendingBridge = { quote: j.quote, at: Date.now(), account };
      savePendingBridge(p);
      setPending(p);
    } catch (e) { setPErr((e as Error).message); } finally { setBusy(false); }
  };

  if (pending) return <InTracker p={pending} route={routes?.find((r) => r.key === pending.quote.route) ?? null} onNew={() => setPending(null)} />;
  if (err) return <div className="notice err" role="alert"><Icon name="alert" /><p>{err} <button type="button" className="link" style={{ textDecoration: "underline", fontWeight: 600 }} onClick={retry}>Try again</button></p></div>;
  if (!routes) return <p className="fine"><span className="spin" style={{ display: "inline-block", verticalAlign: "-3px", marginRight: 8 }} />Loading chains from NEAR Intents…</p>;

  const assets = routes.filter((r) => r.chain === chain);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="m-field">
          <label htmlFor="dep-chain">From chain</label>
          <select id="dep-chain" value={chain} onChange={(e) => { setChain(e.target.value); const first = routes.find((r) => r.chain === e.target.value); if (first) setKey(first.key); setRefund(""); }}>
            {chains.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="m-field">
          <label htmlFor="dep-asset">Asset</label>
          <select id="dep-asset" value={key} onChange={(e) => setKey(e.target.value)}>
            {assets.map((r) => <option key={r.key} value={r.key}>{r.symbol}</option>)}
          </select>
        </div>
      </div>
      <div className="m-field">
        <label htmlFor="dep-amt">You send ({route?.symbol} on {route?.chainName})</label>
        <div className="m-amt">
          <input id="dep-amt" inputMode="decimal" autoComplete="off" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))} />
          <div className="side"><b style={{ color: "var(--ink2)", fontSize: 15 }}>{route?.symbol}</b>{usd !== null ? <span>≈ ${usd.toFixed(2)}</span> : null}</div>
        </div>
        {overCap ? <p className="bad" role="alert">{overCap}</p> : null}
      </div>
      <div className="m-field">
        <label htmlFor="dep-refund">Refund address on {route?.chainName} <span style={{ fontWeight: 400, color: "var(--ink3)" }}>(optional)</span></label>
        <input id="dep-refund" autoComplete="off" spellCheck={false} placeholder={route?.addr === "evm" ? "0x…" : "Your address"} value={refund} onChange={(e) => setRefund(e.target.value.trim())} />
        {refundBad ? <p className="bad">{refundBad}</p> : <p className="hint">If the swap can’t complete, it goes back here. Left empty, a refund goes to your NEAR account inside NEAR Intents.</p>}
      </div>
      {preview ? (
        <div className="m-get"><span className="k">USDC arriving in your NEAR wallet<small>at least ${(Number(preview.minAmountOut) / 1e6).toFixed(2)} · about {preview.timeEstimate < 90 ? `${preview.timeEstimate} s` : `${Math.round(preview.timeEstimate / 60)} min`} after your deposit confirms</small></span><span className="v">${Number(preview.amountOutFormatted).toFixed(2)}</span></div>
      ) : units && !pErr && !refundBad && !overCap ? <p className="fine"><span className="spin" style={{ display: "inline-block", verticalAlign: "-3px", marginRight: 8 }} />Getting a quote…</p> : null}
      {pErr ? <Failed text={pErr} /> : null}
      <button type="button" className="btn primary lg full" disabled={!preview || busy} onClick={start} data-testid="bridge-start">
        {busy ? <><span className="spin" />Getting your address…</> : "Get my deposit address"}
      </button>
      <p className="fine">Routed by NEAR Intents (1Click): solvers swap and deliver it, and nobody holds your money in between. {preview && !preview.authenticated ? "1Click adds a 0.25% routing fee, included in the quote." : ""}</p>
    </>
  );
}

function InTracker({ p, route, onNew }: { p: PendingBridge; route: Route | null; onNew: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const q = p.quote;
  const [s, setS] = useState<BridgeStatusView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const deadline = q.deadline ? Date.parse(q.deadline) : null;

  useEffect(() => {
    let off = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await getJson<BridgeStatusView>(`/bridge/status?depositAddress=${encodeURIComponent(q.depositAddress!)}${q.depositMemo ? `&depositMemo=${encodeURIComponent(q.depositMemo)}` : ""}`);
        if (off) return;
        setS(v); setErr(null);
        if (v.status === "SUCCESS") { void refreshAccount(p.account); updatePendingBridge(p.account, q.depositAddress!, { done: "SUCCESS" }); logTx(p.account, { kind: "bridge_in", hash: v.nearTxs[0] ?? null, at: Date.now(), amountMicro: q.amountOut, note: `${q.amountInFormatted} ${route?.symbol ?? ""} from ${route?.chainName ?? "another chain"}` }); }
        if (bridgeDone(v.status)) return;
      } catch (e) { if (!off) setErr((e as Error).message); }
      if (!off) t = setTimeout(poll, document.hidden ? 15_000 : 5_000);
    };
    void poll();
    return () => { off = true; clearTimeout(t); };
  }, [q.depositAddress, q.depositMemo, q.amountOut, q.amountInFormatted, p.account, route]);

  const status = s?.status ?? "PENDING_DEPOSIT";
  const arrivedMicro = s?.amountOutFormatted ? usdToMicro(Number(s.amountOutFormatted)) : BigInt(q.amountOut);
  const steps: { id: string; label: string }[] = [
    { id: "PENDING_DEPOSIT", label: `Send ${q.amountInFormatted} ${route?.symbol ?? ""} to the address` },
    { id: "KNOWN_DEPOSIT_TX", label: "Your deposit is seen on its chain" },
    { id: "PROCESSING", label: "Swapped and delivered to your NEAR wallet" },
    { id: "SUCCESS", label: "Move it into your Priced In balance" },
  ];
  const at = status === "SUCCESS" ? 3 : status === "PROCESSING" ? 2 : status === "KNOWN_DEPOSIT_TX" ? 1 : 0;

  if (moved) return <Done title="Deposited" actions={<button type="button" className="btn primary full" onClick={() => { dropPendingBridge(p.account, q.depositAddress!); openSheet(null); }}>Start betting</button>}><p>Your Priced In balance is {acct.balanceMicro !== null ? fmtMicro(acct.balanceMicro) : "updating"}.</p></Done>;

  return (
    <>
      {status === "PENDING_DEPOSIT" || status === "KNOWN_DEPOSIT_TX" ? (
        <div className="m-qr" data-testid="deposit-address">
          <QR text={q.depositAddress!} label={`Deposit address on ${route?.chainName ?? "the origin chain"}`} />
          <div style={{ minWidth: 0, width: "100%" }}>
            <span className="send">Send exactly</span>
            <span className="send"><b>{q.amountInFormatted} {route?.symbol}</b></span>
            <span className="send">on {route?.chainName}, to:</span>
            <div style={{ marginTop: 6 }}><CopyText text={q.depositAddress!} /></div>
            {q.depositMemo ? <div style={{ marginTop: 6 }}><span className="send">Memo (required)</span><CopyText text={q.depositMemo} /></div> : null}
            {deadline ? <p className="m-timer" style={{ marginTop: 8 }}><Icon name="clock" />Send within <Countdown to={deadline} /></p> : null}
          </div>
        </div>
      ) : null}
      <ol className="progress" aria-live="polite">
        {steps.map((x, i) => <li key={x.id} className={`pstep ${i < at ? "done" : i === at ? "on" : ""}`}><span className="b">{i < at ? <Icon name="check" /> : null}</span>{x.label}</li>)}
      </ol>
      {s && (status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT") ? (
        <div className="notice err" role="alert"><Icon name="alert" /><p><b>{STATUS_WORDS[status]}.</b> {s.refundedFormatted ? `${s.refundedFormatted} ${route?.symbol ?? ""} goes back to ${q.refundTo}.` : `Anything sent goes back to ${q.refundTo}.`} {s.refundReason ?? ""}</p></div>
      ) : null}
      {err ? <p className="fine">Status check: {err} Still trying.</p> : null}
      {status === "SUCCESS" ? (
        <>
          <div className="m-get"><span className="k">Arrived in your NEAR wallet</span><span className="v">{fmtMicro(arrivedMicro)}</span></div>
          <MoveIn amountMicro={acct.usdcMicro !== null && acct.usdcMicro < arrivedMicro ? acct.usdcMicro : arrivedMicro} onDone={() => setMoved(true)} />
        </>
      ) : (
        <p className="fine">You can close this: we keep watching, and your portfolio shows it until it lands. Track it on the <a href={`https://explorer.near-intents.org/?search=${q.depositAddress}`} target="_blank" rel="noopener" style={{ textDecoration: "underline" }}>NEAR Intents explorer</a>.</p>
      )}
      <button type="button" className="btn ghost full" onClick={() => { if (bridgeDone(status) || status === "PENDING_DEPOSIT") dropPendingBridge(p.account, q.depositAddress!); onNew(); }}>{status === "PENDING_DEPOSIT" ? "Cancel and start over" : "Start another deposit"}</button>
    </>
  );
}

function MoveIn({ amountMicro, onDone }: { amountMicro: bigint; onDone: () => void }) {
  const { st, run } = useSend();
  const txs = useMemo(() => (amountMicro > 0n ? [depositTx(cfg, amountMicro)] : []), [amountMicro]);
  useEffect(() => { if (st.phase === "done") onDone(); }, [st.phase, onDone]);
  return (
    <>
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed text={st.error} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || st.phase === "wallet"} data-testid="move-in"
        onClick={() => run(txs, (r) => [{ kind: "deposit", hash: r[0]?.hash ?? null, at: Date.now(), amountMicro: amountMicro.toString() }])}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : `Move ${fmtMicro(amountMicro)} into my balance`}
      </button>
    </>
  );
}
