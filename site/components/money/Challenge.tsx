"use client";
// Challenge a line with your own bond: the money path to "this is wrong". What it costs, what happens
// either way and any bounty come from GET /api/challenge?claim=; the evidence is a public page and the
// exact words from it, in the shape the jury runner checks before any model reads it. The wallet signs
// one call (challenge on the market, the bond taken from the Priced In balance), then three AI judges are
// asked to rule at once (POST /api/after-challenge).
import { useEffect, useMemo, useState } from "react";
import { EMPTY_RECEIPT, ReceiptFields, receiptProblem, type Receipt } from "../today/Report";
import { ApproveBox, Done, Failed, GeoLine, Loading, Sheet, TxLink } from "./ui";
import { useSend } from "./useSend";
import { challengeInfo } from "@/lib/client/picks";
import { moneyConfig } from "@/lib/money/config";
import { openSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { checkChallenge, type ClaimStatus } from "@/lib/money/rules";
import { challengeEvidence, challengeTx } from "@/lib/money/tx";
import { fmtMicro } from "@/lib/money/units";
import type { ChallengeInfo } from "@/lib/news";

const cfg = moneyConfig();

export function ChallengeSheet({ claimId, question, receipt, onClose }: { claimId: number; question: string; receipt?: Receipt; onClose: () => void }) {
  const w = useWallet();
  const geo = useGeo();
  const acct = useAccount(w.accountId);
  const { st, run, locked } = useSend();
  const [info, setInfo] = useState<ChallengeInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [r, set] = useState<Receipt>(receipt ?? EMPTY_RECEIPT);

  useEffect(() => {
    let off = false;
    challengeInfo(claimId).then((x) => { if (off) return; if (x.ok) setInfo(x); else setInfoError(x.message); });
    return () => { off = true; };
  }, [claimId]);

  const bond = BigInt(info?.bond.micro ?? "1000000");
  const evidence = useMemo(() => challengeEvidence(r), [r]);
  const tooLong = new TextEncoder().encode(evidence).length > (info?.evidence.max_bytes ?? 4000);
  const refusal = !info ? null : !info.open ? info.why_not ?? "This line can’t be challenged now." : receiptProblem(r) ?? (tooLong ? "That evidence is too long: shorten the note or the quote." : checkChallenge(bond, acct.balanceMicro, info.status as ClaimStatus, geo.access, r));
  const txs = useMemo(() => (info && !refusal ? [challengeTx(cfg, claimId, r.says === "true", evidence, bond)] : []), [info, refusal, claimId, r.says, evidence, bond]);

  const send = async () => {
    const results = await run(txs, (res) => ({ kind: "challenge", hash: res.hash, at: Date.now(), amountMicro: bond.toString(), claimId, question }));
    const hash = results.find((x) => x.ok)?.hash;
    // the jury is asked at once; the hourly run asks again if this one is missed
    if (hash && w.accountId) void fetch("/api/after-challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash, signerId: w.accountId }) }).catch(() => {});
  };

  return (
    <Sheet title="Challenge with your bond" sub={question} onClose={onClose}>
      {st.phase === "done" ? (
        <Done title="Challenge sent">
          <p>Three AI judges rule within minutes, on your page and its words. If they agree with you, your {fmtMicro(bond)} bond comes back{info && info.bounty.usd > 0 ? ` with the ${fmtMicro(BigInt(Math.round(info.bounty.usd * 1e6)))} bounty` : ""}.</p>
          <TxLink hash={st.results[0]?.hash ?? null} />
        </Done>
      ) : !info ? (
        infoError ? <div className="notice err" role="alert"><p>{infoError}</p></div> : <Loading>Reading the line…</Loading>
      ) : (
        <>
          <div className="m-get"><span className="k">Your bond<small>From your Priced In balance{acct.balanceMicro !== null ? `: ${fmtMicro(acct.balanceMicro)}` : ""}</small></span><span className="v">{fmtMicro(bond)}</span></div>
          <ul className="m-outcomes">
            <li><b>If you’re right:</b> {info.outcomes.right}</li>
            <li><b>If you’re wrong:</b> {info.outcomes.wrong}</li>
            {info.bounty.usd > 0 && <li><b>Bounty:</b> {fmtMicro(BigInt(Math.round(info.bounty.usd * 1e6)))}, paid to {info.bounty.pays}.</li>}
          </ul>
          <ReceiptFields r={r} set={set} news={!!info.settles} />
          <p className="fine">{info.evidence.checked}</p>
          <ApproveBox txs={txs} />
          {refusal && (r.url || r.quote) ? <p className="fine rp-hint">{refusal}</p> : null}
          {st.phase === "failed" ? <Failed state={st} /> : null}
          {acct.balanceMicro !== null && bond > acct.balanceMicro ? (
            <button type="button" className="btn primary lg full" onClick={() => openSheet({ kind: "deposit" })}>Deposit first</button>
          ) : (
            <button type="button" className="btn primary lg full" disabled={!txs.length || locked} onClick={() => void send()} data-testid="challenge-confirm">
              {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet…</> : `Challenge with ${fmtMicro(bond)}`}
            </button>
          )}
        </>
      )}
      <GeoLine />
    </Sheet>
  );
}
