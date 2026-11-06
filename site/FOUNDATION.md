# Priced In site: foundation

The product site in the Pulse brand: Next.js 16 (App Router) + TypeScript + Tailwind 4, server-rendered from the live API. Brand spec: `.apex/design/brand/pulse/` (README, tokens, the five screens). Read it before changing the look.

## Run

```
cd site
npm install
npm run dev          # http://localhost:3100
npm run build && npm start
npm test             # unit: the quote layer against web/test/vectors
npm run e2e          # Playwright: never spends money (see tests/e2e)
```

Env (`.env.example`): `API_ORIGIN` (default `https://isitpriced.com`), `NEAR_NETWORK` (default `mainnet`), `SITE_URL` (share links), `PROXY_SECRET` (secret, shared with the API; see below).

## How data flows

- **Server components read the API** through `lib/server/api.ts` (`api.claims()`, `api.claim(id)`, `api.history(id)`, `api.rulings()`, `api.events()`, `api.agents()`, `api.rationales(id)`, `api.health()`). Each returns `{ ok, value } | { ok: false, error, status }` and never throws. `lib/server/site.ts` `getSite()` is the one cached read per request (facts, price paths, bets as sentences, agent names, rulings, the lane's state, totals), shared by the layout's live strip and the pages.
- **The browser talks only to this site.** `next.config.ts` rewrites `/api/*`, `/health`, `/claims`, `/events`, `/lane`, `/v1` and `/post` to `API_ORIGIN`, so the site can take the API's domain later.
- **The API sees the visitor, not the site.** `proxy.ts` runs on every forwarded path and `lib/proxy/forward.ts` holds the rule: the visitor's address (`x-real-ip`, else the first `x-forwarded-for` hop) goes in `x-visitor-ip` and `PROXY_SECRET` in `x-proxy-secret`; a client's own copies are dropped; with no secret set, neither is sent. `visitorIp` in `services/api/src/ratelimit.mjs` trusts the address only with the secret, so set the same value on both projects, or every visitor shares one free-bet bucket. A new forwarded path goes in `next.config.ts`, `API_PATHS` and the matcher in `proxy.ts` (a test holds the last two together).
- **The view model** is `lib/model.ts`: `toFact(claim, openPpm)` joins a claim with its question (`data/questions.json`, keyed by sha256 of the exact sentence), its art direction (`data/catalog.json`, built by `npm run catalog` from the Pulse kit and the corpus) and its exact $1 quote. `priceWords(fact)` gives the % its meaning ("chance it’s true", "No bets yet · our AI’s starting estimate: 40%").
- **Quotes are exact.** `lib/quote.ts` `quoteClaim(view)` runs the contract's own fill (`fillBuy`, fee included) on the market a v3 claim view describes (`marketFromClaim`, `feeBpsOf`). `backUsd(q)` is the "get $1.81 back" number, rounded down. Never compute a payout any other way.
- **The money engine is reused, not rewritten.** `lib/core/` is a copy of `web/src/core` (api, config, lane, lmsr, rpc, store, verify, router) and `web/src/ui/context.ts`'s TradeHistory/AgentBook. Fix bugs in `web/` first, then copy. `lib/engine.ts` wires it for the browser: `liveEngine()` (API through `/api`, polled; the lane's free $1 key) and `recordedEngine()` (the replay). `lib/useStore.ts` bridges the store to React with `useSyncExternalStore`: `useStore(store, s => s.doubt, IDLE)`, `useLane(lane)`. Selectors must return parts of the state, not new objects.
- **The free $1 key costs the lane gas.** It is asked for only after a person picks Yes or No (`warmLane()`, or `markIntent()` on a card's Yes/No link). Never call `lane.prepare()` on page load.
- **Replay:** `?recorded=1` on `/c/18` replays `data/rehearsal-mainnet.json` (a copy of `deployments/rehearsal/mainnet.json`): the real free $1, the signed rewrite 4.3 s later, the Skeptic's answer, then the ruling. The nav shows "Replay of a real mainnet run" while it's on.

## Components (`components/`)

| Component | What it is |
|---|---|
| `Dial` | The Blender dial with the live needle. `p` 0..1. Server-safe. |
| `Chart`, `Spark` | Step chart of the price after each logged bet (hover a step: who bet, how much); sparkline. |
| `FactCard`, `PctBlock` | The card: question, % with meaning, evidence line, Yes/No with the one-line bet, meta. |
| `BetLinks` | Yes/No links to `/c/[id]?side=…`, marking intent. |
| `Ticket` | The market page's bet flow, every state (blocked with reason, picking, sending, failed, done). |
| `Receipt` | The post-bet sheet: timing, needle swing, signed rewrite verified in the browser, AI reply, share. |
| `RulingBlock`, `ReplayRuling` | Challenge, three signed verdicts, window, settlement, "Corrected → see the new market". |
| `MarketTabs` | Activity / Discussion / History. |
| `Home` | `Intro` (promise + three steps), `RulingFeature`, `PlainFeature`, `DecidingRail`, `ResultsRail`. |
| `HomeGrid` | Topic tabs, search, live-refreshing grid of cards. |
| `Chrome` | `Nav`, `PhoneNav`, `ThemeToggle`, `ReplayBar`, `OfflineNotice`. |
| `LiveStrip`, `Footer` | Real bets as sentences; the trust line. |
| `Toasts` (`useToast()`), `States` (`Sk`, `CardSkeleton`, `StateBox`, `ErrorState`, `Retry`), `Explain` (one-tap "?"), `Live` (`Countdown`, `Ago`, `CoachMark`), `Icon`, `Brand` (`Lockup`, `TopicIcon`). |

## Styling

- Tokens are CSS variables for both themes (`app/styles/tokens.css`, generated by the kit; dark is the default, `data-theme="light"` on `<html>`). Tailwind reads them through `@theme` in `app/globals.css`: `bg-surface`, `text-ink2`, `text-yes`, `bg-no-bg`, `font-display`, `rounded-xl`…
- The kit's component classes (`.card`, `.bet`, `.panel`, `.ticket`, `.chip`, `.btn primary|soft|ghost`, `.pct`, `.lab`…) live in `globals.css`, ported from `kit.css`. Reuse them; add Tailwind utilities for one-offs.
- Fonts: `app/fonts.ts` (next/font/local). `--disp` General Sans for voice and big numbers, `--text` Geist for reading and changing numbers, `--mono` Geist Mono for hashes, `--quote` Amstelvar only for what Wikipedia says.
- Breakpoints: 1240 (tablet), 1000, 760 (phone, composed for 390). Phone has `.pbar` and `.pnav`; the market ticket docks above the bottom bar (`.ticket.dock`, hide extras with `.hide-dock`).
- Copy rules (from testing): every % says what it means; "Bet $1 → get $X back"; no "lines", "rulings" or "NEAR" in first-screen copy (NEAR is in the trust line and footer); every number comes from the chain or the API.

## Add a route

1. `app/<route>/page.tsx` as a server component. Read data with `getSite()` or `api.*`; on `!ok`, render `<ErrorState message=… />`; for a missing thing call `notFound()`. Do not add a `loading.tsx` above a route that calls `notFound()` (it would stream a 200).
2. Wrap content in `<main id="main" className="wrap">`. Use `.sec` for section heads, `.panel` for surfaces, `.grid` + `FactCard` for facts.
3. Client interactivity goes in a `"use client"` component; live data via the engine (`liveEngine().store`) or a small poll of `/api/...` while `!document.hidden`.
4. Add the route to `lib/nav.ts` (`NAV`, and `phone: true` for the bottom bar, at most four).
5. Share card: add `opengraph-image.tsx` next to the page (see `app/c/[id]/opengraph-image.tsx`).
6. Check 360/390/1440 in both themes (`?theme=light`), no overflow, 44 px targets.

## The proof pages

`/rulings`, `/agents`, `/stats`, `/trust`, `/developers`, `/p`, `/p/[slug]`, `/new`, `/[user]/status/[id]` and `/embed/[id]`. Their components are in `components/pages/`, their styles in `app/styles/pages.css` (each route imports it).

- **Reads beyond `getSite()`** go through `lib/server/proof.ts`: activity, reasons, portfolios, proofs, the truth API, and the chain itself (`stats`, code hash, keys, a verdict's own transaction).
- **The ruling record** is `rulingRecord()` in `lib/rulings.ts`. `/rulings`, `/stats` and the share card all read it, so they can't disagree.
- **Per-address limits decide where a call runs.** `/paste`, `/post` and `/v1/credence` count per address, so they run in the browser (`lib/client/api.ts`), where `proxy.ts` forwards the visitor's address. From the server, every visitor would share one quota. A `/v1/credence` sample read on the server is cached for hours.
- **Commands a developer copies** live in `lib/truth.ts`. The MCP server defaults to a local API and testnet, so both must be set.
- **The encyclopedia's text** is `data/pages/`, built from `corpus/pages/` by `npm run pages`. `lib/server/encyclopedia.ts` joins it to the market.
- **`data/mainnet-public.json`** is the public part of `deployments/mainnet.json`, for `/trust`. Copy it again after an upgrade, or the page will say the hashes differ.
- **Class names:** check `globals.css` before naming one. `.skip` is the skip link and `.mk` the market page's grid; both have broken a page by being reused.
