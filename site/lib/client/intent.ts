// A tap on a card's Yes or No, carried to the fact's page, so the ticket can ask for the free $1 key at
// once without a crawler's visit to the same link ever doing so.
const KEY = "pricedin.intent";
const FRESH_MS = 60_000;

export function markIntent() {
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* private mode: the ticket waits for its own tap */ }
}

/** True once, right after a person tapped through. */
export function takeIntent(): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY) || 0);
    sessionStorage.removeItem(KEY);
    return Date.now() - at < FRESH_MS;
  } catch { return false; }
}
