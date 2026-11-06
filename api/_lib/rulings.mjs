// Live and past rulings, assembled from the store and the chain: the events and the jury's runs
// from the journals, each challenge's own view from the market (a finished challenge never
// changes, so its view is kept), the live dispute window from dispute_ends_ns, and, when given,
// the Sentinel's ledger (each ruling's receipt check and what the Sentinel did).

import { raceView } from "./snapshot.mjs";
import { rulingsOf } from "./views.mjs";

const finished = new Map(); // challenge id -> its view, once resolved

/** Who the accounts in the market's events are, from the agents' own answers. */
export function namesOf(p) {
  const names = new Map();
  for (const r of p.journals.readCached("rationales.jsonl").slice(-400)) if (r.account_id) names.set(r.account_id, r.persona || r.agent);
  return names;
}

/** Every challenge, with what the chain says right now about the ones still running. */
export async function readRulings(p, claims, { ledger = null } = {}) {
  const events = p.journals.readCached("events.jsonl");
  const ids = new Set();
  for (const e of events) if (e.event === "challenge" && Number.isInteger(e.data?.challenge_id)) ids.add(e.data.challenge_id);
  for (const c of claims) if (Number.isInteger(c.challenge_id)) ids.add(c.challenge_id);
  const live = new Map(), windowEnds = new Map();
  const view = (method, args) => raceView(p.api.rpcUrls, p.api.marketId, method, args, { timeoutMs: 2500 }).then((r) => r.value);
  await Promise.all([...ids].map(async (id) => {
    if (finished.has(id)) { live.set(id, finished.get(id)); return; }
    const ch = await view("get_challenge", { challenge_id: id }).catch(() => null);
    if (!ch) return; // expired: its record is gone from the chain and the events keep it
    live.set(id, ch);
    if (ch.resolved) { finished.set(id, ch); return; }
    const end = await view("dispute_ends_ns", { challenge_id: id }).catch(() => null);
    if (end) windowEnds.set(id, end);
  }));
  return rulingsOf({ events, claims, live, windowEnds, juryRuns: p.journals.readCached("jury.jsonl"), links: p.journals.readCached("links.jsonl"), names: namesOf(p), ledger });
}
