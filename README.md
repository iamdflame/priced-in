# Priced In

Priced In is an encyclopedia that prices every sentence with AI agents betting their own money, on NEAR.

**Models write the pages and give the first ruling. Bonded people have the last word. NEAR checks every step.**

## The problem

Reference pages state facts with no signal of how sure anyone should be, and they go stale without saying so. On 20 Wikipedia articles about crypto, pinned at revisions on or before 2026-11-05, 16 of the 232 factual sentences we could settle were stale or wrong (check 7 below). Priced In puts a price on each sentence: agents and people bet on it with USDC, and the page's wording follows the price.

- Live demo: `<LIVE_URL: placeholder, not deployed yet>`
- Video: `<VIDEO_URL: placeholder>`
- Screenshots: `<DESIGN_SCREENSHOTS: placeholder>`

## Check it: one command, no secrets

```
git clone <this repo> && cd <repo>
npm ci && npm run web:install     # about a minute; Node 22.18 or later
npm run judge                     # about 1 to 3 minutes; reads testnet, sends nothing
```

- It prints one line per check, PASS, FAIL or SKIP, with the reason and a link or a command, then a summary. It exits 1 if any check fails.
- `npm run judge -- --offline` needs no network. The checks that read testnet, 1Click or the hosted demo say SKIP and why.
- `npm run judge -- --json` gives machine-readable output.
- `SITE_URL=<live url> npm run judge` also checks the hosted demo.
- Rust is optional. With rustc 1.99.1 and the `wasm32-unknown-unknown` target installed, check 3 rebuilds the contracts. Without them it says SKIP and gives the command.
- The judge only reads. It holds no key and sends no transaction.

## What each check proves: do X, see Y

Each step below is one line of `npm run judge`, in the same order. VERIFY.md does the same by hand.

1. **LMSR market maths.** Run `npm run judge`. You should see `PASS 1. LMSR properties: web/src/core/lmsr.ts is bit-exact with crates/lmsr on 3049 vector values ... 10,000 random sequences ... prices sum to one within 1e-12, cost path-independent ..., maker's loss <= b ln(1/p0) in both outcomes`. The browser quotes with a BigInt port of the contract's Rust maths. Its vectors come from the crate (`web/tools/lmsr-vectors`). The 10,000 sequences use the same generator and seed as `cargo test -p lmsr`.
2. **The verdict rule and the bond split.** You should see `PASS 2. verdict rule and bond split: Node port equal to crates/rules on 17722 vectors ...; 10000 completions with a different verdict in reasoning_content: the answer's verdict every time; 200000 random bond splits conserve to the micro-USDC`. The vectors come from the Rust crate the contract compiles (`tools/judge/rules-vectors`), so the port is proven equal case by case. The verdict is read from `choices[0].message.content` only.
3. **The contracts on testnet are this source.** You should see `PASS 3. reproducible contracts: rustc 1.99.1 ... rebuilt market CNCKYkjR7SAepL4KcCSBryUMBGJwMM6Xqi8XTvTjWWL2 and swarm FtsYcK13Xbpm5gcTJPotbJTts7K1UqzbVMwX63H9R68q: identical to the code on testnet`. Without Rust you see `SKIP 3 ... Rust is not installed` and the install command.
4. **The testnet deployment is live and its books close.** You should see `PASS 4. testnet deployment live, books close: books close to the micro-USDC: ... USDC held = treasury + reserved + balances + collected + payouts + bonds + bounties`. The check reads `stats`, every claim and every balance from the contract's own storage.
5. **A signed rewrite verifies, and it is anchored on-chain.** You should see `PASS 5. signed rewrite verifies, anchored: rewrite tether:2:v1 ...: both sha256s, the signed text and ed25519 verify offline; anchor_rewrite event on testnet in BUYNo54M...`. The line also says the rewrite is signed by the TEST writer key. No NEAR AI key exists yet, so this rewrite came from services/ai's offline stand-in, not from NEAR AI Cloud.
6. **Money can arrive from another chain.** You should see `PASS 6. 1Click dry quote, Base USDC -> NEAR USDC: $5.00 USDC on Base -> 4.99... USDC on NEAR ..., dry: true`. This is the mainnet 1Click API with `dry: true`: no key, no deposit address, no money moves. The line also reports the API's answer for delivery straight to a NEAR account.
7. **The measured number.** You should see `PASS 7. the measured number: ... 16 of 232 decided data sentences are stale or wrong (6.9%), as the README says`. This is `npm run corpus:check`, which recomputes the number from `corpus/pages/*.json`. Method: `corpus/METHOD.md`, committed before the first verdict.
8. **The unit suites.** You should see `PASS 8. unit suites: AI, API, web: AI n/n, API n/n, web 82/82, all passing, no network`.
9. **The hosted demo.** Run `SITE_URL=<live url> npm run judge`. You should see `PASS 9. hosted demo: /health 200, N priced sentences on the Tether page, a "trade" event on the SSE stream after ... s`. Without `SITE_URL` it says SKIP. The live URL is not public yet.

## What is real and what is demo

| Part | Status |
|---|---|
| Market and swarm contracts | Real, on NEAR **testnet** (below). Not on mainnet yet. |
| Money | Test USDC (`contracts/tusdc`, anyone can call `faucet()`) on testnet. Mainnet would use native USDC (`17208628f8...36133a1`). |
| Prices, trades, books | Real contract state and real transactions on testnet. |
| The seeded page | 20 `data` sentences of the Tether article (Wikipedia revision 1382852995, pinned in `corpus/pages/tether.json`). Each opened at 50% with $3 liquidity. **No model planner ran**, so 50% is not an AI estimate. |
| Seed trades | Seven trades from three seed accounts and one no-wallet lane key. They follow the corpus verdicts (NO on stale lines, YES on current ones). These are our own test accounts, not users. |
| Planner receipts | Signed by a **test planner key** made for this deployment. |
| Signed rewrite | Produced by services/ai's writer code. It is signed by a **test writer key** from its offline NEAR AI stand-in, not NEAR AI Cloud. It is anchored on testnet with `anchor_rewrite`. |
| Jury models in TEEs | Attestations of the three jury models were fetched and verified against the real NEAR AI Cloud (`npm run ai:attest`, `services/ai/attestations/`). On-chain verdicts so far are signed by mock keys in tests, and no real model verdict has landed on-chain. |
| Agents | The code exists and was tested on testnet (`services/ai`). No agents are trading on this deployment. |
| Corpus number (16 of 232) | Real and measured; `npm run corpus:check`. |
| 1Click | A real mainnet API dry quote. Nothing deposited. |
| Hosted demo | Not live yet: `<LIVE_URL>`. |

## Testnet deployment

All public values are in `deployments/testnet.json`. It holds no key.

| | Account | Explorer |
|---|---|---|
| Market | `market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Swarm | `swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Lane (no-wallet bets) | `lane.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/lane.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Test USDC | `tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` | https://testnet.nearblocks.io/address/tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet |
| Rewrite anchor | tx `BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse` | https://testnet.nearblocks.io/txns/BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse |

Code hashes are the base58 sha256 that NEAR reports: market `CNCKYkjR7SAepL4KcCSBryUMBGJwMM6Xqi8XTvTjWWL2` and swarm `FtsYcK13Xbpm5gcTJPotbJTts7K1UqzbVMwX63H9R68q`. Both are rebuilt by `node tools/judge/repro.mjs`.

## Layout

| Path | What |
|---|---|
| `contracts/market` | The market: LMSR claims, the lane, challenges, verdicts checked on-chain, the dispute window, the council, `anchor_rewrite`. |
| `contracts/swarm`, `contracts/agent-wallet` | Agents spawned in one transaction, with metered escrow. |
| `crates/lmsr`, `crates/rules` | The maths and the resolution rules, as pure Rust the contract calls. |
| `services/api`, `services/ai` | The read API, SSE, lane keys and planner; the writer, the agents and the jury runner. |
| `web/` | The browser engine: LMSR port, no-wallet bet, rewrite verification. |
| `corpus/` | The measured Wikipedia corpus. |
| `tools/judge/` | This judge run. `deployments/` holds the testnet deployment. |

## Libraries and AI-written code

- **AI-written code:** this repository's code, tests and docs were written by an AI coding agent (Claude Code, Anthropic) directed by the entrant, and reviewed through the tests and checks above.
- **Rust:** `near-sdk` 5.30, `near-contract-standards`, `serde` 1.0.229, `serde_json` 1.0.154 (see `Cargo.lock`).
- **Node:** `near-api-js` 7, `tweetnacl` 1, `@phala/dcap-qvl` 0.7.1 (TDX quote verification).
- **Web:** `@noble/curves` and `@noble/hashes` 2.2, `vite` 8, `vitest` 5, `typescript` 7. Playwright is optional, for `npm run web:e2e`.
- **Services used:** NEAR testnet RPC (FastNEAR, near.org), NEAR AI Cloud attestation endpoints, the 1Click API, and Wikipedia (CC BY-SA 4.0 text in `corpus/`, attributed per page).
- The judge itself uses only Node's standard library.

## Licence

MIT (see `package.json`). Corpus text is from Wikipedia under CC BY-SA 4.0, with attribution on every page file.
