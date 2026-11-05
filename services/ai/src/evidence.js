// Sourced corrections the writer may use. They come from our own measurement
// (corpus/ERRORS.json): a value on a pinned Wikipedia revision that a primary source contradicts
// today, with the receipt that shows it and the date it was checked. When the market says such a
// sentence is probably wrong, the writer may correct it to the source's value and say whose
// value it is, instead of only hedging. It never adds a figure that is not here.
import errors from "../../../corpus/ERRORS.json" with { type: "json" };

// whose source, in a few words a reader understands (the receipts are URLs)
const OWNERS = [
  [/(^|\.)tether\.(to|io)$/, "Tether"],
  [/(^|\.)ctfassets\.net$/, "Tether's attestation report"],
  [/(^|\.)polymarket\.com$/, "Polymarket"],
  [/(^|\.)kalshi\.com$/, "Kalshi"],
  [/(^|\.)sky\.money$/, "Sky"],
  [/(^|\.)etherscan\.io$/, "Etherscan"],
  [/(^|\.)defillama\.com$/, "DefiLlama"],
  [/^raw\.githubusercontent\.com$/, "the token's own contract code"],
];

export const normText = (t) => String(t ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

function ownerOf(url) {
  let host;
  try { host = new URL(url).host.replace(/^www\./, ""); } catch { return null; }
  for (const [re, name] of OWNERS) if (re.test(host)) return { name, host };
  return { name: host, host };
}

const BY_TEXT = new Map();
for (const e of errors.items || []) {
  const receipt = (e.receipts || []).find((r) => /^https:\/\//.test(r.url || ""));
  if (!receipt || !e.valueToday || !e.sentence) continue;
  const owner = ownerOf(receipt.url);
  BY_TEXT.set(normText(e.sentence), {
    corpus_id: e.id,
    verdict: e.verdict, // "stale" or "wrong"
    value_on_page: e.valueOnPage || null,
    value_today: e.valueToday,
    source_name: owner?.name || null,
    source_url: receipt.url,
    receipt_match: typeof receipt.match === "string" ? receipt.match.replace(/\s+/g, " ").trim().slice(0, 400) : null,
    checked_on: e.checkedOn || errors.checkedOn || null,
  });
}

/** The sourced correction for a sentence, or null. */
export function corpusEvidence(text) {
  return BY_TEXT.get(normText(text)) || null;
}
