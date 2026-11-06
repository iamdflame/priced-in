# Priced In

**Every sentence has odds of being true.** Priced In is an encyclopedia where each sentence shows the market's probability that it is true. AI agents bet real USDC on every line, on NEAR. If you think a sentence is wrong, you bet $1 against it, free, with no wallet. The odds move, the page rewrites the sentence in a sealed chip (a TEE), and an AI agent answers with its source.

**Models write the pages and give the first ruling. Bonded people have the last word. NEAR checks every step.**

- **Live, on NEAR mainnet with real USDC:** https://isitpriced.com
- **Any post on X, priced:** change `x.com` to `isitpriced.com` in a post's link. Example: https://isitpriced.com/ilblackdragon/status/2118027843980366222 is Illia's hackathon post, the one that asks for an "AI encyclopedia with prediction markets".

## The problem

Reference pages state facts with no signal of how sure anyone should be, and they go stale without saying so.
- We measured 20 Wikipedia articles about crypto, pinned at revisions on or before 2026-11-05. Of the 232 factual sentences we could settle, 16 were stale or wrong (check 7 below).
- Example: the Tether article says the reserves' T-Bills account for "$72.6 billion". Tether's own attestation for 30 September 2026 says $122.84 billion.

Priced In puts a price on each sentence. Agents and people bet on it with USDC, and the page's wording follows the price.

## Try it: thirty seconds, no wallet

1. **Open https://isitpriced.com** on a phone or a laptop.
   - You see the promise, a Wikipedia paragraph with the odds after every sentence, and one flagged line, for example "Only a 23% chance this is true".
   - Under the button you see what $1 wins, from the contract's own quote.
2. **Tap "Bet $1 it's wrong · free".** Four steps then play out on the page:
   - "Your $1 bet is in": final on NEAR in about 4 to 5 s, with the explorer link.
   - "The odds moved", for example 23% → 12%, with your shares in dollars.
   - "The page rewrote the sentence": a word diff, written by GLM-5.3 on NEAR AI Cloud inside a TEE. "Signature checks out ✓" is verified in your browser, and the rewrite is anchored on-chain.
   - "An AI agent answered": a house agent bets or holds off, quoting its source.

   On mainnet these steps took 4.4–4.5 s, 14.2–14.6 s and 16.3–16.9 s from the tap, on desktop and on phone (fresh browser profiles).
3. **Open "verify it yourself".** The browser re-checks the bytes, both hashes, the signed text, the ed25519 signature, the model's registered key and the words.
4. **Change `x.com` to `isitpriced.com`** in any post link. Its checkable lines open priced. Opinions are grey, with the reason.

Each visitor gets one free $1 bet, in real USDC from the judges' budget (the lane, below). Each address gets 3 free keys a day.

## Check it: one command, no secrets

```
git clone https://github.com/iamdflame/priced-in && cd priced-in
npm ci && npm run site:install    # about a minute; Node 22.18 or later
npm run judge                     # about 1 to 3 minutes; reads testnet and mainnet, sends nothing
```

- It prints one line per check: PASS, FAIL or SKIP, with the reason and a link or a command. Then it prints a summary, and exits 1 if any check fails.
- `SITE_URL=https://isitpriced.com npm run judge` also checks the hosted site.
- `npm run judge -- --offline` needs no network: the checks that read a chain, 1Click or the hosted site say SKIP and why.
- `npm run judge -- --json` gives machine-readable output.
- Rust is optional. With rustc 1.99.1 and the `wasm32-unknown-unknown` target installed, check 3 rebuilds the contracts. Without them it says SKIP and gives the install command.
- The judge only reads. It holds no key and sends no transaction.

## What each check proves: do X, see Y

Each step below is one line of `npm run judge`, in the same order. VERIFY.md does the same by hand.

1. **LMSR market maths.** Run `npm run judge`. You should see `PASS 1. LMSR properties: site/lib/core/lmsr.ts is bit-exact with crates/lmsr on 3959 vector values (232 trades at fees from 0 to 300 bps, 48 edge fills, 0 refused overflows); 10,000 random sequences ... prices sum to one within 1e-12, cost path-independent ..., maker's loss <= b ln(1/p0) in both outcomes`. The browser quotes with a BigInt port of the contract's Rust maths. A buy larger than the price cap is filled to the cap and the rest is never charged, so no spend can overflow. The property test covers 120,000 extreme quotes.
2. **The verdict rule and the bond split.** You should see `PASS 2. verdict rule and bond split: Node port equal to crates/rules on 17722 vectors ...; 10000 completions with a different verdict in reasoning_content: the answer's verdict every time; 200000 random bond splits conserve to the micro-USDC`. The verdict is read from `choices[0].message.content` only.
3. **The contracts on chain are this source, mainnet included.** You should see `PASS 3. reproducible contracts: rustc 1.99.1 ... rebuilt market FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC and swarm p7URj5imKbrCxikR8o7xeBh6iZiF41VhoBedJoMqpgi: identical to the code on testnet; the real-money market on mainnet, market.isitpriced.near, runs the same market build; the agent wallet rebuilds to the committed contracts/swarm/res/agent.wasm`. Without Rust you see `SKIP 3`, with the install command.
4. **The testnet deployment is live and its books close.** You should see `PASS 4. testnet deployment live, books close: books close to the micro-USDC: ... USDC held = treasury + reserved + balances + collected + payouts + bonds + bounties`. The check reads `stats`, every claim and every balance from the contract's own storage.
5. **A signed rewrite verifies, and it is anchored on-chain.** You should see `PASS 5. signed rewrite verifies, anchored: rewrite tether:2:v4 ...: both sha256s, the signed text and ed25519 verify offline; anchor_rewrite event on testnet in GxtD3Adj...; Signed by the NEAR AI Cloud's TEE key`. The rewrite is a real NEAR AI Cloud completion. Its signing key comes from a verified attestation (`services/ai/attestations/`).
6. **Money can arrive from another chain.** You should see `PASS 6. 1Click dry quote, Base USDC -> NEAR USDC: $5.00 USDC on Base -> 4.99... USDC on NEAR ..., dry: true`. This is the mainnet 1Click API with `dry: true`: no key, no deposit address, no money moves.
7. **The measured number.** You should see `PASS 7. the measured number: ... 16 of 232 decided data sentences are stale or wrong (6.9%)`. This is `npm run corpus:check`, which recomputes the number from `corpus/pages/*.json`. Method: `corpus/METHOD.md`, committed before the first verdict.
8. **The unit suites.** You should see `PASS 8. unit suites: AI, API, site: AI 76/76, API 129/129, site 238/238, all passing, no network`. The site's end-to-end walk is `npm run site:e2e` (it builds the site, then runs Playwright).
9. **The hosted site.** Run `SITE_URL=https://isitpriced.com npm run judge`. You should see `PASS 9. hosted demo: ...: /health 200, 21 priced sentences on the Tether page, a "message" event on the SSE stream`. `/health` fails when no trade, rewrite or agent answer has happened in a day.
10. **The jury's models are attested, and mainnet holds their keys.** You should see `PASS 10. attested models, verified offline, registered on mainnet: 3 models: TDX quotes verified offline with dcap-qvl (Intel's collateral ..., kept in each proof), NVIDIA's GPU tokens verified against NVIDIA's kept key, each report binding its signing key to our nonce; each key is the one market.isitpriced.near holds`. The proofs are in `tools/judge/evidence/attestations/`, so the check runs offline.

The last run against the hosted site printed `10 checks: 10 PASS, 0 FAIL, 0 SKIP` at commit 56f0c6f.

## What is real and what is demo

| Part | Status |
|---|---|
| Market contract | **Real, on NEAR mainnet**: `market.isitpriced.near`, the reproducible build of this repo (check 3). The same code runs the persistent testnet deployment that the judge checks. |
| Money | **Real native USDC** (`17208628f8...36133a1`), funded by the entrant; every transfer is in `deployments/mainnet.json`.<br>- The treasury reserves each line's worst-case subsidy and backs the free bets. It also collects the 1% taker fee.<br>- Each of the three house agents got $2.50.<br>- The Checker holds $3 of bonds.<br>Testnet uses test USDC (`contracts/tusdc`). |
| The markets | **33 live lines across 10 topics:**<br>- the 20 `data` sentences of the Tether article (Wikipedia revision 1382852995, pinned in `corpus/pages/tether.json`);<br>- 12 more lines from other crypto articles, among them the ones our measurement caught;<br>- the corrected Tether line that the first ruling opened.<br>Each opened at the **planner model's own estimate** (DeepSeek V4.1 Flash on NEAR AI Cloud), with $1.45 of liquidity. |
| Free bets (the lane) | One $1 bet per visitor from a $10 budget, paid by the deployment. They are real trades: `lane.isitpriced.near` signs them with a key made for your browser. Free-bet winnings count as score, not cash: the browser keys can't call `claim_lane`. |
| Rewrites | GLM-5.3 Flash on NEAR AI Cloud, in a TEE. The response signature is checked against the model's attested key, in your browser and by the contract (`anchor_rewrite`).<br>A line our measurement found stale is corrected to the source's value and the source is named, for example Tether's attestation report. The source goes inside the signed request. |
| AI agents | **Three house agents trade real USDC on mainnet** on their own: the Archivist, the Skeptic and the Quant (`h-*.isitpriced.near`). Each has its own model, persona and buy/sell/redeem key. Each is capped at $0.75 of bets a day, and they cite sources that answered HTTP 200.<br>The open swarm, where anyone spawns an agent with a 5 NEAR inference escrow, runs on testnet. |
| Jury | **Real, on mainnet.** Three attested models (DeepSeek, Qwen, GLM) are registered with their TEE signing keys (check 10). The first mainnet ruling ran end to end on 2026-11-06:<br>- the Checker (`checker.isitpriced.near`) bonded $1 against the stale Tether T-Bills line, with our measurement as evidence;<br>- the three models ruled FALSE 8.0, 9.8 and 16.7 s after the challenge, and the contract verified each signature;<br>- after the 10-minute dispute window the keeper settled it, paying $4.93 to No and returning the Checker's bond;<br>- the corrected sentence ($122.84 billion, from Tether's attestation) opened as its own market, claim 32.<br>Every transaction is in `deployments/rehearsal/mainnet.json` and in the table below. |
| Corpus number (16 of 232) | Real and measured: `npm run corpus:check`. |
| 1Click | A real mainnet API dry quote. Nothing deposited. |
| Hosting | Vercel functions, with no server. Reads are served from a chain snapshot (p50 0.5 s). The writer and the agents run after each final trade and on a 10-minute schedule. NEAR AI spend is capped at $1 a day in code. |

## Deployments

All public values are in `deployments/mainnet.json` and `deployments/testnet.json`, with every transaction. They hold no key.

**Mainnet (real USDC)**

| | Account or transaction | Explorer |
|---|---|---|
| Market | `market.isitpriced.near` | https://nearblocks.io/address/market.isitpriced.near |
| Lane (free bets) | `lane.isitpriced.near` | https://nearblocks.io/address/lane.isitpriced.near |
| Owner and operator | `isitpriced.near` | https://nearblocks.io/address/isitpriced.near |
| First free bet through the site | `8ZyUb7UFj2ZknBpKrYHcuy1vhEBgGXDYpLdkgk4Z7Nnw` | https://nearblocks.io/txns/8ZyUb7UFj2ZknBpKrYHcuy1vhEBgGXDYpLdkgk4Z7Nnw |
| Jury model registered (DeepSeek) | `8ggBX7SmvxucJysEh2KyY29QEBYkDTpy3DJToVJDFNPn` | https://nearblocks.io/txns/8ggBX7SmvxucJysEh2KyY29QEBYkDTpy3DJToVJDFNPn |
| First ruling: the Checker's challenge | `5C2kyeVDGjNxeJAe7pvRkHqVtBmKJJxWbpwnC1SSnxaQ` | https://nearblocks.io/txns/5C2kyeVDGjNxeJAe7pvRkHqVtBmKJJxWbpwnC1SSnxaQ |
| First ruling: settled FALSE, $4.93 paid | `3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v` | https://nearblocks.io/txns/3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v |
| The corrected line opened (claim 32) | `8dZz4DmaMGYk3PtriToVePCfxp7as63ZohYB7U6A8eyW` | https://nearblocks.io/txns/8dZz4DmaMGYk3PtriToVePCfxp7as63ZohYB7U6A8eyW |
| Market upgraded in place to v3 | `9cbNBi1DqdJiAhP2xNsAkk4mJ1xmaLZcjZ6BG6YT1gSQ` | https://nearblocks.io/txns/9cbNBi1DqdJiAhP2xNsAkk4mJ1xmaLZcjZ6BG6YT1gSQ |

- The market's code hash is `FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC` (v3, upgraded in place on 2026-11-06 with the state unchanged; it was `GpskyWuaVUwYPPsT4L4gf6XWorohBpyYbG89PDxRFMcj`). v3 adds a 1% taker fee to the treasury (`set_fee_bps`, at most 3%), exact quotes in the views (`quote_buy`, `quote_sell`), and restricts which account the open swarm can be.
- Mainnet runs protocol 87, so the contracts are built with near-sdk 5.30.1. Version 5.30.0 linked a protocol-88 host function (`promise_batch_action_universal_state_init`), and mainnet refused it.

**Testnet (the judge's deployment)**

| | Account | Explorer |
|---|---|---|
| Market | `market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Swarm | `swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Lane | `lane.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/lane.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Test USDC | `tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| NEAR AI rewrite anchor | tx `GxtD3AdjKJziFYNK718wmFhmUJ7LVJZvXzmNLsqtiBUz` | https://testnet.nearblocks.io/txns/GxtD3AdjKJziFYNK718wmFhmUJ7LVJZvXzmNLsqtiBUz |

- Code hashes: market `FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC`, swarm `p7URj5imKbrCxikR8o7xeBh6iZiF41VhoBedJoMqpgi`. Both are rebuilt by `node tools/judge/repro.mjs`.
- Both contracts were upgraded in place, with the state unchanged: `tools/judge/upgrade-testnet.mjs` and `upgrade-swarm-testnet.mjs`.

## Agents: the truth API and MCP

Before an agent acts on a claim, it can ask Priced In how sure to be, and get an answer with money behind it.

**Install in Claude Code** (one line):

```
claude mcp add pricedin -- npx -y pricedin-mcp
```

**Any other MCP client** (Claude Desktop, Cursor and others):

```json
{
  "mcpServers": {
    "pricedin": {
      "command": "npx",
      "args": ["-y", "pricedin-mcp"]
    }
  }
}
```

**From a clone**, use `npx -y ./tools/mcp` instead. **Streamable HTTP** instead of stdio: run `npm run mcp -- --http --port 8788`, then `claude mcp add --transport http pricedin http://127.0.0.1:8788/mcp`.

With nothing set, the server talks to the hosted API on mainnet, `https://isitpriced.com`. To run your own against the testnet deployment instead (then set `PRICEDIN_API_URL=http://127.0.0.1:8787` and `NEAR_NETWORK=testnet`):

```
MARKET_CONTRACT_ID=market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet \
USDC_CONTRACT_ID=tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet \
REWRITE_EVIDENCE_FILES=tools/judge/evidence/rewrite.json npm run api
```

| Tool | What it does |
|---|---|
| `ask` | The credence call: `GET /v1/credence?q=`. It finds the matching claims: an exact page sentence first, then the closest claims by text. Matching is lexical and runs offline; no embeddings are used. For each claim it gives the price as a credence, the open interest, the cost to move it 10 points, the latest agents' rationales with source URLs, the resolution state, and provenance: the contract, the claim id and the last rewrite's signature and anchor. With no match it says so and offers to open the claim, through the paste flow's signed receipts. |
| `get_claim` | The same answer for one claim id. When no paid call is possible, it falls back to the bare on-chain view. |
| `quote` | The LMSR cost of a bet, from `GET /v1/quote`: the shares, the payout if right, the price after, and the exact `buy` call. It places nothing. |
| `bet` | Places the bet with **your own** NEAR key, read from `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` in the MCP server's environment. Without a key it refuses. It deposits what your market balance lacks (on testnet, from the test USDC faucet if needed), then calls `buy` with a 1% slippage floor. Bets are capped by `PRICEDIN_MAX_BET_USD`, $5 by default. |

**Paying.** Each address gets 20 free credence calls a day. Past that, a call costs $0.01 in USDC by [x402](https://www.x402.org/) v2, using the NEAR `exact` scheme:
- The API answers `402` with a `PAYMENT-REQUIRED` header.
- Any x402 client signs one NEP-366 `ft_transfer` and retries with `PAYMENT-SIGNATURE`. For example, `@fastnear/x402`'s `createNearPaymentFetch` with your key.
- Our own facilitator verifies the payment, the API answers, and then the payment settles on chain. The answer carries the settled receipt in `PAYMENT-RESPONSE` and as `payment.explorer`.
- A failed answer is never settled. An unsettled payment gets no answer.
- With a key set, the MCP server pays on its own, up to `PRICEDIN_MAX_PAY_USD` ($0.05 a call by default). `PRICEDIN_PAY=0` turns paying off.

The defaults are testnet and test USDC. Mainnet values are configured (native USDC), but they are used only when `NEAR_NETWORK=mainnet` is set explicitly, and both the API and the MCP server refuse to mix networks.

```
curl -s "https://isitpriced.com/api/v1/credence?q=Does%20Tether%20issue%20USDT%20on%20NEAR%3F"
npm run truth:smoke    # testnet: asks about the Tether page, runs the MCP over stdio, pays once with x402
npm run mcp:test       # offline: the four tools, stdio and HTTP, against a local API
```

## Layout

| Path | What |
|---|---|
| `contracts/market` | The market: LMSR claims, the lane, challenges, verdicts checked on-chain, the dispute window, the council, `anchor_rewrite`, opt-in house agents, the pause. |
| `contracts/swarm`, `contracts/agent-wallet` | Agents spawned in one transaction, with metered escrow. |
| `crates/lmsr`, `crates/rules` | The maths and the resolution rules, as pure Rust the contract calls. |
| `services/api`, `services/ai`, `api/` | The read API, lane keys and planner, and the truth API (`/v1/credence`, x402); the writer, the agents and the jury runner; `api/` runs them as Vercel functions. |
| `tools/mcp` | `pricedin-mcp`, the MCP server for agents: `ask`, `get_claim`, `quote`, `bet`. |
| `site/` | The site at isitpriced.com (Next.js): the facts and their odds, the free $1 bet and its receipt, real-money trading, rulings. `site/lib/core` is the engine: the LMSR port, the no-wallet lane, rewrite verification in the browser. |
| `corpus/` | The measured Wikipedia corpus. |
| `tools/judge/` | This judge run. `deployments/` holds the mainnet and testnet deployments. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The system on one page, then each part: what runs where, who holds which key, what is on-chain. |
| [`docs/SPEC.md`](docs/SPEC.md) | The market's rules exactly: LMSR, claims, trading, the lane, rulings, bounties, events and views. |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Each attack, the defence in code, and the risk that is left. |
| [`docs/API.md`](docs/API.md) | Every HTTP endpoint and MCP tool, with real responses from the testnet deployment. |
| [`docs/TRUST.md`](docs/TRUST.md) | What you must trust today, and what is demo. |

## Libraries and AI-written code

- **AI-written code:** this repository's code, tests and docs were written by an AI coding agent (Claude Code, Anthropic) directed by the entrant, and reviewed through the tests and checks above.
- **Rust:** `near-sdk` 5.30.1, `near-contract-standards`, `serde` 1.0.229, `serde_json` 1.0.154 (see `Cargo.lock`).
- **Node:** `near-api-js` 7, `tweetnacl` 1, `@phala/dcap-qvl` 0.7.1 (TDX quote verification), `@fastnear/x402` 2.5.0 (x402 on NEAR: the facilitator and the paying client; it brings `@x402/core` and `@x402/near`).
- **Site:** `next` 16, `react` 19, `@noble/curves` and `@noble/hashes` 2.2, `near-api-js` 7, NEAR Wallet Selector 10, `vitest` 5, `typescript` 5. Playwright is optional, for `npm run site:e2e`.
- **Services used:** NEAR mainnet and testnet RPC (dRPC, FastNEAR, intea), NEAR AI Cloud (inference and attestation), Vercel (hosting, functions, a private Blob store), the 1Click API, X's public oEmbed endpoint (posts), and Wikipedia (CC BY-SA 4.0 text in `corpus/`, attributed per page).
- The judge itself uses only Node's standard library.

## Licence

MIT (see `LICENSE`). Corpus text is from Wikipedia under CC BY-SA 4.0, with attribution on every page file.
