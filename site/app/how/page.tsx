// /how: the whole product in a minute, told through one real fact from first price to payout. Every
// number comes from the recorded mainnet run (data/rehearsal-mainnet.json) or an exact quote, so this
// page can't drift from what happened.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import rehearsal from "@/data/rehearsal-mainnet.json";
import { Dial } from "@/components/Dial";
import { Icon } from "@/components/Icon";
import { ModelBadge, SHead } from "@/components/pages/Kit";
import { explorerTx, money, shortHash, span } from "@/lib/format";
import { REPLAY_HREF } from "@/lib/nav";
import { arrange, shortDate, type TodayLine } from "@/lib/news";
import { payoutWords, quoteClaim } from "@/lib/quote";
import { preBetClaim, REPLAY } from "@/lib/replay/record";
import { getNews } from "@/lib/server/news";
import { getOfficial } from "@/lib/server/pages";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "How it works",
  description: "Pick true or false, three AI judges decide, and right answers win. One real fact from first price to payout, in a minute.",
};

const QUESTION = "Are most of Tether’s cash reserves U.S. T-Bills, accounting for $72.6 billion?";
const LADDER = [
  { usd: "$1", what: "The challenge" },
  { usd: "$2", what: "First objection" },
  { usd: "$4", what: "Second objection" },
  { usd: "$8", what: "Third, then the council decides" },
];

interface Ruling { opened_at: number; settled_at: number; payout_usd: number; settle_tx: string; verdicts: { model: string; verdict: string; at: number }[]; correction: { claim_id: number; open_tx: string } }

/** The daily loop, shown while the API has today's news on: told with one real claim from today. */
function DailyLoop({ example }: { example: TodayLine | null }) {
  return (
    <>
      <SHead id="daily" title="Every day: call today’s news" sub="Wikipedia is the record. The news is what people argue about today, so twice a day new claims open, and you can call them free." />
      <ol className="how-loop">
        <li>
          <span className="n" aria-hidden="true">1</span>
          <h3>Fresh claims from the news</h3>
          <p>Our scout reads the day’s headlines and opens a few claims nobody has confirmed yet, each with a date and whose word settles it.</p>
          {example && (
            <div className="how-claim">
              <b>{example.question}</b>
              <small>Settles by {shortDate(example.settles.by)}: {example.settles.source}</small>
            </div>
          )}
        </li>
        <li>
          <span className="n" aria-hidden="true">2</span>
          <h3>Pick in one tap</h3>
          <p>Yes or No, free, with no wallet and no sign-up. Your first pick on a claim is the one that counts. Picks win nothing.</p>
        </li>
        <li>
          <span className="n" aria-hidden="true">3</span>
          <h3>It settles on the source’s word</h3>
          <p>After the date, our settler reads the named source, and three AI judges rule on its receipts. A line waits rather than pay the wrong side.</p>
        </li>
        <li>
          <span className="n" aria-hidden="true">4</span>
          <h3>Come back: did you call it?</h3>
          <p>Right calls build your streak and your place on the <Link className="link" href="/leaderboard">leaderboard</Link>, beside three AI traders that bet real money.</p>
        </li>
      </ol>
      <div className="how-catch panel">
        <Icon name="flag" />
        <p><b>See something wrong?</b> On any fact or claim, show us a page from its own sources, an official site or an established news outlet, with the exact words from it. If our checks pass, our Checker challenges it with its own $1 bond, and a catch the AI judges uphold counts on the leaderboard. Or challenge it yourself with a $1 bond from your wallet.</p>
      </div>
    </>
  );
}

export default async function HowPage() {
  const [news, official] = await Promise.all([getNews(), getOfficial()]);
  const who = 5 + (news.on ? 1 : 0) + (official.on ? 1 : 0);
  const example = news.on ? (arrange(news.today.lines, Date.now()).lead ?? news.today.lines[0] ?? null) : null;
  const r = (rehearsal.steps as { kind: string; record?: unknown }[]).find((s) => s.kind === "ruling")!.record as Ruling;
  const before = preBetClaim();
  const quotes = quoteClaim(before);
  const yes = quotes ? payoutWords(quotes.yes) : null, no = quotes ? payoutWords(quotes.no) : null;
  const from = Math.round((before.price_yes_ppm / 1e6) * 100), to = Math.round((REPLAY.priceAfterPpm / 1e6) * 100);
  const seconds = (at: number) => `${((at - r.opened_at) / 1000).toFixed(1)} s`;

  return (
    <main id="main" className="wrap pg how">
      <section className="how-hero" aria-labelledby="how-title">
        <div>
          <span className="kick">How it works</span>
          <h1 id="how-title">Pick true or false. AI judges decide. Right answers win.</h1>
          <p className="lede">Priced In is a market for facts. You bet on whether a line is true, and three AI judges settle it in public. Your first $1 is free: no wallet, no sign-up.</p>
          <div className="acts">
            <Link className="btn primary lg" href="/">Bet your free $1</Link>
            <Link className="btn ghost lg" href={REPLAY_HREF}><Icon name="play" />Watch a real one</Link>
          </div>
        </div>
        <figure className="how-herodial">
          <Dial p={0.0998} label="chance it’s true" sizes="320px" priority />
          <figcaption><b>10% chance it’s true</b>A real Wikipedia line after 7 bets. Here’s what happened to it.</figcaption>
        </figure>
      </section>

      <SHead id="story" title="One real fact, start to finish" sub="Every number here is from a real run with real money, and every step is a public transaction." />
      <ol className="how-steps">
        <li className="how-step">
          <span className="n" aria-hidden="true">1</span>
          <div className="how-copy">
            <h3>Every fact gets a price.</h3>
            <p>Each fact is a Yes or No question. The % is the chance it’s true. It starts as our AI’s estimate, and every bet moves it.</p>
          </div>
          <div className="how-art how-fact">
            <div>
              <small>From Wikipedia: Tether (cryptocurrency)</small>
              <b>{QUESTION}</b>
              <blockquote>“The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.”</blockquote>
            </div>
            <figure>
              <Dial p={0.5} sizes="170px" />
              <figcaption>Our AI’s estimate, before any bets</figcaption>
            </figure>
          </div>
        </li>

        <li className="how-step">
          <span className="n" aria-hidden="true">2</span>
          <div className="how-copy">
            <h3>You bet Yes or No.</h3>
            <p>The buttons say what $1 becomes if you’re right, and the less likely side pays more. A visitor’s free $1 went on No, and it moved the price. Seven bets took this fact to 10%.</p>
          </div>
          <div className="how-art">
            {yes && no && (
              <div className="bets">
                <div className="bet yes"><b>Yes, it’s true</b><small>{yes.right}</small></div>
                <div className="bet no" aria-pressed="true"><b>No, it’s false</b><small>{no.right}</small></div>
              </div>
            )}
            <div className="how-receipt">
              <span className="ok"><Icon name="check" />Recorded on NEAR in 4.5 s</span>
              <p className="how-move"><b>{from}% <Icon name="arrow" /> {to}%</b><span>chance it’s true</span></p>
              <a className="hashv" href={explorerTx(REPLAY.betTx)} target="_blank" rel="noopener" aria-label="This bet on the NEAR explorer">{shortHash(REPLAY.betTx)}</a>
            </div>
          </div>
        </li>

        <li className="how-step">
          <span className="n" aria-hidden="true">3</span>
          <div className="how-copy">
            <h3>Someone doubts it, and three AI judges rule.</h3>
            <p>Our Checker posted a $1 bond with its evidence: Tether’s own report says $122.84 billion. Three AI models from different makers read it and each signed a verdict. The market contract checks every signature, so nobody can fake one.</p>
          </div>
          <div className="how-art how-judges">
            {r.verdicts.map((v) => (
              <div key={v.model}>
                <ModelBadge model={v.model} />
                <span className="verdict">{v.verdict}</span>
                <span className="at">{seconds(v.at)}</span>
              </div>
            ))}
            <small>Seconds after the challenge</small>
          </div>
        </li>

        <li className="how-step">
          <span className="n" aria-hidden="true">4</span>
          <div className="how-copy">
            <h3>Anyone can object.</h3>
            <p>Every ruling opens a window: 10 minutes on a small market, up to a day on the largest. To object, you post twice the bond, and whoever turns out wrong loses theirs. A Sentinel also checks every receipt at its source and disputes fakes.</p>
          </div>
          <div className="how-art">
            <ol className="how-ladder">
              {LADDER.map((l) => <li key={l.usd}><b>{l.usd}</b><span>{l.what}</span></li>)}
            </ol>
            <p className="how-note"><Icon name="clock" />On this fact, nobody objected.</p>
          </div>
        </li>

        <li className="how-step">
          <span className="n" aria-hidden="true">5</span>
          <div className="how-copy">
            <h3>Right answers win, and the fact gets fixed.</h3>
            <p>It settled {span(r.settled_at - r.opened_at)} after the challenge. The people who bet No were paid, and the corrected sentence opened as a new fact anyone can bet on.{official.on && <> On the encyclopedia page, it took the old line’s place.</>}</p>
          </div>
          <div className="how-art how-paid">
            <p className="how-big"><b>{money(r.payout_usd)}</b><span>paid to the people who bet No</span></p>
            <dl className="how-ba">
              <div><dt>Before</dt><dd><del>$72.6 billion</del></dd></div>
              <div><dt>After</dt><dd><ins>$122.84 billion</ins> at 30 September 2026</dd></div>
            </dl>
            <p className="how-links">
              <Link className="link" href={`/c/${r.correction.claim_id}`}>See the new fact</Link>
              <a className="link" href={explorerTx(r.settle_tx)} target="_blank" rel="noopener">The payout on NEAR</a>
            </p>
          </div>
        </li>
      </ol>

      {news.on && <DailyLoop example={example} />}

      <SHead id="ways" title={news.on ? "Three ways to play" : "Two ways to play"} sub="Same facts, same judges. The difference is what a right answer gives you." />
      <div className={`how-ways${news.on ? " three" : ""}`}>
        {news.on && (
          <div className="how-way">
            <h3>A free pick</h3>
            <p>One tap, no wallet. A right call counts on the leaderboard against the AI traders. Picks win nothing: no prize, no payout.</p>
            <Link className="btn ghost" href="/#today">Pick today’s claims</Link>
          </div>
        )}
        <div className="how-way">
          <h3>Your free $1</h3>
          <p>No wallet and no sign-up. A right answer adds to your score. Free play can’t be cashed out.</p>
          <Link className="btn primary" href="/">Bet your free $1</Link>
        </div>
        <div className="how-way">
          <h3>Real USDC</h3>
          <p>Connect a NEAR wallet and add USDC. A right answer pays real money, with a 1% fee on each bet. Not available in the US or other <Link className="link" href="/terms#regions">restricted regions</Link>.</p>
          <Link className="btn ghost" href="/portfolio">Go to your portfolio</Link>
        </div>
      </div>

      <SHead id="who" title="Who does what" />
      <dl className={`how-who${who === 6 ? " six" : who === 7 ? " seven" : ""}`}>
        <div><dt>You</dt><dd>Pick true or false, and collect when you’re right.</dd></div>
        <div><dt><Link href="/agents">The AI traders</Link></dt><dd>Three AI models with their own money. They bet small amounts, so no fact sits empty.</dd></div>
        <div><dt>The Checker</dt><dd>Challenges a fact when a newer source disagrees, with its own bond.</dd></div>
        <div><dt><Link href="/rulings">The AI judges</Link></dt><dd>Three models from different makers. They rule, and they sign what they ruled.</dd></div>
        <div><dt><Link href="/accuracy#sentinel">The Sentinel</Link></dt><dd>Checks each receipt where it lives, and disputes a ruling that rests on a fake.</dd></div>
        {official.on && <div><dt><Link href="/p">The writer</Link></dt><dd>Rewrites each encyclopedia page from the odds, and signs every paragraph it writes.</dd></div>}
        {news.on && <div><dt>The scout</dt><dd>Reads the day’s news and opens claims nobody has confirmed yet, each with its date and whose word settles it.</dd></div>}
      </dl>

      <SHead id="asked" title="What people ask first" right={<Link className="link" href="/help">All questions</Link>} />
      <div className="panel cc">
        <details>
          <summary>Can’t I just ask an AI?</summary>
          <p>You can, and it’s how you win: check a fact, then bet on what you found. An answer in a chat changes nothing. A ruling here is public, signed and paid, and the corrected line becomes a new fact.</p>
        </details>
        <details>
          <summary>What if the AI judges are wrong?</summary>
          <p>They can be. On 232 facts we had checked by hand they ruled on 142 and got 136 right, and every mistake is listed on <Link href="/accuracy">Accuracy</Link>. That’s why anyone can object with a bond before a ruling settles.</p>
        </details>
        <details>
          <summary>Is the free $1 really free?</summary>
          <p>Yes. We pay for it, and we never ask for your name or email. It’s a real trade on NEAR, and winning adds to your score.</p>
        </details>
      </div>

      <section className="how-close" aria-labelledby="how-go">
        <h2 id="how-go">Your first $1 is free.</h2>
        <p>Pick a fact and call it.</p>
        <Link className="btn primary lg" href="/">Bet your free $1</Link>
      </section>
    </main>
  );
}
