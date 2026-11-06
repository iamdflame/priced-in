"use client";
// The browser's calls to this site's /bridge routes, which do the talking to NEAR Intents 1Click.
import type { BridgeQuote, BridgeRoute, BridgeStatusView } from "./oneclick";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message ?? "NEAR Intents didn’t answer. Try again in a moment.");
  return j as T;
}

const post = (body: object): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchRoutes = () => json<{ routes: BridgeRoute[] }>("/bridge/tokens").then((j) => j.routes);

export interface InRequest { route: string; amount: string; recipient: string; refundTo: string | null; dry: boolean }
export const quoteIn = (b: InRequest) => json<{ quote: BridgeQuote }>("/bridge/quote?dir=in", post(b)).then((j) => j.quote);

export interface OutRequest { route: string; amountMicro: string; recipient: string; refundTo: string; dry: boolean }
export const quoteOut = (b: OutRequest) => json<{ quote: BridgeQuote }>("/bridge/quote?dir=out", post(b)).then((j) => j.quote);

export function fetchStatus(q: Pick<BridgeQuote, "depositAddress" | "depositMemo">) {
  const u = new URLSearchParams({ depositAddress: q.depositAddress ?? "" });
  if (q.depositMemo) u.set("depositMemo", q.depositMemo);
  return json<BridgeStatusView>(`/bridge/status?${u}`);
}

/** Optional: tells 1Click the deposit went out, so it starts sooner. Its failure changes nothing. */
export const submitDeposit = (depositAddress: string, txHash: string) => json("/bridge/submit", post({ depositAddress, txHash })).catch(() => null);
