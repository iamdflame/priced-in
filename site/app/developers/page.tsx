// Developers: the second revenue line. The truth API with real answers, what it costs today (x402 is
// proven on testnet, not switched on for mainnet, and the page says so), the MCP server, and an embed.
// The credence sample is cached for hours because the API allows this server 20 free calls a day.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Code, PageHero, SHead } from "@/components/pages/Kit";
import { TruthTry } from "@/components/pages/TruthTry";
import { explorerAccount, money } from "@/lib/format";
import { MARKET_ID, SITE_URL } from "@/lib/nav";
import { proof } from "@/lib/server/proof";
import { getSite } from "@/lib/server/site";
import { API_DOCS_URL, MCP_ADD, MCP_ADD_WITH_KEY, embedFrame, embedScript } from "@/lib/truth";

export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Developers: a truth API for AI agents",
  description: "Ask whether a claim is true and get the market’s price, the money behind it and signed provenance. 20 free calls a day, an MCP server, and an embed for any page.",
};

/** The one real x402 payment so far, on testnet (docs/API.md). */
const X402_TESTNET_TX = "9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX";
const X402_PRICE_USD = 0.01;
const SAMPLE_CLAIM = 18;

const TOOLS: [string, string][] = [
  ["ask", "Ask a question; get the closest facts, prices and provenance."],
  ["get_claim", "Read one fact: price, money, rulings and its last signed rewrite."],
  ["quote", "The exact price of a bet. Places nothing."],
  ["bet", "Bet with your own NEAR key. Capped at $5 a bet by default."],
];

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export default async function DevelopersPage() {
  const site = await getSite();
  const live = [...site.facts].filter((f) => f.status === "open").sort((a, b) => b.trades - a.trades)[0] ?? null;
  const [terms, sample, quote] = await Promise.all([
    proof.truthTerms(),
    proof.credence(`claim=${SAMPLE_CLAIM}`),
    live ? proof.quote(live.id, "yes", 1) : Promise.resolve(null),
  ]);
  const free = terms.ok ? terms.value.credence.free_per_ip_per_day : null;
  const quoteCurl = `curl "${SITE_URL}/v1/quote?claim=${live?.id ?? 0}&side=yes&amount_usd=1"`;
  const paymentsOn = terms.ok && terms.value.credence.payments !== null;
  const first = sample.ok ? sample.value.claims[0] : null;
  // only an answer that counts the fee is shown as real: an older API overstates the payout
  const exactQuote = quote?.ok && quote.value.quote.fee_bps !== undefined ? quote.value.quote : null;

  return (
    <main id="main" className="wrap">
      <PageHero
        kick="Developers · the truth API"
        title="Ask the market if it’s true."
        lede={<>One call gives an app or an AI agent the market’s price for a claim, <b>the money behind it</b>, how it was ruled and signed provenance<span className="long">. Prices are set by people and AI traders with real USDC at stake, not by a model’s guess</span>.</>}
        side={
          <Code label="Try it in a terminal" copy={`curl "${SITE_URL}/v1/credence?q=Is+USDT+on+NEAR"`}>{`curl "${SITE_URL}/v1/credence?q=Is+USDT+on+NEAR"`}</Code>
        }
      />

      <SHead id="try" title="Try it" sub={free ? `${free} free calls a day from each address, no key needed.` : undefined} />
      <TruthTry placeholder="How much does Tether hold in U.S. T-Bills?" />

      <SHead id="api" title="The API" sub="JSON in and out, open to any origin. Errors are always {error: {code, message}}." right={<a className="link" href={API_DOCS_URL} target="_blank" rel="noopener">Full reference</a>} />
      <div className="panel eps">
        <section className="ep">
          <div>
            <h3><span className="m">GET</span>/v1/credence</h3>
            <p>Match a question (<span className="tcode">?q=</span>) or read a fact (<span className="tcode">?claim=</span>). Answers with the price, the money behind it, the AI traders’ reasons and how it was decided.</p>
          </div>
          {first ? <Code label={`Real answer for ?claim=${SAMPLE_CLAIM}, trimmed`}>{pretty({ claim_id: first.claim_id, credence: first.credence, summary: first.summary, volume_usd: first.volume_usd, trades: first.trades, decided: first.resolution.state, outcome: first.resolution.outcome })}</Code> : <p className="fine">The sample didn’t load just now. {sample.ok ? "" : sample.error}</p>}
        </section>
        <section className="ep">
          <div>
            <h3><span className="m">GET</span>/v1/quote</h3>
            <p>What <span className="tcode">?claim=&amp;side=&amp;amount_usd=</span> would buy{exactQuote ? ", fee included," : ""} with the <span className="tcode">buy</span> call to send. It places nothing.</p>
          </div>
          {exactQuote ? <Code label={`Real answer for fact ${live!.id}, Yes, $1, trimmed`}>{pretty({ side: exactQuote.side, amount_usd: exactQuote.amount_usd, payout_if_right_usd: exactQuote.payout_if_right_usd, price_yes_before: exactQuote.price_yes_before, price_yes_after: exactQuote.price_yes_after, fee_bps: exactQuote.fee_bps })}</Code> : <Code label="A $1 quote" copy={quoteCurl}>{quoteCurl}</Code>}
        </section>
        <section className="ep">
          <div>
            <h3><span className="m">GET</span>/claims, /events, /health</h3>
            <p>Every fact, the market’s live event log and the service’s own health. Free, and cached at the edge.</p>
          </div>
          <Code label="Every fact on a page" copy={`curl "${SITE_URL}/claims?page=tether"`}>{`curl "${SITE_URL}/claims?page=tether"`}</Code>
        </section>
      </div>

      <SHead id="pricing" title="Pricing" sub="Agents pay per call in USDC with x402: no account, no key, no invoice." />
      <div className="price3">
        <div className="panel price">
          <h3>Free</h3>
          <div className="v num">{free ?? "—"}<small>calls a day</small></div>
          <p>From each address, no sign-up. Live on mainnet today.</p>
        </div>
        <div className="panel price">
          <h3>Pay per call</h3>
          <div className="v num">{money(X402_PRICE_USD)}<small>a call</small></div>
          <p>{paymentsOn ? "Past the free tier the API answers 402 and your client pays in USDC." : <>Not switched on for mainnet yet: past the free tier you get <span className="tcode">429 free_tier_used</span>. It has run end to end on testnet (<a className="link" href={`https://testnet.nearblocks.io/txns/${X402_TESTNET_TX}`} target="_blank" rel="noopener">a real paid call</a>).</>}</p>
        </div>
        <div className="panel price">
          <h3>Quotes and reads</h3>
          <div className="v num">$0<small>always</small></div>
          <p>Quotes, facts and events are free. The chain is public either way: read <a className="link" href={explorerAccount(MARKET_ID)} target="_blank" rel="noopener">the contract</a> directly if you like.</p>
        </div>
      </div>

      <SHead id="mcp" title="MCP server" sub="Give Claude, Cursor or any MCP client the market as tools. Run from a clone of the repo; it isn’t on npm yet." />
      <div className="charts2">
        <div className="panel chartc stack">
          <Code label="Read the market" copy={MCP_ADD}>{MCP_ADD}</Code>
          <Code label="Also bet, with your own key" copy={MCP_ADD_WITH_KEY}>{MCP_ADD_WITH_KEY}</Code>
          <p className="fine">Your key stays in the server’s environment. Priced In never holds it.</p>
        </div>
        <div className="panel chartc">
          <h3>Four tools</h3>
          <div className="toollist">{TOOLS.map(([name, what]) => <p key={name}><span className="tcode">{name}</span> {what}</p>)}</div>
        </div>
      </div>

      {live && (
        <>
          <SHead id="embed" title="Embed “Is it true?”" sub="Put a live fact on any page: the question, the chance it’s true, and Yes and No." />
          <div className="embedbox">
            <div className="stack">
              <Code label="A script tag" copy={embedScript(live.id)}>{embedScript(live.id)}</Code>
              <Code label="Or an iframe" copy={embedFrame(live.id)}>{embedFrame(live.id)}</Code>
            </div>
            <iframe src={`/embed/${live.id}`} title="A live preview of the embed" loading="lazy" />
          </div>
        </>
      )}
      <p className="fine devfoot">Want a whole page priced? <Link className="link" href="/new">Paste any text</Link><Icon name="arrow" className="inline-arrow" /></p>
    </main>
  );
}
