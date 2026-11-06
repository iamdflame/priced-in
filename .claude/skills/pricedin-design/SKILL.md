---
name: pricedin-design
description: "Priced In's design system and review standard for the chosen brand, Pulse: the dial, graphite plus one action cyan, plain-words clarity rules, exact tokens (OKLCH and hex, both themes), type, the mark, the topic art system, every component with states and phone rules, copy and honesty rules, the scale and trust cues, and the review checklist. Load it before building, changing or reviewing any Priced In page, card, share card, OG or social image, deck slide, video frame or UI state, even small tweaks."
---

# Priced In design: Pulse

The source of truth is the kit at `.apex/design/brand/pulse/` (`tokens.json`, `assets/tokens.css`, `assets/kit.css`, `assets/app.js`, `assets/core.js`, `contrast.md`, `logo/`, `assets/art/`, `assets/fonts/`, `motion/signature.html`, `screens/`). When this file and the kit disagree on a value, the kit wins: copy values, never retype them. Build with the kit's CSS variables, not new ones.

## 1. Essence

**The idea.** Every fact has a pulse: a live price you can watch move, and a needle that settles where the money thinks the truth is.

**What the product is, in one breath.** Bet on whether facts are true. Prediction markets on lines from Wikipedia, priced by AI traders, decided by AI judges, live on NEAR mainnet and paid in USDC. Your first $1 is free: no wallet, no sign-up.

**Taglines (use exactly):**
- Brand line: **Is it true? Bet on it.** (cyan on the second sentence only when the ground is graphite; otherwise ink.)
- First-screen H1: **Bet on whether facts are true.**
- Sub: **Your first $1 is free: no wallet, no sign-up.**
- Trust line (footer, small, once): **Runs on NEAR. Paid in USDC.**
- Three steps: **1 Pick true or false · 2 AI judges decide within an hour · 3 Right answers get paid**

**Voice.** Plain, exact, a little wry. Sentence case. No em dashes. Curly quotes and apostrophes. Says what happens and what it pays. Never shouty, never crypto-bro, never a terminal.

**Why this brand won.** In blind pairwise tests against Polymarket and Kalshi (round 2 head to head: Pulse 68 wins to 13 losses, the best of four kits), Pulse won "bigger company" and "return tomorrow" against the other kits. Against the leaders, Pulse won "return" and the leaders won "bigger" and "trust" on scale cues: photos, breadth, density, live volume, chart-first pages. The strategy that follows:
- **It looks like serious money and plays like a toy.** Graphite and one luminous cyan read as a pro trading tool; round type and the springy needle keep it fun.
- **It owns an object.** The dial appears in the hero, market page, receipt, share card and app icon. A feed of numbers is what everyone else has.
- **Clear in five seconds** beats pretty. Cold testers who scored 3 to 5 out of 10 on the first Pulse said why in their own words (section 6). Clarity outranks every jury score.

## 2. Non-negotiables

1. **Dark is the default theme** (`<html data-theme="dark">`); light is designed, not inverted. Both ship, both pass AA.
2. **Pulse Cyan is for action only**: primary buttons, the selected tab, links, focus rings, the live pulse that invites a bet, the needle and its hub. Never Yes or No, never decoration, never a chart series colour, never a heading fill except the brand line on graphite in the brand assets.
3. **Yes is green, No is red**, always labelled in words ("Yes, it's true", "No, it's false"). Colour is never the only signal.
4. **Every changing number uses tabular figures** (Geist, `font-feature-settings: 'tnum'`, the body default).
5. **Every % says what it means, beside it**: "40% chance it's true". Same words on home, market, receipt, share card, video, deck.
6. **Yes and No buttons say what $1 wins**, and sit above the fold on phone home and market.
7. **Only real data.** Every number comes from `snapshot.json`, the chain, or an exact LMSR quote. No invented numbers, no invented trader names, no stock-photo scale cues.
8. **The dial is the signature object**: one needle, same geometry everywhere, the number always the real price.
9. **No people, no logos in imagery.** Topic art is the kit's graphite-and-glass object system; coins are the CC0 icons; Polymarket, Kalshi, Augur, NEAR, DeFi get neutral monograms (Pm, Ka, Au, N, DF).
10. **Touch targets at least 44 px**; 360 px has no horizontal overflow; reduced motion stops everything.

## 3. Tokens

### 3.1 Colour (copied from `tokens.json`; CSS names in `assets/tokens.css`)

Neutrals are tinted toward hue 255. `[data-theme="dark"]` is also `:root`.

| Role (CSS var) | Dark OKLCH | Dark hex | Light OKLCH | Light hex |
|---|---|---|---|---|
| `--bg` | oklch(0.165 0.011 255) | #0B0F13 | oklch(0.982 0.003 255) | #F8F9FB |
| `--surface` | oklch(0.205 0.013 255) | #13181D | oklch(1 0 0) | #FFFFFF |
| `--surface2` | oklch(0.24 0.015 255) | #1B2026 | oklch(0.962 0.005 255) | #F0F3F6 |
| `--surface3` | oklch(0.285 0.017 255) | #252B33 | oklch(0.935 0.007 255) | #E6EAEE |
| `--line` | oklch(1 0 0 / 0.08) | #FFFFFF14 | oklch(0.25 0.02 255 / 0.09) | #1B222B17 |
| `--line-strong` | oklch(1 0 0 / 0.15) | #FFFFFF26 | oklch(0.25 0.02 255 / 0.17) | #1B222B2B |
| `--ink` | oklch(0.975 0.004 255) | #F5F7F9 | oklch(0.20 0.018 255) | #11161E |
| `--ink2` | oklch(0.80 0.012 255) | #B9BEC6 | oklch(0.42 0.018 255) | #474E57 |
| `--ink3` | oklch(0.68 0.014 255) | #9399A1 | oklch(0.50 0.016 255) | #5D646C |
| `--brand` (Pulse Cyan) | oklch(0.86 0.15 205) | #00ECFF | oklch(0.86 0.15 205) | #00ECFF |
| `--brand-hover` | oklch(0.90 0.135 205) | #81F2FF | oklch(0.83 0.15 205) | #00E1F3 |
| `--brand-press` | oklch(0.80 0.14 207) | #00D6EA | oklch(0.79 0.145 207) | #00D2E6 |
| `--brand-ink` (label on cyan) | oklch(0.20 0.045 232) | #001926 | same | #001926 |
| `--brand-text` (cyan as text) | oklch(0.86 0.15 205) | #00ECFF | oklch(0.50 0.10 222) | #006E89 |
| `--brand-soft` | oklch(0.86 0.15 205 / 0.14) | #00ECFF24 | oklch(0.70 0.13 210 / 0.14) | #00B2C824 |
| `--yes` (text, icon) | oklch(0.80 0.18 152) | #4BDE81 | oklch(0.51 0.15 152) | #007B3D |
| `--yes-bg` | oklch(0.80 0.18 152 / 0.13) | #4BDE8121 | oklch(0.62 0.17 152 / 0.12) | #00A1511F |
| `--yes-fill` (selected, hover) | oklch(0.78 0.18 152) | #42D77B | same | #42D77B |
| `--yes-ink` (label on fill) | oklch(0.20 0.05 152) | #011C0A | same | #011C0A |
| `--no` (text, icon) | oklch(0.72 0.18 22) | #FF7072 | oklch(0.54 0.20 25) | #C9222B |
| `--no-bg` | oklch(0.72 0.18 22 / 0.13) | #FF707221 | oklch(0.60 0.20 25 / 0.10) | #DE3B3D1A |
| `--no-fill` | oklch(0.70 0.19 22) | #FF6367 | same | #FF6367 |
| `--no-ink` | oklch(0.18 0.05 22) | #230707 | same | #230707 |
| `--warn` (Wikipedia may be wrong) | oklch(0.84 0.14 80) | #FAC053 | oklch(0.52 0.12 65) | #965800 |
| `--warn-bg` | oklch(0.84 0.14 80 / 0.13) | #FAC05321 | oklch(0.80 0.14 80 / 0.20) | #EDB34533 |
| `--focus` | oklch(0.86 0.15 205) | #00ECFF | oklch(0.55 0.11 220) | #007E9A |
| `--scrim` | oklch(0.12 0.01 255 / 0.7) | #040609B3 | oklch(0.2 0.02 255 / 0.4) | #10171F66 |

**Cyan rules**
- Allowed: primary button fill (gradient `--brand-hover` to `--brand`, label `--brand-ink`), selected tab fill, links and small cyan text (use `--brand-text`, which is darker on light), focus ring (`--focus`, 2 px), the live dot, the needle, the hub core, the chart's head dot.
- Light theme: the cyan fill is 1.38:1 against white as a shape, so every cyan fill carries a dark label (`--brand-ink`, 12.35:1) and the inner border from the primary button recipe. Never use bare cyan text on white; use `--brand-text` (5.82:1).
- Forbidden: Yes/No, charts other than the head dot, borders, backgrounds of large areas, icons in lists, gradients as decoration. The dial's soft cyan glow on the graphite ground is the one decorative use and belongs to the object.
- Yes/No fills never appear next to each other as the same strength: the idle button is the soft tint (`-bg` with `--yes`/`--no` text); hover or selection moves to `-fill` with `-ink` text.
- Warn (amber) is for the "Wikipedia may be wrong" chip and nothing else.

**Contrast, all verified AA (`contrast.md`)**: every text pair at least 4.5:1 in both themes (lowest: `--yes` on its tint in light, 4.69:1; `--ink3` on `--surface2` light, 5.37:1). UI pairs at least 3:1 except the cyan fill on white, handled by the label. Re-run `_pr/tokens.mjs` if a token changes; do not hand-edit `tokens.css`.

### 3.2 Type

Self-hosted woff2 in `assets/fonts/`; `@font-face` in `assets/kit.css` (copy it).

| Role | Family | Weights | Use |
|---|---|---|---|
| Display (`--disp`) | General Sans, then Geist, system-ui | 500, 600, 700 | H1, card questions, the big %, buttons, the wordmark, numbers |
| Text (`--text`) | Geist (variable 100–900), `Geist-latin` plus `Geist-latin-ext` | 400, 500, 600 | Body, UI labels, every changing number |
| Mono (`--mono`) | Geist Mono | 400–500 | Transaction hashes and signatures only |
| Quote (`--quote`) | Amstelvar roman and italic | `font-variation-settings: 'opsz' 18` | Quoted Wikipedia sentences only (what Wikipedia says; before/after in the ruling block) |

- **₮ (U+20AE).** Neither General Sans nor Geist has it, so `Inter-tugrik.woff2` (a one-glyph subset) is mapped to U+20AE for both families by `unicode-range`. Keep those two `@font-face` lines or "USD₮" and "XAU₮" render in a fallback.
- Amstelvar is never used for UI, headings or numbers. Hashes are never in anything but Geist Mono.
- Body is `font: 400 15px/1.5 Geist` with `-webkit-font-smoothing: antialiased`.

**Scale (`--fs-*`, `--lh-*`, `--tr-*`)**

| Token | px | Line height | Tracking |
|---|---|---|---|
| num-hero | 120 | 0.88 | -0.05em |
| num-xl | 88 | 0.9 | -0.045em |
| num-lg | 56 | 0.92 | -0.04em |
| num-md | 40 | 0.95 | -0.035em |
| num-sm | 28 | 1 | -0.02em |
| display-xl | 64 | 1 | -0.035em |
| display-lg | 48 | 1.04 | -0.03em |
| display-md | 36 | 1.08 | -0.025em |
| title | 24 | 1.2 | -0.015em |
| title-sm | 20 | 1.25 | -0.01em |
| body-lg | 18 | 1.55 | 0 |
| body | 16 | 1.55 | 0 |
| body-sm | 14 | 1.5 | 0 |
| caption | 13 | 1.4 | 0.005em |
| micro | 12 | 1.35 | 0.01em |

Rules: numbers and headlines are General Sans 700 with the negative tracking above (heavy weights never get positive tracking); the % sign is `<i>` at 0.52em beside the digits; nothing under 12 px except dial scale labels (`max(10px, 3.6cqw)`); text-wrap balance on headings, pretty on paragraphs; ink text on graphite is `--ink`, secondary `--ink2`, captions `--ink3`.

### 3.3 Space, radius, shadow, motion

- **Space (4 px base):** 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128 (`--s-0` to `--s-13`). Page gutter 40 px desktop (`--gut`), 16 px phone; content max 1360 px (`--max`).
- **Radius:** xs 6 · sm 10 · md 14 · lg 20 · xl 28 · pill 999 (`--r-*`). Buttons and tabs pill; Yes/No buttons 14; cards 20 (`--r-lg`); the featured card and ticket slips 28 (`--r-xl`); chips pill.
- **Shadow** (not in `tokens.json`, these are in `assets/kit.css`; copy):
  - Dark `--card-shadow: inset 0 1px 0 oklch(1 0 0 / .05), 0 1px 0 oklch(0 0 0 / .4)`; `--panel: linear-gradient(180deg, oklch(.225 .014 255), oklch(.2 .013 255))`; `--lift: 0 18px 40px -18px oklch(0 0 0 / .8)`; `--dial-shadow: 0 30px 60px -20px oklch(0 0 0 / .85)`.
  - Light `--card-shadow: 0 1px 2px oklch(.3 .03 255 / .06), 0 8px 24px -12px oklch(.3 .05 255 / .16)`; `--panel: linear-gradient(180deg, oklch(1 0 0), oklch(.985 .003 255))`; `--lift: 0 18px 40px -18px oklch(.3 .06 255 / .3)`; `--dial-shadow: 0 30px 50px -22px oklch(.25 .05 255 / .55)`.
  - One elevation family: flat card, lifted (hover and popovers), dial. No coloured shadows except the primary button's cyan glow.
- **Featured and slip backdrop:** `radial-gradient(70% 110% at 84% 42%, oklch(.31 .035 225 / .55), transparent 70%)` over `--panel` in dark; `oklch(.86 .07 210 / .4)` in light. The glow sits behind the dial.
- **Motion:** `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, `--spring: cubic-bezier(0.34, 1.56, 0.64, 1)`; durations `--micro` 140ms (press), `--color` 180ms, `--ui` 220ms, `--reveal` 700ms, `--tick` 900ms. Press = `transform: scale(.97)`. Card art hover = `scale(1.045)`. Animate transform and opacity only.

## 4. The mark

Files in `logo/`; use these, never redraw.

- **Construction:** a rho (a dial on a stem reads as a P) with the needle on its pivot. 48-unit grid: ring centre (24, 19), outer radius 14, inner radius 8.5, stem one stroke wide sharing the ring's left edge, needle at 42 degrees, hub radius 3. Wordmark is General Sans Semibold outlines, kerned by hand, with the i's dot in cyan.
- **Files:** `mark.svg` (ink #14171C + cyan #00B7C7, for light grounds), `mark-on-dark.svg` (#F4F6F9 + #00E5F2), `mark-mono.svg` (one colour), `wordmark(.svg|-on-dark.svg)`, `lockup-horizontal(-on-dark).svg` (mark + wordmark, 171.28 × 48 viewBox), `lockup-stacked(-on-dark).svg`, `favicon.svg` (redrawn for 16 px, not scaled), `favicon-16.png`, `favicon-32.png`, `app-icon.svg` (1024), `app-icon-1024.png`, `app-icon-1024-render.png` (Blender studio render, home-screen mock only).
- **Which file:** graphite or dark art grounds take `-on-dark`; white or light grounds take the plain files; one-colour print or emboss uses `mark-mono`.
- **Colour rule:** the cyan in the mark is the needle and the dot of the i, the same "action and pulse" job as in the UI. Never recolour the P in cyan, never tint the whole mark.
- **Clear space (decided here; the kit does not state it):** one ring radius (14/48 of the mark's height, about 0.3×) on every side of the mark or lockup. Nothing enters it: no text, edge or crop.
- **Minimum sizes (decided here):** mark alone 16 px (use `favicon.svg`/`favicon-16.png` at 16 to 24 px; the full mark from 24 px up); horizontal lockup 96 px wide on screen (48 px high stacked lockup is the floor for the stacked); print 8 mm mark.
- **Favicon:** `favicon.svg` (rounded 3.6/16 square #14171C, P in #F4F6F9, cyan needle stroke #00E5F2 1.7) plus the 16 and 32 px PNGs. Link `favicon.svg` with `type="image/svg+xml"`.
- **App icon and avatar:** `app-icon.svg` is a graphite radial gradient (#2A303A, #191D24, #101318) with a soft cyan glow behind the needle, the P in #F4F6F9, the needle in #00E5F2. Full-bleed square; the platform rounds it. For circular crops (X, Discord) keep the P inside the central 78%: it already does.
- **Don'ts:** do not stretch, rotate, outline, add shadows or gradients to the mark on UI; do not put it on photographic or busy grounds; do not set the wordmark in another font; do not use the P without the needle (it becomes a generic "P"); do not rebuild the lockup with a different gap; do not place the mark on a cyan fill (use `mark-mono` in `--brand-ink` if ever needed); do not animate the mark outside the single pivot sweep.

## 5. Signature objects

### 5.1 The dial

A Blender-rendered machined face (`assets/art/dial.webp`, 900×900) with a live SVG needle, a hub and a number on top. The dial is a square with `border-radius: 50%`, `aspect-ratio: 1`, `box-shadow: var(--dial-shadow)`, `container-type: inline-size` (all type inside is in `cqw` units so it scales).

**Mapping.** 0 degrees is straight up. 0 to 100% sweeps −120° to +120°: `rotate(calc(-120deg + 240deg * var(--p)))`, with `--p` the price from 0 to 1. 0% = lower left, 50% = straight up, 100% = lower right. 10% is −96° (just below the left horizontal); that is correct, not a bug. Reading the real price, always: never set the needle for effect.

**Geometry (percent of dial width)**
- Needle: `left 50%; top 50%; width 8.4%; height 40.5%; margin-left -4.2%; margin-top -40.5%; transform-origin: 50% 100%`. Path: `M10 0C10.9 0 11.5.6 11.7 1.5L16 100H4L8.3 1.5C8.5.6 9.1 0 10 0Z` in `viewBox="0 0 20 100"`, `preserveAspectRatio="none"`, fill `oklch(.86 .15 205)`; `filter: drop-shadow(0 0 6px oklch(.86 .15 205 / .75)) drop-shadow(0 3px 5px oklch(0 0 0 / .6))`.
- Hub: 12% square, centred (`margin: -6% 0 0 -6%`), radial gradient `circle at 36% 30%, oklch(.72 .012 255), oklch(.34 .012 255) 48%, oklch(.2 .01 255)`, shadow `0 3px 8px oklch(0 0 0 / .7), inset 0 1px 0 oklch(1 0 0 / .35)`; core dot `inset: 34%`, `oklch(.86 .15 205)` with `0 0 10px oklch(.86 .15 205 / .9)`.
- Read-out: `.read` at `top: 60%`, centred. Number General Sans 700 at `25cqw`, `letter-spacing -.05em`, line-height .9, `%` at .52em. Label under it: Geist 500 at `max(11px, 4.1cqw)`, `oklch(.8 .012 255)`, margin-top 4cqw, text "chance it's true".
- Scale labels "0" (left 21%, bottom 13.5%) and "100" (right 19%, bottom 13.5%), Geist 500 at `max(10px, 3.6cqw)`, `oklch(.72 .012 255)`.
- The dial face is dark in both themes (it is an object, like product photography); on light surfaces it sits on a pale cyan radial wash. Never invert it.

**Sizes.** Home featured 340 px max; market page chart box 170 to 190 px; receipt 196 px; phone beside the question about 118 to 124 px (drop the caption to `b` mode: "chance it's true" in bold under it); share card 500 px; brand assets 420 to 600 px. Under about 110 px drop the scale labels and the label line, never the number.

**The % is `Math.round(price * 100)`.** Dial number, card number, Yes cents (`pct¢`) and No cents (`100 − pct¢`) all derive from the same rounded price so they always agree.

### 5.2 The needle motion

- Settle: `transition: transform 1.1s cubic-bezier(.3, 1.45, .5, 1)` (kit.css); the signature clip uses `1.25s cubic-bezier(.3, 1.6, .45, 1)`. The overshoot is the personality; do not replace it with ease-out.
- The money moment (`motion/signature.html`, loops 7 s): the No button presses, the needle swings from 23% to 12% (real numbers, "done in 4.5 s"), the digits roll in fixed-width cells (each digit its own cell, no layout shift), a pulse ring leaves the hub (`@keyframes ring`: opacity .9 to 0, scale 1 to 9), the chart takes one step down, and the settlement confirms in green.
- Idle: the live dot pings (`@keyframes ping`, 2.2 s, a 9 px cyan ring fading out); the chart's head dot has a single ring pulse (2.4 s). Ticker scrolls at 90 s linear and pauses on hover.
- Reduced motion (`prefers-reduced-motion: reduce`, and `?still`): needle jumps, no ticker, no pulses, no digit roll. Settled states only.
- Count-ups use ease-out cubic (`1 − (1 − k)^3`) over 700 ms (`tween` in `core.js`).

### 5.3 The topic art system

Every fact card carries an image: a machined glass-and-graphite object on the interface's own ground. A feed of mostly Tether lines still reads as varied and premium. One art director: the template below, never ad hoc prompts.

**Current set (16, in `assets/art/*.webp`, raw PNGs in `assets/art/raw/`):** tether (three emerald glass coins), stablecoins (gyroscope), ethereum (periwinkle crystal), bitcoin (amber coin on its rim), near (open mirror ring), uniswap (hot-pink horn), polymarket (cobalt split sphere), kalshi (jade fluted column), dai (amber vault dial), defi (three interlocked rings, one violet), reserves (pale-green glass bars in a band), gold, audit (magnifying lens), freeze (coin in ice), corp (smoked glass tower), augur (cracked crystal ball). Plus `dial.webp`.

**How to make a new topic image**
1. Write the subject in one sentence: one physical object, a material (smoked or coloured glass, brushed graphite metal), a single accent hue that is the topic's colour, no text on it. Examples in `_pr/gen-art.mjs`.
2. Generate with FLUX.2 [pro] at 1344×768 through `node .apex/design/brand/fal.mjs --model fal-ai/flux-2-pro --prompt "<prompt>" --out .apex/design/brand/pulse/assets/art/raw/<key>.png --json '{"image_size":{"width":1344,"height":768}}'` (logged and capped; each image is about $0.06; skips existing files, so a re-roll is delete and rerun).
3. Prompt template (the only wrapper; replace `{subject}`):

> `{subject} Studio product render on a perfectly uniform near-black graphite background, flat colour #14171C from edge to edge, no spotlight on the background, no gradient, no horizon line. Soft key light from the upper left falls on the object only, thin cool rim light, physically based materials, smoked glass and brushed dark metal, faint inner glow, subtle caustics. A single object in three-quarter view, large in the frame and centred with a clean margin, precise and expensive like a Swiss instrument. No text, no letters, no numbers, no symbols, no logo, no people.`

4. Grade with `python _pr/post-art.py` (models the studio ground from the frame border and removes it, lifts colour by 1.55, grades the background to #14171C with a vignette so the tile melts into dark surfaces and reads as product photography on white cards, then writes 1120×640 WebP).
5. Use as a card header (`.art`, `object-fit: cover`, hover scale 1.045), with the price on the art on desktop. A new topic needs its own colour and silhouette; if two tiles look alike in a grid, redo one.
- Never: people, faces, logos, text in the render, stock photos, a different background colour, a different lighting direction, a second object. Coin glyph badges on cards are the CC0 icons in `assets/icons/`; unknown brands get a neutral monogram chip (`.ti.mono`, 700 9.5px General Sans on `--surface3`, inset 1px `--line-strong`).

## 6. Copy rules

### 6.1 Clarity rules (from cold testing; these are hard stops)

Two strangers each gave the first Pulse five seconds: a Polymarket regular scored it 5/10, a never-touched-crypto person 3/10. After the fix, the cold read was: "A betting app where you guess whether statements are true or false, with a free first dollar." and both tapped. Remaining confusion was about who the traders are, "$1 wins $1.81 (total or profit?)", "40% vs 40¢", and a cut-off ticker. Rules:

1. **Say what this is, first.** Above the fold on every viewport, one plain sentence in the hero: "**Bet on whether facts are true.** Your first $1 is free: no wallet, no sign-up." Never a banner; part of the hero.
2. **Every percentage says what it means, beside it:** "**40% chance it's true**". Where nobody has bet: "**No bets yet · our AI's starting estimate**" (kit shorthand on tiny surfaces: "AI's estimate · no bets yet"). Where bets exist: "down from 50% at the start" / "up from…" / "same as at the start (N%)".
3. **Yes and No say what they mean and pay.** "Yes, it's true · 40¢" and "No, it's false · 60¢", with "$1 wins $1.81" under each (the exact LMSR quote). Neither side is pre-selected in the ticket.
4. **Say what $1 pays, in one line a stranger reads without math:** "**Bet $1 → get $1.81 back if you're right**" (total back, not profit; say "back"). On the market page: "Three AI judges decide within an hour of a challenge. If you're right, $1 pays $1.81."
5. **Who decides and when it pays:** the three-step strip under the hero ("1 Pick true or false · 2 AI judges decide within an hour · 3 Right answers get paid").
6. **One source per card:** the question, the % with its meaning, Yes/No, and at most one line of evidence ("A newer source says 140+ countries (Kalshi, Oct 2025)"). The full Wikipedia quote and the source go on the market page, labelled "**What Wikipedia says (what you're betting on)**" and "**What a newer source says**".
7. **Less on the first screen.** Question, odds, bet, trust. Density lives below the first screen. Polymarket's first screen is a question, a %, Yes/No and a chart; ours adds the dial and the three steps, not more widgets. One-line chart, no dots or avatars on it.
8. **Honest status words.** The ticker is real bets as sentences, never tickers or triangles.

**Plain-words table (use the right column everywhere)**

| Never | Say |
|---|---|
| Caught out of date | Wikipedia may be wrong |
| Ruling now / ruling in | Being decided / AI judges decide in 41 min |
| Rulings | Results |
| Signed fix | Corrected |
| Lines, sentences, claims | Facts |
| Jury bench, AI desk | The AI judges (they decide) · The AI traders (they bet) |
| AI's first read | AI's estimate |
| Live on NEAR | Live · real money (NEAR said once, small: "Runs on NEAR. Paid in USDC.") |
| Prediction markets (as a tab) | a topic chip: "Prediction markets" only on the Kalshi/Polymarket facts |
| Vol, bps, perps, TVL, odds in bare cents | spell out, or leave out |
| "Yes" / "No" alone | "Yes, it's true" / "No, it's false" |

Tabs (in order): **Trending · Wikipedia may be wrong · Being decided · Crypto · Stablecoins · Ethereum · NEAR · Bitcoin**. "Crypto" covers every topic outside Tether, stablecoins and DAI.

**Phrasings that tested well (reuse verbatim):** "Bet on whether facts are true" · "Your first $1 is free: no wallet, no sign-up" · "40% chance it's true" · "No bets yet · our AI's starting estimate" · "Pick true or false / AI judges decide within an hour / Right answers get paid" · "Bet $1 → get $1.81 back if you're right" · "Wikipedia may be wrong" · "Live · real money" · "Done in 4.5 s".

**Banned on any first screen (home hero, OG image, share card, video first frame, deck slide 1):** Caught, Ruling, Rulings, Jury (bench), Signed fix, Lines (for facts), First read, desk, attestation, T-Bills as an unexplained label (a fact's own question may contain it; put a one-line plain explainer under it), LMSR, shares, odds as a bare cent figure, NEAR as a headline word, TEE, mainnet, USDC as a headline, bps, Vol, "AI agents" (say AI traders or AI judges), terminal metaphors, any invented trader name. Also banned: question titles that mix two claims, a fact whose card is only a "no bets yet" 50%, and a lead card that needs crypto context to read. Lead with a fact a stranger gets in three seconds.

**Type of copy.** Curly quotes and apostrophes everywhere; no-break spaces glue numbers to units and dates ($72.6 billion, 30 September 2026); identifiers in a nowrap span; hashes truncated `FGFhi1…BBvc6` in Geist Mono; sentence case; no em dashes; "AI traders" bet, "AI judges" decide; "traders" are named only by their real persona (Archivist, Skeptic, Quant) and always introduced as "The AI traders".

### 6.2 Honesty rules (unchanged by the rebrand)

- **Only real data**, from `snapshot.json` (NEAR mainnet) and the contract's event log. Every sparkline step is a logged trade; untraded facts are flat and dotted and labelled "AI's estimate". Opening prices come from `deployments/mainnet.json`.
- **Payouts are the exact LMSR quote** for $1 against the deployed liquidity b = $1.45, including price move. Do not divide $1 by the price (it overstates winnings on a thin book). The quote reproduces the logged trades (event 14: 1.203049 shares logged, 1.203050 computed). Say "back" (total), not "profit".
- **Measured times only.** "Done in 4.5 s" is the measured final time of the real bet (tx FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6). The "41 min" jury countdown is a given from the brief; any other time must be measured.
- **Early states are named.** No bets: "No bets yet · our AI's starting estimate". Few bets: show the count ("7 bets · $4.08 bet so far"), never hide small numbers and never pad them. Resolved, signed, anchored: show the real signature check only if verified.
- **Real figures right now** (2026-11-06 01:58 UTC): 32 live markets, 10 topics, 20 bets, $6.76 traded. The T-Bills fact (market 18): 10% chance it's true (price 0.0998), 7 bets, $4.08, caught: page says $72.6 billion, newer source says $122.84 billion at 30 September 2026, signed by z-ai/glm-5.3-flash. The free bet moved it 23.18% to 11.63%, 1.20 shares at 83¢, $1.20 if the AI judges say No. Re-read `snapshot.json` before using any of these.
- **No fake scale.** No stock photography, no invented user counts, no "trusted by", no logos of firms that do not use us, no blurred partner rows, no volume number we did not earn. Small real volumes are shown plainly; scale is carried by design and live structure (section 8).
- **Attribution:** coin icons CC0; monograms are ours; fonts under OFL or the ITF free licence (`assets/LICENSES.md`).

## 7. Components

Names follow `assets/kit.css`. Phone = under 760 px (tablet breakpoint 1240 px). Every interactive element is at least 44 px high; focus is a 2 px `--focus` ring, always visible.

### 7.1 Question card (feed)
- **Anatomy:** art header (topic object, 16:9 crop, price on the art on desktop; thumbnail left on phone), topic chip(s) (topic icon plus name; amber "Wikipedia may be wrong" chip when corrected), the question (General Sans 600, up to 3 lines), the % with "chance it's true" (desktop), one evidence line, Yes/No buttons (7.3), a micro sparkline (132×44, one step per logged bet).
- **Surface:** `--surface`, `--r-lg` (20), `--card-shadow`; hover `0 0 0 1px --line-strong` and art scale 1.045.
- **States:** *Loading:* surface block with skeleton art (`--surface2`), two text bars, buttons shown disabled; no spinner. *Empty (no bets):* flat dotted sparkline, "No bets yet · our AI's starting estimate", buttons still enabled. *Error:* the card stays, the price slot reads "Price unavailable · retry" in `--ink3` and buttons are disabled; never show 0% or a stale number. *Disabled:* 45% opacity, no hover fill, `aria-disabled`. *Free-bet-unavailable:* buttons stay; the label under them changes from "$1 wins $X" to "Free $1 used · bets from your balance" and the header CTA changes from "Free $1" to "Bet $1".
- **Phone:** list card, art thumbnail 84 px left, question and % right, buttons full width below, whole card 44 px+ targets; the % moves to the sparkline slot as a number.

### 7.2 Featured fact (home hero)
- **Anatomy:** a `--r-xl` panel, two columns: left (chips, question at display-md, one evidence line, Yes/No, status line), right the dial (340 px, backdrop glow). A second column rail "Being decided": art, countdown ("41:00", General Sans 700 38 px, tnum), question, % and one-line chart, Yes/No.
- **States:** *Loading:* panel with a grey dial disc, no needle, skeleton text. *Empty:* dial at the AI estimate, caption "AI's estimate · no bets yet". *Error:* dial shown at 50% dimmed with "Can't load this fact. Try again." *Disabled/closed:* buttons replaced by the result sentence. *Free-bet-unavailable:* as 7.1.
- **Phone:** dial shrinks to 118 to 124 px beside the question; caption becomes the bold two-line "40% chance it's true"; Yes/No and the free CTA sit within the first 844 px.

### 7.3 Yes / No buttons (`.bets`, `.bet`)
- **Anatomy:** 2-column grid, gap 8; each `min-height: 54px; padding: 7px 13px; radius 14`; row one: label (General Sans 600 15 px) left, cents right ("40¢"); row two: "$1 wins $1.81" (12.5 px, opacity .92). Labels: "Yes, it's true" / "No, it's false". `aria-label`: "Bet that it's true, 40 cents, $1 wins $1.81".
- **Colours:** idle `--yes-bg` + `--yes` (or `--no-bg` + `--no`); hover and selected `--yes-fill`/`--no-fill` with `--yes-ink`/`--no-ink`; press `scale(.97)` 140 ms.
- **States:** *Loading:* shimmer-free `--surface2` blocks with the labels present, disabled. *Empty (no market price yet):* disabled, "Opening soon". *Error:* both disabled, one line "Couldn't get a price. Try again." *Disabled:* opacity .45, no fill on hover. *Free-bet-unavailable:* sub-line says "$1 from your balance".
- **Phone:** full width; sticky bottom bet bar on the market page (sits above the bottom nav), with the line "Three AI judges decide within an hour of a challenge. If you're right, $1 pays $X on Yes or $Y on No."

### 7.4 Ticket (market page bet slip)
- **Anatomy** (`.ticket`, sticky at 84 px, padding 18, panel): "Place your bet" title; segmented control `.seg` (two 60 px buttons: "Yes, it's true · 10¢" / "No, it's false · 90¢"), nothing pre-selected; amount box (`.amt`: `b` General Sans 700 26 px "$1", right caption "Your free $1" or balance); rows (`.kv`): "Chance it's true now", "You'd pay"; "To win" row (`.towin .v` General Sans 700 34 px `--yes`) "If you're right you get back $X"; primary cyan button "Bet $1 free" (full width, `.btn.primary.lg`); fine print (12.5 px `--ink3`): "Real money, paid in USDC. Three AI judges decide within an hour of a challenge."
- **States:** *Loading quote:* "To win" shows a 60 px skeleton, button disabled "Getting your price…". *Empty:* no side chosen, button disabled "Pick true or false". *Error:* inline `--no` line "Couldn't place that bet. Nothing was charged. Try again." *Disabled:* closed market, ticket replaced by the result. *Free-bet-unavailable:* amount editable, button "Bet $1", caption "You've used your free $1".
- **Phone:** the ticket becomes the bottom sheet above the sticky bar (scrim `--scrim`); sheet radius 28 top; amount keypad is the OS numeric keyboard.

### 7.5 Receipt (after the bet)
- **Anatomy** (`.slip`, 500 px, `--r-xl`, dial backdrop): green check "Done in 4.5 s" (`.ok`); H1 "You bet $1 that it's false" (General Sans 700 30 px); the question; the move row: dial (196 px) beside the big move "23% → 12%" (`.big-move`, 66 px, "from" at .62em in `--ink3`) and "chance it's true / Your $1 moved it. It's 10% now."; lines: "If it's false, you get $1.20", "You got 1.20 shares at 83¢", Transaction `FGFhi1…BBvc6` (Geist Mono 13 px, copyable, links to the explorer); actions: primary "Share receipt" (cyan), soft "Copy", soft "Save"; footer line "Recorded on NEAR. Real money markets, paid in USDC."
- **Beside/below:** "Wikipedia's sentence, corrected" ruling block (7.6), "Value now" and sell quote, the AI judges countdown.
- **States:** *Pending:* a four-step waiting state ("Sending your $1…", "Odds moving…"), check replaced by a cyan ring; *Failed:* the red state "Your bet didn't go through. Nothing was charged." with Retry; *Free-bet-unavailable:* not applicable (receipt only follows a bet); *Empty:* n/a.
- **Phone:** one column; the dial and the big move stay side by side; actions stack full width, "Share receipt" first.

### 7.6 Ruling block ("Wikipedia's sentence, corrected")
- **Anatomy:** header "Wikipedia's sentence, corrected" (General Sans 600 16 px) with a green "Signature ✓" (`.sig`, 13 px, `--yes`) only when the signature check passed; a before/after grid (`.ba`, 62 px label column: "Before", "After"): Amstelvar 15.5 px `opsz 18`; `del` in `--ink2` with a `--no` 1.5 px strikethrough; `ins` with `--yes-bg` background and 4 px radius; chip line: judge model (e.g. "z-ai/glm-5.3-flash"), version, "Source: tether.io"; the AI judges' countdown (`.jury .clock`, 38 px tnum) and one sentence: "Three AI judges decide within an hour."
- **States:** *Loading:* before text shown, after as two skeleton bars. *Empty/no correction:* block hidden; never show a blank "corrected" shell. *Error:* "We couldn't verify the signature" in `--warn`; hide the check. *Disabled:* n/a. Phone: before and after stack; the clock sits above.

### 7.7 Live strip (ticker)
- **Anatomy** (`.ticker`, 42 px high, `--bg`, 1 px bottom `--line`): left "Live · real money" with the pinging cyan dot (`.live`, 13 px 500), then "32 facts open · 20 bets so far" (`.net`, `--ink3`), then a masked scrolling tape of real bets as sentences ("The Archivist bet $0.22 that Tether's T-Bills fact is false"), each with the topic icon (22 px) and the side word coloured (`--yes` "true", `--no` "false"). Tape is 90 s linear, pauses on hover.
- **States:** *Loading:* the live dot and counts only, tape empty (no fake rows). *Empty (no bets):* "No bets yet · be the first" replaces the tape. *Error:* "Live feed paused" in `--ink3`, dot grey, no pulse. *Disabled:* n/a. Never show cut-off text mid-word on phone: truncate at the strip edge with the mask; the first item is the shortest.
- **Phone:** "Live · real money" then the tape; the counts are dropped.

### 7.8 Tabs (`.tabs`, `.tab`)
- 40 px high pills, `--ink2` idle on transparent; hover `--surface`; selected `--brand` fill with `--brand-ink` label, weight 600; counts at .65 opacity (`.n`). Scrolls horizontally with no scrollbar; selected stays in view. Sit above the grid, not at the top of the first screen.
- **States:** *Loading:* labels without counts. *Empty tab:* "No facts here yet." with a link "See all facts". *Error:* counts hidden. *Disabled:* n/a. Phone: horizontally scrollable, 16 px edge padding; bottom nav (Facts · May be wrong · Results · Portfolio) is separate, 44 px+ items.

### 7.9 Chart
- One line, one step per logged bet on a true 0 to 100 axis (`K.chart`, `K.spark`): stroke `--ink` 1.75, `stroke-linejoin: round`; a soft area fill gradient under the line; flat untraded = `--ink3` dotted (`1 5`); head dot `--brand` (`--brand-text` on light) with a one-ring pulse; gridlines `--line` at 25 / 50 / 75 / 100% labelled in 11 px `--ink3` on the right. Caption above: "Chance it's true, after each bet" and "$4.08 bet so far · 7 bets". No dots on steps, no avatars, no second series, no cyan line.
- **States:** *Loading:* gridlines plus a dashed placeholder line. *Empty (no bets):* a flat dotted line at the opening price and "AI's estimate · no bets yet". *Error:* "Chart unavailable" in `--ink3` with the dial still showing the price. *Disabled:* n/a.
- **Phone:** height at least 140 px; must not sit under the sticky bet bar at first paint (a tester saw an empty chart hidden behind the bar): put the dial and Yes/No above it and give the chart a bottom margin equal to the bar height.

### 7.10 Share card (`screens/share.html`, 1200×630; the image is `share-card-1200x630-{dark,light}.png`)
- **Anatomy:** grid `minmax(0,1fr) 500px`, padding 48×56, dial backdrop glow at 82% 46%. Left column: lockup (56 px high), the question as H1 (General Sans 700 62/1.04, tracking −0.032em, balance), then "**40% chance it's true** · {whose}" (sub), footer "Is it true? **Bet on it.**" (22 px Geist 500, cyan on "Bet on it." in dark, `--brand-text` in light) and "isitpriced.com" right. Right: the dial 500 px with the real %.
- **Post text** is "{question} {The market says | AI's estimate}: 40% chance it's true. Is it true? Bet on it. isitpriced.com/c/{id}".
- **States:** *Loading:* never rendered; the card is built from final data. *Empty (no bets):* "AI's estimate · no bets yet" in the sub. *Error:* fall back to the brand card (tagline, dial at 50% is not allowed: use the lockup, tagline and the app icon, no number). *Free-bet-unavailable:* n/a.
- **Phone/small:** scales as a fixed 1200×630 artboard (`.fit`); on phone the card scales to width, text never reflows. Safe margin 56 px; nothing important within 40 px of the edge. Both themes shipped; dark default.
- **OG and social crops** (`pulse/social/`): X avatar 400×400, X banner 1500×500 (keep the left 400 px free of text for the avatar overlap), GitHub social preview 1280×640, README hero 1600×800.

### 7.11 Other surfaces
- **Primary button** (`.btn.primary`): pill, 44 px (52 lg), General Sans 600 15 px, `linear-gradient(180deg, --brand-hover, --brand)`, `--brand-ink` label, `inset 0 1px 0 oklch(1 0 0/.45), inset 0 -1px 0 oklch(.5 .1 215/.35), 0 10px 26px -10px oklch(.86 .15 205/.55)`; hover glow to .8; press `scale(.97)`. Ghost: inset 1px `--line-strong`. Soft: `--surface2`. Disabled: opacity .45, no glow. Loading: label replaced by "Working…" and the cyan ring; width fixed.
- **Chips** (`.chip`): 26 px pill, 12.5 px 500, `--surface2` + `--ink2`; `.warn` uses `--warn-bg` + `--warn`.
- **Header:** logo, search ("Search facts or paste an X link", `/` shortcut), nav (Facts, Results, AI traders, Portfolio), theme toggle, "Claim free $1" primary. Phone: logo, search icon, "Free $1".
- **Footer:** the trust line "Runs on NEAR. Paid in USDC." once, small; links to the contract and the audit are real URLs.

## 8. Scale and trust cues (what the judges decided)

In blind pairwise tests (3 questions per pair: bigger company, more trusted with money, would open again tomorrow), judges said:
- **Leaders won "bigger" and "trust" on:** real photos and faces, breadth of categories, density, many live items, huge volume numbers, chart-first pages, familiar neutral layouts, light incumbent UIs ("plain white reads established").
- **Pulse won "return" (and "bigger" over our own other kits) on:** the dial and cyan CTA ("memorable, fun to reopen"), the dark gauge look ("premium", "pro trading", "fintech-native"), a clear hook (the free $1), a clear odds number.
- **Where Pulse lost trust:** "looks like a game", "gimmicky for money", "less proven", sparse content, "dark but dense". **Where Verdict won trust:** sourced evidence, calm sober layout, "clean explanation".

So the dial can't carry trust alone. Show these honestly, with real data, on the first screen and above the fold on the market page:
1. **Live structure over fake volume:** "Live · real money", a counts line ("32 facts open · 20 bets so far"), a ticker of real bets with names and amounts, countdowns that really count. Small real numbers shown plainly read more honest than hidden or inflated ones.
2. **Sources and proof, visibly:** one evidence line with a named source and date on each corrected card ("A newer source says 140+ countries (Kalshi, Oct 2025)"); on the market page "What Wikipedia says" next to "What a newer source says"; the signed correction ("Signature ✓", model name, version); the transaction hash on every receipt, linking to the explorer; a "who decides" sentence.
3. **Breadth with the art system:** a grid with at least eight different topic objects in the first two scrolls (the art is our substitute for photography); a topic tab strip with real counts.
4. **A pro chart on the market page:** true 0 to 100 axis, one step per logged bet, the bet count and volume beside it; hash and time stamps in Geist Mono.
5. **Institutional detail:** tabular numbers everywhere, aligned columns, consistent radii and spacing, no layout shift, signatures, a status page of the three AI judges and three AI traders with their model names, a footer with the contract and audit links, "Runs on NEAR. Paid in USDC." once.
6. **Sober light theme and a calm dark one:** AA text, flat cards, no sticker styles, no mascots, no confetti. The playful part is only the needle.
7. **Do not:** copy a leader's layout, fake a user count, add "featured on" strips, use stock news photos, pre-select a side, or put the big green and red buttons first in the hierarchy over the question and %.

## 9. After-bet story (kept from the old direction, restated for Pulse)

1. **Your $1 bet is in** (receipt): seconds to final (measured), the explorer link.
2. **The odds moved:** before to after in the big move row, the needle sweeping on its spring.
3. **The fact was corrected** (when the AI judges rule the line wrong): the real before/after diff, signed.
4. **An AI trader answered:** built from real rationale fields, quoted by persona (The Archivist, The Skeptic, The Quant), never a machine string. While waiting: "The Archivist is reading the sources…".
Each step has a waiting state and plain failure words ("Nothing was charged. Try again.").

## 10. Review checklist

**Format.** Shots of home, market, receipt, portfolio and share card at 1440×900 and 390×844, light and dark, plus 360×800; from a fresh profile; the kit's `screens/shots/` is the reference. Review blind: place ours next to Polymarket and Kalshi (`review/side-by-side.html`) and answer the three questions (bigger, trust, return) before opening any rationale.

**The bars.**
- **Cold five-second test:** a stranger who has never heard of us, phone and laptop, five seconds, says (a) what it is ("a betting app where you guess whether statements are true"), (b) what to tap, (c) what Yes pays. Target 9/10 clarity from both a Polymarket regular and a person who has never touched crypto. Anything below 8 is a hard stop.
- **Blind pairwise against Polymarket and Kalshi** (desktop and phone, light and dark, home and market): win or tie on "return"; win or tie on "trust" at least as often as the kit's own rounds; "bigger" within reach by the scale cues in section 8. Pulse's own record to beat: 68 of 81 against the other kits.
- **360 px:** no horizontal overflow, no clipped text, no doubled words, no broken images, targets at least 44 px, Yes/No above the fold.
- **Lighthouse:** at least 90 on performance, accessibility, best practices and SEO (phone), 0 console errors; art as WebP, fonts preloaded for General Sans 700 and Geist.
- **AA:** every text pair at least 4.5:1, UI at least 3:1, both themes, focus visible, keyboard reachable, `prefers-reduced-motion` honoured; the Yes/No words always present.
- **Real data:** every number traceable to `snapshot.json`, the contract or an exact quote.

**Tells to reject**
- A first screen that is art without instructions, or reads like a document ("document-like" is the owner's verdict-in-one-word; "lame" is a hard stop).
- A % without "chance it's true" beside it; "40¢" with no "$1 wins"; Yes/No without "it's true / it's false".
- Cyan used for decoration, for Yes or No, for chart lines, or as large flat blocks; green or red as brand.
- The dial with the wrong angle, a recoloured needle, a needle that jumps without the spring, or a number that disagrees with the card.
- A new topic image not made from the template (different background, a person, a logo, text, a second object).
- Amstelvar in UI; mono in prose; the ₮ in a fallback font; non-tabular numbers; typewriter apostrophes; em dashes; unexplained jargon; first-screen words from the banned list.
- Invented numbers, fake trader names, stock photos, "trusted by" rows, fake scale cues, a pre-selected side, hidden small volumes.
- Cut-off ticker text mid-word, a chart hidden under the sticky bar, Yes/No below the fold on phone, tabs above the first screen's message.
- Generic AI skeleton: centred hero with gradient blob, three feature cards, emoji icons, glossy gradients, glassmorphism, default shadows, purple.
- The retired directions: the giant lone sentence set by the money, the gauge-as-glyph question mark, the dish field, the half-filled full stop mark, Amstelvar as the main font, the paper-and-red palette. They read as art without instructions or as a document.
- Light theme as an afterthought (flat inversion, cyan text on white, the dial washed out).

## 11. Files and kit gaps

- **Brand kit:** `.apex/design/brand/pulse/` (board `index.html`, `screens/`, `logo/`, `assets/`, `motion/`, `review/`, `social/`).
- **Social and brand renders:** `pulse/social/x-avatar-400x400.png`, `x-banner-1500x500.png`, `github-social-1280x640.png`, `readme-hero-1600x800.png`.
- **Builders:** `_pr/` (`tokens.mjs`, `gen-art.mjs`, `post-art.py`, `logos.mjs`, `blender-pulse.py`, `sharecards.mjs`, `qa.mjs`); Playwright from `.apex/design/tools` (`PLAYWRIGHT_DIR`).
- **Not specified by the kit (decisions made in this file):** logo clear space and minimum sizes; component states other than the default (loading, empty, error, disabled, free-bet-unavailable) beyond the kit's "No bets yet" and "AI's estimate" cases; shadows are in CSS not in `tokens.json`; ticket sheet on phone; the exact trust-cue list. Treat these as the standard until the kit says otherwise, and update this file when it does.
