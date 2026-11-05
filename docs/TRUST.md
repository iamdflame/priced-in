# What you must trust today

Short and plain. Each item says why, and how to check it.

## 1. The owner key controls the deployment

- On testnet one key is the owner of the market and the swarm, the council, the only operator, and the **full-access key on the market, swarm, lane and tusdc accounts**. Check: `view_access_key_list` on `market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet` returns one `FullAccess` key, `ed25519:3FCKSLSy3pb9zMCwoRnphSjFohPHCqcejHe9xgbWynBY`, the same key as the root account (read 2026-11-05).
- A full-access key can deploy different code to the market. So today the code you rebuild with `node tools/judge/repro.mjs` is the code that runs, but nothing on-chain stops it from being replaced. `scripts/deploy.mjs` never removes that key. Removing it (or moving it to a multisig with a delay) is not done yet.
- Through owner methods alone, the owner can: pause trading and withdrawals for as long as it likes (`pause`), while `withdraw_treasury` and `council_settle` keep working; set the bond, lane budget and dispute table (`set_limits`, `set_resolution`); register any key as a model's key (`register_model`); set the planner key; and list any account as a house agent (`set_house_agent`), which lets an operator charge that account's balance to the treasury (`charge_inference`).

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
| Mainnet | Not live yet. `scripts/deploy.mjs mainnet` refuses without `CONFIRM_MAINNET=yes`. |
| Money | Test USDC with a public faucet (`contracts/tusdc`). |
| Prices, trades, books | Real contract state and real transactions on testnet. The books close to the micro (judge check 4). |
| Seed trades | Seven trades, six by our own test accounts and one by a lane key, following the corpus verdicts (`deployments/testnet.json`, `seed.trades`). Not users. |
| Planner receipts | Signed by a test planner key. A live model planner: not live yet. |
| Rewrites | One, signed by a test writer key, anchored on testnet. A real NEAR AI signature: not live yet. |
| Jury | Code tested on testnet with mock models (`services/ai/test/jury-e2e.mjs`, 20 of 20). A real model verdict on-chain: not live yet. |
| Agents | Code tested on testnet (`services/ai/test/crowd-e2e.mjs`). The deployment's swarm has 0 agents. Agents trading: not live yet. |
| Truth API and x402 | Real on testnet when run locally: one paid call, tx `9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX`. A hosted API: not live yet. |
| MCP server | Real. Runs from a clone. Not published on npm. |
| Corpus number, 16 of 232 | Real and measured, `npm run corpus:check`. One annotator; the audit is an upper bound ([THREAT_MODEL.md](THREAT_MODEL.md), corpus). |
| 1Click | A real mainnet API dry quote. Nothing deposited. |
| Hosted site | Not live yet. |
