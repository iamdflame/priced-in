# AGENTS.md: screening Priced In

Priced In is a prediction market for facts: each checkable sentence of an encyclopedia page is a Yes/No market in real USDC, three attested AI models rule on challenges on-chain, and the corrected line opens as a new market.
Live at https://isitpriced.com on NEAR mainnet. Contract `market.isitpriced.near` (code hash `FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC`), native USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`.

Facts only. Every number below comes from a command run or a file read on 9 November 2026 at commit f83eddc, on Windows 11, Node 24.19.0.

## Verify in about a minute

```
npm ci                  # 27 s measured; Node 22.18 or later
npm run judge:quick     # 25 to 28 s measured: 11 checks, no Rust, no unit suites, the hosted site included
```

Expected last line (measured, 9 November 2026):

```
11 checks: 9 PASS, 0 FAIL, 2 SKIP in 0m25s · testnet market market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet · mainnet market market.isitpriced.near · commit f83eddc
```

The two SKIPs in quick mode are by design: check 3 (`--quick` implies `--no-build`, so the contracts are not rebuilt) and check 8 (`--quick` does not run the unit suites). Check 11, the mainnet rulings, runs in quick mode. An RPC that times out makes a chain check SKIP with its reason, never PASS (one of three quick runs here hit `UND_ERR_CONNECT_TIMEOUT` on check 11 and took 1m15s); run it again.

Then everything:

```
npm run judge:full      # npm ci, the site's npm ci, then all 11 checks against https://isitpriced.com, as JSON
```

- Duration: 4m25s for the whole command on this machine, of which the judge took 2m58s and the two installs the rest. The judge alone (`npm run judge -- --site=https://isitpriced.com`) took 1m59s on a second run.
- Needs: network (testnet and mainnet RPC, the 1Click API, isitpriced.com, crates.io for the build) and, for check 3, rustc 1.99.1 with the `wasm32-unknown-unknown` target (`rustup toolchain install 1.99.1 --target wasm32-unknown-unknown`). Without Rust, check 3 says SKIP with the fix; nothing else needs it.
- Expected: 11 PASS, 0 FAIL, 0 SKIP. Measured on Windows: `11 checks: 11 PASS, 0 FAIL, 0 SKIP in 1m59s` (the judge alone). The first `judge:full` run hit a DNS failure on this machine (check 9 FAIL "fetch failed", check 10 SKIP "ENOTFOUND"); every other check passed, check 3 included, and the rerun passed all 11.
- On a clean machine: GitHub Actions runs all 11 checks on Ubuntu with Node 22 for every push to main (`.github/workflows/judge.yml`, report on each run's summary page and as the `judge-report` artifact). Measured 9 November 2026: `11 checks: 11 PASS, 0 FAIL, 0 SKIP in 101.5 s` ([run 42652794818](https://github.com/iamdflame/priced-in/actions/runs/42652794818)).
- Check 3 per platform: clean `ubuntu-latest`, `macos-latest` and `windows-latest` runners rebuild both deployed hashes byte for byte with `node tools/judge/repro.mjs` (`.github/workflows/repro.yml`, branch `ci/repro`): [run 42542226417](https://github.com/iamdflame/priced-in/actions/runs/42542226417) and [run 42542566537](https://github.com/iamdflame/priced-in/actions/runs/42542566537), all three jobs green in both.
- `npm run judge -- --offline` needs no network: checks that read a chain, 1Click or the site say SKIP; check 11 still verifies the recorded verdict bytes and signatures.
- Exit code 1 if any check FAILs. `--json` prints `{checks, summary}`.

## The 11 checks

Code: `tools/judge/judge.mjs` and `tools/judge/checks/*.mjs`. "Chain" is what the check reads.

| # | What it proves | Needs | Chain |
|---|---|---|---|
| 1 | The browser's LMSR (`site/lib/core/lmsr.ts`) is bit-exact with `crates/lmsr` on 3959 vector values, and holds the market's properties over 10,000 random sequences | nothing | none |
| 2 | The verdict rule and bond split (Node port) equal `crates/rules` on 17722 vectors; `reasoning_content` never counts; 200,000 splits conserve to the micro-USDC | nothing | none |
| 3 | rustc 1.99.1 rebuilds market and swarm byte-identical to the code on testnet, and the market to the code on mainnet | Rust 1.99.1 + wasm target, network | testnet (market, swarm) and mainnet (market) |
| 4 | The testnet market's books close to the micro-USDC at one pinned block | network | testnet |
| 5 | A recorded NEAR AI Cloud rewrite verifies offline (sha256s, ed25519) and its `anchor_rewrite` event is on chain | network for the anchor | testnet |
| 6 | A dry 1Click quote: $5 USDC on Base to USDC on NEAR. No key, no deposit, no money moves | network | none (1Click's mainnet API) |
| 7 | `npm run corpus:check` recomputes 16 of 232 stale or wrong sentences from `corpus/pages/*.json` | nothing | none |
| 8 | The AI, API and site unit suites pass | `npm ci` and the site's install | none |
| 9 | The hosted site: `/health` 200, priced sentences on the Tether page, an event on the SSE stream | network | none directly (the site serves mainnet) |
| 10 | Each jury model's TDX and GPU attestation verifies offline, and its key is the one the mainnet market holds (`get_model`) | `npm ci`, network for `get_model` | mainnet |
| 11 | Mainnet's books close, and every challenge's three verdicts verify from the chain: request hash = sha256(`canonical_request`), response and signature from the `submit_verdict` transaction, ed25519 against `get_model`'s key; each settled outcome is the one the verdicts and disputes give; one mainnet rewrite verifies | network | mainnet |

The open swarm (`contracts/swarm`) is testnet only. Check 11 on 9 November: 8 of 8 challenges settled, 24 verdicts by 3 models, all verified.

## Claims and how to check each

| Claim (README first screen) | Check it with | Transaction or evidence | Check |
|---|---|---|---|
| 8 rulings settled on mainnet, winners paid | https://isitpriced.com/api/rulings (`count`, `status`, `payout_usd`, `challenger_result`) | 4 of 8 paid bettors, $6.98 in all (first settlement `3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v`, $4.93 to No); in the other 4 nobody held the winning side, so `payout_usd` is 0. The Checker won its $1 bond back all 8 times | 11 |
| Three TEE-signed verdicts per ruling, checked by the contract | `npm run judge:quick` | `tools/judge/evidence/mainnet-rulings.json` (24 verdicts); e.g. `6HWB2Esndp73tCtrzvCD99kfBEwnrmR6YTdtfUZUa2dz`; `tools/judge/evidence/attestations/` | 11, 10 |
| Pages rewritten from the odds, signed in a TEE, anchored on NEAR | https://isitpriced.com/api/pages/tether (`totals`: 16 signed, 16 anchored) | `tools/judge/evidence/rewrite-mainnet.json`, anchor `ALdDyEDxHKFpTGG5koipfV8JsizymsirejGzHkA5FVAQ` | 11 (mainnet), 5 (testnet) |
| The Tether T-Bills line ($72.6 billion) ruled FALSE, corrected to $122.84 billion | https://isitpriced.com/p/tether, `corrections[0]` in its API | corrected line opened as claim 32: `8dZz4DmaMGYk3PtriToVePCfxp7as63ZohYB7U6A8eyW` | 11 (challenge 0) |
| Anyone can object within 10 minutes | `get_resolution` on `market.isitpriced.near` (`dispute_tiers` [50000000, 600]); `dispute` in `contracts/market/src/lib.rs` | no objection yet on mainnet (`disputes: []` on all 8); the flip, window and council path runs in the testnet lifecycle test | 11 reads disputes into each outcome; 2 (bond split) |
| Your first $1 is free, no wallet | https://isitpriced.com/api/lane/status | first free bet `8ZyUb7UFj2ZknBpKrYHcuy1vhEBgGXDYpLdkgk4Z7Nnw`; `lane.isitpriced.near` | none directly |
| The contracts rebuild byte-identical | `node tools/judge/repro.mjs` (rustc 1.99.1) | CI runs 42542226417 and 42542566537 | 3 |
| 16 of 232 Wikipedia data sentences stale or wrong | `npm run corpus:check` | `corpus/ERRORS.json`, `corpus/pages/*.json` | 7 |
| Asking an AI: web search found 7 of 10, no-web models repeated 47 of 90 | read the files | `deployments/ask-an-ai-web.json`, `deployments/ask-an-ai.json` | none |
| Change `x.com` to `isitpriced.com` | https://isitpriced.com/ilblackdragon/status/2118027843980366222 (200) | none (read-only page) | none |

## Illia's post (x.com/ilblackdragon/status/2118027843980366222), mapped: three of its four ideas; private trading is not ours

| His idea | Here | Status (9 November 2026) |
|---|---|---|
| AI encyclopedia, "every fact becomes a perpetual truth-seeking market" | https://isitpriced.com; `contracts/market`, `api/_lib/keeper.mjs` | Mainnet: 49 lines, 8 settled |
| "official pages are generated by AI based on the current market understanding" | https://isitpriced.com/p/tether; `services/ai/src/writer.js`, `api/_lib/pages.mjs` | Mainnet: 16 signed, anchored rewrites on Tether |
| "Universal checkout widget ... paying with Intents" | deposit sheet at /portfolio; `site/app/bridge/`, `site/lib/money/oneclick.ts` | Partial: 13 1Click routes into our own app, not a widget for other apps; one dry quote checked (6) |
| "Swarm-for-Hire ... giving it NEAR (to pay for inference)" | `contracts/swarm`, `contracts/agent-wallet` | Partial, testnet: spawn with at least 5 NEAR escrow; no on-chain work bids |

## What the judge holds

The judge holds no key, signs nothing and sends no transaction: it reads RPC views, transactions and public HTTP. Its evidence files:

- `tools/judge/evidence/mainnet-rulings.json`: each mainnet verdict's `submit_verdict` transaction hash and its request, response and signature bytes (24 verdicts, made 2026-11-09T00:12Z); check 11 reads the rest from mainnet.
- `tools/judge/evidence/rewrite.json` and `rewrite-mainnet.json`: one signed rewrite each, testnet (check 5) and mainnet (check 11).
- `tools/judge/evidence/attestations/*.json`: the three jury models' attestation proofs with Intel's and NVIDIA's collateral (check 10).
- `deployments/mainnet.json`: every mainnet account, code hash, model key and funding transaction. No key.
- `corpus/ERRORS.json`: the 10 caught Wikipedia sentences, each with its `oldid=` revision and receipts.
- `deployments/ask-an-ai.json`, `deployments/ask-an-ai-web.json`: the "can't I just ask an AI?" measurement of 2026-11-06.

## Live JSON (each answered 200 on 9 November 2026)

| Endpoint | Fields worth reading |
|---|---|
| https://isitpriced.com/health | `ok`, `network` (`mainnet`), `checks.ruling.next_ruling_note` |
| https://isitpriced.com/api/rulings | `next_ruling_note`, `count` (8), each ruling's `verdicts`, `disputes`, `sentinel.status` |
| https://isitpriced.com/api/pages/tether | `corrections[0]` (the $72.6 billion line, its corrected text, `tx`), `totals.signed`, `totals.anchored` |
| https://isitpriced.com/api/today | `counts`, each line's `settles.by` and `settles.source` |
| https://isitpriced.com/api/lane/status | `available`, `credits_left` (free bets left on the contract) |

## Schedule and free bets

- The jury's next sittings are 12 and 13 November 2026 at 15:00 UTC, on the last two caught Wikipedia lines (claims 27 and 26). The keeper holds every sitting until `CHECKER_FROM` (`api/_lib/keeper.mjs`, `firstSitting`), then sits once a day while caught lines remain. News lines from Today's claims settle as each comes due, under their own caps. Live: `next_ruling_note` at https://isitpriced.com/api/rulings ("The jury's next sitting is 12 November at 15:00 UTC" on 9 November) and https://isitpriced.com/rulings.
- Free bets: one $1 bet per browser, paid from the lane budget. On 9 November 11 were left (`credits_left`). Until 15 November the last 4 are kept for the judges (`LANE_RESERVE`, `LANE_RESERVE_UNTIL`, `services/api/src/lane.mjs`); from then any visitor can take them. Live: https://isitpriced.com/api/lane/status.

## Map

`contracts/market` the market (LMSR, lane, challenges, verdicts, disputes) · `contracts/swarm` agents spawned with escrow (testnet) · `api/` Vercel functions (cron, keeper, Sentinel, rulings) · `services/` the API (`services/api`) and the AI (`services/ai`: writer, agents, jury, receipts) · `site/` the Next.js site · `tools/judge/` this judge and its evidence · `scripts/mainnet/` the owner's scripts; each one that signs refuses to touch mainnet without `CONFIRM_MAINNET=yes`.

## Tests (fresh run, 9 November 2026)

| Command | Result |
|---|---|
| `npm run api:unit` | 265 of 265 pass, 52 s |
| `npm run site:test` (the site's vitest; run `npm run site:install` first) | 319 of 319 pass in 33 files, 13 s |
| `npm run judge:test` | 30 of 30 pass, 1 s |
| `npm run ai:unit` (inside check 8) | 213 of 213 pass |
| `npm run test:lifecycle` (contract, testnet) | not rerun: needs `FUNDER_ID`/`FUNDER_KEY` (about 14 NEAR); 238 checks in its last recorded run (`docs/SPEC.md`) |

Rules for agents: never set `CONFIRM_MAINNET=yes`, never read `.env` or `.apex-test/`. Docs: `README.md`, `VERIFY.md` (each step by hand), `docs/API.md`, `docs/ARCHITECTURE.md`.
