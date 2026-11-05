# VERIFY: check each claim by hand in about ten minutes

`npm run judge` does all of this in one go. This page does the same steps without the judge, so you don't have to trust it. Each step gives a command and the output to expect. It needs only `curl` and Node 22.18 or later; Rust is needed for step 3. Nothing here sends a transaction or needs a key.

The deployment's public values are in `deployments/testnet.json`. In the commands below:

```
M=market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet
T=tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet
RPC=https://test.rpc.fastnear.com
view() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 -w0)\"}}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Buffer.from(JSON.parse(s).result.result).toString()))'; }
```

## 1. The LMSR maths (2 min)

```
cargo test -p lmsr --release          # if you have Rust
npm run web:test -- lmsr              # the browser's port against the crate's vectors
```

**Expect:** `test result: ok. 4 passed` from cargo, including `property_random_sequences` (10,000 random buy and sell sequences). From vitest, the `lmsr` tests pass, including "every row bit-exact".

To see the vectors' source, read `web/tools/lmsr-vectors/src/main.rs`. It calls `crates/lmsr` directly. Regenerate them with `npm --prefix web run vectors` and run `git diff web/test/vectors`: expect no change.

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

## 3. The contracts on testnet are this source (1 to 3 min, needs rustc 1.99.1)

```
rustup toolchain install 1.99.1 --target wasm32-unknown-unknown   # once
node tools/judge/repro.mjs
```

**Expect:**
```
same market built CNCKYkjR7SAepL4KcCSBryUMBGJwMM6Xqi8XTvTjWWL2 (...) · recorded CNCKYkjR... · testnet CNCKYkjR...
same swarm  built FtsYcK13Xbpm5gcTJPotbJTts7K1UqzbVMwX63H9R68q (...) · recorded FtsYcK13... · testnet FtsYcK13...
same agent  built 14AB93Dn5Ec2JTQr3fjR8ksWbEEkTaeE9sAy9Y4tbKri · committed contracts/swarm/res/agent.wasm
```

Read the code hash on-chain yourself:

```
curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$M\"}}"
```

**Expect:** `"code_hash":"CNCKYkjR7SAepL4KcCSBryUMBGJwMM6Xqi8XTvTjWWL2"`.

**How the build is made reproducible** (`tools/judge/lib/repro.mjs`):
- It uses the flags of `npm run build:contracts`, plus `--remap-path-prefix`, so no local path reaches the wasm.
- Dependency paths become `/crates/<crate>/...`, and workspace paths become `contracts/...`.
- On Windows each such file is remapped one by one, because a prefix remap keeps backslashes. They are listed in `tools/judge/repro-paths.json`.

**Tested:** two clean target directories on Windows give identical bytes. **Not yet tested:** a Linux or macOS rebuild. If yours differs, the judge prints both hashes; please tell us.

## 4. The deployment is live and its books close (1 min)

```
view $M stats '{}'
view $T ft_balance_of "{\"account_id\":\"$M\"}"
```

**Expect:** the `held_micro` from `stats` equals the token balance, and both equal `treasury_micro + reserved_micro + balances_micro + collected_micro + payouts_micro + bonds_micro + bounties_micro`. At seeding it was:

```
held 140000000 = treasury 37411160 + reserved 41588840 + balances 49000000 + collected 12000000 + 0 + 0 + 0
```

Anyone can trade on testnet, so the numbers change; the equality must not.

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
- `get_model` returns `signing_address_hex` `49468af2afbf0e3465d00601db4bdc666d5187b78fed060c8222f008397e512c`, the record's `signing_address`.

Then open https://testnet.nearblocks.io/txns/BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse. **Expect:** a log `EVENT_JSON:{"standard":"pricedin",...,"event":"rewrite","data":[{...,"request_hash":"<same>","response_hash":"<same>","signature":"<same>","model":"z-ai/glm-5.3-flash"}]}`. The contract checked the ed25519 signature against the registered key before it logged.

**Honest limit:** that key is a TEST writer key from services/ai's offline NEAR AI stand-in. No NEAR AI Cloud key existed when this was recorded. A real TEE-signed rewrite goes through the same code; it will replace this record and re-register the key.

## 6. A 1Click dry quote (30 s, mainnet API, no money moves)

```
curl -s -X POST https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -d '{"dry":true,"swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"5000000","refundTo":"0x1111111111111111111111111111111111111111","refundType":"ORIGIN_CHAIN","recipient":"isitpriced.near","recipientType":"INTENTS","deadline":"2030-01-01T00:00:00.000Z"}'
```

**Expect:** `{"quote":{"amountIn":"5000000",...,"amountOut":"499....","minAmountOut":...,"timeEstimate":...}}`, with no `depositAddress`, because the quote is dry.

With `"recipientType":"DESTINATION_CHAIN"`, delivering straight to a NEAR account, the API answered "Quoting for this pair is not available" or a server error on 2026-11-05. See the known limits in `.apex/streams/judge-result.md`.

## 7. The measured number (10 s)

```
npm run corpus:check
```

**Expect:** `16 of 232 decided data sentences are stale or wrong: 6.9% (95% Wilson 4.3%-10.9%)`.

To check one row by hand, open `corpus/ERRORS.json`. Each item has the sentence, its `oldid=` revision link and receipts; open the revision and a receipt URL to compare.

## 8. The unit suites (1 to 2 min)

```
npm ci && npm run web:install
npm run ai:unit && npm run api:unit && npm run web:test
```

**Expect:** for each node suite, `ℹ fail 0`; from vitest, `Tests 82 passed (82)`. None of them touches the network.

## 9. The hosted demo (when it is live)

```
curl -s <LIVE_URL>/health
curl -s '<LIVE_URL>/claims?page=tether'
curl -N <LIVE_URL>/events
```

**Expect:**
- `/health` returns `{"ok":true,...}` with status 200.
- `/claims` returns claims with `price_yes`.
- `/events` replays recent events at once, and new ones arrive as trades land.

The live URL is a placeholder until it is deployed.
