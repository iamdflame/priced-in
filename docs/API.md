# API

Every HTTP endpoint of `services/api` and `services/ai`, and every MCP tool of `tools/mcp`.

**Where it runs.** The API is live on NEAR mainnet at `https://isitpriced.com`, on Vercel functions (`api/`), reading `market.isitpriced.near`. Two path forms reach the same routes:

| Path | What it reaches |
|---|---|
| `/v1`, `/v1/*`, `/health`, `/claims`, `/claims/:id`, `/events`, `/events/recent` | Those routes, at the root. |
| `/api/<route>` | Every route, for example `/api/v1/credence`, `/api/rewrites`, `/api/agents`, `/api/paste`. |

**The site proxies these paths.** `https://isitpriced.com` is the product site (`site/`, Next.js). The API is its own Vercel project (the repo root: `api/` and `vercel.json`) at `https://pricedin-fawn.vercel.app`, whose own page only links back here. The site forwards `/api/*`, `/health`, `/claims`, `/events`, `/lane`, `/v1` and `/post` to it (`site/next.config.ts` rewrites, to `API_ORIGIN`). On the way, `site/proxy.ts` drops any client-sent `x-visitor-ip` and `x-proxy-secret`, then sets them to the visitor's address and the shared `PROXY_SECRET`, so per-address limits count each visitor and not the site's edge (`site/lib/proxy/forward.ts`, `visitorIp` in `services/api/src/ratelimit.mjs`). Every call below works on either origin, except `/x402/*`, which only the API's origin serves.

The hosted API runs the same handlers as a local server. It differs in four ways:
- Limits that matter hold across function instances, because they count through the store: `/lane/key`, `/paste` and `/v1/credence`. Locally they count in memory, and a restart clears them.
- `/events` is a finite stream: it sends what the store has after `?since=` and closes with `retry: 2000`.
- `/health` has its own checks. `checks.x402` shows the pay-to account, the relayer and its NEAR balance, and sets `low` when the balance is under `X402_RELAYER_MIN_NEAR` (0.02). A low relayer stops revenue, not the site, so it never fails the check.
- It adds the read routes under [Hosted read routes](#hosted-read-routes).

**Where the responses come from.** Responses marked *hosted* were returned by `https://isitpriced.com` on 2026-11-06. Responses marked *mainnet terms* were returned on 2026-11-06 by this code, run locally on the mainnet market with `X402_PAY_TO=isitpriced.near`: they show the terms before any payment. Every other response is also real: it was returned on 2026-11-05 by a local `services/ai` server (which includes `services/api`) reading the testnet deployment in `deployments/testnet.json`, with no NEAR AI key, no lane key and no payment key. The command:

```
MARKET_CONTRACT_ID=market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet \
USDC_CONTRACT_ID=tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet \
SWARM_CONTRACT_ID=swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet \
REWRITE_EVIDENCE_FILES=tools/judge/evidence/rewrite.json \
RPC_URLS=https://test.rpc.fastnear.com,https://testnet-rpc.intea.rs \
PORT=8797 npm run ai
```

Long strings and arrays are cut and marked `…`. Nothing else is changed. The testnet answers say `off` or `unavailable` for what needs a key; on the hosted API the planner, the writer, the agents and the lane are on.

**Common rules** (`services/api/src/app.mjs`):
- JSON in and out. Errors are `{"error":{"code","message","retryAfterS"?}}`.
- CORS allows any origin and exposes `payment-required`, `payment-response`, `x-free-calls-remaining` and `retry-after`.
- Body caps: 2 KB for `/lane/key`, 64 KB for `/paste`.
- Limits are per client IP and per UTC day. `X-Forwarded-For` counts only with `TRUST_PROXY=1`. On the hosted API the address is the edge's `x-real-ip`, or `x-visitor-ip` when the product site vouches for it with `PROXY_SECRET`.

## services/api

### `GET /`

The service name and its route list.

```
$ curl -s http://127.0.0.1:8797/
{"name":"Priced In API","network":"testnet","marketId":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet",
 "endpoints":["GET /v1","GET /v1/credence?q=<question or claim>","GET /v1/credence?claim=<id>",
  "GET /v1/quote?claim=<id>&side=yes|no&amount_usd=<n>","POST /lane/key","GET /claims?page=<slug>","GET /claims/:id",
  "GET /events (SSE)","GET /events/recent","GET /health","POST /paste","GET /rewrites?page=<slug>","GET /post/:id",
  "GET /post?url=<link>","GET /ai/status","GET /agents","GET /rationales","POST /agents/runner-key","GET /ai/usage/*",
  "GET /jury","GET /attestations","GET /attestations/*"]}
```

### `GET /health`

200 when healthy, 503 with `failures[]` when the RPC is unreachable, serves the wrong chain, scanning stopped for 30 s, or `MARKET_CONTRACT_ID` is unset. Tests: `services/api/test/app.test.mjs`, "/health: 200 while scanning, 503 with the reason when the RPC is unreachable".

```
$ curl -s http://127.0.0.1:8797/health
{"ok":true,"network":"testnet","marketId":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet","failures":[],
 "checks":{
  "ai":{"writer":{"writer":"template_only","model":"z-ai/glm-5.3-flash","reason":"NEARAI_API_KEY is not set: template rewrites only, marked unsigned",…},
        "signer":{"status":"off","reason":"no keystore (KEYSTORE_DIR) and no SIGNER_KEYS_FILE: nothing to sign with",…},
        "agents":{"status":"off","reason":"NEARAI_API_KEY is not set: agents form no credences without a model, so they stay silent",…},
        "anchoring":{"on":false,"anchored":0,"failures":0},
        "jury":{"status":"off","reason":"NEARAI_API_KEY is not set","models":["deepseek-ai/DeepSeek-V4.1-Flash-1017","Qwen/Qwen3.8-27B","z-ai/glm-5.3-flash"]},
        "attestations":[]},
  "scanner":{"lastBlockHeight":276367067,"lastScanAgeS":1.222,"maxAgeS":30,"chainLagS":8.073,"blocksScanned":12,"txsTracked":0,"skippedBlocks":0,"lostTxs":0,"lastError":null},
  "rpc":{"reachable":2,"urls":[{"url":"https://test.rpc.fastnear.com","ok":true,"latencyMs":414,"chainId":"testnet","height":276367072},
                               {"url":"https://testnet-rpc.intea.rs","ok":true,"latencyMs":1310,"chainId":"testnet","height":276367074}]},
  "events":{"lastEventAgeS":null,"maxAgeS":null,"buffered":0,"streams":0},
  "lane":{"configured":false},
  "planner":{"status":"unavailable","reason":"NEARAI_API_KEY is not set","plannerPublicKeyHex":null},
  "posts":{"cached":0,"fetches":0,"lastFetchMs":null,"lastError":null,"newToday":0,"newPerDay":3000},
  "credence":{"freePerIpPerDay":20,"payments":"off","network":"near:testnet","priceMicro":10000,"asset":"tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet",…}}}
```

### `GET /claims?page=<slug>` and `GET /claims/:id`

The contract's `get_claims` and `get_claim` views, cached for 1 s, each claim decorated with `price_yes`, `cost_to_move` and `volume_usd`. The page filter runs in the API. `/claims?page=tether` returned the 20 seeded claims (12,040 bytes).

```
$ curl -s http://127.0.0.1:8797/claims/6
{"claim":{"id":6,"text":"Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Liquid Network…","page":"tether","kind":"data",
  "price_yes_ppm":189970,"cost_up_10_micro":"395292","cost_down_10_micro":"2242169","status":"Open","outcome":null,"provisional":null,
  "trades":3,"volume_micro":"3100000","open_interest_micro":"4547388","collected_micro":"3100000","payout_left_micro":"0",
  "challenge_id":null,"prev":null,"next":null,"bounty_micro":"0",
  "price_yes":0.18997,"cost_to_move":{"up_10_points_usd":0.395292,"down_10_points_usd":2.242169},"volume_usd":3.1},
 "asOf":1793896875887}

$ curl -s http://127.0.0.1:8797/claims/99999
HTTP 404 {"error":{"code":"no_such_claim","message":"No claim 99999."}}
```

### `GET /events` (SSE) and `GET /events/recent`

The scanner publishes the market's `EVENT_JSON` logs (`services/api/src/events.mjs`). SSE sends `retry: 2000`, replays the buffer (or everything after `Last-Event-ID` or `?since=`), then `event: hello`, and a ping every 15 s. Each event record carries `uid`, `event`, `version`, `data`, `txHash`, `receiptId`, `signerId`, `blockHeight`, `blockTimestampMs` and `seenAtMs`. Test: "/events streams market events to subscribers, replays the buffer, and /events/recent lists them".

```
$ curl -s -N http://127.0.0.1:8797/events
retry: 2000

event: hello
data: {"lastBlockHeight":276367151,"replayed":0,"marketId":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet"}

$ curl -s http://127.0.0.1:8797/events/recent
{"events":[],"lastBlockHeight":276367077,"lastSeq":0}
```

No trade happened on the deployment during the run, so no event was streamed. The `data` of a trade event is the contract's log, for example from tx `55GJAbUYwxgHXtDA4JRQpcTgUzUP3AsaUArNYiqLfuiK`: `{"claim_id":6,"trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","side":"no","shares_micro":"1292110","amount_micro":"1000000","price_yes_ppm":189970,"balance_micro":"0"}`. On testnet the e2e measured the SSE trade event 2.4 to 3.2 s after the bet was sent (`.apex/streams/api-result.md`).

### `POST /lane/key`

Body `{"publicKey":"ed25519:<base58>"}`. Adds the key to the lane account as a function-call key on the market (`buy, sell, open_and_buy, redeem, claim_lane`, 0.25 NEAR allowance).

Real response from this run (no lane key configured):
```
$ curl -s -X POST -H 'content-type: application/json' -d '{"publicKey":"ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT"}' http://127.0.0.1:8797/lane/key
HTTP 503 {"error":{"code":"lane_unavailable","message":"The judges' lane is not configured on this server."}}
```

With a lane key, the 200 body is `{laneAccountId, contractId, publicKey, nonce, blockHash, rpc, rpcs, methods, allowanceYocto, maxGasTgas: 20, reused}` (`services/api/src/lane.mjs`). The testnet e2e checks "the answer carries laneAccountId, contractId, nonce, blockHash, rpc" and issued keys in 1.5 to 2.1 s (`services/api/test/lane-e2e.mjs`, `.apex/streams/api-result.md`). Refusals: 429 `rate_limited` ("This address has used its 4 free bets for today." in the e2e, limit set to 4), 429 `lane_daily_cap`, 503 `lane_used_up`, 503 `market_paused`, 504 `lane_timeout`.

### `POST /paste`

Body `{"text": "...", "page"?: "<slug>"}`. Splits into at most 12 sentences. With a planner (`NEARAI_API_KEY`, `PLANNER_MODEL`, `PLANNER_PRIVATE_KEY`), priceable sentences come back with a signed receipt and ready `open_and_buy` args. Without one:

```
$ curl -s -X POST -H 'content-type: application/json' -d '{"text":"NEAR Intents passed $10B. Dr. Smith said 3.5% was fine. I love it!"}' http://127.0.0.1:8797/paste
{"page":"paste-fe0d079ae62c","truncated":false,"totalSentences":3,"bMicro":"1000000","planner":"unavailable",
 "plannerReason":"NEARAI_API_KEY is not set","message":"Pricing soon: the planner is offline, so nothing here is priced yet.",
 "sentences":[{"index":0,"text":"NEAR Intents passed $10B.","status":"pricing_soon","label":null},
              {"index":1,"text":"Dr. Smith said 3.5% was fine.","status":"pricing_soon","label":null},
              {"index":2,"text":"I love it!","status":"pricing_soon","label":null}]}
```

The signed path is tested with a stubbed model ("/paste with a planner: labels, person and opinion lines unpriced, receipts that verify") and one real on-chain `open_and_buy` in the e2e ("the contract accepts the API's planner receipt (open_and_buy) · 59.9999% -> 75.7387%"). The hosted API runs the live planner: `checks.planner` in `/health` shows `deepseek-ai/DeepSeek-V4.1-Flash-1017`.

### `GET /post/:id` and `GET /post?url=<link>`

Opens a public X post as a priced page `x-<id>`, through `publish.x.com/oembed`. Accepts every link form in `parsePostLink` (`services/api/src/posts.mjs`).

```
$ curl -s 'http://127.0.0.1:8797/post?url=x.com/jack/status/20'
{"source":"x","page":"x-20","gone":false,
 "post":{"id":"20","url":"https://x.com/jack/status/20","authorName":"jack","handle":"jack","authorUrl":"https://x.com/jack",
         "date":"March 21, 2006","postedAt":"2006-03-21T00:00:00.000Z","lang":"en","language":{"code":"en","name":"English","english":true},
         "text":"just setting up my twttr","mediaCount":0,"linkCount":0,"thread":null,"fetchedAt":1793896910349,"checkedAt":1793896910349},
 "notices":[],"truncated":false,"totalSentences":1,"bMicro":"1000000","planner":"unavailable","plannerReason":"NEARAI_API_KEY is not set",
 "message":"Pricing soon: the planner is offline, so nothing here is priced yet.",
 "sentences":[{"index":0,"text":"just setting up my twttr","status":"pricing_soon","label":null}],"allOpinion":false}
```

A deleted post answers 410 `post_deleted` with no text (`npm run api:post-smoke`: "a post that doesn't exist answers gone, with no text · HTTP 410 post_deleted"). Other answers: 410 `post_private`, 503 `x_rate_limited`, 502 `x_unavailable`, 400 `not_a_post_link`, 429 `rate_limited` and `post_daily_cap`.

### `GET /rewrites?page=<slug>[&history=1]`

Signed rewrites in the store. `REWRITE_EVIDENCE_FILES` preloads the judge's evidence record.

```
$ curl -s 'http://127.0.0.1:8797/rewrites?page=tether'
{"page":"tether","writer":{"writer":"template_only","model":"z-ai/glm-5.3-flash","reason":"NEARAI_API_KEY is not set: template rewrites only, marked unsigned",…},
 "rewrites":[{"id":"tether:2:v1","page":"tether","paragraph":2,"version":1,
   "trigger":{"claim_id":6,"txHash":"55GJAbUYwxgHXtDA4JRQpcTgUzUP3AsaUArNYiqLfuiK","trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","price_yes_ppm":189970,"seq":null},
   "prices_canonical":"{\"page\":\"tether\",\"paragraph\":2,\"version\":1,\"prices\":[[5,516391],[6,189970],[7,265124]]}",
   "prices_hash":"8be929bae4c99de07a0d1bc9580a43cd966b2abc7e174b6aa9704e2ea0c41336","status":"signed",
   "sentences":[{"claim_id":5,…,"band":"disputed"},{"claim_id":6,"probability":0.18997,"band":"negate","text":"Contrary to some reports, it is unlikely that tether issues tokens on Algorand, …"},…],
   "provenance":{"kind":"model","status":"signed","verified":true,"model":"z-ai/glm-5.3-flash",
     "request_hash":"2700504a08050407664fb1d34d5f29027e2c2f172f969b7805f2f1e674750bce",
     "response_hash":"d1f95efa5542391e69fbbf538d958693bfa75c67045d92e3cc529b00329985c1",
     "signature":"82bdc042e14989f6566b37e31b51229e28a1ae7252562d953744b0436863fdcbaf38b0ce464e6cae…",
     "signing_address":"49468af2afbf0e3465d00601db4bdc666d5187b78fed060c8222f008397e512c","signature_kind":"provider_tee",
     "request_b64":"eyJtb2RlbCI6…","response_b64":"eyJpZCI6…",
     "anchor":{"tx_hash":"BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse","sender_id":"pimw3dxfzp.basalt-lane-mw2skhdc.testnet","block":276329152}},
   "anchor":{"status":"anchored","tx_hash":"BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse",…},
   "evidence_file":"tools/judge/evidence/rewrite.json","writer_key":"test"}],
 "count":1,…}
```

`"writer_key":"test"` means the signature is from the offline stand-in's throwaway key, not NEAR AI Cloud ([TRUST.md](TRUST.md)). The record verifies offline and its anchor is on testnet (judge check 5).

### `GET /v1`

The truth API's terms, and what it has earned. The CDN caches it for 30 s.

*Mainnet terms:*
```
$ curl -s https://isitpriced.com/v1
{"name":"Priced In truth API","network":"mainnet","contract":"market.isitpriced.near",
 "usdc":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
 "rpc":["https://near.drpc.org","https://rpc.fastnear.com","https://free.rpc.fastnear.com"],
 "credence":{"path":"/v1/credence?q=<question or claim>","free_per_ip_per_day":20,
  "payments":{"protocol":"x402","version":2,"scheme":"exact","network":"near:mainnet",
   "asset":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
   "amount":"10000","payTo":"isitpriced.near","maxTimeoutSeconds":60,"extra":{},"usd":0.01,"facilitator":"in-process"}},
 "truth_api":{"paid_calls":0,"revenue_usd":0,"revenue_micro":"0","payers":0,"last_paid_at":null,"last_tx":null,"last_tx_explorer":null},
 "quote":"/v1/quote?claim=<id>&side=yes|no&amount_usd=<n>",
 "mcp":"claude mcp add pricedin -- npx -y pricedin-mcp (tools: ask, get_claim, quote, bet)."}
```

`credence.payments` says whether this API takes payments. It's `null` until `X402_PAY_TO` and a facilitator are set, and then past the free tier is 429 instead of 402.

`truth_api` is the revenue record: every settled payment, counted once by transaction. `last_tx_explorer` links the newest one, so the figure can be checked on chain. On the hosted API it comes from the store's `x402.jsonl`, so every instance reports the same number. On a local server it counts in memory.

### `GET /v1/credence?q=<question>` or `?claim=<id>` (`&page=`, `&limit=`, `&open=0`)

Matches a question to claims and answers with the chain's price and provenance (`services/api/src/credence.mjs`). Header `x-free-calls-remaining`.

*Hosted*, with `rationales` cut:
```
$ curl -s 'https://isitpriced.com/v1/credence?q=Is%20Tether%20the%20issuer%20of%20USDT%3F&limit=1&open=0'
{"network":"mainnet","contract":"market.isitpriced.near","query":"Is Tether the issuer of USDT?","matched":1,
 "answer":"The closest claim: \"Anchorage Digital Bank also serves as the issuer of Tether's U.S.-focused stablecoin, USAT.\" The market prices this at 50% true, with $0.00 riding on it; it costs $0.32 to push it 10 points up, $0.32 to push it 10 points down.",
 "claims":[{"claim_id":11,"text":"Anchorage Digital Bank also serves as the issuer of Tether's U.S.-focused stablecoin, USAT.","page":"tether","kind":"document",
   "match":{"kind":"close","score":0.669,"matched_terms":["tether","issuer"],"missing_terms":[]},
   "credence":0.5,"summary":"The market prices this at 50% true, with $0.00 riding on it; it costs $0.32 to push it 10 points up, $0.32 to push it 10 points down.",
   "price":{"yes":0.5,"no":0.5,"yes_ppm":500000},"open_interest_usd":0,"volume_usd":0,"trades":0,
   "cost_to_move_10_points":{"up_usd":0.323558,"down_usd":0.323558},"liquidity_b_usd":1.45,
   "rationales":[{"agent":"house-skeptic","model":"deepseek-ai/DeepSeek-V4.1-Flash-1017","account_id":"h-skeptic.isitpriced.near","side":"no_bet","size_usd":0,"credence":0.2,"rationale":"Neither source mentions USAT or Anchorage Digital's role as an issuer; …",…}],
   "recent_trades":[],
   "resolution":{"state":"open","status":"Open","outcome":null,"provisional":null,"challenge_id":null,"note":"Open: nobody has challenged it. The price is the market's credence."},
   "provenance":{"network":"mainnet","contract":"market.isitpriced.near","claim_id":11,"view":{"method":"get_claim","args":{"claim_id":11}},
     "contract_explorer":"https://nearblocks.io/address/market.isitpriced.near","last_rewrite":null}}],
 "as_of":"2026-11-06T07:21:40.678Z","free":{"limit":20,"remaining":16}}
```

No match:
```
$ curl -s 'http://127.0.0.1:8797/v1/credence?q=Is%20the%20moon%20made%20of%20cheese%3F'
{"network":"testnet","contract":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet","query":"Is the moon made of cheese?","matched":0,"claims":[],
 "answer":"No claim on Priced In matches that, so no money stands behind any answer yet.",
 "open":{"how":"Open it: each priceable sentence below comes with a planner receipt that the mar…",
         "result":{"page":"paste-fa6ea9feff40","planner":"unavailable","plannerReason":"NEARAI_API_KEY is not set",…,
                   "sentences":[{"index":0,"text":"Is the moon made of cheese?","status":"pricing_soon","label":null}]}},
 "as_of":"2026-11-05T16:41:33.551Z","free":{"limit":20,"remaining":17}}

$ curl -s http://127.0.0.1:8797/v1/credence
HTTP 400 {"error":{"code":"empty_query","message":"Ask something: /v1/credence?q=<a question or a claim>, or ?claim=<id>."}}
```

#### Pricing and the free tier

| | |
|---|---|
| Free tier | 20 credence calls per address per UTC day (`CREDENCE_FREE_PER_IP_PER_DAY`). A call that fails gives its unit back. |
| Past it | $0.01 a call in USDC on NEAR (`X402_PRICE_MICRO=10000`), paid per call over x402. |
| Asset | Circle's native USDC on NEAR, `17208628…`, 6 decimals. |
| Always free | `GET /v1`, `GET /v1/quote`, `GET /claims` and the bare chain views. A paid call spends no free unit. |

A payment gets one answer. A call that fails is never settled, so nothing is charged.

#### Paying: what happens on one call

1. The agent calls `/v1/credence` past its free calls and gets 402, with the terms.
2. It signs a NEP-366 delegate action of exactly one `ft_transfer` of the amount to `payTo`, and retries with the payload in `PAYMENT-SIGNATURE`. Its key signs on its own machine, and it needs no NEAR for gas. The key must be a full-access key.
3. The API verifies the payment and computes the answer.
4. The API relays the delegate action. Its relayer, `x402.isitpriced.near`, signs the outer transaction and pays the gas and the 1 yoctoNEAR deposit: about 0.0003 NEAR, or a tenth of a cent.
5. The USDC moves from the agent to `isitpriced.near`, and the API waits for the inner receipt to succeed.
6. The answer goes out with `PAYMENT-RESPONSE` and a `payment` receipt, and the payment is added to `truth_api`.

The API is its own facilitator (`@fastnear/x402/facilitator`, in the same function). Any x402 client pays it as is, for example `@fastnear/x402`'s `createNearPaymentFetch`. One paid call takes 5 to 10 seconds, nearly all of it waiting for finality.

The challenge, *mainnet terms*:
```
$ curl -si 'https://isitpriced.com/v1/credence?claim=1&open=0'
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi…   (base64 of the same JSON as the body)

{"x402Version":2,"error":"The free tier is 20 credence calls a day per address, and this address has used them. Each further call costs $0.01 in USDC by x402.",
 "resource":{"url":"https://isitpriced.com/v1/credence?claim=1&open=0","description":"Priced In credence: the market's price, open interest, cost to move, agents' rationales with sources, resolution and provenance for the claims matching your question.","mimeType":"application/json"},
 "accepts":[{"scheme":"exact","network":"near:mainnet","asset":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","amount":"10000","payTo":"isitpriced.near","maxTimeoutSeconds":60,"extra":{}}],
 "message":"The free tier is 20 credence calls a day per address, and this address has used them. Each further call costs $0.01 in USDC by x402.",
 "free":{"limit":20,"remaining":0,"resets_in_s":59862}}
```

A paid answer adds `payment`: `{settled, transaction, network, payer, amount, asset, payTo, usd, explorer}`. These lines are from one real payment on testnet (`npm run truth:smoke`):

```
PASS past the free tier: 402 with the x402 v2 challenge · exact near:testnet: 10000 micro-tUSDC of tusdc.pimw3dxfzp.basalt-lane-mw2skhdc.testnet to truthpayee-mw3r9fnc.basalt-lane-mw2skhdc.testnet, 60 s
PASS one x402 payment by @fastnear/x402 with the payer's own key: answered, with PAYMENT-RESPONSE · settled in 8050 ms, payer truthpayer-mw3r9fnc.basalt-lane-mw2skhdc.testnet, tx 9NTBY2oVBVQGzcV2wcQ4ZQyNmLb3C1sCBKJhtqG492RX
PASS the same payment replayed is refused and moves nothing · 402: Payment refused: invalid_exact_near_payload_delegate_action_nonce_already_used.
```

The answers past the free tier:

| Status | Means |
|---|---|
| 402 | Pay, or the payment was refused or did not settle. `error` says which, and a fresh challenge comes with it. No answer is given. |
| 200 | Paid and answered, with the receipt. |
| 429 `free_tier_used` | This API takes no payments. Come back after `retryAfterS`. |
| 502 `facilitator_unavailable` | The payment check did not answer. Nothing was charged. |
| 503 `settlement_busy` | The relayer stayed busy for 15 s. Nothing was charged. `retry-after: 5`. |

One relayer key has one nonce, so settlements take turns, through a lease in the store. That allows about one settlement every 3 seconds, or some 20,000 paid calls a day; more relayer accounts would raise it. The same turn stops a replay: a payment sent to two instances at once settles on the first, and the second finds the delegate's nonce spent before anything is sent.

#### The mainnet smoke test

`node services/api/test/truth-smoke.mjs --network mainnet --plan` reads the hosted API and the chain, and says whether a paid call would work and what it would spend. It uses no key.

The real run pays $0.01 of real USDC:

```
CONFIRM_MAINNET=yes node services/api/test/truth-smoke.mjs --network mainnet
```

- **Who pays:** `checker.isitpriced.near`, with its recovery key from `.apex-test/mainnet/checker-key.json`. If its wallet is short, the run registers it on USDC (0.00125 NEAR, once) and withdraws $0.05 from its own market balance. `PAYER_ACCOUNT_ID` and `PAYER_PRIVATE_KEY` name another payer.
- **Who receives:** `isitpriced.near`. It uses up your address's free calls first, so run it from a machine whose free calls you don't need today.
- **What you should see:** `PASS` on six checks: the free tier counts every call once and stops; 402 with the same terms as `GET /v1`; one payment answered with its receipt; the pay-to up by exactly 10000 and the payer down by exactly 10000; the replay refused; and `truth_api` counting the payment.
- **How a replay is refused:** the same `PAYMENT-SIGNATURE` is sent again. The answer is 402 with `Payment refused: invalid_exact_near_payload_delegate_action_nonce_already_used`, no claims, and no balance moves. The delegate's nonce is spent on chain, so no server state is needed to refuse it.

The receipt goes to the git-ignored `.apex-test/mainnet/truth-receipt.json`.

### `GET /v1/quote?claim=<id>&side=yes|no&amount_usd=<n>`

The LMSR closed form on the public view, and the exact `buy` call. It places nothing. `amount_usd` is above 0 and at most 1,000.

```
$ curl -s 'http://127.0.0.1:8797/v1/quote?claim=6&side=no&amount_usd=1'
{"network":"testnet","contract":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet","text":"Tether issues tokens on Algorand, …",
 "quote":{"claim_id":6,"side":"no","amount_usd":1,"amount_micro":"1000000","shares":1.193089,"avg_price":0.8381599883043097,
          "payout_if_right_usd":1.193089,"profit_if_right_usd":0.19308900000000007,"price_yes_before":0.18997,"price_yes_after":0.136119,
          "liquidity_b_usd":3,"min_shares_micro":"1181158",
          "method":"LMSR closed form on the contract's public view (b implied by its cost-to-move figures)"},
 "call":{"contract":"market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet","method":"buy",
         "args":{"claim_id":6,"side":"no","amount_micro":"1000000","min_shares_micro":"1181158"},"deposit":"0","gas_tgas":30,
         "note":"Your market balance pays. Deposit test USDC first with ft_transfer_call to the m…"}}
```

On mainnet the note says USDC.

### `GET /x402/supported`, `POST /x402/verify`, `POST /x402/settle`

Our facilitator's own HTTP interface, for a server that holds the relayer key (`X402_RELAYER_PRIVATE_KEY`) with `X402_FACILITATOR_ROUTES` on. It refuses with 403 `not_our_payment` any requirements other than the ones `GET /v1` lists, so nobody can spend our relayer's gas. The hosted API sets `X402_FACILITATOR_ROUTES=0`, so these answer 404 there: it settles only its own calls, in turn, and records each one. Test: `services/api/test/credence.test.mjs`, "our facilitator's own routes settle only payments to us".

### Hosted read routes

These answer on the hosted API only, from the store's journals, the claims snapshot and the market's views (`api/_lib/routes.mjs`).

| Route | Answers |
|---|---|
| `GET /api/history?claim=<id>` or `?all=1` | Price history as `[t_ms, price_yes_ppm]` points. |
| `GET /api/portfolio?trader=<account or lane:ed25519:…>` | A trader's balance, positions and history. |
| `GET /api/activity?limit=` | The latest trades, rewrites, agents' answers and rulings. |
| `GET /api/rulings` | Live and past challenges, and the ruling clock. |
| `GET /api/attestations[?model=<id>]` | Each model's published proof; `?model=` adds the collateral. |
| `GET /api/lane/status[?publicKey=]` | Whether this visitor can still get a free bet. |
| `GET /api/pages`, `GET /api/pages/<slug>`, `GET /api/record` | The official pages, with `OFFICIAL_PAGES=1`: see [The official pages](#the-official-pages-official_pages1). |

### `GET /api/rulings`

Every challenge, newest first, and a clock that promises only what can happen. The AI jury sits daily: at the first cron run at or after `CHECKER_SITTING_HOUR_UTC` (default 15) the Checker challenges the doubted fact with the most bets, at most `CHECKER_PER_DAY` a day (default 1), one at a time. A fact with fewer than `CHECKER_MIN_BETS` bets (default 1) waits, so a ruling pays someone. A bet counts while someone still holds a position on the fact: bets sold back out don't. Tests: `services/api/test/engine.test.mjs`, "GET /rulings" and "the clock".

```
$ curl -s https://isitpriced.com/api/rulings
{"ruling_now":null,
 "next_challenge_at":1794063600000,
 "next_ruling_at":1794063600000,
 "next_ruling_note":"Today's ruling is done. The next sitting is tomorrow at 15:00 UTC",
 "sitting_hour_utc":15,"rulings_today":1,"per_day":1,"queue":4,"waiting_for_bets":3,
 "checker":{"account":"checker.isitpriced.near","balance_usd":2.95,"lines_left":4,"note":"today's sitting is done: 1 of 1"},
 "keeper_ran_at":"2026-11-07T16:20:02.510Z",
 "rulings":[…],"count":7,"asOf":1793981991113}
```

| Field | Type | Meaning |
|---|---|---|
| `ruling_now` | object or null | The live ruling: `challenge_id`, `claim_id`, `claim`, `stage` (`jury`, `window` or `escalated`), `provisional`, `verdicts`, `opened_at`, `jury_deadline_at`, `window_ends_at`, `finalize_due_at`, `live`. |
| `next_ruling_at` | ms or null | With no live ruling, the real next sitting. With one, when it settles. **null when no ruling is coming**, so a visitor sees no countdown. It is never in the past and doesn't slide. |
| `next_challenge_at` | ms or null | The same time as `next_ruling_at` when no ruling is live, else null. |
| `next_ruling_note` | string | One plain sentence to show a visitor. Always present. |
| `sitting_hour_utc` | number | The hour the jury sits. |
| `rulings_today` | number | The Checker's challenges opened today (UTC). |
| `per_day` | number | The Checker's most in a day. |
| `queue` | number | Doubted facts waiting, with or without bets. |
| `waiting_for_bets` | number | How many of those are short of `CHECKER_MIN_BETS`. |
| `checker` | object or null | `account`, `balance_usd`, `lines_left` (the same as `queue`), and `note`: the operator's reason it did or didn't act on the last run. null before the keeper's first run. |
| `keeper_ran_at` | ISO time or null | The keeper's last run. |
| `rulings`, `count`, `asOf` | | Every challenge, how many, and the claims snapshot's time. Each ruling carries `receipt_check` and `sentinel`, below. |

The clock's states, first match wins. `queue`, `waiting_for_bets` and `rulings_today` are read at request time, so a bet shows at once. The rest comes from the keeper's last run.

| State | `next_ruling_at` | `next_ruling_note` |
|---|---|---|
| The jury is ruling | when it should settle: if the jury runs late, its deadline; null if that isn't known | Three AI judges are ruling on this fact now |
| The objection window is open | the first cron run after it closes | Anyone can object with twice the bond until the window closes, then the keeper settles it |
| Escalated | null | This ruling went to the council after three disputes |
| No Checker key, `CHECKER_ENABLED=0`, or no keeper run yet | null | The jury isn't sitting right now |
| Empty queue | null | No doubted fact is waiting for the jury |
| Every queued fact is short of bets | null | No doubted fact has a bet yet, so the next sitting waits for one |
| The Checker can't cover the bond | null | The next sitting waits for the Checker's bond to be funded |
| The last challenge was really refused | null | Today's sitting is delayed while the keeper tries again |
| `per_day` reached, or the signer's cap | tomorrow's sitting | Today's ruling is done. The next sitting is tomorrow at 15:00 UTC |
| Before today's sitting | today's sitting | The jury sits daily at 15:00 UTC |
| The sitting is due | the next cron run | The jury sits within the next 10 minutes |

The signer's daily caps stay above this as a safety net: `SIGNER_DAILY_CHALLENGES` (default 6) and `SIGNER_DAILY_OPENS` (default 12, enough for a full day of corrected lines and a day's backlog). The keeper asks where they stand before it acts. Reaching a cap, or having nothing eligible, leaves `/health`'s cron check ok with no failure strings, and a corrected line held by the cap opens on a later run. Any other refusal is a failure.

#### Each ruling's `receipt_check` and `sentinel`

Every ruling in `rulings` has both fields. Both are null on a ruling nothing has checked yet, such as a past challenge whose evidence can't be checked without a live fetch. The field names are stable. Measured results are in `deployments/sentinel-test.json`, and the threat they answer is in [THREAT_MODEL.md](THREAT_MODEL.md), threats 1 and 2. Code: `services/ai/src/receipts.js`, `services/ai/src/support.js`, `services/ai/src/sentinel.js`. Tests: `services/ai/test/receipts.test.mjs`, `services/ai/test/support.test.mjs`, `services/ai/test/sentinel.test.mjs`, and `services/api/test/engine.test.mjs`, "GET /rulings: each ruling says what its receipts were".

```
"receipt_check": {
  "result": "quote_not_found",
  "reason": "The quoted words \"Tether Holdings Limited, a company...\" are not at https://tether.to/en/legal/ (HTTP 200, fetched 2026-11-06T15:00:02Z).",
  "checked_at": "2026-11-06T15:00:02.512Z",
  "via": "source",
  "record": null,
  "quotes": [{ "text": "Tether Holdings Limited, a company incorporated and headquartered in Zug, Switzerland", "found": false, "url": null }],
  "sources": [{ "url": "https://tether.to/en/legal/", "via": "source", "status": 200, "sha256": "4f2a...", "bytes": 147739, "content_type": "text/html; charset=UTF-8", "fetched_at": "2026-11-06T15:00:02.301Z", "error": null }],
  "support": null
},
"sentinel": {
  "status": "disputed",
  "note": "The receipts failed (quote not found): the Sentinel disputed in round 1 with a $2.00 bond.",
  "last_look_at": "2026-11-06T15:03:01.100Z",
  "disputes": [{ "round": 1, "bond_usd": 2, "tx": "8fQ...", "at": "2026-11-06T15:03:01.100Z" }]
}
```

`receipt_check`, or null:

| Field | Type | Meaning |
|---|---|---|
| `result` | string | One of the results below. |
| `reason` | string | One plain sentence saying why. |
| `checked_at` | ISO time | When the check ran. |
| `via` | `corpus`, `source` or null | `corpus`: settled against our committed record with no live fetch, as our Checker's are. `source`: settled by fetching. null: nothing to check. |
| `record` | object or null | The corpus record the evidence names: `id`, `found`, `hash_matches`, `sentence_matches`, `sha256_claimed`, `sha256_committed`. |
| `quotes` | array | Each quoted passage: `text`, `found`, and `url`, the source it was found at, or null. |
| `sources` | array | Each source: `url`, `via`, `status` (HTTP, or null with no answer), `sha256` of the bytes fetched, `bytes`, `content_type`, `fetched_at`, `error`. With `via: "corpus"` these are the corpus's own fetch, from `corpus/receipts/evidence-index.json`. |
| `support` | object or null | Set when the quotes verified at a live source: does that source support the challenge? `verdict` (`supported`, `unsupported`, `unclear` or `unanswered`), `unanimous` (two or more said the same and no model disagreed), `asked_at`, `url`, and `answers`: each model's `model`, `answer` (`YES`, `NO`, `UNCLEAR`, `UNPARSEABLE` or `ERROR`), `verified` (its signature checked against its attested key; only those count), `reason`, `request_hash`, `response_hash`, `signature`, `signing_address`. Never set on our corpus records. |

| `result` | Meaning | Our jury | The Sentinel |
|---|---|---|---|
| `verified` | Every quote is at its source, or the corpus record matches and holds them. | Called | Never disputes |
| `quote_not_found` | A quote is not at the sources fetched, or nothing quoted can be checked: a source with no quote from it, or a quote with no source. | Not called | Disputes a ruling for the challenger |
| `unfetchable` | A source could not be read: an HTTP error, a time-out, too large, not HTTPS, a private address, or nothing readable in it. | Not called; tried again after 10 minutes | Disputes a ruling for the challenger, after checking again |
| `record_mismatch` | The corpus record named doesn't exist, has no hash or another hash, is about another sentence, or says the opposite of the challenge. | Not called | Disputes a ruling for the challenger |
| `no_receipt` | No URL, no quote and no record: a bare accusation. | Not called | Records it and does not dispute: the jury refuses those |
| `unsupported` | Every quote is at its source, and at least two of the three attested models reading that source found it does not support the challenge: a real quote with a lie told around it. Also a FALSE on a news line before its date, refused in code with no model asked (`support.answers` empty, `support.unanimous` true). | Not called | Disputes a ruling for the challenger only if no model disagreed (`support.unanimous`) |

With `support.verdict` `unanswered` (fewer than two signed answers) the result stays `verified`, but our jury waits, because it needs the same models, and the question is asked again. The Sentinel doesn't dispute while it is unanswered. `unclear` is a pass: the source is raw data the excerpt can't settle.

Quotes are compared after normalising whitespace, case, quote marks, dashes, markdown and number formatting, so `122,839,738,995` and `122 839 738 995` match. A quote may skip words with an ellipsis. HTML, JSON, plain text and PDF are read. Fetching is HTTPS only, port 443, public addresses only (every address a name resolves to is checked, and every redirect is checked again; for IPv6 only global unicast counts), 10 s and 6 MB a source, at most six sources, 45 s for all of a check's fetches. A PDF is read on its own thread and refused past 8 s, 8 million characters of text, or 320 MB more memory, so a hostile file reads as `unfetchable` and stops nothing else.

`sentinel`, or null:

| Field | Type | Meaning |
|---|---|---|
| `status` | string | `watching`: live, and it will act if the outcome comes to side with a challenger whose receipts failed. `disputed`: it has posted at least one dispute here. `no_dispute`: it won't dispute, and `note` says why. `blocked`: it would dispute and can't, because of a cap, its balance, no key, the window closing, or a failed transaction. |
| `note` | string | One plain sentence for this ruling. |
| `last_look_at` | ISO time | The last time its decision here changed. A quiet minute writes nothing. |
| `disputes` | array | Its disputes on this challenge: `round`, `bond_usd`, `tx`, `at`. |

A challenge our jury refused stays `jury` until its deadline, unless someone else's jury rules. The clock says "Our jury isn't sitting on this challenge: its receipts did not verify", gives the deadline as `next_ruling_at`, and the challenge doesn't hold up the daily sitting. `GET /api/jury?challenge=<id>` shows the run with `status: "refused"`.

### `GET /api/sentinel`

The Sentinel's minute (`vercel.json`, `* * * * *`). Only Vercel's cron can call it: it needs `Authorization: Bearer <CRON_SECRET>`, and anything else gets 401. With no bond held on the market it costs one `stats` view call and answers `{"ok":true,"idle":true,...}`. Otherwise it looks at every live challenge and answers `{ok, at, live, disputed, blocked, errors, sentinel, ms}`. Its record goes to the store's `sentinel/ledger.json`, which `GET /api/rulings` reads.

### Today's claims, picks, reports and the board (`NEWS_ENABLED=1`)

**Off by default.** Everything in this section exists only when the API project has `NEWS_ENABLED=1`. Without it, every path below answers `404 not_found` as before, `GET /api/news` answers `{"ok":true,"off":true}` and does nothing, `/api/claims` carries no `news` field, and `/health` is unchanged. To turn it on: put `NEWS_ENABLED=1` in `.env` and run `node scripts/vercel/secrets.mjs --network mainnet`, then redeploy (`NEWS_ENABLED=0` there removes it again). Code: `api/_lib/news.mjs`, `api/_lib/picks.mjs`, `api/_lib/today-routes.mjs`, `api/news.mjs`, `services/ai/src/scout.js`, `gate.js`, `settle.js`. Tests: `services/api/test/today.test.mjs`, `services/ai/test/news.test.mjs`.

**What a news line is.** A claim from today's news that nobody had confirmed when it opened, with its deadline and its settling source inside the text the jury reads, for example `By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production. Reports citing unnamed sources don't count.` Every line ends with the rule "Reports citing unnamed sources don't count.", so the jury and the support panel apply it too. It is an ordinary market on the chain: page `news-YYYY-MM-DD` (the day it opened), kind `document` on the chain (the contract accepts only `data`, `document` and `judgment`; the API says `kind: "news"`), opened by the keeper's `open_claim` key at the scout's first estimate (clamped to 20..80%) with `NEWS_B_MICRO` of liquidity ($1.45 by default). It settles TRUE when the named source confirms it on or before the date, FALSE when the date passes without that or the source denies it. The question, topic, headline, settling source and first estimate live in the store (`news/lines.json`); every candidate the scout proposed, opened or refused, with the check that stopped it, is in the `scout.jsonl` journal.

**How one settles.** TRUE can come at any time, once the named source itself has said it: a report citing unnamed sources is not a confirmation. FALSE needs the date to have passed: nobody can show a news line FALSE before that, so a challenge that tries (anyone can post one) gets `receipt_check.result` `unsupported`, in code, with no model asked; our jury stays off it and the Sentinel disputes any ruling that takes it. Our Checker's FALSE also needs a second, separate web search that finds the claim unconfirmed. An absence can't be stated by a page, so on a news line a FALSE asks the support panel whether the source shows the matter was still unconfirmed (`ABSENCE_PROMPT` in `services/ai/src/support.js`), chosen only by the claim's own text and the side, never by the evidence. A line whose receipts don't pass waits, `overdue`, and is looked at again every `NEWS_DUE_LOOK_H`: a wrong settlement pays the wrong people, and a late one costs only the reserve it holds.

**The settings.** `NEWS_PER_DAY` (4), `NEWS_B_MICRO` (1450000), `NEWS_SCOUT_HOURS_UTC` (`6,18`), `NEWS_TREASURY_FLOOR_MICRO` (1500000: kept in the treasury, on top of the lane budget, which pays the free bets), `NEWS_MARKET_MIN_NEAR` (0.3: the market account's spare NEAR for storage the gate never touches, because past it nothing can be stored, free bets and trades included), `NEWS_WEB_VERIFY` (on; `0` skips the web check), `NEWS_REQUIRE_DEFINITE` (off; `1` passes only claims with an event due that settles them either way), `NEWS_SETTLE_BAR` (off; `1` makes our Checker's own receipts pass `settlerBar` in `services/ai/src/sources.js`: an official or primary source, or two independent hosts. On the recorded runs it strands 9 of 22 lines, see [THREAT_MODEL.md](THREAT_MODEL.md), threat 13), `NEWS_SETTLE_GRACE_H` (6), `NEWS_EARLY_LOOK_H` (24), `NEWS_DUE_LOOK_H` (12: how often a due line that can't settle yet is looked at again), `NEWS_SETTLE_PER_RUN` (3), `NEWS_SPEND_SHARE` (50: news stops at this percent of `NEARAI_DAILY_CAP_USD`, so the jury, the writer and the agents always have the rest), `NEWS_FEEDS` (extra feeds, `id|https://...|why;...`), `NEWS_SCOUT_MODEL`, `NEWS_REVIEW_MODEL`, `NEWS_VERIFY_MODEL`. The signer's own caps: `SIGNER_DAILY_NEWS_OPENS` (6), `SIGNER_DAILY_NEWS_CHALLENGES` (8), `SIGNER_DAILY_REPORT_CHALLENGES` (2), counted apart from the corrected lines' `SIGNER_DAILY_OPENS` and the sitting's `SIGNER_DAILY_CHALLENGES`. Limits per UTC day: `PICKS_PER_KEY_PER_DAY` (60), `PICKS_PER_IP_PER_DAY` (400), `PROFILES_PER_KEY_PER_DAY` (5), `PROFILES_PER_IP_PER_DAY` (60), `REPORTS_PER_KEY_PER_DAY` (3), `REPORTS_PER_IP_PER_DAY` (10); `LEADERBOARD_MIN_SETTLED` (5). Reports: `REPORT_CHECKS_PER_DAY` (30: checks run on reports in a day, the rest wait, so reports can't spend the scout's and the settler's model budget), `REPORT_KEEP_BONDS` (1: bonds a report leaves the Checker, so it can't take the daily sitting's), `REPORT_TRUSTED_HOSTS` (comma-separated hosts added to the pages the Checker bonds on).

**Signing.** Picks, nicknames and reports are signed by the ed25519 key the browser already holds for the free bet (`site/lib/core/lane.ts`; the same key, `ed25519:<base58>`). The browser signs the UTF-8 bytes of one exact message and sends the signature as 128 hex characters (or 88 base64). `issued_at` is the browser's clock in ms and must be within 10 minutes of the server's. With near-api-js:

```
const kp = KeyPair.fromString(savedSecret);                       // the lane key
const issued_at = Date.now();
const message = `pricedin|pick|v1|mainnet|${claim_id}|${side}|${issued_at}`;
const sig = kp.sign(new TextEncoder().encode(message)).signature;          // Uint8Array(64)
const signature = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
fetch("/api/picks", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ public_key: kp.getPublicKey().toString(), claim_id, side, issued_at, signature }) });
```

| What | The message |
|---|---|
| A pick | `pricedin\|pick\|v1\|<network>\|<claim_id>\|<yes or no>\|<issued_at>` |
| A nickname | `pricedin\|profile\|v1\|<network>\|<nickname, NFKC, trimmed, each run of spaces made one>\|<issued_at>` |
| A report | `pricedin\|report\|v1\|<network>\|<claim_id>\|<false or true>\|<sha256 hex of JSON.stringify([url, quote, note])>\|<issued_at>`, with `url` trimmed and `quote` and `note` trimmed and each run of whitespace made one space |

`<network>` is `mainnet` on isitpriced.com. A bad signature is `401 bad_signature` with the message the server expected; a stale one is `400 stale_signature`.

#### `GET /api/today`

Today's lines first (opened in the last 24 hours and still open), then the open ones settling soonest, then the ones decided in the last 7 days, newest first. CDN-cached for 5 s.

```
{"as_of":1794045600000,"date":"2026-11-07",
 "counts":{"today":1,"settling":2,"decided":1},
 "next_scout_at":1794088500000,
 "lines":[{
   "claim_id":40,"section":"today","kind":"news",
   "question":"Is Tesla ending Cybertruck production?",
   "claim":"By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production.",
   "topic":"Tech","why":"Tesla's most talked-about truck",
   "source":{"headline":"Tesla Is Ending Production of Its Cybertruck - The New York Times","url":"https://news.google.com/rss/articles/…","outlet":"The New York Times","published_at":1794038400000},
   "settles":{"by":"2026-11-13","by_words":"13 November 2026","due_at":1794614400000,"source":"Tesla's newsroom or an SEC filing","source_url":"https://ir.tesla.com/press","event":"Tesla announces the end of production, or says it continues","rule":"By 13 November 2026, Tesla or a Tesla filing confirms that it is ending Cybertruck production."},
   "first_estimate":0.45,
   "price_yes":0.45,"price_yes_ppm":450000,"trades":0,"volume_usd":0,"open_interest_usd":0,"liquidity_b_usd":1.45,
   "cost_to_move":{"up_10_points_usd":0.38,"down_10_points_usd":0.33},
   "status":"open","chain_status":"Open","overdue":false,"outcome":null,"decided_at":null,"ruling":null,
   "settler":null,
   "picks":{"yes":2,"no":1,"total":3},
   "bounty_usd":0,"opened_at":1794038700000,"open_tx":"8dZz…","url":"/c/40"}],
 "rules":{"lines":"Each line is a claim from today's news that nobody had confirmed when it opened. …","picks":"Picks are free and win nothing: no purchase, no prize, no payout. …"},
 "asOf":1794045600512}
```

| Field | Meaning |
|---|---|
| `section` | `today`, `settling` or `decided`. |
| `status` | `open` (takes bets and picks), `ruling` (a challenge is live: no picks) or `decided`. `chain_status` is the market's own (`Open`, `Challenged`, `Escalated`, `Settled`). |
| `overdue` | true when its date has passed and it is still open on the chain: the settler is looking for receipts that pass the check, or waiting for them. It takes no picks, and `settler.note` says why it hasn't settled. A line stays this way until its receipts pass: we would rather wait than pay the wrong side. |
| `outcome`, `decided_at` | `"true"`, `"false"` or null; the settle event's time in ms. |
| `ruling` | `{challenge_id, provisional}` while a challenge is live, else null. |
| `settles.due_at` | The end of the settle-by day (UTC), in ms: picks close then, and the settler looks after `NEWS_SETTLE_GRACE_H` more. |
| `settler` | null before the settler looked; else `{last_look_at, note, challenge_id}`, `note` one plain sentence (for example "Waiting for its date: the source may still confirm it."). |
| `picks` | Free picks on the line, first pick per key. |
| `first_estimate` | The scout's honest first estimate, 0..1; the line opened there (clamped to 20..80%). |

#### `GET /v1/today`

The same lines, compact, free with no key, cached for a minute, for a publisher to show or embed. Each line has the existing embed's iframe and script (`/embed/<id>`, `/embed.js`).

```
{"name":"Priced In: today's claims","network":"mainnet","contract":"market.isitpriced.near","as_of":"2026-11-07T10:00:00.000Z",
 "lines":[{"claim_id":40,"question":"Is Tesla ending Cybertruck production?","claim":"By 13 November 2026, …","topic":"Tech",
   "odds":{"yes":0.45,"no":0.55},"status":"open","outcome":null,"settles_by":"2026-11-13","settling_source":"Tesla's newsroom or an SEC filing",
   "headline":"Tesla Is Ending Production of Its Cybertruck - The New York Times","headline_url":"https://news.google.com/rss/articles/…",
   "url":"https://isitpriced.com/c/40",
   "embed":{"iframe":"https://isitpriced.com/embed/40","script":"<script src=\"https://isitpriced.com/embed.js\" data-fact=\"40\" async></script>"}}],
 "count":1,
 "terms":"Free, no key. Cached for a minute. …"}
```

**The truth API answers about news lines too.** `/v1/credence` (and so the MCP `ask` and `get_claim`, and x402) finds a news line by its claim or by its question, and its answer carries `news`: `{kind, question, topic, why, source, settles, first_estimate, opened_at, open_tx, coverage}` (the same `source` and `settles` as above; `coverage` is the links the gate's web check read, which the house agents use as sources). `/api/claims` and `/api/claims/<id>` carry the same `news` field on news lines and no new field on any other claim.

#### `POST /api/picks` and `GET /api/picks?key=` / `?claim=`

A free Yes or No on an open line, signed. No wallet, no money, no prize. The first pick on a line is final: the same pick again answers `200` with `duplicate: true`; the other side answers `409 already_picked`. A line takes picks while it is `Open` on the chain and, for a news line, before the end of its settle-by day. Body:

```
{"public_key":"ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","claim_id":40,"side":"yes","issued_at":1794045600000,"signature":"<128 hex>"}
```

`200 {"ok":true,"pick":{"claim_id":40,"side":"yes","at":1794045600400,"price_yes_ppm":450000},"rules":"Picks are free and win nothing: …"}`. The market's price at that moment is kept with the pick: it sets the points a right pick earns.

Refusals: `400` `invalid_public_key`, `invalid_claim_id`, `invalid_side`, `invalid_signature`, `invalid_issued_at`, `stale_signature`; `401 bad_signature`; `404 no_such_claim`; `409 line_closed` (settled, a ruling running, or the date passed: the message says which) or `already_picked` (with `pick`); `429 rate_limited` with `retryAfterS`; `503 busy` with `retryAfterS` when the store can't count the limit. Picks, profiles and reports all fail closed this way: try again in a moment.

`GET /api/picks?key=<public key>`: `{key, nickname, name, stats, picks, rules}`. `stats` is all-time: `{accuracy, settled, right, points, streak: {current, best}, picks_today, picks_total, open_picks, caught, ranked, min_settled}` (`accuracy` is null before any pick settles). Each pick: `{claim_id, side, at, price_yes_ppm, question, claim, state, points, settled_at, message, signature}`, `state` one of `open`, `ruling`, `right`, `wrong`.

`GET /api/picks?claim=<id>`: everyone's picks on one line, published so anyone can check them: `{claim_id, yes, no, total, picks: [{key, name, side, at, price_yes_ppm, message, signature}], verify}`, the newest 200.

#### `POST /api/profile` and `GET /api/profile?key=`

A nickname, signed the same way: 3 to 20 characters of letters, digits, spaces, dots, dashes and underscores, with a letter, in one alphabet (Latin, Cyrillic or Greek, not two). Slurs and profanity are refused (`400 nickname_refused`), and so is anything that could pass for Priced In, one of its AIs or a visitor's default name, look-alike letters included (`400 nickname_reserved`: Priced In, admin, official, Checker, Sentinel, the Archivist, the Skeptic, the Quant, Visitor, and the like). The first key to take a name keeps it (`409 nickname_taken`, compared without case, spaces or look-alike digits). Body `{public_key, nickname, issued_at, signature}`; `200 {"ok":true,"key":"ed25519:…","nickname":"Diego"}`. `GET` answers `{key, nickname, name, stats, rules}`; `name` is the nickname or `Visitor` and the start of the key.

#### `GET /api/leaderboard?period=week|month|all`

People and the three house AI traders side by side, so "you against the AIs" counts the same thing for both. A person's pick is their first pick on a line; an AI's pick is its first buy on a line, at the price just before that buy. A pick counts in the period its line settled in (`week` is the last 7 days, `month` the last 30). Ranked once an entry has `min_settled` settled picks in the period: by accuracy, then by how many settled, then by points. A right pick earns `round(100 × (1 − the price of its side when picked))` points, at least 1, so calling what the market doubted earns more; a wrong one earns 0. A verified catch the jury upheld adds 1 to `caught` and 100 points. CDN-cached for 15 s.

```
{"period":"week","window":{"from":1793440800000,"to":1794045600000},"min_settled":5,
 "board":[{"rank":1,"kind":"ai","id":"h-quant.isitpriced.near","name":"Quant","accuracy":1,"settled":6,"right":6,"points":300,"streak":{"current":6,"best":6},"picks_today":0,"picks_total":6,"open_picks":0,"caught":0,"ranked":true},
          {"rank":2,"kind":"person","id":"ed25519:6237…","name":"Diego","accuracy":0.833,"settled":6,"right":5,"points":250,"streak":{"current":0,"best":5},"picks_today":2,"picks_total":8,"open_picks":2,"caught":0,"ranked":true}],
 "waiting":[{"kind":"person","id":"ed25519:9Fx…","name":"Visitor 9FxQ2a","accuracy":1,"settled":2,"right":2,"points":150,"streak":{"current":2,"best":2},"picks_today":1,"picks_total":3,"open_picks":1,"caught":1,"ranked":false,"needs":3}],
 "ai":[{"kind":"ai","id":"h-quant.isitpriced.near","name":"Quant","rank":1,…},{"kind":"ai","id":"h-skeptic.isitpriced.near","name":"Skeptic","rank":null,…}],
 "you_vs_ai":{"best_ai":{"id":"h-quant.isitpriced.near","name":"Quant","accuracy":1,"settled":6,"rank":1},"people_ranked":1,"people_ahead_of_best_ai":0},
 "totals":{"people":2,"picks":11,"ai_picks":8,"settled_picks":14,"catches_upheld":1},
 "rules":"Picks are free and win nothing: no purchase, no prize, no payout, no sweepstakes. …",
 "asOf":1794045600512}
```

`waiting` lists people short of `min_settled` (the 50 closest), each with `needs`. `ai` always lists every house AI trader, with its `rank` or null. The AI traders are `h-archivist`, `h-skeptic` and `h-quant` under the market's owner, named from their own answers; `LEADERBOARD_AI=account=Name,...` replaces the list.

#### `POST /api/reports` and `GET /api/reports?id=|key=|claim=`

Catch a mistake: the free path. A line (any open line, news or Wikipedia), a public page and the exact words from it, and a note, signed. Body:

```
{"public_key":"ed25519:…","claim_id":7,"says":"false","url":"https://tether.io/news/…","quote":"the exact words from that page, 3 or more words","note":"Why the line is wrong (optional, 600 characters)","issued_at":1794045600000,"signature":"<128 hex>"}
```

`says` is `false` (the line is wrong, the default) or `true`. `202 {"ok":true,"report":{…,"status":"received"},"next":"GET /api/reports?id=<id>"}`. One report at a time per line: `409 already_reported` while one is being checked or ruled on. A note or quote with a slur or a profanity is refused (`400 report_refused`), a quote with a link in it is `400 invalid_quote`, and a URL with characters the receipt check would split it at is `400 invalid_url`.

**Whose page the Checker bonds on.** A report is free and a bond is ours, and a page the reporter wrote would pass every check, so the page must be one of: the line's own sources (its settling source and the gate's coverage links, same host; on a host anyone can post to, such as x.com or docs.google.com, only that very page), an official site (`.gov`, `gov.uk`, `europa.eu`, `.int` and the like), or an established outlet (`OUTLETS` in `api/_lib/picks.mjs`, widened with `REPORT_TRUSTED_HOSTS`). Any other page is `400 untrusted_source` with the line's `hosts` and a pointer to `GET /api/challenge`, where a reader can bring that page with their own bond. A redirect to any other page is refused after the fetch.

Then, within minutes (and on the hourly run): the receipt check runs on it, as our jury runner checks a challenge (the page fetched, the words found at it, then the three attested models asked whether the page supports the report). The bar is higher than our jury's: at least two models say yes and none says no or unclear. If it passes, our Checker challenges the line with the reader's receipt and its own $1 bond, under `SIGNER_DAILY_REPORT_CHALLENGES`, as long as that leaves it `REPORT_KEEP_BONDS` for the daily sitting, and the jury is called at once. The evidence on-chain is their page and their exact words and nothing else: the note stays in our store, so free text never goes on-chain under our Checker's key and can't add a source to what the check reads.

Each report: `{id, key, claim_id, says, url, quote, note, at, status, reason, challenge_id, challenge_tx, decided_at, check, message, signature}`, `check` `{result, support}` once checked. `status`, with `reason` in plain words:

| `status` | Meaning |
|---|---|
| `received` | Waiting for the check. |
| `retry` | The page couldn't be read or the models didn't answer; it runs again (twice at most). |
| `refused` | The check failed. `reason` says why: "We couldn't find those exact words at that page. …", "We couldn't read that page …", "The words are on that page, but our three AI checkers found the page doesn't show the line is wrong." |
| `verified` | It passed; the challenge is next. |
| `challenged`, `ruling` | The Checker challenged with it; the jury is ruling. |
| `upheld` | The line settled the reader's way: a catch, on the leaderboard. |
| `rejected` | It settled the other way. |
| `expired` | The ruling ran out of time without a decision. |
| `closed` | The line stopped taking challenges before we could act, or we could not finish within two days: `reason` says which. It no longer holds the line, so anyone can send another. |

#### `GET /api/challenge?claim=<id>`

The money path: what a wallet needs to challenge a line itself with its own bond (`challenge` on the market), the line's bounty, and what happens next.

```
{"claim_id":7,"claim":"…","status":"Open","open":true,"why_not":null,
 "call":{"contract":"market.isitpriced.near","method":"challenge","args":{"claim_id":7,"claimed_outcome":false,"evidence":"<your receipt: see evidence>"},"deposit":"0","gas_tgas":30},
 "bond":{"micro":"1000000","usd":1,"from":"Your balance in the market. Deposit USDC first: ft_transfer_call to market.isitpriced.near with msg \"\". The free $1 can't be a bond: lane keys can't challenge."},
 "evidence":{"max_bytes":4000,"format":"…\"Source: <a public https:// page>\" … \"Receipt excerpt: \"<the exact words from that page>\"\" …","checked":"…"},
 "claimed_outcome":"false if the line is wrong; true if it is right and you want it settled TRUE.",
 "after":"POST /api/after-challenge {txHash, signerId}: three AI judges rule within minutes. …",
 "outcomes":{"right":"Your bond comes back, the line's bounty is yours if it has one, …","wrong":"Your bond goes to whoever was right (the treasury, if nobody disputed)."},
 "bounty":{"usd":0,"pays":"the first challenger whose claimed outcome wins","fund":{"contract":"market.isitpriced.near","method":"fund_question","args":{"claim_id":7,"amount_micro":"<at least 10000>"},"note":"…"}}}
```

A news line's answer also carries its `settles`. Nothing here funds a bounty: `bounty.usd` is what the line holds, from `bounty_micro` on the chain.

#### `GET /api/news` (the cron)

Hourly (`vercel.json`, `5 * * * *`), and `POST /api/news?job=reports` from this API when a report arrives. Only Vercel's cron and this API can call it: `Authorization: Bearer <CRON_SECRET>`, else 401. With `NEWS_ENABLED` unset it answers `{"ok":true,"off":true,…}` and does nothing. On, one round: readers' reports waiting for their check; at `NEWS_SCOUT_HOURS_UTC`, the scout; then news lines that came due (or an early look for a confirmation). Model work stops at `NEWS_SPEND_SHARE` of the day's cap. It answers `{ok, at, job, reports, settle, scout, ms, spend}`; `scout` is `{slot, headlines, candidates, passed, opened: [{claim_id, tx, question}], refused: {<check>: n}, headroom_usd, feeds_failed, errors}`. `?job=scout&force=1` runs the scout outside its hours (once per hour slot). Model calls count against `NEARAI_DAILY_CAP_USD`. The writer never rewrites a news page: a day's news lines are not a paragraph.

### The official pages (`OFFICIAL_PAGES=1`)

An encyclopedia page written by AI from what the market believes right now (`api/_lib/pages.mjs`). Off by default: with the flag unset these routes answer 404, the cron sweeps nothing, and the writer's requests are byte for byte what they were. To turn it on, put `OFFICIAL_PAGES=1` in `.env`, run `node scripts/vercel/secrets.mjs --network mainnet`, and deploy the API. The site reads these routes and follows.

| Setting | Default | Means |
|---|---|---|
| `OFFICIAL_PAGES` | unset | `1` turns all of this on. |
| `WRITER_SWEEP_PER_RUN` | `3` | The most paragraphs one cron run rewrites (0 to 20). |
| `WRITER_SWEEP_SHARE` | `60` | The sweep stops when today's model spend reaches this percent of `NEARAI_DAILY_CAP_USD`, so the jury and the Sentinel's panel keep the rest. |

**What a paragraph is.** The pinned revision's sections, four sentences at a time, as the site cuts them. `api/_data/articles/` holds the text (`node scripts/vercel/articles.mjs` writes it from `corpus/pages/`, `--check` compares). A sentence joins its market by its exact text. A paragraph's `index` is stable: it counts from the top of the pinned article, and lines the revision doesn't hold go in one last paragraph.

**What each sentence says, in order:**

| `written_by` | When | The words |
|---|---|---|
| `wikipedia` | No market (`claim: null`). | Wikipedia's. A rewrite never touches them and the page claims no view. |
| `wikipedia` | A market nobody has bet on (`claim.trades` 0), or one in the hedge band whose sentence already says who says so ("Tether claims ..."). | Wikipedia's. An opening price is an estimate, so "disputed" or "traders doubt" would be false about a market nobody traded. |
| `ruling` | Ruled true. | The claim, plainly. |
| `correction` | Ruled false, and its correction opened as a market. | The correction's, in the same place: the page never says both. |
| `ai` | Ruled false, no correction yet, and a source gives the wording: our corpus's record, or a ruling's receipts the check found at the source. | The model's, band `correct`. |
| `ruling` | Ruled false, and no source gives the wording. | "Three AI judges ruled this false: <the line>", or "The council ...". |
| `ai` | Anything else with a market. | The newest words a model wrote for it, in the band of its price when written. `written.current` is false when the price has since left that band. |
| `market` | A line the revision doesn't hold. | The line as opened. |

Decided lines are stated from the chain, so they change at once and wait for no sweep. A template is never the market's words, and neither is a signature that failed its check.

**The sweep** runs inside the cron's writer job. It takes the paragraphs with a sentence that has no rewrite yet (`why: "new"`), that left the band it was written in (`band`), that was ruled false with a source and has no correction (`decided`), or whose signature never landed (`unsigned`). Stalest first; among those never written, the page with the most facts first. A try that came to nothing waits an hour. Only rewrites by the page writer count (`page_writer` on the record): older ones were written from another prompt, for other paragraphs. The cron's record and `GET /api/pages` say what it did and why it stopped:

```
"sweep":{"at":"2026-11-07T16:20:02.510Z","due":16,"per_run":3,
 "rewritten":[{"id":"tether:0:v1","why":"new","status":"signed"}, …],
 "stopped":"the sweep stops at 60% of the daily model cap so the jury and the Sentinel keep the rest: $0.60 of $1.00 is spent"}
```

A rewrite is one model call of about 1,100 tokens in and 60 out, about $0.00013 at the live price, plus one `anchor_rewrite` of 2.76 Tgas, about 0.00025 NEAR (`deployments/pages-test.json`). The anchor stores a counter and a log line, so the market's storage doesn't grow.

#### `GET /api/pages/<slug>`

Also `GET /v1/pages/<slug>`, free. Cached 10 s by the CDN. 404 `no_such_page` for a slug that isn't an article. These shapes are the ones `services/api/test/pages.test.mjs` checks; long values are cut.

```
{"slug":"tether","title":"Tether (cryptocurrency)",
 "source":{"url":"https://en.wikipedia.org/w/index.php?title=Tether_(cryptocurrency)&oldid=…","attribution":"…licensed CC BY-SA 4.0…","licence":"CC BY-SA 4.0","revised_at":"2026-10-30T17:27:49Z"},
 "totals":{"paragraphs":52,"written_by_ai":11,"sentences":190,"facts_priced":20,"facts_decided":0,"facts_no_bets":7,"rewrites":11,"signed":9,"anchored":9,"last_changed":1794064311697,"models":["z-ai/glm-5.3-flash"]},
 "paragraphs":[
  {"index":0,"section":"","written_by":"ai","changed":true,
   "wikipedia":"Tether is a stablecoin… It is represented by its currency codes USD₮ and USDT. …",
   "market":"Tether is a stablecoin… It is probably represented by its currency codes USD₮ and USDT. …",
   "diff":[{"op":"eq","text":"Tether is a stablecoin… It is "},{"op":"ins","text":"probably "},{"op":"eq","text":"represented by…"}],
   "sentences":[
    {"text":"Tether is a stablecoin…","written_by":"wikipedia","claim":null},
    {"text":"It is probably represented by its currency codes USD₮ and USDT.","wikipedia":"It is represented by its currency codes USD₮ and USDT.","written_by":"ai","ruled":[],
     "claim":{"id":0,"text":"It is represented by…","price_yes":0.812063,"band":"hedge","trades":2,"status":"open","outcome":null,"url":"/c/0"},
     "written":{"rewrite_id":"tether:0:v1","band":"hedge","price_yes":0.812063,"current":true}}],
   "rewrites":[{"id":"tether:0:v1","version":1,"written_at":1794064311697,"updated_at":1794064318000,"trigger":"sweep","page_writer":"page-1",
     "prices":[{"claim_id":0,"price_yes":0.812063,"band":"hedge"},{"claim_id":1,"price_yes":0.794,"band":"hedge"}],
     "prices_canonical":"{\"page\":\"tether\",\"paragraph\":0,\"version\":1,\"prices\":[[0,812063],[1,794000]]}","prices_hash":"…",
     "signature":{"status":"signed","verified":true,"model":"z-ai/glm-5.3-flash","signing_address":"…","request_hash":"…","response_hash":"…","reason":null},
     "anchor":{"status":"anchored","tx":"…","explorer":"https://nearblocks.io/txns/…"}}]}],
 "asOf":1794064400000}
```

| Field | Meaning |
|---|---|
| `totals.written_by_ai` | Paragraphs with at least one sentence a model wrote, a correction included. |
| `totals.facts_priced` | Sentences with a market. `facts_decided` of them are settled and `facts_no_bets` have no bets. |
| `totals.last_changed` | The newest rewrite in use or ruling on the page, in ms. |
| `paragraphs[].written_by` | `ai`, `market` (only a ruling or an added line changed it) or `wikipedia`. |
| `paragraphs[].wikipedia`, `market`, `diff` | The two texts, and the word diff from one to the other. `wikipedia` is null on the last paragraph of added lines, and `diff` is null when nothing changed. |
| `sentences[].ruled` | The lines ruled false before this one in the same place: `claim_id`, `text`, `outcome`, `by`, `challenge_id`, `decided_at`, `tx`, `explorer`, `url`. |
| `sentences[].decided` | The same fields, for a settled claim. |
| `claim.band` | The band of its price now, null once decided. |
| `rewrites[].prices_canonical` | The exact string `prices_hash` is the sha256 of, and the hash `anchor_rewrite` put on-chain. |
| `rewrites[]` | The proof. The exact request and response bytes stay on `GET /rewrites?page=<slug>&history=1`, where the check that "the words on the page are the words the model signed" runs. |

#### `GET /api/pages`

Also `GET /v1/pages`, free. Every live page, the same `totals` flat on each, the page with the most facts first.

```
{"pages":[{"slug":"tether","title":"Tether (cryptocurrency)","paragraphs":52,"written_by_ai":11,"sentences":190,"facts_priced":20,…,"url":"/p/tether"}, …],
 "count":10,"encyclopedia":20,"record":{"count":0},"sweep":{…},"asOf":1794064400000}
```

#### `GET /api/record`

Also `GET /v1/record`, free. Each decided news line, newest first. With `NEWS_ENABLED` off it is `{"lines":[],"count":0,"asOf":…}`.

```
{"lines":[{"claim_id":41,"question":"…?","topic":"Tech","claim":"By 13 November 2026, …","outcome":"false",
   "text":"Three AI judges ruled this false: By 13 November 2026, …","decided_at":1794400000000,"by":"three AI judges",
   "sources":[{"kind":"settled_by","label":"X's newsroom","url":"https://…"},{"kind":"headline","label":"…","url":"https://…"},{"kind":"receipt","label":null,"url":"https://…"}],
   "ruling":{"challenge_id":8,"url":"/c/41#ruling","tx":"…","explorer":"https://nearblocks.io/txns/…"},"market_url":"/c/41"}],
 "count":1,"asOf":1794400100000}
```

`sources[].kind` is `settled_by` (the source the line named), `headline` (what it came from), `receipt` (what the jury's evidence cited) or `coverage`.

## services/ai (mounted on services/api by `services/ai/src/mount.js`)

### `GET /ai/status`

The same block as `checks.ai` in `/health` (above): writer, signer, agents, anchoring, jury and attestations, each with its reason when off.

### `GET /agents`

```
$ curl -s http://127.0.0.1:8797/agents
{"agents":[],"unheld":0,"swarm":"swarm.pimw3dxfzp.basalt-lane-mw2skhdc.testnet",
 "state":{"status":"off","reason":"NEARAI_API_KEY is not set: agents form no credences without a model, so they stay silent"}}
```

That is the testnet run with no key. On the hosted API, `GET /api/agents` lists the house agents, which trade on mainnet with real USDC.

### `GET /rationales?claim=<id>|page=<slug>|agent=<id>`

```
$ curl -s 'http://127.0.0.1:8797/rationales?claim=6'
{"rationales":[],"agents":{"status":"off","reason":"NEARAI_API_KEY is not set: agents form no credences without a model, so they stay silent"}}
```

### `POST /agents/runner-key`

Body `{"persona": {...}}`. Registers a persona and returns a runner public key whose private half only the signer holds, plus the exact `spawn_agent` call. At most five keys an hour per address.

```
$ curl -s -X POST -H 'content-type: application/json' -d '{"persona":{}}' http://127.0.0.1:8797/agents/runner-key
HTTP 503 {"error":{"code":"agents_off","message":"This API runs no swarm agents."}}
```

With a signer and a swarm, the 200 body is `{runner_public_key, persona_hash, persona, spawn: {contract, method: "spawn_agent", args, min_deposit_yocto}, note}` (`mount.js`).

### `GET /ai/usage/<usage_hash>`

The exact usage JSON behind an on-chain inference bill, so anyone can check a `charge` or `sweep` event's `usage_hash`.

```
$ curl -s http://127.0.0.1:8797/ai/usage/0000000000000000000000000000000000000000000000000000000000000000
HTTP 404 {"error":{"code":"no_such_usage","message":"No inference bill with that usage hash."}}
```

No bill exists on the testnet deployment. Billing is tested offline (`services/ai/test/billing.test.mjs`).

### `GET /jury?challenge=<id>`

```
$ curl -s 'http://127.0.0.1:8797/jury?challenge=0'
{"run":null,"jury":{"status":"off","reason":"NEARAI_API_KEY is not set"}}
```

The jury path ran on testnet with mock models in `services/ai/test/jury-e2e.mjs` (20 of 20, "two verdicts verified on-chain", "a forged verdict is refused on-chain").

### `GET /attestations` and `GET /attestations/<file>`

The verified attestation bundles of the three jury models, fetched from the real NEAR AI Cloud with `npm run ai:attest` (no key needed).

```
$ curl -s http://127.0.0.1:8797/attestations
{"attestations":[],"files":["deepseek-ai__DeepSeek-V4.1-Flash-1017.json","Qwen__Qwen3.8-27B.json","z-ai__glm-5.3-flash.json"]}

$ curl -s http://127.0.0.1:8797/attestations/z-ai__glm-5.3-flash.json
{"model":"z-ai/glm-5.3-flash","fetched_at":"2026-11-05T03:53:15.784Z","nonce":"9fa9a0efbaa3b57d19482263d9cdc353952df5d24e090f1c1717a5666d40dd1c",
 "request":{"url":"https://cloud-api.near.ai/v1/attestation/report?model=z-ai%2Fglm…","headers":{"x-no-aliasing":"true"},…},
 "verdict":"verified","verified_signers":{"0":{"signing_address":"5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff","signing_algo":"ed25519"}},
 "verifiers":{"quote":"dcap-qvl@0.7.1 (Intel DCAP, collateral from Phala PCCS)","gpu":"NVIDIA NRAS v3 (verdict over TLS; JWT signature not checked locally)"},
 "verification":{"0":{"ok":true,"checks":{"signer":{"ok":true,…},"nonce_echo":{"ok":true,…},"intel_quote":{"ok":true,"tcb_status":"UpToDate",…},
   "debug_off":{"ok":true},"report_data_binding":{"ok":true,…},"mr_config_id":{"ok":true,…},"rtmr3_event_log":{"ok":true,…},
   "gpu":{"ok":true,"overall":true,"arch":"HOPPER","gpus":8,…}}}}}
```

The real key `5a0210f2...caff` is **not** the key registered on the testnet market (`49468af2...512c`, a test key). See [TRUST.md](TRUST.md).

## MCP tools (`tools/mcp`, `pricedin-mcp`)

`claude mcp add pricedin -- npx -y pricedin-mcp`. With nothing set it talks to the hosted API on mainnet; `tools/mcp/README.md` has the setup for other clients and every setting. JSON-RPC over stdio (newline-delimited) or streamable HTTP (`POST /mcp`, `npx -y pricedin-mcp --http --port 8788`). Protocol versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05. The transcript below is real: `tools/mcp/bin/pricedin-mcp.mjs` over stdio against the local API above, 2026-11-05, with no NEAR key.

```
-> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docs","version":"1"}}}
[stderr] pricedin-mcp: API http://127.0.0.1:8797, testnet, no NEAR key (ask and quote work; bet is refused; paid calls are not made)
-> {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
<- tools: ask, get_claim, quote, bet
```

### `ask`

Input `{question: string (2..600), page?: string, limit?: 1..10}`. Calls `GET /v1/credence`. Returns readable text plus `structuredContent` with the full JSON. Real call, `npm run truth:smoke` on testnet (`.apex/streams/truthapi-result.md`):

```
-> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask","arguments":{"question":"Does Tether issue USDT on NEAR?"}}}
<- The closest claim: "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Liquid Network, Near, Polygon, Solana, Bitcoin Cash's Standard Ledger Protocol, Statemint, Tezos, and Tron." The market prices this at 19% true, with $4.55 riding on it; it costs $0.40 to push it 10 points up, $2.24 to push it 10 points down.
   Claim 6 (page tether): …
   Match: close, score 0.627
   Credence: 19% true · $4.55 open interest · +10 pts costs $0.40, -10 pts $2.24
```

A real Claude Code session also called `mcp__pricedin__ask` against the testnet deployment (log in the git-ignored `.apex-test/truth-claude-code-session.jsonl`, summary in `.apex/streams/truthapi-result.md`).

### `get_claim`

Input `{claim_id: integer}`.

```
-> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_claim","arguments":{"claim_id":6}}}
<- isError=false
Claim 6 (page tether): "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS, Liquid Network, Near, Polygon, Solana, Bitcoin Cash's Standard Ledger Protocol, Statemint, Tezos, and Tron."
Credence: 19% true · $4.55 open interest · +10 pts costs $0.40, -10 pts $2.24
Resolution: Open: nobody has challenged it. The price is the market's credence.
Rationales: none posted yet.
Provenance: market.pimw3dxfzp.basalt-lane-mw2skhdc.testnet on testnet, claim 6 (view get_claim {"claim_id":6}); last rewrite tether:2:v1 signed by z-ai/glm-5.3-flash (ed25519 82bdc042e14989f6…), anchored in https://testnet.nearblocks.io/txns/BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse. Signed by the deployment's TEST writer key (services/ai's offline NEAR AI stand-in), not NEAR AI Cloud.
Free calls left today from this address: 19 of 20.
```

### `quote`

Input `{claim_id: integer, side: "yes"|"no", amount_usd: number (0..1000]}`. Calls `GET /v1/quote`. Read-only.

```
-> {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"quote","arguments":{"claim_id":6,"side":"no","amount_usd":1}}}
<- isError=false
$1.00 on NO of claim 6 ("Tether issues tokens on …") buys 1.1931 shares at 0.8382 each: pays $1.19 if NO is right (profit $0.19). The price moves from 19% to 13.6% YES.
```

### `bet`

Input `{claim_id, side, amount_usd, faucet?: boolean}`. Signs with the caller's own key from `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY`. It reads `get_balance`, takes the test USDC faucet on testnet if needed, deposits the shortfall with `ft_transfer_call`, then calls `buy` with `min_shares_micro` 1% under the quote (`tools/mcp/src/near.mjs`). Capped by `PRICEDIN_MAX_BET_USD` ($1 by default on mainnet, $5 on testnet).

Without a key:
```
-> {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"bet","arguments":{"claim_id":6,"side":"no","amount_usd":1}}}
<- isError=true
Refused: bet signs with your own NEAR key, and none is set. Put NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY (a full-access key of your own account) in this MCP server's environment. Priced In never signs for you.
```

With a key, a real bet of $0.05 YES on claim 19 moved YES from 51.6% to 52.4%: deposit tx `ASWrFLKs2PBGRgXKSVhMXF8FKkiRw243iWQ33G6yJhb9`, buy tx `G3h31QRytntLETdcYSsxMUkeYCroJQsFFzDqf8fFWLEz` (`.apex/streams/truthapi-result.md`).

**Paying from the MCP server.** With a key set, metered calls pay a 402 by themselves through `@fastnear/x402`'s `createNearPaymentFetch`, up to `PRICEDIN_MAX_PAY_USD` ($0.05) a call. `PRICEDIN_PAY=0` turns it off. Test: `tools/mcp/test/mcp.test.mjs`, "x402 through the tools: ... with the caller's key: a real x402 client pays".
