// /terms. Plain words, and only what is true of the product today. The caps and the region lists are
// read from where the site enforces them, so this page can't drift from the rules.
import type { Metadata } from "next";
import Link from "next/link";
import { REGIONS } from "@/lib/money/geo";
import { LIMITS } from "@/lib/money/rules";
import { MARKET_ID } from "@/lib/nav";
import { getNews } from "@/lib/server/news";

export const revalidate = 60;

export const metadata: Metadata = { title: "Terms", description: "The research preview, score versus cash, the risks, withdrawals and the restricted regions." };

const codes = (l: string[]) => l.join(" · ");

export default async function TermsPage() {
  const { blocked, close_only: closeOnly, policy, sources } = REGIONS;
  const news = await getNews();
  return (
    <main id="main" className="wrap">
      <article className="legal">
        <h1>Terms</h1>
        <p className="lede">Priced In is a micro-stakes research preview. Read this before you put in real money. The free $1 needs none of it.</p>
        <p className="upd">Last changed 7 November 2026. This page is not legal, tax or financial advice.</p>

        <h2 id="preview">A micro-stakes research preview</h2>
        <p>Priced In is live software on NEAR mainnet, and it is still a preview. Stakes are kept small on purpose. Through this site a bet is capped at ${LIMITS.maxBetUsd} and a deposit at ${LIMITS.maxDepositUsd}. Those caps are set by this site; the contract has no per-person limit.</p>

        <h2 id="score">Score versus cash</h2>
        <ul>
          <li><b>Your free $1 is score, not cash.</b> It is one per browser. Its winnings stay in the market as score and can’t be withdrawn. You can bet that score again on any fact, from the same browser.</li>
          {news.on && <li><b>Free picks win nothing.</b> A pick is your call on a claim or a fact: no purchase, no prize, no payout, no sweepstakes. Picks count only toward the leaderboard.</li>}
          <li><b>Real money is USDC on NEAR.</b> You deposit it from your own wallet, bet it, and can sell, collect and withdraw it. A winning share pays $1 after the market settles.</li>
        </ul>

        <h2 id="risks">The risks</h2>
        <ul>
          <li>You can lose everything you bet. A share on the losing side pays nothing.</li>
          <li>Three AI models rule on a challenged fact. They can be wrong, and a ruling can be disputed only inside its window.</li>
          <li>Smart contracts can have bugs, and a transaction on NEAR can’t be reversed. The market can be paused by its owner, and while it is paused no money moves.</li>
          <li>USDC is issued by Circle and carries its own risk. Deposits and withdrawals through other chains are routed by NEAR Intents, which is a third party.</li>
          <li>A transfer to the wrong address can’t be undone.</li>
        </ul>

        <h2 id="fees">Fees</h2>
        <p>Every bet and sale pays the market’s taker fee, shown before you approve (1% today). Collecting, depositing and withdrawing pay no Priced In fee. NEAR charges a small network fee in NEAR, and cross-chain routes have routing fees, which are already in the quote you see.</p>

        <h2 id="custody">Who holds the money</h2>
        <p>Your balance sits in the public contract <a href={`https://nearblocks.io/address/${MARKET_ID}`} target="_blank" rel="noopener">{MARKET_ID}</a>. This site never holds your keys: your wallet signs every transaction after this site has said, in one sentence, what it does.</p>

        <h2 id="kyc">Withdrawals and identity checks</h2>
        <p>No identity check is run today, at these limits. If limits rise, or the law where we operate requires it, identity verification (KYC) will be required at withdrawal, before money leaves through this site. This page will say so before that takes effect.</p>

        <h2 id="regions">Restricted regions</h2>
        <p>Real-money actions on this site follow your region, read from your connection. The free $1 works everywhere, as score.</p>
        <div className="box">
          <p><b>Blocked.</b> {policy.blocked}</p>
          <p className="codes">{codes(blocked.countries)} · {codes(blocked.regions)}</p>
        </div>
        <div className="box">
          <p><b>Close only.</b> {policy.close_only}</p>
          <p className="codes">{codes(closeOnly.countries)} · {codes(closeOnly.regions)}</p>
        </div>
        <p>This list follows the published practice of a large prediction market. It makes no claim about the law of any place, and being outside it doesn’t mean betting is lawful where you are: that is yours to check. Don’t use a VPN or anything else to get around it. The contract itself is public and doesn’t check where anyone is; these restrictions apply to this site.</p>
        <p>Sources: {sources.map((s, i) => <span key={s.url}>{i ? "; " : ""}<a href={s.url} target="_blank" rel="noopener">{s.name}</a> (read {s.retrieved})</span>)}.</p>

        <p className="upd"><Link href="/portfolio">Back to your portfolio</Link></p>
      </article>
    </main>
  );
}
