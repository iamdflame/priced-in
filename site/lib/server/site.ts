// One read of the live market per request, shared by the layout (the live strip) and the pages
// (React's cache dedupes it). Every number is the API's; nothing is filled in when a read fails.
import "server-only";
import { cache } from "react";
import { agentNames, api, type ClaimV3, type Rulings } from "./api";
import { betsFrom, type Bet } from "../live";
import { toFact, type Fact } from "../model";

export interface Site {
  ok: boolean;
  error: string | null;
  facts: Fact[];
  claims: ClaimV3[];
  /** price paths by claim id: [t_ms, ppm] */
  history: Record<string, [number, number][]>;
  bets: Bet[];
  agents: Record<string, string>;
  rulings: Rulings | null;
  lane: { open: boolean; creditsLeft: number | null; paused: boolean } | null;
  totals: { facts: number; open: number; topics: number; trades: number; volumeUsd: number };
  asOf: number;
}

export const getSite = cache(async (): Promise<Site> => {
  const [claims, history, events, agents, rulings, health] = await Promise.all([api.claims(), api.historyAll(), api.events(), api.agents(), api.rulings(), api.health()]);
  const hist = history.ok ? history.value : {};
  const opens: Record<number, number> = Object.fromEntries(Object.entries(hist).map(([id, pts]) => [Number(id), pts[0]?.[1]]));
  const names = agents.ok ? agentNames(agents.value) : {};
  const list = claims.ok ? claims.value : [];
  const facts = list.map((c) => toFact(c, opens[c.id] ?? null));
  const bets = events.ok ? betsFrom(events.value, names, opens) : [];
  const lane = health.ok ? health.value.checks?.lane : undefined;
  return {
    ok: claims.ok,
    error: claims.ok ? null : claims.error,
    facts,
    claims: list,
    history: hist,
    bets,
    agents: names,
    rulings: rulings.ok ? rulings.value : null,
    lane: lane ? { open: !!lane.open && !lane.paused, creditsLeft: typeof lane.creditsLeft === "number" ? lane.creditsLeft : null, paused: !!lane.paused } : null,
    totals: {
      facts: facts.length,
      open: facts.filter((f) => f.status === "open").length,
      topics: new Set(facts.map((f) => f.topic)).size,
      trades: list.reduce((n, c) => n + c.trades, 0),
      volumeUsd: list.reduce((n, c) => n + (c.volume_usd ?? 0), 0),
    },
    asOf: Date.now(),
  };
});

/** The AI traders who bet on each claim, by persona, from the log. */
export function agentsByClaim(bets: Bet[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const b of bets) {
    if (b.kind !== "agent") continue;
    const name = b.who.replace(/^The /, "");
    const l = (out[b.claimId] ||= []);
    if (!l.includes(name)) l.push(name);
  }
  return out;
}
