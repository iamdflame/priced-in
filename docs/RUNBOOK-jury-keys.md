# Runbook: a jury key mismatch

For the founder. What the `jury_keys` check means, and how to fix it in about five minutes.

## What is checked, and when

Each jury model (DeepSeek, Qwen and GLM; GLM is also the page writer) runs on NEAR AI Cloud inside a TEE. The TEE signs every answer with its own key. The market only accepts a verdict when it is signed by the key registered for that model with `register_model`. You can read that key with `get_model` on `market.isitpriced.near`.

The cron (`api/cron.mjs`, step 10) asks NEAR AI Cloud for a fresh attestation of each model. It uses the same verifier the jury uses: a new nonce, the Intel TDX quote, NVIDIA's GPU token and the key binding. Then it compares the key the attestation proves with the key `get_model` returns. It runs:

- once a day, on the first cron run after 00:00 UTC;
- again from 14:00 UTC on sitting days, an hour before the Checker sits at 15:00 UTC (12 and 13 November for the last Wikipedia lines, then daily). News lines go to the jury when they come due, every day, so the daily check covers them too.

The result is `checks.jury_keys` on `GET https://pricedin-fawn.vercel.app/health`. The watchdog (`scripts/watchdog.mjs`, every 10 minutes) fails when its `ok` is `false`, and GitHub then emails you.

## What each status means

| Status | Meaning | Is the jury blocked? |
|---|---|---|
| `match` | The market's key is the key the TEE proves now. | No |
| `mismatch` | NEAR AI Cloud moved the model to a TEE with a new key. The market still holds the old one. | That model is: the contract refuses its verdicts. A ruling needs two matching verdicts out of three. With one model out, the other two must agree. With two out, no ruling can land, and after the jury deadline (an hour) the challenge expires and its bond is returned. |
| `not_registered` | The market has no key for this model. | Yes, for that model. |
| `unverified` | The attestation came back but did not verify (an Intel quote, GPU token or binding failed). | That model is: the jury does not use a model whose attestation fails. |
| `unread` | NEAR AI Cloud or the NEAR RPC did not answer. | Unknown |

A `mismatch` or `not_registered` fails at once. An `unverified` or `unread` model is tried again on the next cron runs, and it fails only when three tries in the same window all end that way. A check that has not run for 26 hours also fails.

## The fix for `mismatch` or `not_registered`

From the main checkout, with `.env` holding `NEAR_DEPLOYER_PRIVATE_KEY`:

```sh
# 1. see what it would do: read only, no key, no transaction
node scripts/mainnet/register-model.mjs --plan

# 2. sign it (one model, or leave the name out to do every model that differs)
CONFIRM_MAINNET=yes node scripts/mainnet/register-model.mjs "Qwen/Qwen3.8-27B"
```

The script attests each model again and refuses if the attestation does not verify or proves more than one key. For each model whose key differs, it signs `register_model` as `isitpriced.near` and keeps the model's current `extras_json`. It reads the write back with `get_model`, records the key and the transaction in `deployments/mainnet.json`, and writes the bundle that proves the key to `services/ai/attestations/`.

The jury can rule as soon as the transaction lands. For a challenge already waiting, the cron's agents job calls the models that have not ruled yet on its next run, as long as the jury deadline has not passed.

3. Keep the judges' check 10 green. It compares the committed bundles with the keys on chain:

```sh
node scripts/attestation/prove.mjs
git add deployments/mainnet.json services/ai/attestations tools/judge/evidence/attestations
```

Commit and push only if the branch is not frozen. After the 14 November freeze, leave `main` alone. The live jury works from step 2. Check 10 then reports the key change, and the transaction in `deployments/mainnet.json` on your branch explains it.

4. Confirm the fix: the next cron run (within 10 minutes) shows `"status": "match"` for every model under `checks.jury_keys.models`. To force the check now, run step 1 again.

## For `unverified` or `unread`

Usually NEAR AI Cloud, Intel's collateral service or NVIDIA's attestation service is briefly down. Run `node scripts/mainnet/register-model.mjs --plan`. If it still refuses after 30 minutes, that model cannot rule until NEAR AI Cloud fixes it. The other two can still reach a ruling if they agree. Do not register a key from an attestation that does not verify.
