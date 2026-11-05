---
name: pricedin-design
description: "Priced In's design system and review standard: the Point Source direction, brand, tokens, type, the ink law, imagery, motion, components, voice, the tells to reject and the review format. Load it before building, changing or reviewing any Priced In page, card, OG image, video frame or UI state."
---

# Priced In design: "Point Source"

## The idea
Priced In is an encyclopedia whose ink is money. Every first screen is one composed image: a real sentence set enormous, printed only as heavily as the money believes it, ending in a question mark whose dot is an ink bowl filled to the price, while a field of radio dishes (the AI agents, each named) stands on the ground below and listens. When money moves, the dishes slew, a beam runs from the trader's dish to the bowl, the ink level changes and the sentence's weight follows. Everything else on the page stays quiet around that image.

Why this direction: across four rounds, seven calibrated design judges ranked it first every time (7.47, 7.34, 7.32, 7.47 on a scale where a typical award winner scores 6.83) and called it "the one item with a true signature". Evidence: `.apex/design/review/jury-*/`, `.apex/design/arena/`, `.apex/design/exec/pointsource-a/`.

## Non-negotiables
1. **One image per first screen:** sentence, bowl, dish field. No second focal point, no panels, no cards.
2. **The type carries the number.** The sentence's weight is its price (display weight via `display.js`, thread at 0% to black at 100%; GRAD only in running text). Never a caption explaining it.
3. **The price lives in the bowl and in one numeral beside it**, set in Amstelvar's own figures, the second-largest thing on the screen. "Doubt it · $1" sits beside the price, at real size, the third thing you read.
4. **The dishes and the bowl are one system:** the beam always runs dish to bowl; the bowl's ink is what the dishes put there. No decorative lines that mean nothing.
5. **No scaffolding.** Header = wordmark plus at most one line. No monospace meta blocks, no microcopy under 14 px, no footer strip of small print, no tooltips open at rest, no middle-dot strings except the brand line "Doubt it · $1", no dotted connectors except a live beam.
6. **Plain words for a cold visitor.** One line under the image says what this is ("Every sentence here has a price. AI agents bet real money on whether it is true."); trades read as sentences ("An AI agent bet $1.50 that this is false. The price fell from 30% to 18%.").
7. **Real sentences, honestly labelled.** The default hero is a real, self-explaining sentence (from the corpus or a live page) with what the source says today. Demo values are labelled. Never invent a claim, a number or a person's words.
8. **The phone is its own composition:** sentence, then bowl and price, then the action, inside 844 px; the dish field becomes a band; no glyph overprints a word.

## Brand
- **Personality:** rigorous, alive, dryly funny · never shouty, never a terminal, never a wiki skin.
- **Mark:** the half-filled full stop (`.apex/design/BRAND.md`), at 22 px beside the wordmark "Priced **In**" (In at heavy weight).
- **Voice:** short, exact, a little wry. Headline: "Every sentence, priced in." CTA: "Doubt it · $1". Success: "Priced. You moved this line from 64% to 41%." Error: "The lane is busy. Your dollar is safe; try again in a few seconds." Empty: "Nothing here to price. Unfalsifiable from start to finish."

## Tokens
```css
:root {
  --paper: oklch(0.975 0.004 255);      /* the sky */
  --ink-9: oklch(0.20 0.035 265); --ink-8: oklch(0.26 0.045 265); --ink-7: oklch(0.36 0.05 265);
  --ink-6: oklch(0.44 0.05 265); --ink-5: oklch(0.50 0.05 265); --ink-3: oklch(0.74 0.03 265);
  --ink-2: oklch(0.84 0.018 265); --ink-1: oklch(0.92 0.01 265);
  --night: oklch(0.25 0.04 265);        /* the ground the dishes stand on */
  --red: oklch(0.62 0.21 32);           /* the red pen: hook, beam of a doubt, the action; under 5% of any screen */
  --red-text: oklch(0.54 0.2 32);       /* red at text sizes, 4.5:1 on paper */
  --font-display: "Amstelvar", Georgia, serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;   /* numbers in tables and hashes only */
  --beat: 400ms;                         /* every duration is a multiple of it */
  --ease: cubic-bezier(.22,1,.36,1); --heavy: cubic-bezier(.65,0,.35,1);
  --pad: clamp(20px, 4.4vw, 64px);
}
```
Radii: 0 for type and panels, 999px only for the round bowl and dish faces. Shadows: none on UI; the ground gets depth from the illustration, not from box-shadow.

## Typography
- **Amstelvar** (variable; `wght` 100–1000, `wdth` 50–125, `opsz` 8–144, `GRAD` −300 to +500) for everything readable. Display lines through `web/` port of `.apex/design/exec/shared/display.js`: black is `"opsz" 144,"wght" 1000,"wdth" 80`, thread is `"opsz" 144,"wght" 100,"wdth" 111.9`, and every weight between sets to the same line length. Under about 64 px use `opsz` 48.
- **Running text:** 18–21 px, `opsz` near the size, price shown with GRAD only (−300 to +500), never `wght`, so nothing reflows.
- **Numbers:** the price numeral in Amstelvar figures at 72–150 px; tabular mono only in ledgers, hashes and the verify panel.
- Sentence case everywhere. No ALL-CAPS eyebrows. No em-dashes in copy.

## Imagery
- **Primary language:** one hand-made illustration standard for the dish field: consistent line weight, real perspective from cropped foreground bowls to horizon specks, hatching that follows form, light from one side. It must read as commissioned art, never clip art or a 3D primitive.
- **The bowl:** the question mark's dot, drawn as a dish seen from above, its ink level the price.
- **Never:** stars as sparkles, gradients as decoration, stock photography, abstract blobs, glassmorphism, emoji.

## Motion (one clock, `--beat` 400 ms)
- **The orchestrated moment (load):** beat 0 the sentence prints black, as written; beat 2 its ink falls to the price as the bowl drains; beat 4 the dishes wheel to the bowl; beat 10 the latest trade arrives: the trader's dish slews, a beam pulses dish to bowl, the numeral counts, the weight follows.
- **A doubt:** your dish (the 65th, "yours") turns red, a red beam runs to the bowl, the price counts down, the hook is drawn in one beat, then the rewrite: strikes in red pen, new words printed at their own weight.
- **Agent trades:** a pulse along the trader's beam on every trade; idle dishes breathe within 1 degree.
- **Reduced motion:** the settled state of every one of these, with no movement.

## Components
- **Action ("Doubt it · $1"):** red-pen ink on paper, 56 px tall desktop, 52 px phone; states: rest, hover (the ink deepens), pressed (one beat stamp), preparing ("preparing your $1"), done ("Priced."), refused (plain reason). Never a glossy pill.
- **Sentence reading card (hover/tap):** price, cost to move 10 points, source, last mover, what the source says today. Opens beside the sentence, never over the bowl.
- **Verify panel:** "signed in a TEE · verify" opens model, short signature, each check with pass or fail, and "checked by the NEAR contract" with the transaction link.
- **Page view (`/p/:slug`):** running text in GRAD ink, a quiet price column in the margin, one sentence at a time can take the hero treatment.
- **Ledger and agents:** names, models, profit and loss as type, house agents labelled "house". No charts unless one number truly needs a line.
- **Errors, empty and loading states:** written in the brand voice, never a spinner alone.

## Tells to reject (from five rounds of review)
The five AI clusters and the tells in the studio's craft.md, plus: monospace meta blocks in a header; microcopy under 14 px; a caption explaining the concept; a price numeral set in a grotesk; a floating gauge not anchored to the sentence; flat two-tone vector art; uniform repeating patterns posing as engraving; 3D primitives with default materials; torn-paper or noise filters; glossy or bevelled buttons; newspaper hairlines and three-column footers; dotted lines that mean nothing.

## Review format
- **Shots:** home first screen, mid-load, after a doubt, the rewrite, the verify panel, a page view, a post view, agents, audit; desktop 1440x900 and phone 390x844.
- **Instruments:** `.apex/design/make-jury.mjs` (7 calibrated judges, anchors, mock control), `.apex/design/make-arena.mjs` (10 desktop and 5 phone award references plus the generic mock; AI-detection test with 3 critics).
- **The bar:** jury trimmed mean ≥ 7.5 with design and usability each ≥ 7.5; Arena ≥ 4 of 10 desktop and ≥ 2 of 5 phone and a clear win over the mock; AI test ≥ 2 of 3 "human studio"; every HIGH and MEDIUM specialist finding fixed; Lighthouse ≥ 90; no console errors; keyboard and reduced motion work.

## Assets
- Fonts: `.apex/design/exec/shared/` (Amstelvar Roman and Italic, OFL; Geist Mono, OFL). Copy into `web/public/fonts/`.
- Reference heroes: `.apex/design/exec/pointsource-a/` (the direction), `exec/r3-engraved/` (illustration craft to beat), `exec/r5-press/` (plain-word layout), `exec/r3-rendered/` (hierarchy).
- Content: real sentences from `corpus/` with their revision links; demo values only where labelled.
