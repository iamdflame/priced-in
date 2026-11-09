// The top of an official page with rulings: each line three AI judges ruled false, Wikipedia's sentence struck
// and the page's sentence now highlighted, with the source, what the market said before the ruling, the
// ruling, the payout and the signed rewrite. Every number comes from the page API's `corrections`; a field it
// couldn't fill leaves its line out. No rulings, no block.
import Link from "next/link";
import { Icon } from "../Icon";
import { modelShort, money, plural, shortHash } from "@/lib/format";
import type { PageCorrection } from "@/lib/pages";

/** Shown open; the rest wait behind one tap so the article stays near the top. */
const OPEN = 3;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SIDE = { yes: "Yes", no: "No" } as const;

/** Where a ruling is told in full: its row on /rulings, else the fact's own page. */
export const rulingHref = (c: Pick<PageCorrection, "challenge_id" | "url">) => (c.challenge_id !== null ? `/rulings#ruling-${c.challenge_id}` : c.url);

/** The plain words each correction says, or null where the API had nothing to say. Pure, for the tests. */
export function correctionWords(c: PageCorrection) {
  const pct = c.price_before === null ? null : Math.round(c.price_before * 100);
  const market = pct === null ? null
    : c.trades > 0 ? { lead: "The market had it at", pct: `${pct}% chance it’s true`, tail: ` before the ruling, after ${plural(c.trades, "bet")}.` }
      : { lead: "Nobody had bet yet. Our AI’s estimate was", pct: `${pct}% chance it’s true`, tail: " before the ruling." };
  const ruled = `${cap(c.by)} ruled it ${c.outcome ?? "false"}`;
  const side = c.payout?.side ? SIDE[c.payout.side] : null;
  const paid = !c.payout || !side ? null : c.payout.usd >= 0.005 ? { money: money(c.payout.usd), text: ` paid to ${side}` } : { money: null, text: `Nobody had bet on ${side}, so nothing was paid out` };
  const r = c.rewrite;
  const rewrite = r ? `Rewritten by ${modelShort(r.model)}${r.signed ? ", signed in a TEE" : ", waiting for its signature"}${r.tx ? ", anchored on NEAR" : ""}` : null;
  return { market, ruled, paid, side: c.payout?.side ?? null, rewrite };
}

function Correction({ c, lead }: { c: PageCorrection; lead: boolean }) {
  const w = correctionWords(c);
  const fixed = c.corrected?.text ?? null;
  const src = c.source;
  return (
    <li className={`crx${lead ? " lead" : ""}`}>
      <div className="crx-ba">
        <span className="crx-k">Wikipedia</span>
        <del>{c.wikipedia ?? c.text}</del>
        {fixed && <><span className="crx-k">Now</span><ins>{fixed}</ins></>}
      </div>
      {src?.url && (
        <p className="crx-src">
          {src.figure ? <><b>{src.figure}</b>, according to </> : "Source: "}
          <a className="link" href={src.url} target="_blank" rel="noopener">{src.name ?? "the source"}<Icon name="ext" /></a>
        </p>
      )}
      <ul className="crx-proof">
        {w.market && <li><Icon name="trend" /><span>{w.market.lead} <b>{w.market.pct}</b>{w.market.tail}</span></li>}
        <li><Icon name="gavel" /><Link className="link" href={rulingHref(c)}>{w.ruled}</Link></li>
        {w.paid && <li><Icon name="coin" /><span>{w.paid.money ? <><b className={`crx-paid ${w.side ?? ""}`}>{w.paid.money}{w.paid.text}</b></> : w.paid.text}</span></li>}
        {w.rewrite && c.rewrite && (
          <li><Icon name="shield" /><span>{w.rewrite}{c.rewrite.tx && c.rewrite.explorer && <> <a className="link crx-hash" href={c.rewrite.explorer} target="_blank" rel="noopener" aria-label={`The anchor transaction on NEAR, ${c.rewrite.tx}`}>{shortHash(c.rewrite.tx)}</a></>}</span></li>
        )}
      </ul>
      {c.corrected?.url && <Link className="btn soft crx-bet" href={c.corrected.url}>Bet on the corrected fact<Icon name="arrow" /></Link>}
    </li>
  );
}

export function Corrections({ items }: { items: PageCorrection[] | undefined }) {
  const list = (items ?? []).filter((c) => c.outcome === "false");
  if (!list.length) return null;
  const open = list.slice(0, OPEN), rest = list.slice(OPEN);
  return (
    <section className="crx-wrap" id="corrected" aria-labelledby="crx-h">
      <h2 id="crx-h"><Icon name="gavel" />Corrected by a ruling</h2>
      <p className="crx-sub">{list.length === 1 ? "One fact on this page was" : `${list.length} facts on this page were`} ruled false. Struck: what Wikipedia says. Highlighted: what this page says now.</p>
      <ol className="crx-list">{open.map((c, i) => <Correction key={c.claim_id} c={c} lead={i === 0} />)}</ol>
      {rest.length > 0 && (
        <details className="crx-more">
          <summary>{plural(rest.length, "more correction")}</summary>
          <ol className="crx-list">{rest.map((c) => <Correction key={c.claim_id} c={c} lead={false} />)}</ol>
        </details>
      )}
    </section>
  );
}
