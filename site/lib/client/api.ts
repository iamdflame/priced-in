// The browser's calls for the pages that price new text. These run in the visitor's browser on
// purpose: the API limits new posts, pastes and free truth calls per address, and only a request from
// the visitor (forwarded by proxy.ts) counts against the visitor. From the server, every visitor would
// share one address and one quota.
import { Api, type Claim } from "@/lib/core/api";
import { quoteClaim, type Quotes } from "@/lib/quote";

export const browserApi = new Api({ baseUrl: "/api", live: "poll" });

export interface ClosestFact { id: number; text: string; pct: number; quotes: Quotes | null }

export type Closest = { found: ClosestFact } | { none: true } | { failed: string };

const refusal = (body: { error?: { message?: string } } | null, status: number) =>
  body?.error?.message ?? (status === 402 || status === 429 ? "You’ve used today’s free lookups." : "We couldn’t look that up just now.");

/** The live fact nearest a sentence, with its exact $1 quote. One free truth call, so only on a tap. */
export async function closestFact(sentence: string): Promise<Closest> {
  try {
    const r = await fetch(`/api/v1/credence?q=${encodeURIComponent(sentence.slice(0, 500))}&limit=1`, { headers: { accept: "application/json" } });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { failed: refusal(body, r.status) };
    const hit = body?.claims?.[0];
    if (!hit) return { none: true };
    const claim = await fetch(`/api/claims/${hit.claim_id}`, { headers: { accept: "application/json" } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const view = claim?.claim as (Claim & { status: string }) | undefined;
    return { found: { id: hit.claim_id, text: hit.text, pct: Math.round(hit.credence * 100), quotes: view?.status === "Open" ? quoteClaim(view as never) : null } };
  } catch {
    return { failed: "We couldn’t look that up just now." };
  }
}
