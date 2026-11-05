---
name: pricedin-design
description: "Priced In's design system and review standard: the clarity direction (odds first, plain words), brand, tokens, type, the ink law as a quiet second signal, components, the after-bet story, voice, the retired Point Source first screen and why, the tells to reject and the review format. Load it before building, changing or reviewing any Priced In page, card, OG image, video frame or UI state."
---

# Priced In design: clarity

## The bar
A visitor who has never heard of Priced In understands, within five seconds, on a 390×844 phone and on a laptop:
- **what it is:** an encyclopedia where every sentence shows the odds it's true, set by AI agents betting real money;
- **what to do:** bet $1 that a sentence is wrong.

This outranks every earlier jury score. The owner opened the art-led site and wrote "I DON'T UNDERSTAND THE UI AND UX AT ALL"; that is a hard stop, and it is why this direction exists. The approved target is `.apex/design/clarity/index.html` (`?after=1&wait=0` for the after-click state), and the built version is `web/src/ui/`.

## What is primary now
1. **The explicit odds number.** Every priced sentence is followed by an odds chip: the number plus a mini bar, red below 40%. The number in the chip, the callout headline and the story always agree, because they come from one source (the store's price).
2. **The promise, in words.** Kicker: "The encyclopedia run by prediction markets". H1: "Every sentence here has *odds* of being true." Sub: "AI agents bet real money on every line, so you can see which ones to trust. Think one is wrong? Bet $1 against it. We give you the dollar: no wallet, no sign-up."
3. **The action, with its stakes.** "Bet $1 it's wrong · free", and under it what that $1 wins, computed from the real quote ("If it's ruled wrong, you win $1.38. If not, you lose the free dollar."). The second button is "No, it's right: bet $1 for it · free". The fine print says who pays and which network: "We give every visitor one free $1 bet in real USDC on NEAR…" (testnet: test USDC on NEAR testnet).
4. **The ink law, demoted to a quiet second signal.** Running text still re-inks on Amstelvar's GRAD axis by price (no reflow, no wght in running text). It is never the only carrier of the number.

## Retired from every first screen, and why
- **The giant lone sentence** set by the money: beautiful, and read as a poster with no instructions.
- **The gauge glyph** (the question mark whose dot is an ink bowl): it carried the price without saying it.
- **The dish field** (the agents as radio dishes): read as illustration, not product.

Together they made the first screen art that a cold visitor couldn't parse. The dish field may appear once, below the fold, only where it illustrates a section. If it does, never clear a rectangle over the drawing, and on the night ground use the night inks (red label `oklch(0.68 0.17 32)`, weight 500).

## Layout
- **Home, first screen:**
  - the nav: logo; How it works; The AI agents; Check our work;
  - the network pill, with no red dot: "Real USDC on NEAR", "Test money · NEAR testnet", or "Recorded · not live";
  - the kicker, the H1 and the sub; three numbered steps on desktop;
  - the article sheet.
- **The sheet:**
  - its header: title, "from Wikipedia, priced live", and stats from real data (sentences priced, AI agents trading, last bet N min ago ↗ linking the latest transaction; no small dollar totals on the first screen);
  - a paragraph of priced sentences with chips, and the flagged sentence (the hero pick: short, self-explaining, source moved on, has bets, price 10–70%);
  - the callout under its paragraph.
- **Phone:** the flagged sentence comes first (the lead sentences are hidden), and the bet button sits inside the first 844 px.
- **The callout:**
  - the headline is the large line and adapts: "Only a 27% chance this is true." / "A coin flip: 50% chance this is true." / "73% chance this is true.";
  - one plain reason line: the named mover, or "No one has bet yet; the opening odds are an AI model's first read", plus the corpus source fact when there is one;
  - the two buttons, each with what it wins, the fine print, and a "Who decides?" link.
- **After the bet: the four-step story,** each step with a waiting state and plain failure words:
  1. "Your $1 bet is in": seconds to final and the explorer link.
  2. "The odds moved": before → after, and the shares in dollars ("If the line is ruled wrong, each pays $1: you'd get $1.38").
  3. "The page rewrote the sentence": the real diff; "Written by GLM-5.3, an AI model running on a sealed chip that proves which model wrote it. Signature checks out ✓ · verify it yourself".
  4. "An AI agent answered": built from its fields, quoting only its real rationale. While waiting: "The Archivist is reading the sources…"
- **Below the fold:** How it works (including "Who decides?"), The AI agents (P&L at today's odds from the chain's trades), Check our work (on-chain, sealed-chip signatures, the reproducible contract, the audit), Works on X too (the two hosts stacked, only the host changes), the footer.
- **Article `/p/<slug>`:** the whole corpus page in the same sheet. Every priced sentence has its chip; unpriced sourced lines get a quiet "price it" (the planner's open_and_buy, as in paste); opinion lines are grey. Tapping opens the same callout and story.
- **Post and paste:** the same sheet. A grey line says why in words ("an opinion: nothing to check").

## Brand and voice
- **Personality:** exact, plain, a little wry; never shouty, never a terminal, never a wiki skin.
- **Mark:** the half-filled full stop beside "Priced **In**".
- **Plain words everywhere.**
  - Never unexplained jargon: "TEE" is "a sealed chip (a TEE)"; "shares" always come with a dollar value; "the odds" rather than "the price" in headlines.
  - Name who is on the other side: "The Skeptic, an AI agent, bet $2 that it's out of date"; "A visitor bet $1…" for a lane key; "A trader…" only when we don't know.
  - Say "AI agents", never "bots".
  - Never quote a machine string as if an agent said it.
- **Typography in copy:**
  - Curly quotes and apostrophes (’) in every string, with `smartQuotes()` on corpus and model text at display time.
  - No-break spaces glue numbers to units and dates ($72.6 billion, 30 September 2026, U.S. T-Bills).
  - Identifiers sit in a nowrap span; hashes break only after : / .
  - Sentence case; no em dashes in our copy.

## Tokens
```css
:root {
  --paper: oklch(0.975 0.004 255); --sheet: oklch(0.995 0.002 255);
  --ink: oklch(0.25 0.04 265); --ink-2: oklch(0.42 0.03 265); --ink-3: oklch(0.52 0.025 265);
  --rule: oklch(0.89 0.01 265); --rule-2: oklch(0.93 0.008 265);
  --red: oklch(0.57 0.2 32);        /* the one red on paper: text, marks, the action (4.6:1) */
  --red-deep: oklch(0.50 0.19 32);  /* hover; pressed one step darker, oklch(0.45 0.18 32) */
  --red-tint: oklch(0.955 0.025 32); --red-line: oklch(0.85 0.06 32);
  --ink-tint: oklch(0.945 0.01 265); --night: oklch(0.25 0.04 265);
  --beat: 400ms;
  /* one size per role, about 1.2 apart */
  --t-xs: 13.5px; --t-s: 15px; --t-m: 17px; --t-b: 19px; --t-l: 22px; --t-xl: 26px; --t-2xl: 34px; --t-3xl: 44px; --t-4xl: 56px; --t-5xl: 66px;
  color-scheme: only light;
}
```
- One red per ground. Radii: 6 px for the sheet, the callout, the story and buttons; 999 px for the pill and dots. One soft sheet shadow; no gloss.
- The verify panel sits on a scrim, `oklch(0.20 0.035 265 / .32)`, and a click on the scrim closes it.
- Short pages fill the viewport, with the footer at the bottom.

## Type
- Amstelvar for everything readable; Geist Mono only for hashes. Tabular lining numerals in chips, stats, the story and figures.
- Running text: about 60–72 characters (`max-width: 68ch`), 22 px desktop, 18 px phone with `hyphens: auto`; `text-wrap: pretty` on paragraphs and `balance` on headings.
- Heavy weights get zero or positive tracking.

## Motion and access
- Motion is quiet: the ink re-inks over two beats, and the story's ticks fill as events arrive. Reduced motion shows the settled states.
- AA contrast, every action reachable by keyboard, focus visible (a 2 px red ring), no console errors.
- Recorded data is labelled plainly. The site paints at once from the recording and switches to live as soon as the API answers; it says "not live" only after two failed checks.

## Tells to reject
- A first screen that is art without instructions.
- A price carried only by weight or a glyph.
- Three mentions of the same number.
- Jargon without a gloss.
- Shares without dollars.
- Quoted machine strings.
- Typewriter apostrophes.
- A red dot that reads as "recording".
- Small dollar totals as social proof.
- Invented numbers (every number comes from the store, the chain or the corpus).
- Plus the old list: monospace meta blocks, microcopy under 13 px, glossy buttons, gradients as decoration, stock imagery.

## Review format
- **Shots:** home, article and post, at 1440×900 and 390×844, before and after a bet, from a fresh profile, against the dev server (recorded and live) and the hosted site. `node web/e2e/shoot-clarity.mjs <site> web/ui-shots/clarity [--query recorded=1]`.
- **The bar:** a cold five-second read gets both what it is and what to do, on both sizes; the button is in the first 844 px on a phone; `npm run web:test` and `npm run web:e2e` are green.
