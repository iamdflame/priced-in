# Priced In site: foundation

The product a stranger uses: bet on whether facts are true, with a free $1. Next.js 16 (App Router), TypeScript and Tailwind 4, server-rendered from the live API, in the Pulse brand. The brand spec is `.apex/design/brand/pulse/` (the README, the tokens and the five designed screens): read it before you change how anything looks.

## Run it

```
cd site
npm install
npm run dev          # http://localhost:3100, against the live API
npm run build && npm start
npm test             # unit tests (vitest): the quote layer, the model, the rulings, the money rules
npm run e2e          # Playwright against a production build; never spends money
npm run e2e:money    # the wallet flows, with a mock wallet and a pretend chain
npm run lint         # tsc --noEmit
```

From the repo root: `npm run site:install`, `site:dev`, `site:build`, `site:test`, `site:e2e` (builds, then runs Playwright).

Env (`.env.example`): `API_ORIGIN` (default `https://isitpriced.com`), `NEAR_NETWORK` (default `mainnet`), `SITE_URL` (share links), `PROXY_SECRET` (shared with the API; see below). Nothing needs setting to run it locally.

## The map

```
app/                 routes; server components unless a file says "use client"
  layout.tsx         fonts, the theme set before paint, nav, live strip, footer
  page.tsx           home
  c/[id]/page.tsx    the market page, with opengraph-image.tsx beside it
  globals.css        Tailwind and the @theme that maps the tokens; imports styles/*.css by surface
components/          shared pieces at the root: Dial, Chart, FactCard, Bet, Ruling, States, Icon…
  shell/ home/ market/ money/ pages/      one folder per surface
lib/                 shared and browser-safe: model, quote, format, bets, rulings, nav
  server/            server-only reads and view models (each file imports "server-only")
  client/            browser-only: the engine, useStore, intent, this browser's bets, browser API calls
  replay/            the record of the mainnet run, and the engine that plays it
  core/              the engine: the LMSR port, the no-wallet lane, the store, rewrite verification
  money/             real money, one rule to a file (see below)
data/                questions.json, catalog.json, pages/; rehearsal-mainnet.json and mainnet-public.json (npm run sync:site-data)
scripts/             build-catalog.mjs, build-pages.mjs, make-rewrite-fixture.mjs, amstelvar-text.py, shoot-receipt.mjs
tests/unit/          vitest (core/ is the engine's)    tests/e2e/   Playwright    tests/vectors/   the LMSR vectors crates/lmsr generates
```

The boundaries the code keeps (hold reviews to them):

- `lib/server/*` never reaches the browser. The questions and the catalog are read there, so their JSON is never shipped.
- `lib/client/engine.ts` (near-api-js and the store) loads through a dynamic `import()` on a person's first pick. No page ships NEAR code just to be read.
- `lib/core` is the one engine. Judge check 1 imports `lib/core/lmsr.ts` and proves it bit-exact with `crates/lmsr` on `tests/vectors/lmsr.json` (regenerate: `npm run vectors:lmsr` at the root). Change it together with its tests in `tests/unit/core/`.
- No `any` outside `lib/core`. A JSON import gets an interface where it is read.

## How data flows

- **One read per request.** Server components read through `lib/server/api.ts`. Every call returns `{ ok: true, value } | { ok: false, error, status }` and never throws. `getSite()` (`lib/server/site.ts`, cached per request) builds what most pages need: Facts, price paths, bets as sentences, agent names, rulings, the free bet's state and the totals. The layout's live strip reads it inside its own Suspense, so a slow API never holds up the page. `getMarket()` (`lib/server/market.ts`) adds what one market page needs.
- **A Fact is the view model** (`lib/model.ts`): a claim joined with its plain question, its art and its exact $1 quote. `toFact()` (`lib/server/facts.ts`) builds it on the server; `liveNumbers(view)` refreshes its numbers in the browser from a new claim view; `priceWords()` gives every % its meaning ("40% chance it’s true", "No bets yet · our AI’s starting estimate: 40%").
- **Quotes are exact.** `quoteClaim(view)` (`lib/quote.ts`) runs the contract's own fill (`fillBuy`, fee included) on the market a v3 claim view describes. `payoutWords(q)` says the free bet in plain money, the same way everywhere: "Right: $1 becomes $1.57", "Wrong: the free $1 is gone" (rounded down, so we never promise more than the chain pays). Never compute a payout any other way: unit tests pin it to every crate vector and to a real logged trade.
- **Rulings** are read through `lib/rulings.ts`: `settledRulings`, `leadRuling` (the "Just ruled" card is the ruling with the most real bets, never one nobody bet on), `rulingRecord` (the counts every page shows) and `resolveRulingNow` (the API sends `ruling_now` as a summary). Never hard-code a count.
- **The browser talks only to this site.** `next.config.ts` forwards `/api/*`, `/health`, `/claims`, `/events`, `/lane`, `/v1` and `/post` to `API_ORIGIN`, so the site can take the API's domain later.
- **The API sees the visitor, not the site.** `proxy.ts` runs on every forwarded path and `lib/proxy/forward.ts` holds the rule: the visitor's address (`x-real-ip`, else the first `x-forwarded-for` hop) goes in `x-visitor-ip` and `PROXY_SECRET` in `x-proxy-secret`; a client's own copies are dropped; with no secret set, neither is sent. `visitorIp` in `services/api/src/ratelimit.mjs` trusts the address only with the secret, so set the same value on both projects, or every visitor shares one free-bet bucket. A new forwarded path goes in `next.config.ts`, `API_PATHS` and the matcher in `proxy.ts` (a test holds the last two together).

## The free $1 bet

- `components/market/useBetFlow.ts` holds the ticket's logic: it loads the engine on the first pick, opens the store on the claim, warms the lane, runs `store.doubt(key, side)` and keeps the bet in this browser. `Ticket.tsx` renders every state in plain words: free bet unavailable with its reason (before any tap), picking, sending (`BetProgress`), failed with a retry, done.
- **Each free $1 key costs the lane gas.** It is asked for only after a person picks a side (`engine.warm()`), or right after they tapped Yes or No on a card (`markIntent()`, then `takeIntent()`). Never call `lane.prepare()` on page load: crawlers, previews and screenshot runs must not spend keys.
- `useStore(store, select, fallback)` and `useLane(lane)` (`lib/client/useStore.ts`) bridge the engine to React with `useSyncExternalStore`. A selector returns part of the state, never a new object.
- **The receipt** (`Receipt.tsx`, a native modal `<dialog>`) shows "Settled on NEAR in X s", measured from the tap to final; the needle swinging from the old odds to the new; the signed rewrite, verified in the browser (`store.verify`, `ReceiptPanels.tsx`); an AI trader's reply; and Share on X with the market's card.
- **The replay:** `?recorded=1` on `/c/18` plays `data/rehearsal-mainnet.json`, a copy of `deployments/rehearsal/mainnet.json` written by `npm run sync:site-data` at the root (and by `npm run catalog`): the real free $1, the signed rewrite 4.3 s later, the Skeptic's answer 12 s later, then the ruling. `lib/replay/engine.ts` answers the API's routes and subclasses `Lane`, so the store runs unchanged and nothing is sent. The nav says "Replay of a real mainnet run" while it plays.

## Today's claims, picks, the board and the score

The API answers `/api/today`, `/api/picks`, `/api/profile`, `/api/leaderboard`, `/api/reports` and `/api/challenge` only while it runs with `NEWS_ENABLED=1` (docs/API.md); until then each is a 404, and the site shows none of it: no section, no link, no empty shell.

- **The switch.** `getNews()` (`lib/server/news.ts`) reads `/api/today` once per request: 404 is off. The layout's `NavWithNews` (`components/shell/NavServer.tsx`) passes it to the header, the phone bar (`navFor(news)` in `lib/nav.ts`: the leaderboard takes the AI traders' place) and mounts the pick tray; the footer, the home, `/how`, `/help`, `/portfolio` and a fact's page read it too. `/leaderboard` is a 404 with it off.
- **A news line is a Fact** whose `news` is set (`toFact` in `lib/server/facts.ts`; page `news-YYYY-MM-DD`). It never shows in the Wikipedia grid, whatever the switch says.
- **One rule for cards.** With news on, every card's Yes and No on the home page and in `/rulings`' queue is a free pick (`components/today/PickButtons.tsx`), in place, signed by the browser's key; the tray (`PickTray.tsx`) then offers the free $1 or USDC. A fact's own page keeps the bet ticket, which can also save a free pick, and a bet placed there counts as the pick.
- **Signing** (`lib/client/picks.ts`): the lane's own key slot, ed25519 through @noble, the API's exact messages. Making a key costs nothing; only `POST /lane/key` spends lane gas, and a pick never calls it. `tests/unit/picks.test.ts` holds it to near-api-js and to the API's parser.
- **The score** (`lib/client/score.ts`): the free $1's winnings stay in the market under `lane:<key>`, which the lane key may spend but never withdraw. Once the free $1 is spent, the ticket bets the score (`store.doubt` with an amount), `/portfolio` adds a won free bet to it (`lane.redeem`), and the leaderboard shows it beside the picks. It is always worded as score that can't be cashed out.
- **Catch a mistake** (`components/today/Report.tsx`, `components/money/Challenge.tsx`): a free report (signed, `/api/reports`, its status in plain words) or a challenge with the wallet's own bond (`challenge` on the market, from `/api/challenge`).
- **Testing it.** `tests/mock/api.mjs` stands in for the API with news on (never shipped): build with `API_ORIGIN=http://127.0.0.1:3299 NEWS_PROBE_MS=0`, start it, and run Playwright with `E2E_NEWS=on`; `POST /__mock {"news":"on"|"off","scenario":"first"|"returning"|"overdue"|"refused"|"bounty"}` switches state. Without `E2E_NEWS`, the same specs test the off state against the live API.

## Film mode

`?film=1` is for recording the demo film. The replay bar is hidden, countdowns freeze at their first value, the live strip holds its first items, and no free-bet key is ever asked for (`liveEngine()` answers the lane itself). It changes no data and appears in no nav, sitemap or share card. The flag is kept for the tab in sessionStorage, so it carries across internal links (`?recorded=1&film=1` films the replay); `?film=0` ends it. The rule lives in `lib/client/film.ts`, and the head script in `app/layout.tsx` applies it before paint. To keep a new moving part still on film, check `filming()` or the `still` class.

## Components

| Where | What |
|---|---|
| `Dial` | The Blender dial with the live needle; `p` is 0..1. Server-safe. |
| `Chart`, `Spark` | The price after each logged bet, with each real bet marked. The chart draws at its container's width; hover or the arrow keys read each step. A fact nobody has bet on says "No bets yet" instead of a flat line. |
| `FactCard`, `PctBlock`, `BetLinks` | The card: question, the % with its meaning, evidence, Yes/No with the one-line bet, meta. |
| `RulingBlock`, `ReplayRuling` | Challenge, three signed verdicts, the objection window, settlement, "Corrected → see the new market". |
| `States` | `Sk`, `CardSkeleton`, `StateBox`, `ErrorState` (with a retry and the replay), `Retry`. |
| `Toasts` (`useToast()`), `Explain` (the one-tap "?", with `WhyEstimate`, `WrongExplain` and `JudgesLine`), `Live` (`Until`, `Ago`, `FreeCashNote`, `FreeBetsOff`), `Icon`, `Brand` | Small shared pieces. |
| `shell/` | `Nav` (with the replay bar), `NavMenu` (the compact header's menu, 761 to 1240 px), `Search`, `ThemeToggle`, `PhoneNav`, `LiveStrip`, `Footer` (the company footer: brand, four columns, trust line, copyright), `OfflineNotice`. |
| `home/` | `Intro` (the promise and the three steps), `ProofBar` (the real numbers, once), `Feature` (one open question), `Rails` (`RuledCard`, `DecidingCard`), `HomeGrid` (filters, search, live prices; about three rows show first, set per width in `home.css`, then "See all" expands in place, so the footer is close). At 1440×900 the lead and the first row of four cards share the first screen: keep it that way. What leads is decided in `lib/lead.ts` from the hand-curated `data/lead.json`: the first open fact in it, preferring any with real bets, and a first row of one fact per topic with the lead's own topic last. |
| `market/` | `MarketBody` (head, price panel, body, skeleton), `Sources` and `Rules`, `MarketTabs`, `Ticket`, `SettledTicket`, `BetProgress`, `Receipt`, `ReceiptPanels`, `useBetFlow`. |

## Styling

- Tokens are CSS variables for both themes (`app/styles/tokens.css`, generated by the kit). Light is the default; `data-theme` on `<html>` switches, set before paint from `?theme=` or the saved choice. Tailwind reads the tokens through `@theme` in `globals.css`: `bg-surface`, `text-ink2`, `text-yes`, `bg-no-bg`, `font-display`, `rounded-xl`.
- The kit's component classes are split by surface in `app/styles/`, ported from the brand's `kit.css`. Reuse them, use Tailwind utilities for one-offs, and keep anything reused out of inline styles.
- **Shared sheets and route sheets.** `base`, `shell`, `instruments`, `cards`, `kit` and `feedback` load on every page and hold what more than one surface uses. A route's sheet keeps every rule inside its root class: `home.css` in `.home`, `market.css` and `receipt.css` in `.market`, `pages.css` in `.pg`, each written as one `:where(.root) { … }` block, so specificity stays as written and no rule can reach another route. The root class goes on `<main>`. `money.css` opens outside any route, so every class there carries a money prefix. A route stylesheet stays live after client-side navigation: a class defined in two sheets breaks whichever page loses the cascade. `tests/unit/css-scope.test.ts` fails on any loose rule, any selector defined in two sheets and any `@keyframes` name used twice. Inside a scope block, a theme rule is `[data-theme='light'] & .x`.
- Fonts (`app/fonts.ts`, next/font/local): General Sans (`--disp`) for the voice and big numbers, Geist (`--text`) for reading and every changing number, Geist Mono (`--mono`) for hashes, Amstelvar (`--quote`, a 17 KB static instance) only for what Wikipedia says.
- Breakpoints: 1240 (tablet: the header's links move into `NavMenu`), 1000, 760 (the phone, composed for 390) and 380 (the smallest phones). The phone has `.pbar` and `.pnav`. The market ticket docks above the bottom bar (`.ticket.dock`); hide extras there with `.hide-dock`; `body:has(.ticket.dock)` leaves room so the footer scrolls clear of it.
- The live strip: at 390 px and below, the moving bets give way to one still line of counts (`proofOf` in `lib/server/site.ts`, the same numbers as `ProofBar`).
- Copy rules, from testing: every % says what it means, at every size; "Right: $1 becomes $X", "Wrong: the free $1 is gone"; the free $1 explained once beside its buttons (`FreeCashNote`); the judges' one line (`JudgesLine`) on the home page and near every ticket; one question per card, with its Yes/No directly under it; no "lines", "rulings" or "NEAR" in first-screen copy (NEAR is in the trust line and the footer); every number comes from the chain or the API.

## Tests

- `tests/unit/` (vitest, `server-only` stubbed): the engine (`core/`: the LMSR port against the crate's vectors, the lane, the store, rewrite verification), the quote against every crate vector and every live claim view, the replay's claim against the real logged trade, the model's words and the rulings. Fixtures are real API snapshots (`tests/unit/fixtures/`).
- `tests/e2e/` (Playwright, against `npm start`). `guard.ts` is the money guard, and every test uses it: it answers `POST /lane/key` with a key for a fake RPC, scripts that RPC, and refuses `send_tx` to every real NEAR RPC. `flow.spec.ts` covers home → market → free bet → receipt, a refused free bet, the replay (with the signature verified in the browser) and a real 404. `layout.spec.ts` checks 360 and 390 px in both themes: no overflow, Yes/No above the fold, 44 px targets. `pages.spec.ts` covers the proof pages.
- **Test like a visitor.** `navigation.spec.ts` walks every route by clicking in one session and holds each stop against a fresh load of the same URL (computed styles and boxes, `visit.ts`). `widths.spec.ts` runs `audit.ts` (nothing past the edge, a header that fits, rows that stay rows, no text cut off, images load) on every route at the real CSS widths, from 320 to 2600 in steps of 8 on `/`, `/c/31` and `/c/18`, and at device scales 1 to 2. `click.spec.ts` crawls every internal link and #anchor, and opens and closes every `?`, sheet, menu, tab and filter, with the keyboard too; no console errors, no layout jump. `browsers.spec.ts` and `flow.spec.ts` run again in Firefox and WebKit (`npx playwright install firefox webkit`).

## Add a route

1. Add `app/<route>/page.tsx` as a server component. Read with `getSite()` or `api.*`. On `!ok`, render `<ErrorState message=… />`. For a missing thing, call `notFound()` before any Suspense boundary streams, and add no `loading.tsx` above the route: it would stream a 200.
2. Wrap content in `<main id="main" className="wrap">`, with the root class of the sheet it uses (`pg` for `pages.css`). Use `.sec` for section heads, `.panel` for surfaces, `.grid` with `FactCard` for facts.
3. Put interactivity in a `"use client"` component. For live data, use the engine (only after a person acts) or a small poll of `/api/...` while `!document.hidden`.
4. Add the route to `lib/nav.ts` (`NAV`, with `phone: true` for the bottom bar, at most four).
5. For a share card, add `opengraph-image.tsx` beside the page (see `app/c/[id]/opengraph-image.tsx` and `lib/og/card.tsx`).
6. Add the route to `ROUTES` in `widths.spec.ts` and `click.spec.ts`, and to the walk in `navigation.spec.ts`.

## Real money (`lib/money/`, `components/money/`)

The person's own NEAR wallet signs every transaction; the site never holds a key. One rule to a file, each with its test beside it (`*.test.ts`, run by `npm test`):

| File | The one thing it decides |
|---|---|
| `config.ts` | Accounts, RPCs and gas per call, for mainnet and testnet. |
| `units.ts` | Amounts: exact bigint parsing and formatting, never a float. |
| `quotes.ts` | Wallet quotes: the contract's own `fillBuy`/`fillSell` with the fee, and the slippage floor (`min_shares_micro`, `min_proceeds_micro`). Equal to the fill on every crate vector. |
| `rules.ts` | Every go or no-go (region, caps, balance, market status), as a sentence or null. The caps live here only. |
| `geo.ts` + `data/restricted-regions.json` | The geofence rule and its list, with sources. `proxy.ts` sets the `pi_geo` cookie and refuses `/bridge/quote` server-side. |
| `tx.ts` | The transactions, as plain data, each with the sentence the person approves. |
| `chain.ts` | Read-only views, and what an outcome means: every receipt counts, and an unknown outcome is never success. |
| `wallet.ts` | NEAR Wallet Selector (HOT, Meteor, MyNearWallet, Intear): one approval per step, stopping at the first failure. `window.__PI_MOCK_WALLET__` replaces it in tests. |
| `oneclick.ts`, `oneclick-server.ts`, `bridge.ts` | NEAR Intents 1Click: curated routes and address checks; the server builds every request (`/bridge/*`, optional `ONECLICK_JWT`); the browser's calls. |
| `ledger.ts`, `portfolio.ts`, `hooks.ts` | This browser's tx log and deposits in flight; the portfolio's view model; React bridges and the open sheet. |

Open a money flow from anywhere with `openSheet({ kind: "trade" | "deposit" | "withdraw" | "collect" | "connect", ... })`. `MoneyLayer`, mounted once in the nav, loads the sheets on first use. E2E: `npm run e2e:money` (a mock wallet and a pretend chain in `tests/e2e/money/`; nothing is signed).

## The proof pages

`/rulings`, `/agents`, `/stats`, `/trust`, `/developers`, `/p`, `/p/[slug]`, `/new`, `/[user]/status/[id]` and `/embed/[id]`. Their components are in `components/pages/`, their styles in `app/styles/pages.css` (each route imports it, and each `<main>` carries `.pg`).

- **Reads beyond `getSite()`** go through `lib/server/proof.ts`: activity, reasons, portfolios, proofs, the truth API, and the chain itself (`stats`, code hash, keys, a verdict's own transaction).
- **The ruling record** is `rulingRecord()` in `lib/rulings.ts`. `/rulings`, `/stats` and the share card all read it, so they can't disagree.
- **Per-address limits decide where a call runs.** `/paste`, `/post` and `/v1/credence` count per address, so they run in the browser (`lib/client/api.ts`), where `proxy.ts` forwards the visitor's address. From the server, every visitor would share one quota. A `/v1/credence` sample read on the server is cached for hours.
- **Commands a developer copies** live in `lib/truth.ts`. The MCP server defaults to a local API and testnet, so both must be set.
- **The encyclopedia's text** is `data/pages/`, built from `corpus/pages/` by `npm run pages`. `lib/server/encyclopedia.ts` joins it to the market.
- **`data/mainnet-public.json`** is the public part of `deployments/mainnet.json`, for `/trust`, written by `npm run sync:site-data` at the root. Run it after an upgrade, or the page will say the hashes differ; `tests/unit/site-data.test.ts` fails while either copy differs from `deployments/`.
- **Class names:** check `app/styles/` before naming one. `.skip` is the skip link and `.mk` the market page's grid; both have broken a page by being reused, and `.proof` broke the home page until the route sheets were scoped.
