// /help: the questions people ask, answered in plain words. Every answer is true of the product today,
// and the limits are read from where the site enforces them, so this page can't drift from the rules.
import "../styles/pages.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHero, SHead } from "@/components/pages/Kit";
import { LIMITS } from "@/lib/money/rules";
import { MARKET_ID, REPLAY_HREF, REPO_URL } from "@/lib/nav";
import { getNews } from "@/lib/server/news";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Help",
  description: "How Priced In works, in plain words: betting, the free $1, who decides what’s true, real money, and using AI.",
};

type QA = { q: string; a: ReactNode };

const SECTIONS: { id: string; title: string; sub: string; items: QA[] }[] = [
  {
    id: "betting", title: "Betting", sub: "Yes or No on a fact, and what the number means.",
    items: [
      { q: "What is Priced In?", a: <>A prediction market for facts. Each fact is a Yes/No question, and the % is the market’s chance that it’s true. You bet on whether it is, and an AI jury decides the facts people doubt.</> },
      { q: "How do I bet?", a: <>Tap Yes or No on any fact. Before you confirm, the ticket shows what $1 becomes if you’re right. Your bet is a real trade on NEAR, and it settles in a few seconds.</> },
      { q: "What does the % mean?", a: <>It’s the market’s chance that the fact is true. Before anyone bets, it’s our AI’s first read, and the card says so. Every bet moves it, and the ticket says how far $1 moves that market.</> },
      { q: "What happens when I’m right?", a: <>When the fact is decided, each share on the right side pays $1 and each share on the wrong side pays nothing. You can also sell before then, at the current price.</> },
    ],
  },
  {
    id: "free", title: "The free $1", sub: "One real bet per browser, with no wallet and no sign-up.",
    items: [
      { q: "Is the $1 really free?", a: <>Yes. Each browser gets one free $1 bet, paid from our budget. It’s a real trade on NEAR, signed by a key your browser makes for itself. We never ask for your name or email.</> },
      { q: "What is the score?", a: <>The free $1 is free play. If you’re right, the winnings add to your score, which you can see on your <Link href="/portfolio">Portfolio</Link>. Score can’t be cashed out. To win money you can withdraw, bet real USDC from a wallet.</> },
      { q: "Why is my free bet unavailable?", a: <>Free bets come from a daily budget, and each network gets a daily limit so one place can’t use them all. When either runs out, the site says so before you tap. You can still <Link href={REPLAY_HREF}>watch a replay</Link> or bet with a wallet.</> },
      { q: "I cleared my browser. Where did my free bet go?", a: <>The key for your free bet lives only in your browser, so clearing its storage loses access to that bet’s score. The trade itself stays on NEAR for anyone to see.</> },
    ],
  },
  {
    id: "rulings", title: "Who decides what’s true", sub: "The AI jury, the dispute window and the corrected line.",
    items: [
      { q: "Who decides whether a fact is true?", a: <>When a fact is doubted, a Checker posts a $1 bond with its evidence. Three AI models from different makers (DeepSeek, Qwen and GLM) read the claim and the evidence and sign a verdict. Each runs in a sealed chip that proves which model answered, and the market contract checks every signature. Two matching verdicts decide.</> },
      { q: "When does the jury sit?", a: <>Daily at 15:00 UTC, on the doubted fact with the most bets. The next sitting and every past ruling are on <Link href="/rulings">Results</Link>.</> },
      { q: "What if the AI jury is wrong?", a: <>Every ruling opens a dispute window, from 10 minutes on a small market up to a day on the largest. Anyone with a NEAR account can dispute by posting twice the bond, which flips the ruling and restarts the window. The third dispute goes to the council. Whoever is wrong loses their bond to whoever is right.</> },
      { q: "Can someone lie to the jury?", a: <>A ruling is only as good as its evidence, so every receipt is checked where it lives: the cited page is fetched and its exact words looked for before our jury sits. If someone runs the jury themselves on receipts that fail, the Sentinel disputes it with its own bond. In our test it disputed 52 of 53 lies and none of 21 honest challenges; the numbers are on <Link href="/accuracy">Accuracy</Link>.</> },
      { q: "How often is the jury right?", a: <>On 232 facts we had already checked by hand, it ruled on 142 and was right on 136. When the source doesn’t settle a fact it declines, and the bond is refunded. Every wrong ruling is listed on <Link href="/accuracy">Accuracy</Link>.</> },
      { q: "What happens to a fact that’s ruled false?", a: <>The people who bet against it are paid. When the source gives the right wording, the corrected sentence opens as a new market anyone can bet on.</> },
    ],
  },
  {
    id: "money", title: "Real money", sub: "USDC on NEAR, in your own wallet.",
    items: [
      { q: "How do I bet real money?", a: <>Connect a NEAR wallet on your <Link href="/portfolio">Portfolio</Link> and add USDC, from NEAR or from another chain through NEAR Intents. Then bet on any fact, and sell, collect or withdraw from your Portfolio.</> },
      { q: "Where is my money held?", a: <>In the public market contract <a href={`https://nearblocks.io/address/${MARKET_ID}`} target="_blank" rel="noopener">{MARKET_ID}</a>. This site never holds your keys: your wallet signs every transaction.</> },
      { q: "What does it cost?", a: <>A 1% fee on each bet and sale, shown before you approve. Depositing, collecting and withdrawing have no Priced In fee; NEAR charges a small network fee. Through this site a bet is capped at ${LIMITS.maxBetUsd} while Priced In is a preview.</> },
      { q: "Where can I bet real money?", a: <>Not in the United States or the other restricted regions listed in the <Link href="/terms#regions">Terms</Link>. The free $1 works everywhere, as score.</> },
    ],
  },
  {
    id: "ai", title: "AI and Priced In", sub: "Asking an AI, the AI traders, and your own agent.",
    items: [
      { q: "Can’t I just ask an AI?", a: <>You can, and it’s how you win: check a fact, then bet on what you found. In our test an AI with web search found 7 of 10 out-of-date Wikipedia lines, yet all 10 were still on Wikipedia. An answer in a chat changes nothing. A ruling here is public, signed and paid, and the corrected line becomes a market.</> },
      { q: "Who are the AI traders?", a: <>Three house agents, the Archivist, the Skeptic and the Quant, each with its own model and its own money. They bet small amounts ($0.12 at most a bet) so no fact sits empty, and their bets and profit are public on <Link href="/agents">AI traders</Link>.</> },
      { q: "Can my AI agent use Priced In?", a: <>Yes. The truth API and the MCP server answer “how sure should I be?” for a claim, with the price, the open interest and the sources. 20 calls a day are free; after that a call costs $0.01 in USDC, paid per call. See <Link href="/developers">Developers</Link>.</> },
    ],
  },
];

/** Shown while the API has today's news on: picks, the leaderboard and catching a mistake. */
const PICKS: { id: string; title: string; sub: string; items: QA[] } = {
  id: "picks", title: "Today’s claims and free picks", sub: "Claims from the news, a free call on each, and the leaderboard.",
  items: [
    { q: "What are today’s claims?", a: <>Claims from the day’s news that nobody had confirmed when they opened, each with a date and the source whose word settles it, such as a company’s newsroom or an official site. Reports citing unnamed sources don’t count. A claim settles true if that source confirms it by the date, and false if the date passes without it or the source denies it.</> },
    { q: "What is a pick?", a: <>Your call on a claim or a fact, in one tap: free, with no wallet and no sign-up. It’s signed by a key your browser keeps, the same one as your free $1. Your first pick on a claim is the one that counts. Picks win nothing: no purchase, no prize, no payout.</> },
    { q: "How is the leaderboard ranked?", a: <>By how often you’re right, once you have 5 settled picks, then by how many settled, then by points. A right pick earns more points the less likely the market thought it was. Three AI traders are on the same board, counted the same way: their first bet on a claim is their pick. See the <Link href="/leaderboard">leaderboard</Link>.</> },
    { q: "Can I bet money on a claim?", a: <>Yes. After a pick, back it with your free $1 or with USDC from a wallet. The bet is a trade like any other, and right answers get paid. A news claim takes no new bets once its date has passed.</> },
    { q: "How do I report a mistake?", a: <>On any fact or claim, tap Report a mistake and give a public page and the exact words from it. We fetch the page and look for the words, and three AI checkers read it. If they agree, our Checker challenges with its own $1 bond and three AI judges rule. A catch they uphold counts on the leaderboard. Reporting is free, and the status shows on the page and on your <Link href="/portfolio">Portfolio</Link>.</> },
    { q: "Why did my report get refused?", a: <>The page must be public and the words must be on it exactly as you copied them; the refusal says which check failed. A claim from the news can’t be shown false before its date: until then it might still happen.</> },
    { q: "What is a bounty?", a: <>Money anyone can add to a line, paid to the first challenger proven right. A line that holds one says how much.</> },
  ],
};

export default async function HelpPage() {
  const news = await getNews();
  const sections = news.on ? [SECTIONS[0], PICKS, ...SECTIONS.slice(1)] : SECTIONS;
  return (
    <main id="main" className="wrap pg">
      <PageHero
        live={false}
        kick="Help center"
        title="Questions, answered plainly."
        lede={<>How betting works, what the free $1 is, who decides what’s true and how real money moves. Every transaction is public, and so is the code.</>}
      />
      {sections.map((s) => (
        <section key={s.id} aria-labelledby={s.id}>
          <SHead id={s.id} title={s.title} sub={s.sub} />
          <div className="panel cc">
            {s.items.map((x) => (
              <details key={x.q}>
                <summary>{x.q}</summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <section aria-labelledby="more">
        <SHead id="more" title="Still have a question?" sub="Check it yourself, or tell us." />
        <div className="panel cc">
          <p>See what you have to trust on <Link href="/trust">Trust</Link>, what’s running right now on <Link href="/status">Status</Link>, and every rule in the <Link href="/terms">Terms</Link>. To report a problem, open an issue on <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener">GitHub</a>.</p>
        </div>
      </section>
    </main>
  );
}
