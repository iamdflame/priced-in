"use client";
// Object to an AI ruling while its window is open: the money path to "the judges got it wrong". The
// bond, the ruling now and the window come from the chain itself (get_challenge, get_claim and
// dispute_ends_ns), never from a cache. The wallet signs the objection (dispute on the market, twice the
// current bond taken from the Priced In balance), after moving the shortfall in from its own USDC when
// the balance is short. Then the new window counts down.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { ApproveBox, Countdown, Done, Failed, GeoLine, Loading, Sheet, TxLink } from "./ui";
import { useSend } from "./useSend";
import { moneyChain, type ChallengeView, type ClaimView } from "@/lib/money/chain";
import { moneyConfig } from "@/lib/money/config";
import { checkDispute, disputeBond, disputeTxs, evidenceBytes, evidenceProblem, funding, liveWindow, MAX_DISPUTES, MAX_EVIDENCE_BYTES, ownSide, windowOpen } from "@/lib/money/dispute";
import { canAddMoney } from "@/lib/money/geo";
import { openSheet, useAccount, useGeo, useWallet } from "@/lib/money/hooks";
import { fmtMicro } from "@/lib/money/units";
import { mmss } from "@/lib/format";

const cfg = moneyConfig();
const said = (b: boolean) => (b ? "Yes, it’s true" : "No, it’s false");

interface Live { ch: ChallengeView | null; claim: ClaimView | null; endsMs: number | null }

async function readLive(challengeId: number, claimId: number): Promise<Live> {
  const c = moneyChain();
  const [ch, claim, endsMs] = await Promise.all([c.challenge(challengeId), c.claim(claimId), c.disputeEndsMs(challengeId)]);
  return { ch, claim, endsMs };
}

export function DisputeSheet({ challengeId, claimId, question, onClose }: { challengeId: number; claimId: number; question: string; onClose: () => void }) {
  const w = useWallet();
  const geo = useGeo();
  const acct = useAccount(w.accountId);
  const router = useRouter();
  const { st, run, reset, locked } = useSend();
  const [live, setLive] = useState<Live | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [after, setAfter] = useState<{ endsMs: number | null; ruling: boolean | null; escalated: boolean } | null>(null);
  const fieldId = useId();

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let off = false;
    readLive(challengeId, claimId).then((x) => { if (!off) setLive(x); }, () => { if (!off) setReadError("We couldn’t read this ruling from NEAR just now. Close this and try again."); });
    return () => { off = true; };
  }, [challengeId, claimId]);

  const win = live ? liveWindow(challengeId, live.ch, live.claim, live.endsMs) : null;
  const open = !!win && windowOpen(win, now);
  const current = live?.ch ? BigInt(live.ch.bond_micro) : null;
  const bond = live?.ch ? disputeBond(live.ch) : null;
  const ruling = live?.claim?.provisional ?? null;
  const mine = live?.ch ? ownSide(live.ch, w.accountId) : null;
  const fund = bond !== null ? funding(bond, acct.balanceMicro, acct.usdcMicro) : null;
  const third = (live?.ch?.disputes ?? 0) === MAX_DISPUTES - 1;
  const refusal = win && bond !== null
    ? checkDispute({ access: geo.access, window: win, now, accountId: w.accountId, laneAccount: cfg.lane, evidence, bond, provisional: ruling, mine, balance: acct.balanceMicro, walletUsdc: acct.usdcMicro })
    : null;
  const txs = useMemo(() => (!refusal && bond !== null && ruling !== null && fund ? disputeTxs(cfg, challengeId, evidence, bond, ruling, fund) : []), [refusal, bond, ruling, fund, challengeId, evidence]);
  const bytes = evidenceBytes(evidence);

  const send = async () => {
    if (bond === null || !fund) return;
    const last = txs.length - 1;
    const results = await run(txs, (res, i) => (i === last
      ? { kind: "dispute", hash: res.hash, at: Date.now(), amountMicro: bond.toString(), claimId, question }
      : { kind: "deposit", hash: res.hash, at: Date.now(), amountMicro: String(fund.depositMicro ?? 0n) }));
    if (results.length !== txs.length || !results.every((r) => r.ok)) return;
    const next = await readLive(challengeId, claimId).catch(() => null);
    setAfter({ endsMs: next?.endsMs ?? null, ruling: next?.claim?.provisional ?? (ruling === null ? null : !ruling), escalated: next?.claim?.status === "Escalated" });
    router.refresh();
  };

  const req = { kind: "dispute" as const, challengeId, claimId, question };

  return (
    <Sheet title="Object to this ruling" sub={<>“{question}”</>} onClose={onClose}>
      {st.phase === "done" ? (
        <Done title="Objection filed" actions={<button type="button" className="btn soft full" onClick={onClose}>Done</button>}>
          {after?.escalated ? (
            <p>That was the third objection, so the market’s council decides. Every bond waits for its ruling.</p>
          ) : (
            <>
              <p>The ruling is now <b>{after?.ruling === null || after?.ruling === undefined ? "flipped" : said(after.ruling)}</b>. Anyone can answer with {bond !== null ? fmtMicro(bond * 2n) : "double"} until the new window closes; if nobody does, it stands.</p>
              {after?.endsMs ? <p className="m-dp-clock" aria-live="off"><span>New window closes in</span> <Countdown to={after.endsMs} /></p> : null}
            </>
          )}
          <TxLink hash={st.results[st.results.length - 1]?.hash ?? null} />
        </Done>
      ) : readError ? (
        <div className="notice err" role="alert"><Icon name="alert" /><p>{readError}</p></div>
      ) : !live || !win ? (
        <Loading>Reading the ruling from NEAR…</Loading>
      ) : !open ? (
        <>
          <div className="notice info" role="status"><Icon name="info" /><p>{win.status === "escalated" ? "Three objections were filed, so the market’s council decides this one." : "The window for objections has closed. The keeper settles it next and pays the winners."}</p></div>
          <button type="button" className="btn soft full" onClick={onClose}>Close</button>
        </>
      ) : !canAddMoney(geo.access) ? (
        <button type="button" className="btn soft full" onClick={onClose}>Close</button>
      ) : !w.accountId ? (
        <>
          <p className="fine">An objection posts a bond from a NEAR wallet. The free $1 can’t object.</p>
          <button type="button" className="btn primary lg full" onClick={() => openSheet({ kind: "connect", then: req })}>Connect a wallet</button>
        </>
      ) : (
        <>
          <p className="m-dp-now">
            <span>The AI judges’ ruling now</span>
            {ruling === null ? <b>Not yet</b> : <b className={ruling ? "yes" : "no"}>{said(ruling)}</b>}
            {win.windowEndsAt ? <span className="m-dp-left">Objections close in <span className="num">{mmss(win.windowEndsAt - now)}</span></span> : null}
          </p>
          <div className="m-get"><span className="k">Your bond<small>Twice the current {current !== null ? fmtMicro(current) : ""} bond, from your Priced In balance{acct.balanceMicro !== null ? `: ${fmtMicro(acct.balanceMicro)}` : ""}</small></span><span className="v ink num">{bond !== null ? fmtMicro(bond) : "…"}</span></div>
          {ruling !== null && bond !== null ? (
            <ul className="m-outcomes">
              <li><b>It flips the ruling</b> to “{said(!ruling)}”{third ? "." : " and starts a new window for objections."}</li>
              <li>{third ? <><b>Yours would be the third objection,</b> so no new window opens: the market’s council decides.</> : <><b>Anyone can answer you</b> by posting double ({fmtMicro(bond * 2n)}), which flips it back. The third objection sends it to the market’s council.</>}</li>
              <li><b>When it ends,</b> the losing side’s bonds pay the winning side, in proportion to each bond. If the final ruling is “{said(!ruling)}”, your {fmtMicro(bond)} comes back with your share; if not, you lose it.</li>
            </ul>
          ) : null}
          <div className="m-field">
            <label className="m-label" htmlFor={fieldId}>Why the ruling is wrong</label>
            <textarea id={fieldId} className="rp-in m-dp-ev" rows={4} value={evidence} aria-describedby={`${fieldId}-n`}
              placeholder="Link the source and quote what it says." onChange={(e) => { setEvidence(e.target.value); if (st.phase === "failed" && !st.unknown) reset(); }} />
            <p className="hint" id={`${fieldId}-n`}><span className={bytes > MAX_EVIDENCE_BYTES ? "bad" : ""}><span className="num">{bytes.toLocaleString("en-US")}</span> of 4,000 bytes</span> · public, and kept on NEAR for good</p>
          </div>
          <ApproveBox txs={txs} />
          {refusal && (evidence || refusal !== evidenceProblem(evidence)) ? <p className="fine rp-hint">{refusal}</p> : null}
          {st.phase === "failed" ? <Failed state={st} /> : null}
          {fund?.needsDeposit ? (
            <button type="button" className="btn primary lg full" onClick={() => openSheet({ kind: "deposit" })}>Deposit first</button>
          ) : (
            <button type="button" className="btn primary lg full" disabled={!txs.length || locked} onClick={() => void send()} data-testid="dispute-confirm">
              {st.phase === "wallet" ? <><span className="spin" />Approve in your wallet{st.of > 1 ? ` (${st.step} of ${st.of})` : ""}…</> : bond !== null ? `Object with ${fmtMicro(bond)}` : "Object"}
            </button>
          )}
        </>
      )}
      <GeoLine />
    </Sheet>
  );
}
