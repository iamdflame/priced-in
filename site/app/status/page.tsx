// /status: what's running right now, in plain words, read from the live health check (/health). Each part
// says what it does for a visitor and how it's doing. Nothing here is typed by hand: a part that isn't
// reported says so instead of guessing.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState } from "@/components/States";
import { Kpis, PageHero, SHead } from "@/components/pages/Kit";
import { ago, clockUtc, money } from "@/lib/format";
import { MARKET_ID } from "@/lib/nav";
import { api } from "@/lib/server/api";
import { problemsKpi, rpcState, statusTitle, type PartState, type RpcCheck } from "@/lib/status";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether every part of Priced In is running right now: the market on NEAR, prices, free bets, the AI traders, the AI judges and payments.",
};

interface Checks {
  rpc?: RpcCheck;
  index?: { errors: unknown[] };
  lane?: { configured: boolean; open: boolean; paused: boolean };
  coverage?: { open: number; answered_today: number };
  outcomes?: { last_trade?: string; last_answer?: string; last_rewrite?: string };
  ruling?: { next_ruling_note?: string; rulings_today?: number };
  ai?: { writer?: string; agents?: string; jury?: string; anchoring?: { anchored: number; failures: number } };
  x402?: { low: boolean };
  cron?: { last_run?: string; ok: boolean; failures: string[] };
  spend?: { spent_usd: number; cap_usd: number; open: boolean };
}
interface FullHealth { ok: boolean; network: string; failures?: string[]; checks?: Checks }

type State = PartState;
const WORD: Record<State, string> = { ok: "Running", warn: "Degraded", down: "Down", unknown: "Not reported" };
const t = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

export default async function StatusPage() {
  const r = await api.health();
  const now = Date.now();
  if (!r.ok) {
    return (
      <main id="main" className="wrap pg">
        <PageHero kick="Status" title="We couldn’t read the health check." lede="The status of each part shows here once it answers. Try again in a moment." />
        <div className="result-gap"><ErrorState message={r.error} /></div>
      </main>
    );
  }
  const h = r.value as unknown as FullHealth;
  const c = h.checks ?? {};
  const failures = [...(h.failures ?? []), ...(c.cron?.failures ?? [])];
  const best = c.rpc?.urls.filter((u) => u.ok) ?? [];
  const fastest = best.length ? Math.min(...best.map((u) => u.latencyMs ?? Infinity)) : null;
  const height = best.length ? Math.max(...best.map((u) => u.height ?? 0)) : null;
  const cronAt = t(c.cron?.last_run);
  const nodes = rpcState(c.rpc);

  const parts: { name: string; what: string; state: State; detail: string }[] = [
    {
      name: "The market on NEAR", what: "Holds every bet and pays every winner.",
      state: nodes.state,
      detail: c.rpc ? `${MARKET_ID} on NEAR ${h.network}. ${c.rpc.reachable} of ${c.rpc.urls.length} NEAR nodes answer${fastest !== null && Number.isFinite(fastest) ? `, the fastest in ${fastest} ms` : ""}${height ? `, at block ${height.toLocaleString("en-US")}` : ""}.${nodes.note ? ` ${nodes.note}` : ""}` : "Not reported.",
    },
    {
      name: "Prices and history", what: "Reads every transaction, so prices, charts and results stay current.",
      state: !c.cron ? "unknown" : !c.cron.ok || (Number.isFinite(cronAt) && now - cronAt > 30 * 60_000) ? "warn" : (c.index?.errors.length ?? 0) > 0 ? "warn" : "ok",
      detail: Number.isFinite(cronAt) ? `Last read ${ago(cronAt, now)}. It runs every 10 minutes, and a bet placed here is recorded at once.` : "Not reported.",
    },
    {
      name: "Free $1 bets", what: "One real bet per browser, with no wallet.",
      state: !c.lane ? "unknown" : !c.lane.configured || c.lane.paused ? "down" : c.lane.open ? "ok" : "warn",
      detail: !c.lane ? "Not reported." : c.lane.paused ? "Paused." : c.lane.open ? "Open." : "Today’s free bets are used up. They’re back tomorrow at 00:00 UTC; betting with a wallet still works.",
    },
    {
      name: "AI traders", what: "Three house agents that bet small amounts, so no fact sits empty.",
      state: !c.ai ? "unknown" : c.ai.agents === "on" ? "ok" : "warn",
      detail: c.coverage ? `Looked at ${c.coverage.answered_today} of ${c.coverage.open} open facts today${t(c.outcomes?.last_answer) ? `, most recently ${ago(t(c.outcomes?.last_answer), now)}` : ""}.` : "Not reported.",
    },
    {
      name: "AI judges", what: "Three attested AI models that decide doubted facts.",
      state: !c.ai ? "unknown" : c.ai.jury === "on" ? "ok" : "warn",
      detail: [c.ruling?.next_ruling_note, c.ruling?.rulings_today !== undefined ? `${c.ruling.rulings_today} decided today.` : null].filter(Boolean).join(" ") || "Not reported.",
    },
    {
      name: "Signed rewrites", what: "Rewrites a doubted line from its source, signed by the model, anchored on NEAR.",
      state: !c.ai ? "unknown" : c.ai.writer !== "on" ? "warn" : (c.ai.anchoring?.failures ?? 0) > 0 ? "warn" : "ok",
      detail: c.ai?.anchoring ? `${c.ai.anchoring.anchored} anchored on NEAR, ${c.ai.anchoring.failures} failed${t(c.outcomes?.last_rewrite) ? `. Last rewrite ${ago(t(c.outcomes?.last_rewrite), now)}` : ""}.` : "Not reported.",
    },
    {
      name: "Payments for AI agents", what: "The truth API’s paid calls, $0.01 each in USDC.",
      state: !c.x402 ? "unknown" : c.x402.low ? "warn" : "ok",
      detail: !c.x402 ? "Not reported." : c.x402.low ? "The payment relayer is low on gas." : "The payment relayer is funded.",
    },
    {
      name: "AI spending cap", what: "A hard daily limit on what the AI may spend.",
      state: !c.spend ? "unknown" : c.spend.open ? "ok" : "warn",
      detail: c.spend ? `${money(c.spend.spent_usd)} of ${money(c.spend.cap_usd, 0)} used today.${c.spend.open ? "" : " AI work resumes at 00:00 UTC."}` : "Not reported.",
    },
  ];
  const down = parts.filter((p) => p.state === "down").length;
  const warn = parts.filter((p) => p.state === "warn").length + (failures.length && !down ? 1 : 0);
  const title = statusTitle(down, warn);

  return (
    <main id="main" className="wrap pg">
      <PageHero
        kick="Status"
        title={title}
        lede={<>Read live from Priced In’s health check at {clockUtc(now)}. The check runs every minute. For machines, the same data is at <a className="link" href="/health">/health</a>.</>}
      />
      <Kpis
        label="Status at a glance"
        items={[
          { v: `${parts.filter((p) => p.state === "ok").length} of ${parts.length}`, l: "parts running" },
          { v: c.rpc ? `${c.rpc.reachable} of ${c.rpc.urls.length}` : "—", l: "NEAR nodes answering", s: nodes.state === "ok" && nodes.note ? (c.rpc && c.rpc.urls.length - c.rpc.reachable === 1 ? "the quiet one is a spare: nothing is affected" : "the quiet ones are spares: nothing is affected") : undefined },
          { v: Number.isFinite(cronAt) ? ago(cronAt, now) : "—", l: "prices last read" },
          { ...problemsKpi(failures.length), tone: failures.length ? "neg" : undefined },
        ]}
      />
      <section aria-labelledby="parts">
        <SHead id="parts" title="Each part" sub="What it does for you, and how it’s doing right now." />
        <div className="panel cc">
          {parts.map((p) => (
            <details key={p.name} open={p.state !== "ok"}>
              <summary>{p.name} · {WORD[p.state]}</summary>
              <p>{p.what} {p.detail}</p>
            </details>
          ))}
        </div>
      </section>
      {failures.length > 0 && (
        <section aria-labelledby="problems">
          <SHead id="problems" title="Problems reported" sub="Exactly as the health check reports them." />
          <div className="panel cc">
            <ul>{failures.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
          </div>
        </section>
      )}
      <section aria-labelledby="check">
        <SHead id="check" title="Check it yourself" sub="Everything here can be verified without trusting this page." />
        <div className="panel cc">
          <p>Every bet and ruling is a public transaction on <a href={`https://nearblocks.io/address/${MARKET_ID}`} target="_blank" rel="noopener">nearblocks</a>. What the house can and can’t do is on <Link href="/trust">Trust</Link>, and the live numbers are on <Link href="/stats">Stats</Link>.</p>
        </div>
      </section>
    </main>
  );
}
