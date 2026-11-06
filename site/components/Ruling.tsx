// The ruling block: the challenge, the three signed verdicts with model names and links, the objection
// window, the settlement and the corrected sentence. Every line links to its transaction.
import Link from "next/link";
import { Icon } from "./Icon";
import { dayTimeUtc, explorerAccount, explorerTx, modelShort, money, span } from "@/lib/format";
import type { Ruling } from "@/lib/server/api";

export type RulingStage = "challenge" | "jury" | "window" | "settled";

const judgeName = (m: string) => modelShort(m).replace(/-\d{4}$/, "");

function TxLink({ tx, label = "tx" }: { tx: string | null | undefined; label?: string }) {
  if (!tx) return null;
  return <a href={explorerTx(tx)} target="_blank" rel="noopener">{label}<Icon name="ext" className="!w-3 !h-3" /></a>;
}

/** `upTo` hides steps that haven't happened yet (the replay reveals them in order). */
export function RulingBlock({ r, correctedQuestion, upTo = Infinity, replay = false }: { r: Ruling; correctedQuestion?: string | null; upTo?: number; replay?: boolean }) {
  const verdict = (r.outcome ?? r.provisional ?? "").toUpperCase();
  const settled = r.status === "settled" && upTo >= 6;
  const shown = (i: number) => i <= upTo;
  const verdicts = r.verdicts.filter((_, i) => shown(1 + i));
  const evidence = r.evidence.split("\n").filter((l) => !/^Record sha256|^Receipt excerpt/.test(l));
  return (
    <section className="panel rulingp" aria-labelledby="ruling-h" id="ruling">
      <header>
        <div>
          <h2 id="ruling-h">{settled ? `Ruled ${verdict} by ${r.verdicts.length} AI judges` : verdicts.length ? `${verdicts.length} of 3 AI judges have ruled` : "Challenged: the AI judges are reading"}</h2>
          <p className="sub">
            {settled
              ? <>Settled in {span((r.settled_at ?? r.opened_at) - r.opened_at)}{r.payout_usd ? <> · {money(r.payout_usd)} paid to {verdict === "FALSE" ? "No" : "Yes"}</> : null}{replay ? " · replayed at the real offsets, the 10-minute window shortened" : ""}</>
              : <>Three attested AI models read the sources and sign their verdicts on-chain. Then anyone can object for 10 minutes.</>}
          </p>
        </div>
        {settled && <span className={`verdict ${verdict.toLowerCase()}`} style={{ height: 30, fontSize: 14, padding: "0 12px" }}>{verdict}</span>}
      </header>
      <ol className="tl">
        <li>
          <span className="dotc no"><Icon name="flag" /></span>
          <div className="what">
            <b>{r.challenger_name.replace(/^the /, "The ")} challenged it</b>: it says the sentence is {String(r.claimed).toLowerCase()}, and put up a {money(r.bond_usd)} bond.
            <details style={{ marginTop: 6 }}>
              <summary className="link" style={{ cursor: "pointer", minHeight: 32, display: "inline-flex", alignItems: "center" }}>The evidence it filed</summary>
              <div style={{ marginTop: 6, fontSize: 13.5 }}>{evidence.map((l, i) => <p key={i} style={{ overflowWrap: "anywhere" }}>{l}</p>)}</div>
            </details>
          </div>
          <div className="when">{dayTimeUtc(r.opened_at)}<TxLink tx={r.open_tx} /></div>
        </li>
        <li>
          <span className={`dotc ${verdicts.length ? "no" : ""}`}><Icon name="scale" /></span>
          <div className="what">
            <b>{verdicts.length ? `${verdicts.length === 3 ? "All three" : verdicts.length} AI judges ruled it ${verdict.toLowerCase() || "…"}` : "Three AI judges are reading the sources"}</b>, each signing its verdict inside a secure chip; the market checked every signature against the model’s registered key.
            <div className="verdicts3">
              {r.verdicts.map((v, i) => shown(1 + i) ? (
                <div key={v.tx} className="vcard">
                  <b title={v.model}>{judgeName(v.model)}</b>
                  <span className={`v ${v.verdict === "TRUE" ? "true" : ""}`}><Icon name="check" />{v.verdict} · in {span(v.at - r.opened_at)}</span>
                  <span>Signature verified on-chain{v.runner?.attestation?.ok ? " · attested" : ""}</span>
                  <TxLink tx={v.tx} label="See the verdict" />
                </div>
              ) : (
                <div key={v.tx} className="vcard pending" aria-hidden="true"><b>{judgeName(v.model)}</b><span className="v" style={{ color: "var(--ink3)" }}>Reading…</span></div>
              ))}
            </div>
          </div>
          <div className="when">{verdicts.length ? dayTimeUtc(verdicts[verdicts.length - 1].at) : null}</div>
        </li>
        <li className={shown(4) ? "" : "pending"}>
          <span className="dotc"><Icon name="clock" /></span>
          <div className="what"><b>10 minutes for objections</b>{shown(5) ? <>: {r.disputes.length ? `${r.disputes.length} filed` : "nobody objected"}.</> : "…"}</div>
          <div className="when">{shown(5) && r.window_ends_at ? `closed ${dayTimeUtc(r.window_ends_at)}` : null}</div>
        </li>
        <li className={settled ? "" : "pending"}>
          <span className={`dotc ${settled ? "yes" : ""}`}><Icon name="coin" /></span>
          <div className="what">{settled ? <><b>Settled: {verdict === "FALSE" ? "No" : "Yes"} wins.</b> The keeper settled it and {r.payout_usd ? `${money(r.payout_usd)} became payable to` : "paid"} everyone who bet {verdict === "FALSE" ? "No" : "Yes"}; the Checker’s bond came back.</> : <b>Settlement</b>}</div>
          <div className="when">{settled && r.settled_at ? <>{dayTimeUtc(r.settled_at)}<TxLink tx={r.settle_tx} /></> : null}</div>
        </li>
      </ol>
      {settled && r.correction && (
        <div className="corrected">
          <p><b>Corrected.</b> <span>The sentence was rewritten from the newer source and opened as its own market{correctedQuestion ? <>: “{correctedQuestion}”</> : null}.</span></p>
          <Link className="btn primary" href={`/c/${r.correction.claim_id}`}>See the new market<Icon name="arrow" /></Link>
        </div>
      )}
      <p className="fine" style={{ marginTop: 12 }}>
        Judges’ signing keys are registered on the market contract; the challenger is <a className="link" href={explorerAccount(r.challenger)} target="_blank" rel="noopener">{r.challenger}</a>.
      </p>
    </section>
  );
}
