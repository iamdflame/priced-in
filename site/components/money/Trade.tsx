"use client";
// Buy and sell with the Priced In balance. The market is read from the chain when the sheet opens and
// every 10 s after, the quote is the contract's own fill on it, and the slippage floor goes to the chain
// with the transaction. The success screen shows what the chain returned, not what was quoted.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { AmountInput, ApproveBox, Done, Failed, GeoLine, Loading, Sheet, TxLink } from "./ui";
import { useSend } from "./useSend";
import { moneyChain, type ClaimView, type Position } from "@/lib/money/chain";
import { moneyConfig } from "@/lib/money/config";
import { canAddMoney, canTakeOut } from "@/lib/money/geo";
import { closeSheet, openSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { DEFAULT_SLIPPAGE_BPS, isFail, QUOTE_WORDS, quoteWalletBuy, quoteWalletSell, SLIPPAGE_CHOICES } from "@/lib/money/quotes";
import { canBuy, canSell, checkBet, checkSell } from "@/lib/money/rules";
import { buyTx, sellTx, type Side } from "@/lib/money/tx";
import { fmtMicro, fmtMicroDown, fmtShares, microToInput, parseUsd } from "@/lib/money/units";

const cfg = moneyConfig();
const pct = (p: number) => `${Math.round(p * 100)}%`;
const sideWord = (s: Side) => (s === "yes" ? "Yes" : "No");

/** The trade the chain returned (the contract's Trade struct). */
interface TradeResult { shares_micro: string; amount_micro: string; fee_micro: string; price_yes_ppm_after: number }

function useMarket(claimId: number, account: string | null, paused: boolean) {
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useCallback(async () => {
    try {
      const chain = moneyChain();
      const [c, p] = await Promise.all([chain.claim(claimId), account ? chain.position(claimId, account) : null]);
      setClaim(c);
      setPosition(p);
      setFailed(false);
    } catch { setFailed(true); }
  }, [claimId, account]);
  useEffect(() => {
    if (paused) return;
    void read();
    const t = setInterval(() => { if (!document.hidden) void read(); }, 10_000);
    return () => clearInterval(t);
  }, [read, paused]);
  return { claim, position, failed, read };
}

export function TradeSheet({ claimId, question, mode: initialMode, side: initialSide, onClose }: { claimId: number; question: string; mode: "buy" | "sell"; side?: Side; onClose: () => void }) {
  const w = useWallet();
  const geo = useGeo();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const { claim, position, failed, read } = useMarket(claimId, w.accountId, busy);

  return (
    <Sheet title={mode === "buy" ? "Bet with your wallet" : "Sell your shares"} onClose={onClose}>
      <p className="m-q">{question}</p>
      {claim ? (
        <>
          <div className="m-tabs" role="tablist" aria-label="Buy or sell">
            <button type="button" role="tab" aria-selected={mode === "buy"} onClick={() => setMode("buy")}>Buy</button>
            <button type="button" role="tab" aria-selected={mode === "sell"} onClick={() => setMode("sell")}>Sell</button>
          </div>
          {mode === "buy"
            ? (canAddMoney(geo.access) ? <Buy claim={claim} initialSide={initialSide ?? null} onBusy={setBusy} onLanded={read} /> : null)
            : (canTakeOut(geo.access) ? <Sell claim={claim} position={position} initialSide={initialSide ?? null} onBusy={setBusy} onLanded={read} /> : null)}
        </>
      ) : failed ? (
        <div className="notice err" role="alert"><Icon name="alert" /><p>We couldn’t read this market from NEAR. <button type="button" className="linkbtn" onClick={read}>Try again</button></p></div>
      ) : <Loading>Reading the market from NEAR…</Loading>}
      <GeoLine />
    </Sheet>
  );
}

function Slippage({ bps, onChange }: { bps: number; onChange: (n: number) => void }) {
  return (
    <div className="m-slip">
      <span id="slip-label">If the price moves past this, cancel it</span>
      <div className="opts" role="group" aria-labelledby="slip-label">
        {SLIPPAGE_CHOICES.map((c) => <button key={c} type="button" aria-pressed={bps === c} onClick={() => onChange(c)}>{c / 100}%</button>)}
      </div>
    </div>
  );
}

function Buy({ claim, initialSide, onBusy, onLanded }: { claim: ClaimView; initialSide: Side | null; onBusy: (b: boolean) => void; onLanded: () => void }) {
  const w = useWallet();
  const acct = useAccount(w.accountId);
  const geo = useGeo();
  const [side, setSide] = useState<Side | null>(initialSide);
  const [amt, setAmt] = useState("5");
  const [slip, setSlip] = useState(DEFAULT_SLIPPAGE_BPS);
  const { st, run, reset, locked } = useSend();
  const amount = parseUsd(amt);
  const refusal = checkBet(amount, acct.balanceMicro, claim.status, geo.access);
  // the quote stands still while the wallet is open: the transaction carries the floor it was shown
  const quote = useMemo(() => (side && amount ? quoteWalletBuy(claim, side, amount, slip) : null), [claim, side, amount, slip]);
  const good = quote && !isFail(quote) ? quote : null;
  const txs = useMemo(() => (good && !refusal ? [buyTx(cfg, claim.id, good.side, good.amountMicro, good.minSharesMicro)] : []), [good, refusal, claim.id]);
  useEffect(() => onBusy(st.phase === "wallet"), [st.phase, onBusy]);

  if (st.phase === "done") {
    const t = st.results[0]?.value as TradeResult | null;
    return (
      <Done title={`You bet ${t ? fmtMicro(BigInt(t.amount_micro)) : fmtMicro(amount ?? 0n)} on ${side ? sideWord(side) : ""}`} actions={<button type="button" className="btn primary full" onClick={closeSheet}>Done</button>}>
        <p>{t ? `${fmtShares(BigInt(t.shares_micro))} shares. If you’re right, you get ${fmtMicroDown(BigInt(t.shares_micro))} back. It’s now ${pct(t.price_yes_ppm_after / 1e6)} chance it’s true.` : "Your bet is on the chain."} Done in {(st.ms / 1000).toFixed(1)} s.</p>
        <TxLink hash={st.results[0]?.hash ?? null} />
        <Link className="fine" href="/portfolio" onClick={closeSheet}>See it in your portfolio</Link>
      </Done>
    );
  }
  if (!canBuy(claim.status)) return <p className="decide">This market isn’t open for new bets right now. If you hold shares, you can still sell them.</p>;

  const short = acct.balanceMicro !== null && amount !== null && amount > acct.balanceMicro;
  return (
    <>
      <div className="seg" role="group" aria-label="Pick a side">
        <button type="button" className="y" aria-pressed={side === "yes"} onClick={() => setSide("yes")}>Yes, it’s true<small>{pct(claim.price_yes_ppm / 1e6)} chance</small></button>
        <button type="button" className="n" aria-pressed={side === "no"} onClick={() => setSide("no")}>No, it’s false<small>{pct(1 - claim.price_yes_ppm / 1e6)} chance</small></button>
      </div>
      <AmountInput label="Amount" value={amt} onChange={(v) => { setAmt(v); if (st.phase === "failed") reset(); }} invalid={refusal}
        side={<span>Balance: {acct.balanceMicro === null ? "…" : fmtMicro(acct.balanceMicro)}</span>}
        max={acct.balanceMicro ? fmtMicro(acct.balanceMicro) : null} onMax={() => { if (acct.balanceMicro) setAmt(microToInput(acct.balanceMicro)); }} presets={[1, 5, 10, 25]} onPreset={(n) => setAmt(String(n))} />
      {short ? <button type="button" className="btn soft full" onClick={() => openSheet({ kind: "deposit" })}>Deposit</button> : null}
      {quote && isFail(quote) ? <div className="notice"><Icon name="info" /><p>{QUOTE_WORDS[quote.error]}</p></div> : null}
      {good ? (
        <>
          <div className="m-get" data-testid="trade-get"><span className="k">If you’re right, you get back<small>Bet {fmtMicro(good.paidMicro)} → get {fmtMicroDown(good.sharesMicro)} back</small></span><span className="v">{fmtMicroDown(good.sharesMicro)}</span></div>
          <div className="m-rows">
            <div className="kv"><span>Your bet moves it to</span><b>{pct(good.priceAfter)} chance it’s true</b></div>
            <div className="kv"><span>Fee ({good.feeBps / 100}%, included)</span><b>{fmtMicro(good.feeMicro)}</b></div>
          </div>
          <Slippage bps={slip} onChange={setSlip} />
        </>
      ) : null}
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed state={st} /> : null}
      <button type="button" className={`btn lg full ${side === "no" ? "nofill" : "yesfill"}`} disabled={!txs.length || locked} data-testid="trade-confirm"
        onClick={async () => {
          const results = await run(txs, (r) => { const t = r.value as TradeResult | null; return { kind: "buy", hash: r.hash, at: Date.now(), amountMicro: t?.amount_micro ?? good!.paidMicro.toString(), claimId: claim.id, side: good!.side, sharesMicro: t?.shares_micro ?? good!.sharesMicro.toString(), question: claim.text }; });
          if (results.some((r) => r.ok)) onLanded();
        }}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : good ? `Bet ${fmtMicro(good.paidMicro)} on ${sideWord(good.side)}` : "Pick a side"}
      </button>
    </>
  );
}

function Sell({ claim, position, initialSide, onBusy, onLanded }: { claim: ClaimView; position: Position | null; initialSide: Side | null; onBusy: (b: boolean) => void; onLanded: () => void }) {
  const geo = useGeo();
  const yes = BigInt(position?.yes_micro ?? 0), no = BigInt(position?.no_micro ?? 0);
  const [picked, setPicked] = useState<Side | null>(initialSide);
  const side: Side = picked ?? (no > yes ? "no" : "yes");
  const held = side === "yes" ? yes : no;
  const [typed, setTyped] = useState<string | null>(null);
  const [slip, setSlip] = useState(DEFAULT_SLIPPAGE_BPS);
  const { st, run, reset, locked } = useSend();
  const input = typed ?? (held > 0n ? microToInput(held) : "");
  const shares = parseUsd(input);
  const refusal = position ? checkSell(shares, held, claim.status, geo.access) : null;
  const quote = useMemo(() => (shares && !refusal ? quoteWalletSell(claim, side, shares, slip) : null), [claim, side, shares, slip, refusal]);
  const good = quote && !isFail(quote) ? quote : null;
  const txs = useMemo(() => (good ? [sellTx(cfg, claim.id, good.side, good.sharesMicro, good.minProceedsMicro)] : []), [good, claim.id]);
  useEffect(() => onBusy(st.phase === "wallet"), [st.phase, onBusy]);

  if (st.phase === "done") {
    const t = st.results[0]?.value as TradeResult | null;
    return (
      <Done title={`Sold for ${t ? fmtMicro(BigInt(t.amount_micro)) : good ? fmtMicro(good.receivedMicro) : ""}`} actions={<button type="button" className="btn primary full" onClick={closeSheet}>Done</button>}>
        <p>It’s in your Priced In balance. Done in {(st.ms / 1000).toFixed(1)} s.</p>
        <TxLink hash={st.results[0]?.hash ?? null} />
      </Done>
    );
  }
  if (!canSell(claim.status)) return <p className="decide">This market has been decided. Winning shares are collected from your portfolio.</p>;
  if (!position) return <Loading>Reading your shares…</Loading>;
  if (yes === 0n && no === 0n) return <p className="decide">You don’t hold any shares in this market from this wallet.</p>;

  return (
    <>
      {yes > 0n && no > 0n ? (
        <div className="seg" role="group" aria-label="Which shares">
          <button type="button" className="y" aria-pressed={side === "yes"} onClick={() => { setPicked("yes"); setTyped(null); }}>Yes<small>{fmtShares(yes)} shares</small></button>
          <button type="button" className="n" aria-pressed={side === "no"} onClick={() => { setPicked("no"); setTyped(null); }}>No<small>{fmtShares(no)} shares</small></button>
        </div>
      ) : null}
      <div className="m-field">
        <label htmlFor="sell-shares" className="m-label">{sideWord(side)} shares to sell</label>
        <div className="m-amt">
          <input id="sell-shares" inputMode="decimal" autoComplete="off" placeholder="0" value={input} aria-invalid={refusal ? true : undefined} onChange={(e) => { setTyped(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")); if (st.phase === "failed") reset(); }} />
          <div className="side"><span>You hold {fmtShares(held)}</span><button type="button" onClick={() => setTyped(null)}>All</button></div>
        </div>
        {refusal ? <p className="bad" role="alert">{refusal}</p> : null}
      </div>
      {quote && isFail(quote) ? <div className="notice"><Icon name="info" /><p>{QUOTE_WORDS[quote.error]}</p></div> : null}
      {good ? (
        <>
          <div className="m-get" data-testid="trade-get"><span className="k">You get now<small>into your Priced In balance</small></span><span className="v ink">{fmtMicroDown(good.receivedMicro)}</span></div>
          <div className="m-rows">
            <div className="kv"><span>Your sale moves it to</span><b>{pct(good.priceAfter)} chance it’s true</b></div>
            <div className="kv"><span>Fee ({good.feeBps / 100}%, included)</span><b>{fmtMicro(good.feeMicro)}</b></div>
          </div>
          <Slippage bps={slip} onChange={setSlip} />
        </>
      ) : null}
      <ApproveBox txs={txs} />
      {st.phase === "failed" ? <Failed state={st} /> : null}
      <button type="button" className="btn primary lg full" disabled={!txs.length || locked} data-testid="trade-confirm"
        onClick={async () => {
          const results = await run(txs, (r) => { const t = r.value as TradeResult | null; return { kind: "sell", hash: r.hash, at: Date.now(), amountMicro: t?.amount_micro ?? good!.receivedMicro.toString(), claimId: claim.id, side: good!.side, sharesMicro: good!.sharesMicro.toString(), question: claim.text }; });
          if (results.some((r) => r.ok)) onLanded();
        }}>
        {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : good ? `Sell for ${fmtMicroDown(good.receivedMicro)}` : "Sell"}
      </button>
    </>
  );
}
