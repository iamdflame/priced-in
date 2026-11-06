# Architecture

Every claim below points to a file, a test or a transaction. "Not live yet" means the code exists but nothing public runs it today.

## On one page

Priced In has four parts.

1. **Contracts on NEAR.** `contracts/market` holds the money, the prices and the rulings. `contracts/swarm` creates agent accounts. `contracts/agent-wallet` is the code on each agent account. `contracts/tusdc` is test USDC. They run on NEAR **testnet** (`deployments/testnet.json`). Mainnet is not live yet.
2. **Services in Node.** `services/api` is the read API, the event stream, the no-wallet lane, the paste planner and the truth API. `services/ai` mounts on it and adds the writer, the agents, billing, the jury runner and a separate signer process. `npm run api` runs the first. `npm run ai` runs both in one process (`services/ai/src/server.js`).
3. **The web engine.** `web/src/core` is the browser code: a BigInt port of the market maths, the no-wallet bet, the event stream and rewrite verification. `web/src/ui` is the site on top of it. The hosted site is not live yet.
4. **The corpus.** `corpus/` holds 20 Wikipedia articles at pinned revisions and the measured number: 16 of 232 decided `data` sentences are stale or wrong (`npm run corpus:check`, `corpus/METHOD.md`).

Outside agents reach it through `tools/mcp` (`pricedin-mcp`) and `GET /v1/credence`.

```
                 people                                   other agents
   browser: web/ (lane key in localStorage)      MCP client -> tools/mcp (caller's own NEAR key)
        |  POST /lane/key, GET /claims,                 |  GET /v1/credence, /v1/quote
        |  GET /events (SSE), POST /paste               |  x402 payment signed by the caller
        v                                               v
  +---------------------------- services/api (node:http, port 8787) -----------------------------+
  |  lane.mjs      adds a function-call key to lane.<root>        (lane admin key)                |
  |  planner.mjs   labels pasted sentences, signs open receipts   (planner key; model: NEAR AI)   |
  |  events.mjs    scans blocks, parses EVENT_JSON, ring buffer -> SSE                            |
  |  credence.mjs + match.mjs + x402.mjs   truth API and our x402 facilitator (relayer key)       |
  |  posts.mjs     reads public X posts through oEmbed                                            |
  |  + services/ai (mount.js), same process:                                                      |
  |     writer.js  -> NEAR AI Cloud (TEE) -> signed rewrite -> /rewrites -> anchor via signer     |
  |     agents.js  -> research.js + NEAR AI -> decision object --IPC--> signer.js                 |
  |     billing.js -> usage hash --IPC--> signer.js -> sweep_escrow or charge_inference           |
  |     jury.js    -> canonical_request -> NEAR AI -> submit_verdict      (jury account key)      |
  |     signer.js  separate OS process: the only one that opens agent and operator keys           |
  +-----------------------------------------------|-----------------------------------------------+
                                                  | JSON-RPC with failover (FastNEAR, near.org, intea.rs)
                                                  v
  NEAR testnet:  market.<root>  <---- release_agent ----  swarm.<root>  ----creates---->  aN.swarm.<root>
                 ledger, LMSR, rulings, events            agent registry, NEAR escrow    agent-wallet code,
                 tusdc.<root>: NEP-141, faucet            lane.<root>: pooled FC keys    runner FC key only
```

Read it top to bottom: a person or an agent signs with its own key; the services read the chain, call the models and relay; only the contracts hold money and decide.

## The contracts

### Market (`contracts/market/src/lib.rs`)

- **Ledger.** USDC arrives by `ft_transfer_call` (handled in `ft_on_transfer`) and sits in internal balances. It leaves by `withdraw` (traders), `withdraw_treasury` (owner) or `release_agent` (swarm agents, through the swarm). `stats` returns every bucket. The books always satisfy `held = treasury + reserved + balances + collected + payouts + bonds + bounties`. Check: `npm run judge`, check 4, which reads every balance from contract storage.
- **Markets.** One binary LMSR market per sentence. The maths is `crates/lmsr`, pure Rust with no dependencies. Claims open by `open_claim` (operators) or `open_and_buy` (anyone holding a planner-signed receipt). The exact rules are in [SPEC.md](SPEC.md).
- **Rulings.** `challenge`, `submit_verdict`, `dispute`, `finalize`, `council_settle`, `expire_challenge`. The verdict reading, bond split and dispute table are pure functions in `crates/rules`, which the contract calls. Check: `cargo test -p rules --release`, and judge check 2 (17,722 vectors made by the crate).
- **Provenance.** `anchor_rewrite` verifies a writer model's signature and logs the record. It stores only a counter.
- **Events.** Every change is an `EVENT_JSON` log, standard `pricedin`, version `2.1.0` (the `log` helper).

### Swarm (`contracts/swarm/src/lib.rs`) and agent wallet (`contracts/agent-wallet/src/lib.rs`)

- `spawn_agent` (payable, at least 5 NEAR) creates `aN.<swarm>` in one transaction. It funds the account with 0.26 NEAR, deploys the 1.2 KB agent wallet and adds one key: the runner's function-call key on the market for `buy`, `sell` and `redeem`, with a 0.25 NEAR allowance. The rest of the deposit is inference escrow, held by the swarm.
- The agent account has no full-access key. Its USDC leaves only by `release_bankroll` or `close_agent`, which call the market's `release_agent`, and always to the owner on record.
- The agent wallet has one method, `close`, callable only by the parent account (the swarm). `delete_agent` uses it to return the account's NEAR to the owner.
- Check: `contracts/market/test/lifecycle.mjs`, checks "the agent's only key is the runner's, limited to the market's buy, sell and redeem, 0.25 NEAR" and "delete_agent deletes the agent account and returns its NEAR to the owner" (141 of 141 on testnet, output in `.apex/streams/contracts-result.md`).

### Test USDC (`contracts/tusdc/src/lib.rs`)

A NEP-141 token with 6 decimals. `faucet()` gives anyone 10 tUSDC. `register(account_id)` registers storage for free. Testnet only. Mainnet would use native USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (`MAINNET_USDC` in `services/api/src/config.mjs`).

## The services

### services/api

| File | What it does |
|---|---|
| `src/app.mjs` | HTTP routes, limits and health. Every route is in [API.md](API.md). |
| `src/rpc.mjs` | NEAR JSON-RPC with failover across URLs and back-off on rate limits. |
| `src/events.mjs` | The scanner. It follows the head every 400 ms, keeps transactions that reach the market, reads `EXPERIMENTAL_tx_status` and publishes the market's `EVENT_JSON` logs into a ring buffer of 200 that feeds SSE. |
| `src/lane.mjs` | Adds a visitor's ed25519 key to the lane account as a function-call key on the market for `buy, sell, open_and_buy, redeem, claim_lane`, 0.25 NEAR allowance. Up to 10 keys per transaction. |
| `src/sentences.mjs`, `src/planner.mjs` | Splits pasted text. With a planner key and a NEAR AI key, one model call labels each sentence and the service signs `open:<page>:<sha256 hex>:<kind>:<p0_ppm>:<b_micro>` (`receiptMessage`). Opening probabilities are clamped to 0.2..0.8 (`P_MIN`, `P_MAX`). |
| `src/posts.mjs` | Reads public X posts through `publish.x.com/oembed`. The HTML is untrusted data. |
| `src/match.mjs`, `src/credence.mjs` | The truth API: lexical matching of a question to claims, then the answer with price, open interest, cost to move, rationales, resolution and provenance. |
| `src/x402.mjs` | x402 v2, NEAR `exact` scheme: verify, answer, then settle. Our facilitator runs in-process with `@fastnear/x402/facilitator`. |
| `src/meter.mjs` | What the truth API counts: free calls, the relayer's turn, settled payments. In memory here; `api/_lib/meter.mjs` is the same shape over the store. |
| `src/config.mjs` | Every setting from env. Testnet unless `NEAR_NETWORK=mainnet`. Accounts and RPCs of the other network are refused at start. |

### services/ai

| File | What it does |
|---|---|
| `src/nearai.js` | NEAR AI Cloud client. Sends exact request bytes, keeps exact response bytes, fetches the `provider_tee` signature, and attests each model with a fresh nonce (Intel DCAP through `@phala/dcap-qvl`, NVIDIA NRAS). A reply is `signed` only if the signature verifies over our bytes and the signer matches a verified attestation. |
| `src/writer.js` | On a trade, rewrites the paragraph that holds the sentence, by price band: assert at 0.85 and above, disputed from 0.45 to 0.55, hedge, negate below 0.40 (`band`). Status goes template, unsigned, signed. Signed rewrites are anchored with `anchor_rewrite` through the signer (`Writer.anchor`). |
| `src/agents.js`, `src/research.js`, `src/personas.js` | The crowd. Each agent researches a claim and forms a signed credence without seeing the price. A deterministic policy (`decide`) then buys, sells, agrees or posts `no_bet`. The edge must beat 2 points; quarter Kelly; $2 cap; $5 daily loss limit (`DEFAULT_POLICY`). No verified signature, no bet. |
| `src/signer.js` | A separate OS process, the only one that opens keys that move money. It refuses any key that is not a function-call key limited to the allowed methods (`checkPermission`), re-checks the caps ($2 per bet, `HARD_MAX_BET_MICRO`) and journals every intent before broadcast, so a restart never sends one twice. |
| `src/billing.js`, `src/ledger.js` | Meters each model call at the live `/v1/models` price, hashes the usage record and bills it on-chain by `sweep_escrow` (route `escrow`) or `charge_inference` (route `balance`). The record is served at `GET /ai/usage/<hash>`. |
| `src/jury.js` | For a challenge: attest, read `canonical_request` from the contract, send those bytes to each model, verify the signature locally, then call `submit_verdict`. |
| `src/mount.js` | Attaches all of the above to the API and adds the routes in [API.md](API.md). State lives in `DATA_DIR` as append-only journals. |

**Not live yet:** no `NEARAI_API_KEY` exists. Without it the writer makes template rewrites only, the planner says `unavailable`, and the agents and the jury are off. See the real `GET /health` output in [API.md](API.md). No real model has signed a verdict or a rewrite that reached the chain.

## The web engine (`web/src/core`)

| Module | What it does |
|---|---|
| `lmsr.ts` | BigInt port of `crates/lmsr`, bit-exact on 3,049 vector values generated by the crate (judge check 1, `web/test/lmsr.test.ts`). |
| `lane.ts` | Makes the ed25519 key in the browser, calls `POST /lane/key` at page load, and signs lane calls with near-api-js, one at a time per key. |
| `rpc.ts` | Sends a transaction to two RPCs and polls both. |
| `api.ts` | Typed client for every API route, with designed failure states and a reconnecting SSE reader. |
| `verify.ts` | `verifyRewrite`: exact bytes, both sha256s, the signed text, ed25519, the key registered on the market (`get_model`), the words on the page, and the `rewrite` log in the anchor transaction. |
| `store.ts`, `router.ts`, `config.ts` | Page state, the doubt state machine, routes and network guards. |

`web/src/ui` is the site built on the engine. The hosted site is not live yet. `npm run web:dev` runs it locally.

## The truth API and MCP

- `GET /v1/credence?q=` matches a question to claims (`match.mjs`, lexical, no embeddings) and answers with the on-chain price and its provenance (`credence.mjs`).
- Each address gets 20 free calls a day (`CREDENCE_FREE_PER_IP_PER_DAY`). After that a call costs $0.01 by x402. `npm run truth:smoke` paid once on testnet: tx `9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX` (`.apex/streams/truthapi-result.md`).
- On the hosted API, the free tier, the relayer's turn and the payment record all go through the store (`api/_lib/meter.mjs`), so they hold across function instances. USDC lands at `isitpriced.near`, which holds no hot key; the relayer `x402.isitpriced.near` holds only gas money (`scripts/mainnet/x402.mjs`).
- `tools/mcp` serves `ask`, `get_claim`, `quote` and `bet` over stdio and streamable HTTP. `bet` signs with the caller's own key and is refused without one. One live MCP bet on testnet: tx `G3h31QRytntLETdcYSsxMUkeYCroJQsFFzDqf8fFWLEz`.
- The hosted API is live at `https://isitpriced.com/v1`. `docs/API.md` has its paths, pricing and the mainnet smoke test.

## The corpus (`corpus/`)

- `METHOD.md` was committed before any page was fetched (commit `fee531c`).
- `pages/<slug>.json` holds the pinned revision, every sentence, its class and its verdict.
- `scripts/check.mjs` (`npm run corpus:check`) recomputes 16 of 232 (6.9%) from the page files. Judge check 7 runs it.
- The seeded testnet page is `corpus/pages/tether.json`, revision 1382852995.

## What runs where

| Part | Where it runs today |
|---|---|
| market, swarm, lane, tusdc | NEAR testnet, accounts in `deployments/testnet.json`. Mainnet: market and lane live with real USDC, accounts in `deployments/mainnet.json` (no swarm on mainnet). |
| services/api and services/ai | Hosted on Vercel functions (`api/`) at `https://isitpriced.com`, on mainnet. Locally: `npm run api` or `npm run ai`. |
| signer | A child process of services/ai (`signer.js` forks itself). |
| Models | NEAR AI Cloud, in TEEs. The three jury models' attestations were verified with `npm run ai:attest` (`services/ai/attestations/`). Completions: not live yet, no key. |
| web | Your browser through `npm run web:dev`. Hosted: not live yet. |
| judge | Your machine, `npm run judge`. It holds no key and sends nothing. |
| MCP server | Your machine, `npx -y ./tools/mcp`. |

## Who holds which key

| Key | Held by | Can do | Where to check |
|---|---|---|---|
| Owner (root) key, testnet | The deployer. Private half in the git-ignored `.apex-test/judge-testnet.json`. | Every owner method. It is also the **full-access key on the market, swarm, lane and tusdc accounts**, so it can deploy new code to them. `scripts/deploy.mjs --lock` removes it from the market, swarm and lane (rehearsed on a throwaway testnet deployment); the persistent testnet deployment is not locked, so it can be upgraded in place. | `view_access_key_list` on `market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` returned one key, `ed25519:3FCKSLSy3pb9zMCwoRnphSjFohPHCqcejHe9xgbWynBY`, `FullAccess` (read 2026-11-05). See [TRUST.md](TRUST.md). |
| Council | The owner: `council_settle` calls `assert_owner`. A multisig is planned, not live. | Rule on escalated claims. | `council_settle` |
| Operators | Accounts the owner lists with `set_operator`. On testnet, only the owner. | `open_claim`, `anchor_rewrite`, `charge_inference` (market); `sweep_escrow` (swarm). | `is_operator` in both contracts |
| Planner key | services/api env `PLANNER_PRIVATE_KEY`. On testnet a test key; public half `8003b937...73c0` in `deployments/testnet.json`. | Sign open and reopen receipts. | `check_planner` |
| Lane admin key | services/api env `LANE_PRIVATE_KEY`, a full-access key on the lane account. | Add lane keys. | `services/api/src/lane.mjs` |
| Lane visitor keys | The visitor's browser (localStorage). | `buy, sell, open_and_buy, redeem, claim_lane` on the market, with 0.25 NEAR of gas. | The NEAR access key itself. `trader()` names the visitor `lane:<public key>`. |
| Runner keys | The signer's keystore (`KEYSTORE_DIR`). | `buy, sell, redeem` for one agent. | Added by `spawn_agent`; `checkPermission` in `signer.js` |
| Operator function-call keys | The signer's keystore (`operator-market.json`, `operator-swarm.json`). | `anchor_rewrite`, `charge_inference`, `sweep_escrow` only. | `OPERATOR_METHODS` in `signer.js` |
| Jury runner key | services/ai env `JURY_PRIVATE_KEY`. Any account works: `submit_verdict` is open to anyone. | Relay signed verdicts. It cannot forge one. | `submit_verdict` verifies the model's signature |
| x402 relayer key | services/api env `X402_RELAYER_PRIVATE_KEY`, on its own account `x402.isitpriced.near`. It must be full-access, because NEAR takes a delegate action from no other kind, so that account holds only gas money. | Pay gas to settle payments to us. The facilitator routes refuse other payees (`sameRequirements`), and the hosted API turns them off. | `/x402/*` in `services/api/src/app.mjs` |
| Model signing keys | NEAR AI Cloud, inside the TEE. We never hold them. | Sign completions. | Public halves registered with `register_model`, a trust step ([TRUST.md](TRUST.md)) |
| Writer key on testnet | Nobody. It was a throwaway key made in memory by `services/ai/test/mock-nearai.mjs` (`nacl.sign.keyPair()`), and `tools/judge/seed.mjs` never writes its private half to disk. | Its public half is registered for `z-ai/glm-5.3-flash`. | `get_model` returns `49468af2...512c` |
| Caller keys | The MCP user (`NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY`). | Their own bets and payments. | `tools/mcp/src/near.mjs` |

## On-chain and off-chain

| On-chain (contract state or the event log) | Off-chain |
|---|---|
| Claim text, page slug, kind, `b`, `d0`, `q_yes`, `q_no`, status, outcome | Paragraph structure and page layout (`corpus/pages/*.json`, `PAGES_FILE`) |
| Every balance, position, bond, bounty and bucket total | Rewrite text and the full request and response bytes (`rewrites.jsonl`, `GET /rewrites`). Only the hashes and the signature go on-chain, in the `rewrite` event. |
| Challenges, evidence, verdicts (model, outcome, request and response hashes) | Agents' rationales and sources (`rationales.jsonl`, `GET /rationales`) |
| The model registry (key and request extras) and the planner's public key | Attestation bundles (`services/ai/attestations/`) |
| Rewrite anchors (an event and a counter) | Inference usage records (`GET /ai/usage/<hash>`). Only the hash goes on-chain. |
| Agents, owners, persona hashes, NEAR escrow | Lane rate limits, free-tier counters, the SSE ring and the post cache, in memory |
