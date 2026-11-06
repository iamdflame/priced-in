// Trust: nobody, us included, can change the rules quietly. The market's code hash read live from
// NEAR beside the hash of the public reproducible build; the command that rebuilds it; what the house
// can do, and what this code stops it doing, in plain words with details one tap away; every key and
// the methods NEAR says it may call; the AI judges' attestation proofs; and what you still have to
// trust. The "can't" list is a property of this code, and the page says so: a full-access key can
// replace the code, which is why the hash is the first thing here.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import deployment from "@/data/mainnet-public.json";
import { Icon } from "@/components/Icon";
import { Code, ModelBadge, PageHero, SHead } from "@/components/pages/Kit";
import { explorerAccount, explorerTx, shortHash } from "@/lib/format";
import { MARKET_ID, REPO_URL } from "@/lib/nav";
import { proof, type Proof } from "@/lib/server/proof";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Trust: what we can and can’t do with your money",
  description: "The market’s code hash read live from NEAR next to the public reproducible build, every key and what it may do, the AI judges’ attestation proofs, and the ten checks anyone can run.",
};

/** The commit the ten checks last passed at, all ten, against the hosted site (README). */
const JUDGE_RUN_AT = "56f0c6f";

const CAN: [string, ReactNode][] = [
  ["Pause the market", <>While paused no USDC leaves, so you can’t withdraw until it lifts. That binds the owner too: nothing settles and the treasury can’t be drawn either. <code>pause</code>, <code>unpause</code>.</>],
  ["Withdraw the treasury", <>Fees and the house’s own money reach the owner through <code>withdraw_treasury</code>. The treasury is a separate bucket from traders’ balances and from what winners are owed. The books on the <Link className="link" href="/stats#books">numbers page</Link> show each one.</>],
  ["Set the fee, up to 3%", <>Every bet pays a taker fee to the treasury: 1% today. The contract refuses anything above 300 basis points, and every change is a public <code>fee</code> event.</>],
  ["Change the bond and dispute rules", <>The owner sets the bond, the free-bet budget and the dispute table with <code>set_limits</code> and <code>set_resolution</code>. Each change is a public transaction from the owner’s account.</>],
  ["Upgrade the code", <>One full-access key can replace the market’s code; that is how it moved to v3. Any change moves the code hash above. Locking the contract removes this power for good, including the power to fix a bug. It hasn’t been done.</>],
  ["Register an AI judge’s key", <>The contract checks every verdict against the key registered for that model, and the owner registers that key with <code>register_model</code>. It takes the owner’s word that the key belongs to an attested chip, so a wrong registration could sign wrong verdicts. The proofs below let you compare the keys yourself.</>],
  ["Decide a fact disputed three times", <>A fact disputed three times is decided by the council, which can also void it. Today the council is the owner’s one key. A multisig is the plan; it isn’t built.</>],
];

const CANT: [string, ReactNode][] = [
  ["Spend your balance", <>Your USDC sits under your own account or key. No owner or operator method bets it or withdraws it for you. A free $1 is tied to the key made in your browser.</>],
  ["Change a settled outcome", <>A settled fact keeps its outcome and evidence. If the fact changes later, it reopens as a new market with its own pot; the old one stands.</>],
  ["Count a verdict without a valid signature", <>The contract rebuilds the signed text and checks the signature against the model’s registered key. A verdict that fails is refused. You can run the same check on <Link className="link" href="/rulings#judges">Results</Link>.</>],
  ["Take more than 3%", <>The cap is in the contract: <code>set_fee_bps</code> refuses anything above 300. Fees never touch a fact’s pot.</>],
  ["Bill you for AI", <>Only a swarm agent its owner spawned, or a house agent that accepted with its own key, can be charged for inference. Ordinary traders can’t.</>],
];

const CHECKS: [string, string][] = [
  ["LMSR market maths", "the browser’s quote is bit-exact with the contract’s Rust on 3,959 vector values"],
  ["The verdict rule and the bond split", "equal to the Rust on 17,722 vectors; 200,000 random splits conserve to the micro"],
  ["The code on chain is this source", "rebuilt byte for byte, mainnet included"],
  ["The books close", "every balance read from contract storage adds up to the micro"],
  ["A signed rewrite verifies and is anchored", "both sha256s, the signed text and ed25519, offline"],
  ["Money can arrive from another chain", "a live 1Click dry quote, Base USDC to NEAR USDC"],
  ["The measured number", "16 of 232 decided data sentences stale or wrong, recomputed"],
  ["The unit suites", "AI, API and web suites, all passing, no network"],
  ["The hosted site", "health, the priced page and the live event stream"],
  ["The judges are attested, mainnet holds their keys", "TDX quotes and GPU tokens verified offline; each key is the one the market holds"],
];

const TRUSTED: [string, string][] = [
  ["One key can upgrade the market.", "Everything under “what this code stops” holds only while this code runs. An upgrade shows as a new hash at the top of this page, but it would already be live when you saw it."],
  ["The owner registers the judges’ keys.", "The contract doesn’t check attestations itself. The proofs above let you compare, after the fact."],
  ["All three judges run on one provider, NEAR AI Cloud.", "You trust its secure chips and its signing. We don’t yet allowlist the measured workload or verify its gateway’s report."],
  ["The council is one key.", "It acts only on a fact disputed three times."],
  ["Our services hold keys, not your money.", "They can anchor corrections, bill agents that agreed, and add free-bet keys, within the methods listed above."],
];

function ProofCard({ p }: { p: Proof }) {
  const registered = deployment.models.find((m) => m.model === p.model);
  const good = p.verified && p.registered?.match;
  const line = (ok: boolean | undefined, text: ReactNode) => <li className={ok ? "" : "fail"}><Icon name={ok ? "check" : "x"} /><span>{text}</span></li>;
  return (
    <article className="panel proofc">
      <ModelBadge model={p.model} />
      <p className={`sig ${good ? "" : "bad"}`}><Icon name={good ? "check" : "alert"} />{good ? "Attested, and the key matches mainnet" : "A check failed"}</p>
      <ul className="checks">
        {line(p.tdx?.verified, <>Intel TDX quote verified, {p.tdx?.tcb_status ?? "status unknown"}</>)}
        {p.gpu && line(Boolean(p.gpu.overall ?? p.gpu.verified), <>NVIDIA GPU attestation{p.gpu.gpus ? `, ${p.gpu.gpus} × ${p.gpu.arch ?? "GPU"}` : ""}</>)}
        {line(p.binding?.debug_off, "Debug mode off")}
        {line(p.binding?.report_data_binding && p.binding?.nonce_echo, "Signing key and our nonce bound in the report")}
        {line(p.registered?.match, <>The key the market holds (<span className="hashv">{shortHash(p.signing_address, 8, 6)}</span>)</>)}
      </ul>
      <p className="fine">
        Fetched {p.fetched_at.slice(0, 10)} · proof sha256 <span className="hashv">{shortHash(p.bundle_sha256, 8, 6)}</span>
        {registered ? <> · <a className="link" href={explorerTx(registered.tx)} target="_blank" rel="noopener">registered on NEAR</a></> : null}
        {" · "}<a className="link" href={`/api/attestations?model=${encodeURIComponent(p.model)}`} target="_blank" rel="noopener">full proof</a>
      </p>
    </article>
  );
}

export default async function TrustPage() {
  const code = deployment.code.market;
  const [account, marketKeys, ownerKeys, attestations] = await Promise.all([proof.account(MARKET_ID), proof.keys(MARKET_ID), proof.keys(deployment.root), proof.attestations()]);
  const live = account.ok ? account.value.code_hash : null;
  const fullOnMarket = marketKeys.ok ? marketKeys.value.keys.filter((k) => k.access_key.permission === "FullAccess").length : null;
  const fullOnOwner = ownerKeys.ok ? ownerKeys.value.keys.filter((k) => k.access_key.permission === "FullAccess").length : null;
  const K = deployment.keys;
  /** What NEAR says a key on the owner account may call, falling back to the deployment record. */
  const methods = (key: string, recorded: string[]) => {
    const hit = ownerKeys.ok ? ownerKeys.value.keys.find((k) => k.public_key === key) : undefined;
    const p = hit?.access_key.permission;
    return (p && p !== "FullAccess" ? p.FunctionCall.method_names : recorded).join(", ");
  };
  const roles: { who: string; key: string; can: string }[] = [
    { who: "The market’s code", key: fullOnMarket === null ? "couldn’t read it" : fullOnMarket ? `${fullOnMarket} full-access key: not locked` : "No keys: locked for good", can: fullOnMarket ? "Replace the code, which changes the hash above" : "Nothing: the code can’t change" },
    { who: `Owner, ${deployment.root}`, key: fullOnOwner === null ? "couldn’t read it" : `${fullOnOwner} full-access key`, can: "Every owner method listed above" },
    { who: "Operator", key: K.operator_public_key, can: `${methods(K.operator_public_key, K.operator_methods)}: anchor corrections, bill agents that agreed` },
    { who: "Keeper", key: K.keeper_public_key, can: `${methods(K.keeper_public_key, K.keeper_methods)}: settle after the window, open corrected facts` },
    { who: "Verdict relay", key: K.jury_public_key, can: `${methods(K.jury_public_key, ["submit_verdict"])}: carries verdicts the models signed` },
    { who: "Checker", key: K.checker_public_key, can: `${K.checker_methods.join(", ")}: bond a challenge against a fact` },
    { who: "Free-bet admin", key: K.lane_admin_public_key, can: "Adds each visitor’s free $1 key on the lane account; can’t move another key’s credit or winnings" },
  ];

  return (
    <main id="main" className="wrap pg">
      <PageHero
        kick="Trust · check it yourself"
        title="Nobody can change the rules quietly. Not even us."
        lede={<>The market is a public contract on NEAR, and its code rebuilds <b>byte for byte</b> from the source. If anyone changes it, the code hash changes where everyone can see<span className="long">. Here is what we can do, what this code stops us doing, and how to check each line</span>.</>}
        side={
          <div className="seal">
            <span className="k">Code running on {MARKET_ID}, read live</span>
            <span className="hash">{live ?? "We couldn’t read it just now."}</span>
            <span className="k">Hash of the public build, commit {code.source_rev}</span>
            <span className="hash muted">{code.code_hash}</span>
            {live === null ? <span className="fine">Try again in a moment.</span>
              : live === code.code_hash ? <span className="ok"><Icon name="check" />They match: mainnet runs the published source.</span>
              : <span className="sig bad"><Icon name="alert" />They differ: the code has changed since this build.</span>}
          </div>
        }
      />

      <SHead id="rebuild" title="Rebuild it yourself" sub={`One command rebuilds the contract from source and prints its hash. A second runs all ten checks against the live deployments, and sends nothing. All ten last passed at commit ${JUDGE_RUN_AT}.`} />
      <div className="panel rebuild">
        <Code label="Rebuild the market" copy="node tools/judge/repro.mjs">{`git clone ${REPO_URL}\ncd priced-in && node tools/judge/repro.mjs\n# market ${code.code_hash}`}</Code>
        <Code label="Run every check" copy="npm run judge">{"npm run judge\n# 10 checks: 10 PASS, 0 FAIL, 0 SKIP"}</Code>
        <p className="fine">
          {deployment.code.toolchain} · wasm sha256 <span className="hashv">{shortHash(code.sha256, 10, 8)}</span> · {Math.round(code.size / 1024)} KB
          {deployment.upgrades.map((u) => <span key={u.tx}> · <a className="link" href={explorerTx(u.tx)} target="_blank" rel="noopener">upgraded {u.at.slice(0, 10)}</a></span>)}
        </p>
      </div>
      <div className="panel chartc tenchecks">
        <h3>The ten checks</h3>
        <ol className="checks10">
          {CHECKS.map(([title, detail], i) => <li key={title}><Icon name="check" /><span><b>{i + 1}. {title}.</b> {detail.charAt(0).toUpperCase()}{detail.slice(1)}.</span></li>)}
        </ol>
      </div>

      <SHead id="powers" title="What the house can do, and what this code stops" sub="Plain words first. Tap a line for the details and the contract method behind it." />
      <div className="cancant">
        <section className="panel cc can" aria-labelledby="can-h">
          <h3 id="can-h"><Icon name="alert" />What we can do</h3>
          {CAN.map(([title, detail]) => <details key={title}><summary>{title}</summary><p>{detail}</p></details>)}
        </section>
        <section className="panel cc cant" aria-labelledby="cant-h">
          <h3 id="cant-h"><Icon name="shield" />What this code stops us doing</h3>
          {CANT.map(([title, detail]) => <details key={title}><summary>{title}</summary><p>{detail}</p></details>)}
          <p className="fine ccnote">These are rules of the contract, so they hold while this code runs. Upgrading it could change them, which is why the hash comes first on this page.</p>
        </section>
      </div>

      <SHead id="keys" title="Every key, and what it may call" sub="Each service signs with a key limited to the methods listed. Methods on the owner account are read from NEAR on each visit; the rest come from the deployment record." />
      <div className="panel boardwrap">
        <table className="keys">
          <thead><tr><th scope="col">Who</th><th scope="col">Key</th><th scope="col">What it can do</th></tr></thead>
          <tbody>
            {roles.map((r) => <tr key={r.who}><td><b>{r.who}</b></td><td><span className="mono">{r.key.startsWith("ed25519:") ? shortHash(r.key, 14, 6) : r.key}</span></td><td className="can">{r.can}</td></tr>)}
          </tbody>
        </table>
      </div>

      <SHead id="judges" title="The AI judges’ proofs" sub="Each judge’s attestation binds its signing key to Intel TDX hardware and to our nonce, and the market holds exactly that key." />
      {attestations.ok && attestations.value.proofs.length ? (
        <div className="proofs3">{attestations.value.proofs.map((p) => <ProofCard key={p.model} p={p} />)}</div>
      ) : (
        <div className="panel quiet"><Icon name="alert" /><div><b>The proofs didn’t load just now.</b><p>{attestations.ok ? "No proofs came back." : attestations.error} They are also in the repository, under tools/judge/evidence/attestations.</p></div></div>
      )}

      <SHead id="limits" title="What you still have to trust" sub="Said plainly, so you don’t have to go looking for it." />
      <div className="panel trusted">
        <ul className="checks">
          {TRUSTED.map(([title, detail]) => <li key={title}><Icon name="info" /><span><b>{title}</b> {detail}</span></li>)}
        </ul>
        <p className="fine">The full notes are in the <a className="link" href={`${REPO_URL}/blob/main/docs/TRUST.md`} target="_blank" rel="noopener">trust document</a> and the <a className="link" href={`${REPO_URL}/blob/main/docs/THREAT_MODEL.md`} target="_blank" rel="noopener">threat model</a>. Contract: <a className="link" href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener">{MARKET_ID}</a>.</p>
      </div>
    </main>
  );
}
