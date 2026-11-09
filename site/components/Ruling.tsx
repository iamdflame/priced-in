// The ruling block: the challenge, the three signed verdicts with model names and links, the objection
// window, the settlement and the corrected sentence. Every line links to its transaction.
import Link from "next/link";
import { Icon } from "./Icon";
import { ObjectButton } from "./money/ObjectButton";
import { clockUtc, dayTimeUtc, explorerAccount, explorerTx, judgeName, money, span } from "@/lib/format";
import { bondFate, nextBondUsd, objectionsSummary, objectionWords, verdictOf, winningSide } from "@/lib/rulings";
import type { Ruling } from "@/lib/server/api";

/** What became of the challenger's bond, for the settlement line. An older answer without the field says what it always said. */
function challengerFate(r: Ruling): string {
  const fate = bondFate(r.challenger_result ?? undefined, r.bond_usd, r.challenger_paid_usd, "The challenger’s");
  if (fate) return fate;
  return r.challenger_result === undefined && r.bonds?.length ? "The challenger’s bond came back." : "";
}

function TxLink({ tx, label = "tx" }: { tx: string | null | undefined; label?: string }) {
  if (!tx) return null;
  return <a href={explorerTx(tx)} target="_blank" rel="noopener">{label}<Icon name="ext" className="!w-3 !h-3" /></a>;
}

/** `upTo` hides steps that haven't happened yet (the replay reveals them in order). */
export function RulingBlock({ r, correctedQuestion, upTo = Infinity, replay = false }: { r: Ruling; correctedQuestion?: string | null; upTo?: number; replay?: boolean }) {
  const verdict = verdictOf(r);
  const side = winningSide(verdict);
  const settled = r.status === "settled" && upTo >= 6;
  const shown = (i: number) => i <= upTo;
  const verdicts = r.verdicts.filter((_, i) => shown(1 + i));
  // what the judges themselves said: an objection flips the ruling, never their verdicts
  const tally = (v: string) => verdicts.filter((x) => x.verdict === v).length;
  const judged = tally("TRUE") > tally("FALSE") ? "TRUE" : tally("FALSE") > 0 ? "FALSE" : verdict;
  const agree = tally(judged);
  const evidence = r.evidence.split("\n").filter((l) => !/^Record sha256|^Receipt excerpt/.test(l));
  // the window as the page last read it; the button checks the clock itself and the sheet reads the chain
  const open = !replay && r.status === "window" && r.window_ends_at !== null;
  const objectButton = open ? <ObjectButton challengeId={r.challenge_id} claimId={r.claim_id} question={r.claim} status={r.status} windowEndsAt={r.window_ends_at} disputes={r.disputes.length} bondUsd={nextBondUsd(r)} /> : null;
  return (
    <section className="panel rulingp" aria-labelledby="ruling-h" id="ruling">
      <header>
        <div>
          <h2 id="ruling-h">{settled ? (judged !== verdict && r.disputes.length ? `Settled ${verdict.toLowerCase()} after ${r.disputes.length === 1 ? "an objection" : `${r.disputes.length} objections`}` : `Decided ${verdict.toLowerCase()} by ${r.verdicts.length} AI judges`) : r.escalated ? "Three objections: the council decides" : verdicts.length ? `${verdicts.length} of 3 AI judges have decided` : "Challenged: the AI judges are reading"}</h2>
          <p className="sub">
            {settled
              ? <>Settled in {span((r.settled_at ?? r.opened_at) - r.opened_at)}{r.payout_usd ? <> · {money(r.payout_usd)} paid to {side}</> : null}{replay ? " · replayed at the real offsets, the 10-minute window shortened" : ""}</>
              : <>Three attested AI models read the sources and sign their verdicts on-chain. Then anyone can object for 10 minutes.</>}
          </p>
        </div>
        {/* the heading says the verdict: a second badge made four FALSEs on one screen */}
      </header>
      <ol className="tl">
        <li>
          <span className="dotc no"><Icon name="flag" /></span>
          <div className="what">
            <b>{r.challenger_name.replace(/^the /, "The ")} challenged it</b>: it says the sentence is {String(r.claimed).toLowerCase()}, and put up a {money(r.bond_usd)} bond.
            <details className="checkbox">
              <summary className="link">The evidence it filed</summary>
              <div className="evidence">{evidence.map((l, i) => <p key={i}>{l}</p>)}</div>
            </details>
          </div>
          <div className="when">{dayTimeUtc(r.opened_at)}<TxLink tx={r.open_tx} /></div>
        </li>
        <li>
          <span className={`dotc ${verdicts.length ? "no" : ""}`}><Icon name="scale" /></span>
          <div className="what">
            <b>{verdicts.length ? `${agree === verdicts.length ? (verdicts.length === 3 ? "All three" : verdicts.length) : `${agree} of ${verdicts.length}`} AI judges decided it ${judged.toLowerCase() || "…"}` : "Three AI judges are reading the sources"}</b>, each signing its verdict inside a secure chip; the market checked every signature against the model’s registered key.
            <div className="verdicts3">
              {r.verdicts.map((v, i) => shown(1 + i) ? (
                <div key={v.tx} className="vcard">
                  <b title={v.model}>{judgeName(v.model)}</b>
                  <span className={`v ${v.verdict === "TRUE" ? "true" : ""}`}><Icon name="check" />{v.verdict === "TRUE" ? "True" : v.verdict === "FALSE" ? "False" : v.verdict} · in {span(v.at - r.opened_at)}</span>
                  <span>Signature verified on-chain{v.runner?.attestation?.ok ? " · attested" : ""}</span>
                  <TxLink tx={v.tx} label="See the verdict" />
                </div>
              ) : (
                <div key={v.tx} className="vcard pending" aria-hidden="true"><b>{judgeName(v.model)}</b><span className="v reading">Reading…</span></div>
              ))}
            </div>
          </div>
          <div className="when">{verdicts.length ? dayTimeUtc(verdicts[verdicts.length - 1].at) : null}</div>
        </li>
        <li className={shown(4) ? "" : "pending"}>
          <span className="dotc"><Icon name="clock" /></span>
          <div className="what">
            <b>10 minutes for objections</b>{shown(5) ? <>: {objectionsSummary(r)}.</> : "…"}
            {shown(5) && open && !r.disputes.length && <> Until {clockUtc(r.window_ends_at!)}, anyone with a NEAR wallet can post {money(nextBondUsd(r))}, twice the bond, to flip the ruling.</>}
            {shown(5) && open && !r.disputes.length && objectButton}
          </div>
          <div className="when">{shown(5) && !open && !r.disputes.length && r.window_ends_at ? `closed ${dayTimeUtc(r.window_ends_at)}` : null}</div>
        </li>
        {shown(5) && r.disputes.map((d, i) => {
          const latest = i === r.disputes.length - 1;
          const fate = bondFate(d.result, d.bond_usd, d.paid_usd);
          return (
            <li key={d.round} className="objection" data-testid="objection">
              <span className={`dotc ${d.proposed === "TRUE" ? "yes" : "no"}`}><Icon name="flag" /></span>
              <div className="what">
                <b>Objection {d.round} of 3</b>: {objectionWords(d)}
                {latest && d.window_ends_at ? <> That window {open ? "closes" : "closed"} at {clockUtc(r.window_ends_at ?? d.window_ends_at)}.</> : null}
                {fate && <span className={`fate ${d.result === "won" || d.result === "returned" ? "yes" : "no"}`}>{fate}</span>}
                {d.evidence ? (
                  <details className="checkbox">
                    <summary className="link">Its reason</summary>
                    <div className="evidence">{d.evidence.split("\n").map((l, k) => <p key={k}>{l}</p>)}</div>
                  </details>
                ) : null}
                {latest && open && objectButton}
              </div>
              <div className="when">{d.at ? dayTimeUtc(d.at) : null}<TxLink tx={d.tx} /></div>
            </li>
          );
        })}
        {shown(5) && r.escalated && (
          <li>
            <span className="dotc"><Icon name="gavel" /></span>
            <div className="what"><b>Three objections: the market’s council decides.</b> Every bond waits for its ruling, and the losing side’s pay the winners.</div>
            <div className="when" />
          </li>
        )}
        <li className={settled ? "" : "pending"}>
          <span className={`dotc ${settled ? "yes" : ""}`}><Icon name="coin" /></span>
          <div className="what">{settled ? <><b>Settled: {side} wins.</b> {r.payout_usd ? `The keeper settled it and ${money(r.payout_usd)} became payable to everyone who bet ${side}.` : `Nobody had bet ${side}, so nothing was paid.`} {challengerFate(r)}</> : <b>Settlement</b>}</div>
          <div className="when">{settled && r.settled_at ? <>{dayTimeUtc(r.settled_at)}<TxLink tx={r.settle_tx} /></> : null}</div>
        </li>
      </ol>
      {settled && r.correction && (
        <div className="corrected">
          <p><b>Corrected.</b> <span>The sentence was rewritten from the newer source and opened as its own market{correctedQuestion ? <>: “{correctedQuestion}”</> : null}.</span></p>
          <Link className="btn primary" href={`/c/${r.correction.claim_id}`}>See the new market<Icon name="arrow" /></Link>
        </div>
      )}
      <p className="fine gap">
        Judges’ signing keys are registered on the market contract; the challenger is <a className="link" href={explorerAccount(r.challenger)} target="_blank" rel="noopener">{r.challenger}</a>.
      </p>
    </section>
  );
}
