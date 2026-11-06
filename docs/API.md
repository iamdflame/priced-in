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
