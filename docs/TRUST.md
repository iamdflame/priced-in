# What you must trust today

Short and plain: what is live on NEAR mainnet, who can change it, and how to check each point yourself. Read on 13 November 2026.

## What is live

| Part | Status on mainnet | Check it |
|---|---|---|
| Hosted site | Live at https://isitpriced.com | `/health` (`network: mainnet`) |
| Market | `market.isitpriced.near`, real USDC (`17208628…6133a1`, 6 decimals). The books close to the micro-USDC. | `npm run judge`, check 11 |
| Code | The deployed code hash is the reproducible build's, rebuilt byte for byte on Ubuntu, macOS and Windows. | `node tools/judge/repro.mjs`, check 3 |
| Jury | Three models on NEAR AI Cloud (DeepSeek-V4.1-Flash-1017, Qwen3.8-27B, glm-5.3-flash). 12 rulings, all settled: 11 false, 1 true; 36 signed verdicts, each checked by the contract against the model's registered key. No ruling has been disputed. | https://isitpriced.com/api/rulings, check 11 |
| Rewrites | Signed inside NEAR AI Cloud's TEE and anchored on mainnet: 16 signed and 16 anchored on the Tether page. | https://isitpriced.com/api/pages/tether (`totals`), check 11 |
| Planner | A live model (DeepSeek-V4.1-Flash-1017) signs the receipt that opens each market. | `/health`, `checks.planner` |
| AI traders | Three house traders (`h-archivist`, `h-skeptic`, `h-quant`.isitpriced.near) bet real USDC from accounts we funded. They are ours, not users. | `/api/agents` |
| Free $1 | `lane.isitpriced.near` pays one $1 bet per browser. Its winnings are score, not cash. | `/api/lane/status` |
| Truth API and x402 | Live at `https://isitpriced.com/v1`. One paid call so far: $0.01 on 6 November, tx `7qgd43o63QRTUEP9ache8qT717WZ2Fuz9kFzD61A9njD`. | `GET /v1` |
| MCP server | Published on npm as `pricedin-mcp`. | `npm view pricedin-mcp` |
| Swarm (agents spawned with escrow) | Testnet only. | `deployments/testnet.json` |

Outside users: none confirmed by 13 November. Every mainnet bet so far is ours: the house traders, our Checker and our own tests of the free $1.

## 1. The owner can replace the market's code

- `market.isitpriced.near` has one key, a full-access key that the owner `isitpriced.near` also holds (`view_access_key_list`, read on 13 November). That key can deploy different code to the market. It is how the market has been upgraded in place, with the same state layout; each upgrade is recorded under `upgrades` in `deployments/mainnet.json`.
- The market is **not locked**. `scripts/deploy.mjs mainnet --lock` would remove the key, but a locked contract can never be fixed. The better shape is upgrades through a delay that anyone can watch. It is not built.
- How to see whether the code changed: compare the code hash on chain with the reproducible build (check 3).
- Through owner methods, the owner can also pause the market (while paused no USDC leaves and nothing settles), set the bond, lane budget and dispute table, set the taker fee up to 3%, set the planner key, propose house agents (an account is only chargeable after it accepts with its own key), and register model keys (section 2).

## 2. The owner registers the judges' keys

- The contract checks every verdict and rewrite signature against the key registered for that model (`register_model`). It does **not** check, on chain, that the key comes from an attested TEE. The owner registers the key after verifying the attestation off chain.
- What you can check: judge check 10 verifies each model's Intel TDX quote and NVIDIA GPU token offline, binds the signing key to our nonce, and confirms that the key is the one `get_model` returns on mainnet. The keeper repeats the comparison every day at 00:00 UTC (`/health`, `checks.jury_keys`). After NEAR AI Cloud's security incident and restore on 10 November, all three keys still matched.
- Until the attestation is bound on chain, "the contract checked the signature" means "the contract checked the key the owner registered, which you can verify against the attestation".

## 3. A claim disputed three times goes to the owner

- Anyone can object to a provisional ruling by posting twice the bond; that flips the proposed outcome and restarts the window. The third objection escalates the claim, and `council_settle` calls `assert_owner`: the owner decides it or voids it (every bond back, the claim reopens).
- No mainnet ruling has been disputed yet, so this has never been used.
- The plan is to take the owner out of this path: a third objection would void the challenge and leave the sentence marked unsettled. Voiding refunds every bond, so it needs a cost to object that doesn't go to the owner. It is not built.

## 4. One TEE provider

- All three jury models, the writer and the planner run on NEAR AI Cloud. You trust its TEEs and its signing. Three models on one provider are independent models, not independent operators.
- NEAR AI paused inference on 9 November after an SGLang vulnerability gave an attacker code execution on one inference server; it restored service on 10 November. One compromised model can't settle a claim here: a ruling needs two matching signed verdicts, and anyone can object for 10 minutes.
- We do not yet allowlist the measured workload or verify the gateway's report. Instances of a model share one key.

## 5. How often the judges are wrong

- On 232 facts checked by hand, the judges ruled on 142 and were right on 136. They declined 90; a declined challenge refunds the bond. The six wrong rulings are listed at https://isitpriced.com/accuracy.
- Accusations and "rule this way" orders fooled them 0 times in 10. A made-up receipt fooled them 9 times in 10, so receipts are now fetched from the source before the judges read them, and the Sentinel disputes a challenge whose receipt doesn't match (52 of 53 lies disputed, 0 of 21 honest challenges).

## 6. The services

- The API and the AI layer hold no user money. They hold keys: the lane admin key (adds free-bet keys and pays their gas), the planner key, operator keys (anchor rewrites, bill house traders' inference), the Checker's and the Sentinel's keys, and the x402 relayer key. Their limits are in [THREAT_MODEL.md](THREAT_MODEL.md), threats 4 and 6.
- The keeper holds rulings to a schedule (`api/_lib/keeper.mjs`). It decides when a challenge is filed, not what the judges say.
- The truth API's matching is lexical: a matched claim is the closest sentence, not proof that it answers your question.

## Testnet

The testnet deployment (`market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet`) is where the swarm runs and where upgrades are rehearsed. Its owner key is also a full-access key on the market, swarm, lane and test-token accounts, and some of its early receipts and one rewrite were signed by test keys (`deployments/testnet.json`). Judge checks 4 and 5 read it.
