// /privacy. Plain words, and only what is true of this site today: what stays in your browser, the one
// cookie, what our servers see, what is public on NEAR forever, and who else is involved.
import type { Metadata } from "next";
import Link from "next/link";
import { MARKET_ID, REPO_URL } from "@/lib/nav";

export const metadata: Metadata = { title: "Privacy", description: "What Priced In keeps, where, and why: no accounts, no ads, no tracking. What stays in your browser and what is public on NEAR." };

export default function PrivacyPage() {
  return (
    <main id="main" className="wrap">
      <article className="legal">
        <h1>Privacy</h1>
        <p className="lede">No account, no email, no ads and no tracking scripts. What we keep is what the product needs to work, and most of it stays in your own browser.</p>
        <p className="upd">Last changed 6 November 2026. This page is not legal advice.</p>

        <h2 id="none">What we don’t collect</h2>
        <ul>
          <li>We never ask for your name, email or phone number. There is no sign-up.</li>
          <li>The site runs no analytics, advertising or tracking scripts, and we sell nothing about you.</li>
        </ul>

        <h2 id="browser">What stays in your browser</h2>
        <p>These live in your browser’s own storage, on your device. We can’t read them, and clearing your site data removes them.</p>
        <ul>
          <li><b>Your free-bet key.</b> Your browser makes its own key for the free $1 and keeps it. Clear it and you lose access to that bet’s score.</li>
          <li><b>Your recent bets and wallet transactions,</b> so your receipts and Portfolio show what you did.</li>
          <li><b>Small settings:</b> your theme, and whether you’ve connected a wallet before.</li>
        </ul>

        <h2 id="cookie">One cookie</h2>
        <p><code>pi_geo</code> holds your country code and what real money may do from there, read from your connection, so the money screens can say so before you tap. It lasts an hour, and only this site reads it.</p>

        <h2 id="servers">What our servers see</h2>
        <ul>
          <li><b>Your IP address,</b> with each request, as every website does. We use it to limit free bets and free API calls per network each day. We don’t store the address itself: we store a short hash of it with a count for that day.</li>
          <li><b>Our host keeps standard request logs.</b> The site and API run on Vercel.</li>
          <li><b>Text you paste to price</b> is sent to our AI on NEAR AI Cloud and can become a public market. Don’t paste anything private.</li>
        </ul>

        <h2 id="public">What is public on NEAR, for good</h2>
        <p>Every bet, sale, deposit, withdrawal and ruling is a transaction on NEAR mainnet, in the public contract <a href={`https://nearblocks.io/address/${MARKET_ID}`} target="_blank" rel="noopener">{MARKET_ID}</a>. It shows the account or key that acted, the amount and the time. Anyone can read it, and no one, including us, can delete it. If you connect a wallet, your bets are linked to that wallet’s account.</p>

        <h2 id="others">Who else is involved</h2>
        <ul>
          <li><b>NEAR nodes</b> carry your transactions when you bet.</li>
          <li><b>Your wallet</b>, when you connect one, under its own terms.</li>
          <li><b>NEAR Intents</b>, when you move money from another chain.</li>
          <li><b>NEAR AI Cloud</b>, which runs our AI models on facts and pasted text, not on anything about you.</li>
        </ul>

        <h2 id="contact">Questions</h2>
        <p>Open an issue on <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener">GitHub</a>. The code that does all of the above is public there too. See also the <Link href="/terms">Terms</Link>.</p>
      </article>
    </main>
  );
}
