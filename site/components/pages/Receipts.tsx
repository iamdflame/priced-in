// What a challenge's receipts were, checked where they live (receipt_check), and what the Sentinel did
// about it (sentinel): one line per ruling, opening to the quotes found, the sources fetched with their
// status and hash, and the Sentinel's own note. Both come from /api/rulings; null says nothing checked yet.
import { Icon, type IconName } from "../Icon";
import type { ReceiptCheck, Ruling, SentinelWatch } from "@/lib/server/api";
import { shortHash } from "@/lib/format";

const RESULT: Record<string, { word: string; tone: "ok" | "bad" | "none"; icon: IconName }> = {
  verified: { word: "Receipts verified", tone: "ok", icon: "check" },
  quote_not_found: { word: "Receipts failed: the words aren’t there", tone: "bad", icon: "x" },
  unfetchable: { word: "Receipts failed: the page couldn’t be read", tone: "bad", icon: "x" },
  record_mismatch: { word: "Receipts failed: the record doesn’t match", tone: "bad", icon: "x" },
  no_receipt: { word: "No receipts given", tone: "none", icon: "info" },
  unsupported: { word: "Receipts don’t back it", tone: "bad", icon: "x" },
};

const SENTINEL: Record<string, string> = {
  watching: "The Sentinel is watching",
  disputed: "The Sentinel disputed it",
  no_dispute: "The Sentinel saw no need to dispute",
  blocked: "The Sentinel couldn’t dispute",
};

const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const clip = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

function where(c: ReceiptCheck) {
  if (c.result !== "verified") return null;
  return c.via === "corpus" ? "against our committed record" : "at the source";
}

export function Receipts({ r }: { r: Ruling }) {
  const c = r.receipt_check ?? null;
  const s: SentinelWatch | null = r.sentinel ?? null;
  if (!c && !s) return <p className="rcpt none"><Icon name="info" />Not checked: this challenge came before receipts were checked at their source.</p>;
  const res = c ? RESULT[c.result] ?? { word: c.result, tone: "none" as const, icon: "info" as IconName } : null;
  return (
    <details className={`rcpt ${res?.tone ?? "none"}`}>
      <summary>
        {res && c && <span className="rcpt-k"><Icon name={res.icon} />{res.word}{where(c) ? ` ${where(c)}` : ""}</span>}
        {s && <span className="rcpt-s">{SENTINEL[s.status] ?? s.status}</span>}
      </summary>
      <div className="rcpt-b">
        {c && <p>{c.reason}</p>}
        {c?.record && <p className="rcpt-rec">Our record <span className="mono">{c.record.id}</span>: {c.record.found ? "found" : "not found"}, hash {c.record.hash_matches ? "matches" : "differs"}, sentence {c.record.sentence_matches ? "matches" : "differs"}.</p>}
        {c && c.quotes.length > 0 && (
          <ul className="rcpt-q">
            {c.quotes.map((q, i) => (
              <li key={i} className={q.found ? "ok" : "bad"}><Icon name={q.found ? "check" : "x"} /><span>“{clip(q.text)}”{q.url ? <> at <a className="link" href={q.url} target="_blank" rel="noopener nofollow">{host(q.url)}</a></> : null}</span></li>
            ))}
          </ul>
        )}
        {c && c.sources.length > 0 && (
          <ul className="rcpt-src">
            {c.sources.map((x, i) => (
              <li key={i}><a href={x.url} target="_blank" rel="noopener nofollow">{host(x.url)}</a><span>{x.status ? `HTTP ${x.status}` : x.error ?? "no answer"}{x.sha256 ? <> · sha256 <span className="mono">{shortHash(x.sha256, 8, 6)}</span></> : null}</span></li>
            ))}
          </ul>
        )}
        {s && <p className="rcpt-sn"><b>Sentinel:</b> {s.note}{s.disputes.length ? ` ${s.disputes.length === 1 ? "One dispute" : `${s.disputes.length} disputes`} on-chain.` : ""}</p>}
      </div>
    </details>
  );
}
