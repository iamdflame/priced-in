"use client";
// /portfolio: the wallet (balance, what can be collected, open positions with value and P&L, money on its
// way, history with tx links) and the free $1 (its positions, what they're worth, and the score). The
// rules are in lib/money/portfolio.ts; this renders them. Polled while the tab is visible.
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "../Icon";
import { Sk } from "../States";
import { GeoLine } from "./ui";
import { useBridgeStatus } from "./useBridge";
import { moneyChain } from "@/lib/money/chain";
import { moneyConfig } from "@/lib/money/config";
import { canAddMoney, canTakeOut } from "@/lib/money/geo";
import { openSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { onLedger, pendingBridges, txLog, type PendingBridge, type TxRecord } from "@/lib/money/ledger";
import { STATUS_WORDS } from "@/lib/money/oneclick";
import { chainRow, fetchPortfolio, groupPositions, mergeHistory, scoreOf, unindexedClaims, type HistoryRow, type Portfolio, type PositionRow } from "@/lib/money/portfolio";
import { canSell } from "@/lib/money/rules";
import { fmtMicro } from "@/lib/money/units";
import { ago, explorerTx, money, shortHash } from "@/lib/format";

/** What the page knows about a fact, from the server. */
export interface FactRef { id: number; question: string; art: string; status: "Open" | "Challenged" | "Escalated" | "Settled"; price: number }
export type FactMap = Record<number, FactRef>;

const NO_TX: TxRecord[] = [];
const NO_BRIDGES: PendingBridge[] = [];

function useLedger<T>(read: () => T[], empty: T[]) {
  const [list, setList] = useState<T[]>(empty);
  useEffect(() => { const sync = () => setList(read()); sync(); return onLedger(sync); }, [read]);
  return list;
}

function usePortfolio(trader: string | null) {
  const [data, setData] = useState<Portfolio | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useCallback(() => {
    if (!trader) return;
    fetchPortfolio(trader).then((p) => { setData(p); setFailed(false); }, () => setFailed(true));
  }, [trader]);
  useEffect(() => {
    setData(null);
    read();
    const t = setInterval(() => { if (!document.hidden) read(); }, 15_000);
    return () => clearInterval(t);
  }, [read]);
  return { data, failed, retry: read };
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
const tone = (n: number | null) => (n === null || Math.abs(n) < 0.005 ? "" : n > 0 ? "up" : "down");

function Stat({ k, v, s, sTone = "", lead = false, children }: { k: string; v: string; s?: string; sTone?: string; lead?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`panel pf-stat ${lead ? "lead" : ""}`}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {s ? <span className={`s ${sTone}`}>{s}</span> : null}
      {children}
    </div>
  );
}

function Row({ r, facts, free }: { r: PositionRow; facts: FactMap; free: boolean }) {
  const geo = useGeo();
  const f = facts[r.claim_id];
  const question = f?.question ?? `Fact ${r.claim_id}`;
  const open = r.state === "open" || r.state === "ruling";
  return (
    <article className={`panel pf-row ${r.redeemable && !free ? "win" : ""}`}>
      <div className="art">{f ? <Image src={`/art/${f.art}.webp`} alt="" width={64} height={64} /> : null}</div>
      <div className="mid">
        <div className="chips">
          <span className={`chip ${r.side}`}>You said: {r.side === "yes" ? "true" : "false"}</span>
          {r.state === "ruling" ? <span className="chip warn">AI judges deciding</span> : null}
          {r.state === "won" || r.state === "collected" ? <span className="chip yes">You called it</span> : null}
          {r.state === "lost" ? <span className="chip">Didn’t win</span> : null}
        </div>
        <h3 className="q"><Link href={`/c/${r.claim_id}`}>{question}</Link></h3>
        <div className="nums">
          {r.shares > 0 ? <span>Shares <b>{r.shares.toFixed(2)}</b></span> : null}
          {r.value_usd !== null ? <span>{open ? "Worth at today’s chance" : "Worth"} <b>{money(r.value_usd)}</b></span> : null}
          {!free && r.pnl_usd !== null ? <span>Profit or loss <b className={tone(r.pnl_usd)}>{signed(r.pnl_usd)}</b></span> : null}
        </div>
      </div>
      {free ? null : (
        <div className="acts4">
          {r.redeemable && canTakeOut(geo.access) ? <button type="button" className="btn primary" data-testid={`collect-${r.claim_id}`} onClick={() => openSheet({ kind: "collect", claimId: r.claim_id, question, winMicro: String(Math.round(r.redeem_usd * 1e6)) })}>You called it · collect {money(r.redeem_usd)}</button> : null}
          {open && r.shares > 0 && canTakeOut(geo.access) && (!f || canSell(f.status)) ? <button type="button" className="btn soft" data-testid={`sell-${r.claim_id}`} onClick={() => openSheet({ kind: "trade", claimId: r.claim_id, question, mode: "sell", side: r.side })}>Sell</button> : null}
        </div>
      )}
    </article>
  );
}

function Bridge({ p }: { p: PendingBridge }) {
  const { status } = useBridgeStatus(p.quote);
  const state = status?.status ?? (p.stage === "landed" ? "SUCCESS" : "PENDING_DEPOSIT");
  const incoming = p.quote.dir === "in";
  return (
    <article className="panel pf-pending">
      <span className="spin" aria-hidden="true" />
      <div className="w">
        <b>{incoming ? `Deposit of ${p.quote.amountInFormatted}` : `Withdrawal of ${fmtMicro(BigInt(p.quote.amountIn))}`}</b>
        <span>{STATUS_WORDS[state]}</span>
      </div>
      <button type="button" className="btn soft" onClick={() => openSheet({ kind: incoming ? "deposit" : "withdraw", tab: "chain" })}>{incoming && state === "SUCCESS" ? "Move into my balance" : "Open"}</button>
    </article>
  );
}

const HISTORY: Record<HistoryRow["kind"], { word: string; icon: IconName; plus: boolean }> = {
  deposit: { word: "Deposited", icon: "down", plus: true },
  bridge_in: { word: "Arrived from another chain", icon: "down", plus: false },
  withdraw: { word: "Withdrew", icon: "share", plus: false },
  bridge_out: { word: "Sent to another chain", icon: "share", plus: false },
  refund: { word: "Withdrawal returned", icon: "refresh", plus: true },
  buy: { word: "Bet", icon: "pulse", plus: false },
  sell: { word: "Sold", icon: "coin", plus: true },
  collect: { word: "Collected", icon: "check", plus: true },
};

function History({ rows, facts }: { rows: HistoryRow[]; facts: FactMap }) {
  const now = useSyncExternalStore(() => () => {}, () => Math.floor(Date.now() / 60_000) * 60_000, () => 0);
  if (!rows.length) return null;
  return (
    <>
      <div className="pf-sec"><h2>History</h2><span className="n">Every line is a public NEAR transaction</span></div>
      <ul className="panel pf-hist" data-testid="history">
        {rows.slice(0, 30).map((r, i) => {
          const h = HISTORY[r.kind];
          return (
            <li key={`${r.tx ?? "local"}:${r.kind}:${i}`}>
              <span className="hi"><Icon name={h.icon} /></span>
              <div className="w"><b>{h.word}{r.side ? ` ${r.side === "yes" ? "Yes" : "No"}` : ""}</b><span>{r.claim_id !== null ? facts[r.claim_id]?.question ?? `Fact ${r.claim_id}` : now ? ago(r.at, now) : ""}</span></div>
              <div className="amt"><span className={h.plus ? "plus" : ""}>{h.plus ? "+" : ""}{money(r.amount_usd)}</span>{r.tx ? <a href={explorerTx(r.tx)} target="_blank" rel="noopener">{shortHash(r.tx, 5, 4)}</a> : null}</div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Wallet({ account, facts }: { account: string; facts: FactMap }) {
  const acct = useAccount(account);
  const geo = useGeo();
  const { data, failed, retry } = usePortfolio(account);
  const readTx = useCallback(() => txLog(account), [account]);
  const readBridges = useCallback(() => pendingBridges(account), [account]);
  const local = useLedger(readTx, NO_TX);
  const bridges = useLedger(readBridges, NO_BRIDGES);

  // a fresh bet shows at once, from the chain, before the indexer reaches it
  const [fresh, setFresh] = useState<PositionRow[]>([]);
  const missing = useMemo(() => (data ? unindexedClaims(data.positions, local) : []), [data, local]);
  useEffect(() => {
    let off = false;
    if (!missing.length) { setFresh([]); return; }
    Promise.all(missing.map(async (id) => {
      const p = await moneyChain().position(id, account);
      const price = facts[id]?.price ?? null;
      return [["yes", p.yes_micro], ["no", p.no_micro]].filter(([, m]) => BigInt(m) > 0n).map(([side, m]) => chainRow(id, side as "yes" | "no", BigInt(m), price, local));
    })).then((rows) => { if (!off) setFresh(rows.flat()); }, () => {});
    return () => { off = true; };
  }, [missing, account, facts, local]);

  const rows = useMemo(() => [...fresh, ...(data?.positions ?? [])], [fresh, data]);
  const g = groupPositions(rows);
  const history = useMemo(() => mergeHistory(data?.history ?? [], local), [data, local]);
  const value = g.open.reduce((n, r) => n + (r.value_usd ?? 0), 0);
  const pnl = rows.reduce((n, r) => n + (r.pnl_usd ?? 0), 0);
  const collectUsd = g.collect.reduce((n, r) => n + r.redeem_usd, 0);

  return (
    <section aria-labelledby="pf-wallet">
      <div className="pf-sec"><h2 id="pf-wallet"><Icon name="wallet" />Your wallet</h2><span className="n">{account}</span></div>
      <div className="pf-stats">
        <Stat k="Priced In balance" v={acct.balanceMicro === null ? "…" : fmtMicro(acct.balanceMicro)} lead>
          <div className="acts3">
            {canAddMoney(geo.access) ? <button type="button" className="btn primary" data-testid="pf-deposit" onClick={() => openSheet({ kind: "deposit" })}>Deposit</button> : null}
            {canTakeOut(geo.access) ? <button type="button" className="btn soft" data-testid="pf-withdraw" onClick={() => openSheet({ kind: "withdraw" })}>Withdraw</button> : null}
          </div>
        </Stat>
        <Stat k="Open bets are worth" v={money(value)} s={`${g.open.length} open`} />
        <Stat k="Profit or loss" v={signed(pnl)} sTone={tone(pnl)} s="all time" />
        <Stat k="Ready to collect" v={money(collectUsd)} s={acct.usdcMicro ? `${fmtMicro(acct.usdcMicro)} USDC in your NEAR wallet` : undefined} />
      </div>
      <div className="pf-note"><GeoLine /></div>
      {failed ? <div className="notice err" role="alert"><Icon name="alert" /><p>We couldn’t load your positions. Your money is safe on NEAR. <button type="button" className="linkbtn" onClick={retry}>Try again</button></p></div> : null}
      {bridges.length ? <div className="pf-list pf-gap">{bridges.map((p) => <Bridge key={p.quote.depositAddress} p={p} />)}</div> : null}
      {g.collect.length ? <><div className="pf-sec"><h2>Ready to collect</h2></div><div className="pf-list">{g.collect.map((r) => <Row key={`${r.claim_id}${r.side}`} r={r} facts={facts} free={false} />)}</div></> : null}
      <div className="pf-sec"><h2>Open bets</h2><span className="n">{g.open.length ? "Selling pays a little less than today’s chance, because a sale moves the price" : ""}</span></div>
      {g.open.length ? <div className="pf-list">{g.open.map((r) => <Row key={`${r.claim_id}${r.side}`} r={r} facts={facts} free={false} />)}</div>
        : data || failed ? <div className="panel pf-empty"><div><h3>No open bets from this wallet</h3><p>Pick a fact and bet with your balance.</p></div><Link className="btn soft" href="/#facts">See the facts</Link></div>
        : <Sk h={88} r={20} />}
      {g.past.length ? <><div className="pf-sec"><h2>Decided and closed</h2></div><div className="pf-list">{g.past.map((r) => <Row key={`${r.claim_id}${r.side}`} r={r} facts={facts} free={false} />)}</div></> : null}
      <History rows={history} facts={facts} />
    </section>
  );
}

function FreeBet({ facts }: { facts: FactMap }) {
  const [trader, setTrader] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // only a browser that already has the key: reading this page must never make one
    let off = false;
    import("@/lib/core/lane").then(({ browserKeyStore }) => {
      if (!browserKeyStore(moneyConfig().network).get()) { if (!off) setTrader(null); return; }
      import("@/lib/client/engine").then(({ liveEngine }) => { if (!off) setTrader(liveEngine().lane.trader); });
    }, () => { if (!off) setTrader(null); });
    return () => { off = true; };
  }, []);
  const { data } = usePortfolio(trader ?? null);
  const rows = (data?.positions ?? []).filter((r) => r.shares > 0 || r.state === "collected");
  const worth = rows.reduce((n, r) => n + (r.value_usd ?? 0), 0);
  return (
    <section aria-labelledby="pf-free">
      <div className="pf-sec"><h2 id="pf-free"><Icon name="gift" />Your free $1</h2><span className="score-note">Free winnings are score, not cash</span></div>
      {rows.length ? (
        <>
          <div className="pf-stats pf-stats-2">
            <Stat k="Your free $1 is worth" v={money(worth)} lead />
            <Stat k="Score" v={scoreOf(rows).toFixed(2)} s="What your decided free bets won" />
          </div>
          <div className="pf-list pf-gap">{rows.map((r) => <Row key={`${r.claim_id}${r.side}`} r={r} facts={facts} free />)}</div>
        </>
      ) : trader === undefined || (trader && !data) ? <Sk h={88} r={20} /> : (
        <div className="panel pf-empty"><div><h3>Your free $1 is ready</h3><p>Tap Yes or No on any fact. No wallet, no sign-up.</p></div><Link className="btn primary" href="/#facts">Pick a fact</Link></div>
      )}
    </section>
  );
}

function ConnectCard() {
  return (
    <section className="panel pf-connect" aria-label="Connect a wallet">
      <div>
        <h2>Bet with real USDC</h2>
        <p>Connect a NEAR wallet, or deposit from another chain. Sell, collect and withdraw any time.</p>
        <ul>
          {["Deposit from Base, Ethereum, Solana, Bitcoin and more", "You approve every payment", "Your money stays in the public contract"].map((t) => <li key={t}><Icon name="check" />{t}</li>)}
        </ul>
      </div>
      <button type="button" className="btn primary lg" data-testid="pf-connect" onClick={() => openSheet({ kind: "connect" })}><Icon name="wallet" />Connect wallet</button>
    </section>
  );
}

export function PortfolioView({ facts }: { facts: FactMap }) {
  const w = useWallet();
  return (
    <main id="main" className="wrap pf">
      <div className="pf-top"><div><h1>Portfolio</h1><p>What you hold, what it’s worth and what you can collect.</p></div></div>
      {w.accountId ? <><Wallet account={w.accountId} facts={facts} /><FreeBet facts={facts} /></> : <><FreeBet facts={facts} /><div className="pf-gap-lg"><ConnectCard /></div></>}
    </main>
  );
}
