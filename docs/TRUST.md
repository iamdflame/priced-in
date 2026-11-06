# What you must trust today

Short and plain. Each item says why, and how to check it.

## 1. The owner key controls the deployment

On testnet one key is the owner of the market and the swarm, the council, the only operator, and a **full-access key on the market, swarm, lane and tusdc accounts**. Every key that exists, read with `view_access_key_list` on 2026-11-05:

| Account | Keys today (testnet) | What each key can do | After `deploy.mjs --lock` |
|---|---|---|---|
| root `pimw3dxfzp.basalt-lane-mw2skhdc.testnet`: owner, council, operator | `ed25519:3FCKSLSy3pb9zMCwoRnphSjFohPHCqcejHe9xgbWynBY`, FullAccess | Every owner method of both contracts (below), every operator method, and anything the root account can do. | Unchanged. The owner key is the governance key; on mainnet it should become a multisig (`COUNCIL_ACCOUNT`, `propose_owner`/`accept_owner`). |
| market `market.pimw3dxfzp...` | the root's key, FullAccess | **Replace the market's code** (`DeployContract`), delete the account, and sign as the market itself, which passes `#[private]` on `on_withdraw` and `on_treasury_withdraw`. | **No keys.** The code can never change, and nobody can sign as the market. |
| swarm `swarm.pimw3dxfzp...` | the root's key, FullAccess | Replace the swarm's code, delete it, sign as the swarm (which the market trusts for `release_agent`). | **No keys.** |
| lane `lane.pimw3dxfzp...` | the root's key, FullAccess (it is also the API's `LANE_PRIVATE_KEY` on testnet), and one judge's function-call key `ed25519:6237Qd...` (market only; `buy`, `sell`, `open_and_buy`, `redeem`, `claim_lane`; NEAR allowance) | FullAccess: add and delete keys (the API adds each judge's key this way), spend the lane's NEAR on gas, replace the lane account's code, delete it. A judge's key: bet and claim winnings as `lane:<that key>` only. | The root's key is gone. One FullAccess key stays, `LANE_ADMIN_PUBLIC_KEY`: the API's own lane key, because only a full-access key can add the judges' keys. It can do what FullAccess does above, on the lane account only; it can't move any other lane identity's credit or winnings, since each is keyed by its own public key. Judges' keys stay. |
| tusdc `tusdc.pimw3dxfzp...` (testnet only) | the root's key, FullAccess | Replace the test token's code. | Not touched (test money). |
| agents `aN.<swarm>` | only the runner's function-call key: market; `buy`, `sell`, `redeem`; 0.25 NEAR | Trade the agent's own balance; nothing can withdraw it except the swarm to the agent's owner. | Unchanged. |

- **Today the code can be replaced.** The code you rebuild with `node tools/judge/repro.mjs` is the code that runs, but the root's full-access key on the market and swarm can deploy different code. `scripts/deploy.mjs <network> --lock` (added 2026-11-05) removes it after deploy and verification, and checks the result: no key on the market or swarm, the API's key alone on the lane. Operators keep working, because they sign from their own accounts with function-call keys there, never as the market. Rehearsed on a throwaway testnet deployment (`node tools/judge/upgrade-rehearsal.mjs --lock`; output in `.apex/streams/harden-result.md`). The persistent testnet deployment is **not locked**, so it can still be upgraded in place. Mainnet: unlocked by default; `--lock` there also needs `CONFIRM_LOCK=yes`, given only when the owner decides. A locked contract can't be upgraded or fixed, ever; the alternative is an owner multisig with a delay, not built.
- **On mainnet** the shape is the same, and it is **not locked**. One key is a full-access key on the market `market.isitpriced.near` and on its owner `isitpriced.near` (read with `view_access_key_list` on 2026-11-06), so it can replace the market's code. That is how the market is upgraded in place.
- Through owner methods alone, the owner can: pause the market for as long as it likes (`pause`; while paused no USDC leaves, its own `withdraw_treasury` included, and nothing settles, `council_settle` included); set the bond, lane budget and dispute table (`set_limits`, `set_resolution`); set the taker fee, up to 300 bps (`set_fee_bps`); register any key as a model's key (`register_model`); set the planner key; name the swarm, once, and only `swarm.<owner>` or `swarm.<the market's parent account>` (`set_swarm`); and propose any account as a house agent (`set_house_agent`). A proposal alone charges nothing: an account becomes chargeable by `charge_inference` only when it accepts with its own key (`accept_house_agent`), and it can leave at any time with its balance intact (`leave_house_agent`).
- **Who can be charged for inference.** A swarm agent, which is a direct sub-account of the swarm, and a house agent that accepted. Nobody else: since v3 the swarm can't be a name like `near`, which would have swept in every `*.near` trader ([THREAT_MODEL.md](THREAT_MODEL.md), threat 11). With the swarm unset, as on mainnet, only house agents can be.
- **The fee.** Every trade pays a taker fee to the treasury: 1% by default, at most 3%, on top of a buy's cost and out of a sale's proceeds. Fees reach the owner through `withdraw_treasury`. They never touch a claim's pot, so what winners are owed doesn't depend on them. `redeem`, deposits and withdrawals pay none. Check the rate with `stats`, and the total taken with `fees_micro`.
- **Those limits hold only for this code.** The 3% cap and the swarm being fixed are rules of the contract, and a full-access key on the market can replace the contract. Until `--lock`, you are trusting the key holder not to, and the code hash on chain (`npm run judge`, check 3) is how you see whether they did.
- These rules are live from the upgrades recorded in each `deployments/<network>.json`, under `upgrades`: the pause and house-agent consent since 2026-11-05, the fee and the swarm rule from v3. A market upgrades in place, with the same state layout, and the code hash recorded is the reproducible build's.

## 2. `register_model` is a trust step

- The contract checks every verdict and rewrite signature against the key registered for that model. It does not check that the key belongs to an attested TEE. The owner registers it after `npm run ai:attest`, and the contract takes the owner's word (`register_model` in `contracts/market/src/lib.rs`).
- Until attestation is checked on-chain, a wrong registration means wrong verdicts can be signed for that model.
- Check what is registered: `get_model`. On testnet today, `z-ai/glm-5.3-flash` has the **test** key `49468af2...512c`, and `Qwen/Qwen3.8-27B` has none (read 2026-11-05). The real attested key for `z-ai/glm-5.3-flash` is `5a0210f2...caff` (`services/ai/attestations/z-ai__glm-5.3-flash.json`). It is not registered.
- With only one model registered, **no jury can reach a quorum on the testnet deployment**.

## 3. Test keys on testnet

- **Planner:** the receipts that opened the 20 Tether claims are signed by a test planner key made for this deployment (`deployments/testnet.json`, `keys.planner`). No model planner ran, so every claim opened at 50% with b = $3. 50% is not an AI estimate.
- **Writer:** the one signed rewrite (`tether:2:v1`) is signed by a throwaway test key from services/ai's offline NEAR AI stand-in (`services/ai/test/mock-nearai.mjs`), not by NEAR AI Cloud. Its anchor on testnet is real (tx `BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse`). The API marks it `"writer_key":"test"`, and judge check 5 says so.

## 4. The council is the owner

`council_settle` calls `assert_owner`. A claim disputed three times is decided by the owner key, which can also void it. The plan is a multisig owner through `propose_owner` and `accept_owner`; that is not done.

## 5. NEAR AI Cloud

- All three jury models and the writer run on one provider. You trust its TEEs and its signing.
- We verified attestations of the three jury models against the real cloud: Intel DCAP `UpToDate`, debug off, key and nonce bound, NVIDIA GPU verdict (`npm run ai:attest`, `services/ai/attestations/`).
- We do not yet allowlist the measured workload, verify the gateway's report, or check the NVIDIA token's signature locally. Instances of a model share one key (`.apex/streams/ai-result.md`, Known limits).

## 6. The services

- The API and the AI layer do not hold user money. They do hold keys: the lane admin key (adds lane keys, pays their gas), the planner key (decides which sentences may open a market), operator keys (anchor rewrites, bill agents) and the x402 relayer key. Their limits are in [THREAT_MODEL.md](THREAT_MODEL.md), threats 4 and 6.
- An agent you spawn is driven by our signer with a runner key that can only `buy`, `sell` and `redeem`. Its USDC can only go back to you. But an operator can bill its escrow and its market balance, and the contract does not check that the bill matches real usage. Each bill's usage record is public at `GET /ai/usage/<hash>`.
- The truth API's matching is lexical. A matched claim is the closest sentence, not a proof that it answers your question.

## What is real and what is demo

| Part | Status |
|---|---|
| Market and swarm contracts | Real, on NEAR testnet. Code rebuilds byte for byte (judge check 3). |
| Mainnet | Live: `market.isitpriced.near`, with real USDC, unlocked. `deployments/mainnet.json` records the build it runs. `scripts/deploy.mjs mainnet` and `tools/judge/upgrade-mainnet.mjs` refuse without `CONFIRM_MAINNET=yes`, and `--lock` there also needs `CONFIRM_LOCK=yes`. |
| Money | Real USDC on mainnet. Test USDC with a public faucet on testnet (`contracts/tusdc`). |
| Prices, trades, books | Real contract state and real transactions on testnet. The books close to the micro (judge check 4). |
| Seed trades | Seven trades, six by our own test accounts and one by a lane key, following the corpus verdicts (`deployments/testnet.json`, `seed.trades`). Not users. |
| Planner receipts | Signed by a test planner key. A live model planner: not live yet. |
| Rewrites | One, signed by a test writer key, anchored on testnet. A real NEAR AI signature: not live yet. |
| Jury | Code tested on testnet with mock models (`services/ai/test/jury-e2e.mjs`, 20 of 20). A real model verdict on-chain: not live yet. |
| Agents | Code tested on testnet (`services/ai/test/crowd-e2e.mjs`). The deployment's swarm has 0 agents. Agents trading: not live yet. |
| Truth API and x402 | The hosted API answers on mainnet: `GET https://isitpriced.com/v1`. Its `credence.payments` says whether payments are on, and `truth_api` reports every settled payment with a link to the newest. One paid call was settled on testnet: tx `9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX`. |
| MCP server | Real. Runs from a clone. Not published on npm. |
| Corpus number, 16 of 232 | Real and measured, `npm run corpus:check`. One annotator; the audit is an upper bound ([THREAT_MODEL.md](THREAT_MODEL.md), corpus). |
| 1Click | A real mainnet API dry quote. Nothing deposited. |
| Hosted site | Not live yet. |
