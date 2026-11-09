# VERIFY: check each claim by hand in about ten minutes

`npm run judge` does all of this in one go. This page does the same steps without the judge, so you don't have to trust it. Each step gives a command and the output to expect. It needs only `curl` and Node 22.18 or later; Rust is needed for step 3. Nothing here sends a transaction or needs a key.

Measured on 9 November 2026 (Windows 11, Node 24.19.0, commit f83eddc): `npm run judge:quick` printed `11 checks: 9 PASS, 0 FAIL, 2 SKIP in 0m25s` (checks 3 and 8 SKIP by design in quick mode), and `npm run judge -- --site=https://isitpriced.com` printed `11 checks: 11 PASS, 0 FAIL, 0 SKIP in 1m59s`.

Steps 1 to 9 use the persistent testnet deployment; steps 10 and 11 read the real-money market on mainnet. The testnet deployment's public values are in `deployments/testnet.json`. In the commands below:

```
M=market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet
T=tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet
RPC=https://test.rpc.fastnear.com
view() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 -w0)\"}}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(JSON.parse(s).result.result).toString()))'; }
```

## 1. The LMSR maths (2 min)

```
cargo test -p lmsr --release          # if you have Rust
npm run site:test -- lmsr             # the site's port (site/lib/core/lmsr.ts) against the crate's vectors
```

**Expect:** `test result: ok. 4 passed` from cargo, including `property_random_sequences` (10,000 random buy and sell sequences). From vitest, the `lmsr` tests pass, including "every row bit-exact".

To see the vectors' source, read `tools/judge/lmsr-vectors/src/main.rs`. It calls `crates/lmsr` directly. Regenerate them with `npm run vectors:lmsr` and run `git diff site/tests/vectors`: expect no change.

## 2. The verdict rule and the bond split (2 min)

```
cargo test -p rules --release
cargo run --release --manifest-path tools/judge/rules-vectors/Cargo.toml > /tmp/rules.json
cmp /tmp/rules.json tools/judge/vectors/rules.json && echo same
```

**Expect:**
- `test result: ok. 9 passed`.
- `same`: the committed vectors are exactly what the Rust crate produces.

Read `crates/rules/src/lib.rs`. `struct Message` declares only `content`, so `reasoning_content` is never read. `bonds_are_conserved_to_the_micro` runs 200,000 random splits.

## 3. The contracts on testnet and mainnet are this source (2 to 4 min, needs rustc 1.99.1)

```
rustup toolchain install 1.99.1 --target wasm32-unknown-unknown   # once
node tools/judge/repro.mjs
```

**Expect** (Linux, macOS or Windows):
```
same market built FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC (sha256 d5fbcbc8..., 435325 bytes) · recorded FQJXhaVJ... · testnet FQJXhaVJ...
same swarm  built p7URj5imKbrCxikR8o7xeBh6iZiF41VhoBedJoMqpgi (sha256 0c119dee..., 213019 bytes) · recorded p7URj5im... · testnet p7URj5im...
same agent  built 14AB93Dn5Ec2JTQr3fjR8ksWbEEkTaeE9sAy9Y4tbKri · committed contracts/swarm/res/agent.wasm
```

Read the code hash on-chain yourself (the mainnet market, `market.isitpriced.near`, has the same market hash):

```
curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$M\"}}"
```

**Expect:** `"code_hash":"FQJXhaVJGwC37dekdneGvEoR9mzJUMkpp4sRjR3WtueC"`. The same call with `RPC=https://rpc.fastnear.com` and `market.isitpriced.near` returned the same hash on 9 November 2026.

**How the build is made reproducible** (`tools/judge/lib/repro.mjs`). The deployed wasm was built on Windows (host `x86_64-pc-windows-gnu`). Two things in it depend on the machine that builds it, and both are pinned to the deployed build's values:
- **Source paths in panic messages.** `tools/judge/repro-paths.json` lists the 25 paths the deployed bytes carry, exactly as they are there, for example `/crates/near-sdk-5.30.1\src\environment\env.rs` and `contracts/market/src/lib.rs`. Each local source file is remapped to its string with `--remap-path-prefix`, on every OS. `cargo fetch` runs first, so a clean machine has the registry unpacked before the remaps are listed.
- **Cargo's `-C metadata`.** For every crate that uses a proc macro or a build script, cargo hashes the host triple into it (49 of 72 compile units differ between the Windows gnu and msvc hosts). It seeds every symbol name, and so the order of functions in the wasm. `tools/judge/repro-wrapper`, a std-only `RUSTC_WRAPPER`, sets each wasm crate's value to the one recorded from the deployed build (`metadata` in `repro-paths.json`). It changes nothing else.

The flags are those of `npm run build:contracts`. The workspace location, `CARGO_HOME` and `RUSTFLAGS` don't change the bytes (tested).

**Tested:** clean `ubuntu-latest`, `macos-latest` and `windows-latest` (msvc) GitHub runners rebuild both deployed hashes byte for byte: [run 42542226417](https://github.com/iamdflame/priced-in/actions/runs/42542226417) and [run 42542566537](https://github.com/iamdflame/priced-in/actions/runs/42542566537) (`.github/workflows/repro.yml`, branch `ci/repro`; all three jobs green in each). So does the founder's Windows machine, with both the gnu and msvc toolchains; on 9 November 2026 check 3 passed there again with rustc 1.99.1.

**If this machine can't build** (no rustc 1.99.1 or wasm target, no network for the crates, no host linker, or a source path it can't remap), check 3 says SKIP with the reason and links that run. It says FAIL only when the build completes and its hashes differ from the chain.

## 4. The deployment is live and its books close (1 min)

```
view $M stats '{}'
view $T ft_balance_of "{\"account_id\":\"$M\"}"
```

**Expect:** the `held_micro` from `stats` equals the token balance, and both equal `treasury_micro + reserved_micro + balances_micro + collected_micro + payouts_micro + bonds_micro + bounties_micro`. At seeding it was:

```
held 140000000 = treasury 37411160 + reserved 41588840 + balances 49000000 + collected 12000000 + 0 + 0 + 0
```

Anyone can trade on testnet, so the numbers change; the equality must not. On 9 November 2026 (block 276940793) check 4 read `held 371578362 = treasury 27569553 + reserved 40579423 + balances 71820498 + collected 214156518 + payouts 17452370 + 0 + 0`, with 21 claims.

To see the page's claims, run `view $M get_claims '{"from":0,"limit":100}'`. Expect 20 Tether sentences with `price_yes_ppm`, and `cost_up_10_micro`, the cost to move the price 10 points.

## 5. The signed rewrite verifies, and it is anchored (2 min)

The record is `tools/judge/evidence/rewrite.json`.

```
node -e '
const {createHash,createPublicKey,verify}=require("crypto");
const p=require("./tools/judge/evidence/rewrite.json").record.provenance;
const h=b=>createHash("sha256").update(Buffer.from(b,"base64")).digest("hex");
const text=`${p.model}:${h(p.request_b64)}:${h(p.response_b64)}`;
const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(p.signing_address,"hex")]),format:"der",type:"spki"});
console.log(h(p.request_b64)===p.request_hash, h(p.response_b64)===p.response_hash, text===p.signed_text, verify(null,Buffer.from(text),key,Buffer.from(p.signature,"hex")));'
view $M get_model '{"model":"z-ai/glm-5.3-flash"}'
```

**Expect:**
- `true true true true`.
- `get_model` returns `signing_address_hex` `5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff`, the record's `signing_address` (read on 9 November 2026).

Then open https://testnet.nearblocks.io/txns/GxtD3AdjKJziFYNK718wmFhmUJ7LVJZvXzmNLsqtiBUz. **Expect:** a log `EVENT_JSON:{"standard":"pricedin",...,"event":"rewrite","data":[{...,"request_hash":"<same>","response_hash":"<same>","signature":"<same>","model":"z-ai/glm-5.3-flash"}]}`. The contract checked the ed25519 signature against the registered key before it logged.

The record is rewrite `tether:2:v4`, a real NEAR AI Cloud completion signed by GLM-5.3 Flash's TEE key (`writer_key: "nearai"` in the file). That key is the one step 10 proves attested, and the one the mainnet market holds for the model.

## 6. A 1Click dry quote (30 s, mainnet API, no money moves)

```
curl -s -X POST https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -d '{"dry":true,"swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"5000000","refundTo":"0x1111111111111111111111111111111111111111","refundType":"ORIGIN_CHAIN","recipient":"isitpriced.near","recipientType":"INTENTS","deadline":"2030-01-01T00:00:00.000Z"}'
```

**Expect:** `{"quote":{"amountIn":"5000000",...,"amountOut":"499....","minAmountOut":...,"timeEstimate":...}}`, with no `depositAddress`, because the quote is dry.

On 9 November 2026 check 6 got `$5.00 USDC on Base -> 4.999413 USDC on NEAR (min 4.949418), about 35 s`. With `"recipientType":"DESTINATION_CHAIN"`, delivering straight to a NEAR account, it quoted too (4.999413); on 2026-11-05 that variant had answered "Quoting for this pair is not available" or a server error. This is the only route checked: USDC on Base. The site lists 12 other 1Click routes (`CURATED` in `site/lib/money/oneclick.ts`) that no step here quotes.

## 7. The measured number (10 s)

```
npm run corpus:check
```

**Expect:** `16 of 232 decided data sentences are stale or wrong: 6.9% (95% Wilson 4.3%-10.9%)`.

To check one row by hand, open `corpus/ERRORS.json`. Each item has the sentence, its `oldid=` revision link and receipts; open the revision and a receipt URL to compare.

## 8. The unit suites (1 to 2 min)

```
npm ci && npm run site:install
npm run ai:unit && npm run api:unit && npm run site:test
```

**Expect:** for each node suite, `ℹ fail 0`; from vitest, `Tests 319 passed (319)`. None of them touches the network. On 9 November 2026: AI 213 of 213, API 265 of 265 (52 s), site 319 of 319 in 33 files (13 s), and `npm run judge:test` 30 of 30.

## 9. The hosted site (30 s)

```
curl -s https://isitpriced.com/health
curl -s 'https://isitpriced.com/claims?page=tether'
curl -N https://isitpriced.com/events
```

**Expect:**
- `/health` returns `{"ok":true,"network":"mainnet","marketId":"market.isitpriced.near",...}` with status 200.
- `/claims` returns claims with `price_yes` (22 priced sentences on the Tether page on 9 November 2026).
- `/events` replays recent events at once (check 9 got one after 0.4 s), and new ones arrive as trades land.

## 10. The jury's models are attested, and mainnet holds their keys (1 min)

```
ls tools/judge/evidence/attestations/
MRPC=https://rpc.fastnear.com
mview() { curl -s $MRPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 -w0)\"}}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(JSON.parse(s).result.result).toString()))'; }
mview market.isitpriced.near get_model '{"model":"z-ai/glm-5.3-flash"}'
```

**Expect:** three proofs (DeepSeek, Qwen, GLM), and `"signing_address_hex":"5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff"`, the key GLM's proof attests. The offline TDX and GPU verification is `npm run judge` check 10 (`services/ai/src/attestproof.js`); on 9 November 2026 it verified all three, each key equal to `get_model`.

## 11. Every mainnet ruling, from the chain (2 min)

The market's three verdicts per ruling are on mainnet; `tools/judge/evidence/mainnet-rulings.json` holds each verdict's `submit_verdict` transaction hash and the bytes it carried. With `mview` from step 10:

```
mview market.isitpriced.near stats '{}'
mview market.isitpriced.near get_challenge '{"challenge_id":0}'
node -e '
const {createHash,createPublicKey,verify}=require("crypto");
const ev=require("./tools/judge/evidence/mainnet-rulings.json"), dep=require("./deployments/mainnet.json");
const key=Object.fromEntries(dep.models.map(m=>[m.model,m.signing_address_hex]));
const h=b=>createHash("sha256").update(Buffer.from(b,"base64")).digest("hex");
let ok=0;for(const v of ev.verdicts){const t=`${v.model}:${h(v.request_b64)}:${h(v.response_b64)}`;
const k=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(key[v.model],"hex")]),format:"der",type:"spki"});
if(verify(null,Buffer.from(t),k,Buffer.from(v.signature_hex,"hex")))ok++;}
const v0=ev.verdicts.find(v=>v.challenge_id===0);
console.log(ok+" of "+ev.verdicts.length+" signatures verify; challenge 0, "+v0.model+": request "+h(v0.request_b64)+", response "+h(v0.response_b64)+", tx "+v0.tx_hash);'
```

**Expect** (9 November 2026):
- `stats`: `"challenges":8`, and `held_micro` equal to the sum of the buckets, as in step 4 (`81607427` that day).
- `get_challenge`: `"resolved":true`, `"disputes":0`, and three `verdicts`, the first `{"model":"deepseek-ai/DeepSeek-V4.1-Flash-1017","outcome":"FALSE","request_hash":"a51b6e15...","response_hash":"6fbc29d9..."}`.
- The script: `24 of 24 signatures verify; challenge 0, deepseek-ai/DeepSeek-V4.1-Flash-1017: request a51b6e15311eae1c48283a8bc28919a59baa298ea0c3a48c11bdc142cfe2a9bb, response 6fbc29d9e04575a31068464481e371d45ec226043232541e31ef59f5b7b8705d, tx 6HWB2Esndp73tCtrzvCD99kfBEwnrmR6YTdtfUZUa2dz`: the hashes the market stored, over the bytes the transaction carried.
- Open https://nearblocks.io/txns/6HWB2Esndp73tCtrzvCD99kfBEwnrmR6YTdtfUZUa2dz: a `submit_verdict` call to `market.isitpriced.near` whose `response` and `signature_hex` are the file's.

The file is only a pointer. Check 11 (`npm run judge:quick`, 25 s) goes further from the chain itself: it reads every challenge from 0 to `stats.challenges - 1`, takes each response and signature from its transaction, hashes `canonical_request` (the market's own rebuild of the request) against the stored `request_hash`, verifies ed25519 against `get_model`'s key, and checks each settled outcome against the verdicts and disputes. On 9 November 2026: 8 of 8 settled, 24 verdicts by 3 models, all verified, no disputes.
