"use client";
// Catch a mistake. The free path: a public page and the exact words from it, signed by this browser's key
// and sent to /api/reports; the API fetches the page, finds the words, asks three AI checkers, and if they
// agree our Checker challenges the line with its own $1 bond. Its status shows here afterwards in plain
// words, and every refusal is the API's own sentence. The money path: a wallet challenges with its own $1
// bond (components/money/Challenge.tsx). A line that holds a bounty says what it pays.
import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Icon } from "../Icon";
import { Sheet } from "../money/ui";
import { existingKey, myReports, reportById, sendReport } from "@/lib/client/picks";
import { canAddMoney } from "@/lib/money/geo";
import { openSheet, useGeo, useWallet } from "@/lib/money/hooks";
import { money } from "@/lib/format";
import { REPORT_WORDS, reportLive, type Report } from "@/lib/news";

// ---------- one sheet for the page ----------

interface ReportReq { claimId: number; question: string; news: boolean }
let open: ReportReq | null = null;
const subs = new Set<() => void>();
export function openReport(r: ReportReq | null) { open = r; for (const f of subs) f(); }
const useReportReq = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => null);

// ---------- the receipt's fields, shared with the wallet's challenge ----------

export interface Receipt { says: "false" | "true"; url: string; quote: string; note: string }
export const EMPTY_RECEIPT: Receipt = { says: "false", url: "", quote: "", note: "" };

/** Plain checks before sending; the API has the last word. */
export function receiptProblem(r: Receipt): string | null {
  if (!/^https:\/\/\S{4,}$/.test(r.url.trim())) return "Add a public https:// link to the page that shows it.";
  const q = r.quote.replace(/\s+/g, " ").trim();
  if (q.split(" ").length < 3 || q.length < 16) return "Copy the exact words from that page: three words or more.";
  if (r.note.length > 600) return "Keep the note under 600 characters.";
  return null;
}

export function ReceiptFields({ r, set, news }: { r: Receipt; set: (r: Receipt) => void; news: boolean }) {
  const id = useId();
  return (
    <div className="rp-fields">
      <fieldset className="rp-says">
        <legend>What’s wrong with it?</legend>
        <label className={r.says === "false" ? "on" : ""}><input type="radio" name={`${id}s`} checked={r.says === "false"} onChange={() => set({ ...r, says: "false" })} /><span><b>It’s false</b><small>{news ? "The source denied it, or the page shows it won’t happen" : "A newer source says otherwise"}</small></span></label>
        <label className={r.says === "true" ? "on" : ""}><input type="radio" name={`${id}s`} checked={r.says === "true"} onChange={() => set({ ...r, says: "true" })} /><span><b>{news ? "It’s already confirmed" : "It’s true after all"}</b><small>{news ? "The named source has said it" : "The source backs it as written"}</small></span></label>
      </fieldset>
      <label className="m-label" htmlFor={`${id}u`}>A public page that shows it</label>
      <input id={`${id}u`} className="rp-in" type="url" inputMode="url" placeholder="https://" value={r.url} onChange={(e) => set({ ...r, url: e.target.value })} autoComplete="off" />
      <label className="m-label" htmlFor={`${id}q`}>The exact words from that page</label>
      <textarea id={`${id}q`} className="rp-in" rows={3} placeholder="Copy them as they appear there: we look for these words on the page." value={r.quote} onChange={(e) => set({ ...r, quote: e.target.value })} />
      <label className="m-label" htmlFor={`${id}n`}>Anything to add? <span className="rp-opt">Optional</span></label>
      <textarea id={`${id}n`} className="rp-in" rows={2} maxLength={600} value={r.note} onChange={(e) => set({ ...r, note: e.target.value })} />
    </div>
  );
}

// ---------- where a report stands ----------

export function ReportStatus({ rep }: { rep: Report }) {
  const w = REPORT_WORDS[rep.status] ?? { label: rep.status, tone: "wait" as const };
  return (
    <div className={`rp-status ${w.tone}`} role="status" data-testid="report-status">
      <p className="rp-st">{w.tone === "wait" ? <span className="spin" aria-hidden="true" /> : <Icon name={w.tone === "ok" ? "check" : w.tone === "bad" ? "x" : "info"} />}{w.label}</p>
      {rep.reason && <p className="rp-why">{rep.reason}</p>}
      {rep.challenge_tx && <a className="link" href={`https://nearblocks.io/txns/${rep.challenge_tx}`} target="_blank" rel="noopener">The challenge on NEAR</a>}
    </div>
  );
}

function useReport(id: string | null) {
  const [rep, setRep] = useState<Report | null>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let tries = 0;
    const tick = async () => {
      const r = await reportById(id);
      if (stop) return;
      const got = r.ok ? r.reports[0] ?? null : null;
      if (got) setRep(got);
      if ((!got || reportLive(got.status)) && ++tries < 40) t = setTimeout(tick, 4000);
    };
    let t = setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(t); };
  }, [id]);
  return [rep, setRep] as const;
}

// ---------- the sheet ----------

export function ReportSheet() {
  const req = useReportReq();
  const [r, set] = useState<Receipt>(EMPTY_RECEIPT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [rep, setRep] = useReport(sentId);
  useEffect(() => { if (req) { set(EMPTY_RECEIPT); setError(null); setSentId(null); setRep(null); } }, [req, setRep]);
  if (!req) return null;
  const problem = receiptProblem(r);
  const send = async () => {
    setBusy(true); setError(null);
    const res = await sendReport(req.claimId, r.says, { url: r.url, quote: r.quote, note: r.note });
    setBusy(false);
    if (res.ok) { setRep(res.report); setSentId(res.report.id); window.dispatchEvent(new Event("pi:report")); }
    else setError(res.message);
  };
  return (
    <Sheet title={rep ? "Your report" : "Report a mistake"} sub={req.question} onClose={() => openReport(null)} label="Report a mistake">
      {rep ? (
        <>
          <ReportStatus rep={rep} />
          <p className="fine rp-after">{reportLive(rep.status) ? "This runs on its own: you can close this. Its status shows on this page and on your portfolio." : "Its status stays on this page and on your portfolio."}</p>
          {rep.status === "refused" && <button type="button" className="btn primary full rp-again" onClick={() => { setRep(null); setSentId(null); }}>Fix it and send again</button>}
          <button type="button" className="btn soft full" onClick={() => openReport(null)}>Done</button>
        </>
      ) : (
        <>
          <ReceiptFields r={r} set={set} news={req.news} />
          <div className="rp-next">
            <Icon name="shield" />
            <p><b>What happens next.</b> We fetch the page and look for those exact words. If three AI checkers agree the page shows it, our Checker challenges the line with its own $1 bond, and three AI judges rule. If they agree with you, it counts as a catch on the leaderboard. Reporting is free: you risk nothing.</p>
          </div>
          {error && <div className="notice err" role="alert"><Icon name="alert" /><p>{error}</p></div>}
          <button type="button" className="btn primary lg full" disabled={busy || !!problem} onClick={() => void send()} data-testid="report-send">
            {busy ? <><span className="spin" />Sending…</> : "Send report"}
          </button>
          {problem && (r.url || r.quote) ? <p className="fine rp-hint">{problem}</p> : null}
        </>
      )}
    </Sheet>
  );
}

// ---------- the button, and the panel on a fact's page ----------

export function ReportButton({ claimId, question, news, className = "btn ghost" }: ReportReq & { className?: string }) {
  return <button type="button" className={className} onClick={() => openReport({ claimId, question, news })}><Icon name="flag" />Report a mistake</button>;
}

function useMyReport(claimId: number) {
  const [rep, setRep] = useState<Report | null>(null);
  useEffect(() => {
    const read = () => { if (existingKey()) void myReports().then((r) => { if (r?.ok) setRep(r.reports.find((x) => x.claim_id === claimId) ?? null); }); };
    read();
    addEventListener("pi:report", read);
    return () => removeEventListener("pi:report", read);
  }, [claimId]);
  return rep;
}

export function CatchPanel({ claimId, question, news, bountyUsd }: ReportReq & { bountyUsd: number }) {
  const geo = useGeo();
  const w = useWallet();
  const mine = useMyReport(claimId);
  const challenge = { kind: "challenge" as const, claimId, question };
  return (
    <section className="panel catch" id="catch" aria-labelledby="catch-h">
      <div className="catch-hd">
        <h2 id="catch-h"><Icon name="flag" />Think it’s wrong? Catch it.</h2>
        {bountyUsd > 0 && <span className="chip brand"><Icon name="coin" />{money(bountyUsd)} bounty</span>}
      </div>
      {bountyUsd > 0 && <p className="catch-bounty">This line holds a <b>{money(bountyUsd)} bounty</b>, paid to the first challenger proven right.</p>}
      {mine ? <ReportStatus rep={mine} /> : null}
      <div className="catch-ways">
        <div>
          <h3>Report it, free</h3>
          <p>Show us a public page and the exact words. If our checks pass, our Checker challenges it with its own $1 bond. Upheld, it counts as your catch on the <Link className="link" href="/leaderboard">leaderboard</Link>.</p>
          <ReportButton claimId={claimId} question={question} news={news} className="btn primary" />
        </div>
        {canAddMoney(geo.access) && (
          <div>
            <h3>Challenge it with $1</h3>
            <p>Post your own $1 bond from your wallet’s balance. If three AI judges agree with you, it comes back{bountyUsd > 0 ? `, with the ${money(bountyUsd)} bounty` : ""}. If not, it goes to whoever was right.</p>
            <button type="button" className="btn soft" onClick={() => openSheet(w.status === "in" ? challenge : { kind: "connect", then: challenge })} data-testid="challenge-open">Challenge with your wallet</button>
          </div>
        )}
      </div>
      <ReportSheet />
    </section>
  );
}
