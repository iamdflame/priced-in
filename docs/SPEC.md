# Market specification

This is what `contracts/market/src/lib.rs` (the contract `PricedIn`), `crates/lmsr/src/lib.rs` and `crates/rules/src/lib.rs` do, function by function. Where this text and the code disagree, the code wins; please report it.

Checks that run this spec: `cargo test -p lmsr --release` (8 tests), `cargo test -p rules --release` (9 tests), `npm run judge` checks 1 and 2, and `node contracts/market/test/lifecycle.mjs` (238 checks on testnet; the last full run is in `.apex/streams/contract-v3-result.md`). Quoted check names below are from that file.

## Units

| Quantity | Unit |
|---|---|
| Money and shares inside the maths | `i128` at `SCALE` = 1e12 per dollar or per share (`lmsr::SCALE`) |
| Money and shares in the contract's storage and API | micro-USDC (1e-6 dollar) and micro-shares. `MICRO` = 1,000,000 SCALE units per micro (`lmsr::MICRO`) |
| Prices | ppm in views and events (`price_yes_ppm`), so 500000 is 50% |
| Time | nanoseconds on-chain (`*_ns`), seconds in settings (`*_secs`) |

One share pays $1 if its side wins.

## The LMSR (`crates/lmsr`)

### Closed forms

With liquidity `b` and the opening log-odds `d0 = ln(p0 / (1 - p0))`:

```
d(q)       = d0 + (q_yes - q_no) / b
price_yes  = sigmoid(d)              (Market::price_yes)
price_no   = 1 - price_yes           (Market::price_no)
C(q)       = q_no + b * softplus(d)  (Market::cost), softplus(x) = ln(1 + e^x)
```

A trade is charged `C(after) - C(before)`, rounded in the market's favour, so the money collected equals `C(final) - C(open)` up to rounding, whatever the path. The maker's worst-case loss is `b ln(1/p0)` if YES wins and `b ln(1/(1-p0))` if NO wins (`Market::max_loss`).

The functions `exp`, `expm1`, `ln`, `softplus` and `sigmoid` are fixed-point series at SCALE. `exp` saturates at e^40 and returns 0 below e^-40.

### Buying (`Market::quote_buy`)

Shares for a spend `m` on side with price `p`, from the closed form:

```
s = b * ln(1 + (e^(m/b) - 1) / p)
```

Then:
1. The room left before the price cap is `(D_CAP - d) * b` for YES, `(D_CAP + d) * b` for NO. If it is 4 units or less, the quote is zero shares.
2. **The cap comes first.** `to_cap = C(with room shares) - C(before) + 1` is what every share up to the cap costs. If the spend is at least `to_cap`, `s` is the room and the closed form is not evaluated. Otherwise `s` is the closed form, clamped to [0, room]. So the closed form only sees a spend below `to_cap`, which is at most `b ln(9999)` plus rounding (about 9.3 b), and `e^(m/b)` stays far inside i128.
3. 4 units are shaved off for rounding.
4. The charge is `C(after) - C(before) + 1`. While it exceeds the spend, the shares step back by `(charge - spend) / p_after + 1`.

It returns `(shares, charged)` with `charged <= spend`.

### Selling (`Market::quote_sell`)

Proceeds for `s` shares are `C(before) - C(after) - 1`, never below zero. You cannot sell more than is outstanding on that side.

### Fills: `Market::fill_buy`, `Market::fill_sell`

These are the contract's trades in whole micro units, taker fee included. `buy`, `sell` and the views `quote_buy` and `quote_sell` all call them, so a quote and its fill are one piece of code. `site/lib/core/lmsr.ts` ports them to BigInt (`fillBuy`, `fillSell`), bit-exact on vectors the crate generates.

`fee_on(amount, bps)` is `ceil(amount * bps / 10,000)`: a fee is rounded up, like every other rounding here, in the market's favour.

`fill_buy(side, amount_micro, fee_bps)`, where `amount_micro` is the most the trader pays, fee included:
1. The pot's budget leaves room for the fee: `floor(amount * 10,000 / (10,000 + bps))`.
2. `quote_buy` on that budget. Its shares are floored to whole micro-shares.
3. Those shares cost exactly `C(after) - C(before)`, rounded up to a micro: `cost_micro`. `fee_micro` is `fee_on(cost_micro, bps)`. The trader pays `paid_micro = cost_micro + fee_micro`.
4. Near a price cap the fixed-point cost carries rounding of a few hundred SCALE units, more than the true cost of the fraction the floor dropped, so the cost can come out a micro above the budget. The fill then steps back one micro-share at a time, at most `FILL_STEPS` (16) times. Measured over 20,000 random markets: 11 orders needed it, one micro-share each. Before v3 the contract refused those orders with "slippage".

`cost + fee <= amount` always: the cost is at most the budget, and `budget + fee_on(budget) <= amount`. A fill of zero shares charges nothing. At 0 bps the fill is the pre-fee contract's, to the micro, wherever that contract filled.

`fill_sell(side, shares_micro, fee_bps)`: `proceeds_micro` is `quote_sell` floored to a micro, `fee_micro` is `fee_on(proceeds_micro, bps)`, and the trader receives `received_micro = proceeds_micro - fee_micro`.

Tests: crates/lmsr `the_taker_fee_on_buys_and_sales` and `property_fills_never_overcharge_and_round_trips_never_profit` (20,000 markets across the contract's liquidity range, orders from 1 micro to $10^12, fees from 0 to 300 bps, a round trip never returning more than was paid less both fees); site/tests/unit/core/lmsr.test.ts and judge check 1 on the vectors, which trade at fees from 0 to 300 bps and hold 48 edge fills (stepped back, at the cap, too small).

### The opening clamp and the price cap

- **Opening clamp:** `Market::open` clamps `p0` to [0.2, 0.8] (`P_MIN`, `P_MAX`) before computing `d0`. The contract does not refuse a `p0_ppm` outside that range: it opens at the clamped price. The planner never signs one outside it (`services/api/src/planner.mjs`, `P_MIN`/`P_MAX`; test "opening probabilities clamp to 0.2..0.8 and round to 0.1 point").
- **Price cap:** `|d| <= D_CAP = ln(9999)` (9,210,240,366,976 at SCALE), so prices stay in [0.0001, 0.9999]. A buy that reaches the cap buys up to it and is charged only for what it bought. `Market::at_cap` is true when not one whole micro-share is left to buy before the cap; there `buy` panics with "the price is at its cap" and `quote_buy` says zero shares.
- **Large buys (fixed):** a spend above about 33 times `b` used to overflow i128 inside `quote_buy` (`div(expm1(spend / b), p)`), and with `overflow-checks = true` the call panicked. Since the cap check comes first (step 2 above), any spend, up to `i128::MAX` at SCALE, buys at most up to the cap and is charged only for those shares; the rest of the order stays in the trader's balance. Example: $5 on `b = $0.10` at 50% buys to 99.99% for a cost of $0.851720 (`b ln(0.5 / 0.0001)`) and, at 1%, a fee of $0.008518 on that cost: $0.860238 in all. Tests: crates/lmsr `a_spend_far_above_the_liquidity_buys_to_the_cap_and_keeps_the_rest` and `property_extreme_spends_and_liquidity_never_overflow` (20,000 markets, `b` from $0.01 to $10^9, spends from 1e-9 b to 1e12 b and `i128::MAX`, release build with overflow checks); site/tests/unit/core/lmsr.test.ts on regenerated vectors with orders up to $10^9; lifecycle "a $5 buy on $0.10 of liquidity buys up to the price cap instead of overflowing".

## Claims

A `Claim` stores `text`, `page`, `kind`, `b`, `d0`, `q_yes`, `q_no`, `status`, `outcome`, `provisional`, `reserve_micro`, `collected_micro`, `payout_left_micro`, `trades`, `volume_micro`, `created_ns`, `challenge`, `prev`, `next`, `bounty_micro`, `bounty_epoch`.

Status is one of `Open`, `Challenged`, `Escalated`, `Settled`.

### Opening (`open`, internal)

- `text` is 1 to 600 bytes. `kind` is `data`, `document` or `judgment`. `b_micro` is $0.10 to $100 (100,000 to 100,000,000).
- The reserve is `max(max_loss(Yes), max_loss(No)) / MICRO + 1` micro-USDC. It moves from `treasury_micro` to `reserved_micro`. The treasury must cover it, and total reserves must stay under `reserve_cap_micro` (default $2,000).
- Example: b = $3 at 50% reserves `3 ln 2` = $2.079441, plus 1 micro: the testnet `open` event for claim 6 says `"reserve_micro":"2079442"` (tx `GgegKUdVbqbSnG1tnRYpAah6nQd9nUXJPcX4XtuXwMfV`).

### `open_claim(text, page, kind, p0_ppm, b_micro) -> u64`

Operators only. Opens a claim with no bet.

### `open_and_buy(text, page, kind, p0_ppm, b_micro, planner_sig_hex, side, amount_micro) -> Trade`

Anyone, lane keys included.
1. The message is `open:<page>:<sha256(text) hex>:<kind>:<p0_ppm>:<b_micro>`.
2. `check_planner` verifies the ed25519 signature against `planner_key` (set by `set_planner_key`).
3. The receipt id is `sha256(message)`. If `receipts` already maps it to a claim, that claim is used. Otherwise a claim is opened and the receipt is recorded. **A receipt opens one market.** Before this rule, replaying a receipt opened the same sentence again and drained another subsidy from the treasury. Check: "a receipt opens one market: replayed, it bets on that market".
4. It then calls `buy` with `min_shares_micro = 0`.

### `reopen(claim_id, p0_ppm, b_micro, planner_sig_hex) -> u64`

The planner signs `reopen:<claim_id>:<p0_ppm>:<b_micro>`. The old claim must be `Settled` and have no `next`. A successor opens with the same text, page and kind, `prev = claim_id`, and the old claim gets `next`. Checks: "reopen opens a successor linked by prev; the settled claim keeps its outcome", "a claim has one successor".

## Trading

The trader is `trader()`: the predecessor account, or `lane:<signer public key>` when the predecessor is the lane account.

### `buy(claim_id, side, amount_micro, min_shares_micro) -> Trade`

1. Not paused. A new lane identity is credited first (see the lane).
2. The claim must not be `Settled`. Trading continues while `Challenged` and `Escalated`.
3. `0 < amount_micro <= balance`. `amount_micro` is the most the buy may take, fee included.
4. `fill_buy` at the current fee (above). Zero shares panics: "the price is at its cap" if `at_cap`, otherwise "amount too small". The shares must be at least `min_shares_micro`.
5. The trader's balance is debited `cost + fee`. The cost goes to the claim's pot: `collected_micro` and `volume_micro` grow by it, and `trades` by one. The fee goes to the treasury (`take_fee`). The position grows. What the fill didn't use stays in the balance.

`side` accepts `yes`, `YES`, `Yes`, `no`, `NO`, `No`.

### `sell(claim_id, side, shares_micro, min_proceeds_micro) -> Trade`

The claim must not be `Settled`. You must hold the shares. `fill_sell` at the current fee gives the proceeds and the fee, and what you receive, the proceeds less the fee, must be at least `min_proceeds_micro`. The pot pays the whole proceeds (`collected_micro` falls by them, `volume_micro` grows by them), the fee goes to the treasury, and the rest is credited. The event's `side` is `sell_yes` or `sell_no`.

### The taker fee

Every `buy` and `sell` pays it: on top of a buy's cost, out of a sale's proceeds. Lane keys and agents pay like anyone, and a lane key's fee comes out of its credit, so a bet of its whole $1 buys about 1% less. `redeem`, deposits and withdrawals pay no fee.

- **The rate** is `fee_bps`: 100 (1%) until the owner sets another with `set_fee_bps`, at most 300 (3%, `MAX_FEE_BPS`). A new rate applies from the next trade, whatever a client was quoted, so `min_shares_micro` and `min_proceeds_micro` are what protect a trader from a change in between.
- **Where it goes:** the treasury bucket, so the books need no new bucket and `held = treasury + reserved + balances + collected + payouts + bonds + bounties` still holds to the micro. `stats.fees_micro` is the running total, which is part of what went through the treasury, not a bucket of its own. Check "the treasury rebuilds exactly from the events, fees included".
- **Storage:** `fee_bps` is at key `b"F"` (u16, little-endian), written by `set_fee_bps`; absent, it is the default. The total is at key `b"G"` (u128, little-endian). Both are outside the state struct, like the house agents' consent, so the state layout stayed byte for byte (`tools/judge/upgrade-testnet.mjs`).

Checks: "a buy pays 1% of its cost, rounded up, on top of it and inside the order", "a sale pays 1% of its proceeds, rounded up, out of them", "the lane's credit pays the fee: the treasury lends $1 and takes the fee back", "at 300 bps a buy pays 3% of its cost", "at 0 bps nothing is taken: stats and the treasury don't move".

### `redeem(claim_id) -> U128`

After `Settled`. The trader's winning shares pay 1 micro-USDC per micro-share, out of `payout_left_micro`. The position is removed, so a second redeem fails ("nothing to redeem"). Works for accounts, agents and lane keys (checks "a lane key redeems its winning shares", "an agent redeems with its function-call key").

### Settlement of the pot (`resolve`, internal)

`payout = q(winning side) / MICRO`. The pot is `collected + reserve`, and must cover the payout. `pot - payout` goes back to the treasury. `payout_left_micro` is set to the payout.

## Money in and out

- **`ft_on_transfer(sender_id, amount, msg)`**: only from the configured USDC token, and not paused: during a pause it panics, so the token returns the deposit (check "a deposit during a pause is refused and returned by the token"). `msg` containing `"treasury":true` funds the treasury. `{"for":"<account>"}` credits that account. Anything else credits the sender. The lane account can't be credited.
- **`withdraw(amount_micro)`**: your own balance, as USDC. Refused for the lane account. If the transfer fails, `on_withdraw` credits the balance back (check "a failed withdraw is refunded to the ledger").
- **`withdraw_treasury(amount_micro)`**: owner only, not paused, from `treasury_micro` only. `on_treasury_withdraw` restores it on failure. Check "a pause holds the owner's treasury withdrawal too".
- **`release_agent(agent, to, amount_micro)`**: callable only by the swarm, for a swarm sub-account, never to the lane. `None` moves everything.

## The lane (no-wallet bets)

- Lane visitors are function-call keys on one lane account. Each key is its own trader, `lane:<public key>`.
- **Credit:** on a lane identity's first `buy` (`credit_lane_if_new`), `lane_credit_micro` (default $1) moves from both `lane_budget_micro` and `treasury_micro` to its balance, and `credited` records it. If either can't cover it: "the judges' lane is used up for now". The credit pays the taker fee like any balance.
- **The credit can never leave.** A lane identity can't `withdraw`, `challenge`, `dispute` or `fund_question` (`real_account`).
- **`claim_lane(account) -> U128`**: signed by a lane key. It moves only the balance above that key's recorded credit to a real account (not the lane, not the market). Checks: "claim_lane moves exactly the winnings above the credit to a real account", "the credit stays behind", "nothing more can be claimed".
- View `lane_claimable(trader)`.

## Challenges and rulings

### `challenge(claim_id, claimed_outcome, evidence) -> u64`

A real account. Evidence is 1 to 4,000 bytes. The claim must be `Open`. The bond is `challenge_bond_micro` (default $1), debited from the caller. The claim becomes `Challenged`. `jury_deadline_ns = now + jury_deadline_secs` (default 3,600). The challenger's bond is the first `Stake`.

### The canonical request (`build_request`, view `canonical_request(challenge_id, model)`)

The exact bytes a juror runner sends to NEAR AI Cloud:

```
{"model":"<model>","messages":[{"role":"system","content":"<JURY_PROMPT>"},{"role":"user","content":"Market <this account> challenge <id>.\nClaim: <text>\nEvidence (untrusted): <evidence>"}],"temperature":0,<"max_tokens":1024,><extras>,"stream":false}
```

- `JURY_PROMPT` tells the model to treat the evidence as untrusted and to start its answer with exactly one of `VERDICT: TRUE`, `VERDICT: FALSE`, `VERDICT: INSUFFICIENT`.
- `"max_tokens":1024` is added unless the model's extras set `max_tokens`.
- The market's own account is in the request, so a signed verdict can't be replayed on another deployment (check "the default request allows 1024 tokens and names this market").
- Strings are escaped by `json_escape`, matching `JSON.stringify`.

### `submit_verdict(challenge_id, model, response, signature_hex) -> Verdict`

Anyone can relay.
1. The model must be registered. The claim must be `Challenged` on this very challenge, and `now <= jury_deadline_ns`. Each model rules once.
2. The contract rebuilds the request and computes `sha256(request)` and `sha256(response)`.
3. It verifies the model's ed25519 signature over `<model>:<request_hash hex>:<response_hash hex>` against the registered key.
4. It reads the verdict with `rules::verdict_of_response`.

### Verdict reading (`crates/rules`)

- **`verdict_of_response(body, model)`**: the body must parse as a chat completion, and its `model` must equal the requested model, else the call panics. Duplicate `model` or `content` keys fail the parse. Only `choices[0].message.content` is read. `reasoning_content` is not a declared field, so nothing in it can count.
- **`verdict_of_answer(content)`**: the first non-empty line after trimming must be exactly `VERDICT: TRUE`, `VERDICT: FALSE` or `VERDICT: INSUFFICIENT`. Anything else, including `**VERDICT: TRUE**`, `VERDICT: TRUE.` or a line of thought first, is `UNPARSEABLE`. Tests: `answer_first_non_empty_line_exactly`, `response_reads_content_only`, `duplicate_keys_are_refused`; judge check 2 runs 10,000 completions with a different verdict in `reasoning_content`.
- The verdict is recorded whatever it is. `INSUFFICIENT` and `UNPARSEABLE` use up that model's turn.

### Quorum

When no provisional outcome exists and the recorded verdicts hold at least two `TRUE` or at least two `FALSE`, the claim gets `provisional` and the dispute window starts (`start_window`). Later verdicts are recorded but can't move it. Checks: "one verdict is no quorum", "two matching verdicts give a provisional outcome, not a settlement", "a later verdict can't move the outcome: only a bond can".

### The dispute window

- **Open interest** is the larger side's outstanding shares, in micro-USDC: `max(q_yes, q_no) / MICRO` (`Claim::open_interest`).
- **Length** is `rules::window_secs(tiers, top_secs, open_interest)`: the first tier whose threshold the open interest is below, else the top window. Defaults (`new`):

| Open interest | Window |
|---|---|
| below $50 | 10 minutes |
| $50 to below $500 | 1 hour |
| $500 to below $5,000 | 6 hours |
| $5,000 and above | 24 hours |

- **The end that counts** is `window_end = max(window_ends_ns, window_opened_ns + length(current open interest))`. Money that arrives during a window stretches it to its new tier; nothing shortens it. View `dispute_ends_ns(challenge_id)`. Check: "money arriving during the window stretches it to its tier".
- **The table** is set by `set_resolution` and must pass `rules::tiers_ok`: at most 8 tiers, thresholds strictly rising, windows never shrinking, each at least 1 s and at most the top window, top window above 0.

### `dispute(challenge_id, evidence) -> u8`

A real account, evidence 1 to 4,000 bytes. The claim must be `Challenged` on this challenge with a provisional outcome, and `now < window_end`. The bond is twice the current bond: with the defaults, $1 (challenger), then $2, $4, $8. The dispute flips `provisional` and adds a stake on the new side with its evidence. Disputes one and two restart the window. **The third dispute sets `Escalated`** and starts no window. Works during a pause. Checks: "a dispute posts twice the bond, flips the outcome and restarts the window", "the third dispute costs $8 and escalates", "no fourth dispute", "a dispute still lands during a pause".

### `finalize(challenge_id) -> bool`

Permissionless. The claim must be `Challenged` on this challenge with a provisional outcome, and `now >= window_end`. It settles on the provisional outcome. Models alone never settle a claim: a bond against them could always have been posted.

### Escalation: `council_settle(challenge_id, outcome)`

Owner only (the council), not paused. The claim must be `Escalated`. `Some(o)` settles on `o`. `None` voids: every bond goes back to its poster, and the claim returns to `Open` with no provisional and no challenge (`void` event). Checks: "only the council rules", "the council settles the claim", "a council void returns every bond and reopens the claim", "a pause holds the council's settlement too". An escalated claim keeps trading.

### Bonds (`rules::split_bonds`)

Each stake on the winning side gets its bond back plus `lost * bond / won` of the losing side's bonds. Rounding dust goes to the first winning stake, so every micro is paid. If nobody staked on the winning side, all bonds go to the treasury (`bond_forfeit`). Tests: `the_right_side_takes_everything`, `nobody_right_goes_to_the_treasury`, `bonds_are_conserved_to_the_micro` (200,000 random splits).

### Expiry: `expire_challenge(challenge_id)`

Permissionless. The claim must be `Challenged` on this challenge, with no provisional outcome, after the jury deadline. The challenger's bond comes back, the claim returns to `Open`, and the challenge record is deleted (the event log keeps it). Checks: "expire_challenge refunds the bond and reopens the claim", "an expired challenge leaves no storage behind".

### Settled claims

A settled claim keeps its outcome, its `challenge` id and all evidence, including each disputer's. It takes no bets, no verdicts and no second finalize (checks "a settled claim keeps its evidence", "a settled claim takes no bets").

## Bounties

- **`fund_question(claim_id, amount_micro)`**: a real account, at least $0.01, on a claim that isn't settled. It comes from the caller's balance. The record key is `<claim>:<bounty_epoch>:<funder>`. Funding again adds to the amount and resets that funder's expiry to `now + bounty_ttl_secs` (default 30 days).
- **Paid** in `resolve` to the first challenger, only if their `claimed_outcome` won. The claim's `bounty_epoch` then rises, so the paid records can't be refunded.
- **`refund_bounty(claim_id, funder) -> U128`**: permissionless. It returns the funder's amount if the claim is settled (nobody won it), or if the claim is `Open` and the record has expired. Not while a challenge is live or escalated.
- View `get_bounty(claim_id, funder)`.

## Anchoring rewrites: `anchor_rewrite(claim_id, version, prices_hash, request_hash, response_hash, signature_hex, model)`

Operators only. The claim must exist, the three hashes must be 64 lowercase hex characters, and the model must be registered. The model's ed25519 signature over `<model>:<request_hash>:<response_hash>` must verify against the registered key. It increments `rewrites_anchored` and emits `rewrite`. It does not store the record and does not check `version` or `prices_hash` against anything. Real anchor: tx `BUYNo54M17r5eamtm6g1k2b8ihJRWvhnVFwefx816qse`. Checks: "a forged rewrite signature is refused", "a rewrite signed by another model's key is refused".

## Inference charges: `charge_inference(agent, amount_micro, usage_hash)`

Operators only, not paused. `agent` must be a swarm agent (`is_swarm_agent`, below: its owner consented by spawning it), or a house agent that the owner proposed **and that accepted** (below). `usage_hash` is 64 lowercase hex. It moves `amount_micro` from the agent's balance to the treasury. Checks: "an operator can't charge an ordinary trader", "charge_inference moves the agent's balance to the treasury, on-chain".

### House agents opt in

An account that is not a swarm agent becomes chargeable only with its own consent:

1. **`set_house_agent(account, true)`** (owner) records a proposal in `house_agents`. A proposal alone makes nothing chargeable. The lane account can't be proposed.
2. **`accept_house_agent()`**, signed by the account itself, after a proposal, writes its consent (storage key `b"A" + account id`, outside the state struct, so the state layout stayed as v2 deployed it).
3. **`leave_house_agent()`**, signed by the account, at any time, also during a pause, removes both the proposal and the consent. Its balance and positions are untouched.
4. **`set_house_agent(account, false)`** (owner) removes the proposal and any consent. A new proposal needs a new acceptance.

Chargeable means proposed and accepted. View `get_house_agent(account)` returns `proposed`, `accepted` and `chargeable` (true for swarm agents). Each step emits `house_agent`. Checks: "the owner's proposal alone doesn't make an account chargeable", "a proposed house agent can't be charged before it accepts", "the account accepts with its own key and becomes chargeable", "a house agent leaves at any time, its balance intact", "a fresh proposal needs fresh consent", "the owner withdrawing a proposal also ends the consent", "a house agent can leave during a pause, balance intact". A listing made under v2 becomes a proposal after the upgrade: not chargeable until the account accepts (tools/judge/upgrade-rehearsal.mjs).

The swarm's NEAR-side meter is `sweep_escrow` (below). The operator must use one meter per agent.

### The swarm's name

`set_swarm(swarm)` is owner only and works once. It refuses any account but `swarm.<owner>` or `swarm.<the market's parent account>`, and refuses any second call, even to the same name. The market's parent is the account after the first dot of the market's own name, and counts only if it is itself a sub-account: `market.isitpriced.near` has the parent `isitpriced.near`, but `pricedin.near` has none, because nobody in particular holds `swarm.near`. It emits `swarm`.

`is_swarm_agent(account)` is true only for `<label>.<swarm>` with one non-empty label: never the swarm itself, a deeper account or a top-level account, and nobody at all while the swarm is unset, as on mainnet, where `release_agent` is refused too. A swarm stored before v3, when `set_swarm` took any account, counts only if it starts with `swarm.`.

Why: on NEAR only an account can create its own sub-accounts, so everything inside `swarm.<x>` was made by that one account. Before v3, `set_swarm("near")` made every `*.near` account a swarm agent, so an operator could charge any trader's balance to the treasury and the owner could withdraw it. Checks: "set_swarm refuses the top-level account near, which would make every *.near trader chargeable", "a second set is refused, even to the other valid name", "set_swarm accepts swarm.<the market's parent account>", "a top-level account is never a swarm agent". tools/judge/upgrade-rehearsal.mjs reproduces the hole on the old bytes and shows the same state harmless on the new.

## Administration

| Method | Who | What |
|---|---|---|
| `new(owner, usdc, lane)` | init | Defaults: $1 lane credit, $0 lane budget, $1 bond, 1 h jury, the table above, 30-day bounty TTL, $2,000 reserve cap, 100 bps taker fee |
| `propose_owner(account)`, `accept_owner()` | owner, then the proposed account | Two-step handover. `accept_owner` emits `owner`. |
| `set_operator(account, allowed)` | owner | |
| `set_swarm(swarm)` | owner | Once, and only `swarm.<owner>` or `swarm.<the market's parent account>` (see The swarm's name). Its direct sub-accounts are agents. |
| `set_house_agent(account, allowed)` | owner | Proposes an account as a house agent, or withdraws the proposal and its consent. Chargeable only after `accept_house_agent` (see Inference charges). |
| `accept_house_agent()`, `leave_house_agent()` | the account itself | Consent to inference charges after a proposal; leave at any time, balance intact. |
| `set_planner_key(key_hex)` | owner | 32-byte ed25519 key |
| `set_limits(reserve_cap_micro, lane_budget_micro, lane_credit_micro, challenge_bond_micro)` | owner | The bond must be positive. |
| `set_fee_bps(fee_bps)` | owner | The taker fee, 0 to 300 bps (see The taker fee). Works during a pause, as admin settings do. Emits `fee`. |
| `set_resolution(jury_deadline_secs, dispute_tiers, dispute_top_secs, bounty_ttl_secs)` | owner | `tiers_ok`; times positive. Running windows keep their stored end. |
| `pause(paused)` | owner | Freezes the ledger. Stops deposits (`ft_on_transfer` panics and the token returns them), `withdraw`, `withdraw_treasury`, `buy`, `sell`, `open_*`, `reopen`, `claim_lane`, `release_agent`, `charge_inference`, `fund_question`, `refund_bounty`, `challenge`, `submit_verdict`, `finalize`, `council_settle`, `expire_challenge`, `redeem` and `anchor_rewrite`. **Still runs:** `dispute`, on purpose (it only moves a balance into a bond, so a window can't run out on someone locked out of it); the callbacks `on_withdraw` and `on_treasury_withdraw`, which put back a transfer sent before the pause that failed; admin methods, the owner handover, `accept_house_agent`, `leave_house_agent` and views. So while paused no USDC leaves the contract. |
| `register_model(model, signing_address_hex, extras_json)` | owner | Model name 1 to 128 bytes, a 32-byte key, and extras that pass `rules::extras_ok`: at most 512 bytes, valid JSON object members, and none of `model`, `messages`, `temperature`, `stream`, `n`. |

## Events

Every market event is `EVENT_JSON:{"standard":"pricedin","version":"2.1.0","event":"<name>","data":[{...}]}`. Version 2.1.0 is v3: `trade` gained `fee_micro`, its `amount_micro` now includes the fee, and `fee` and `swarm` are new. Amounts are strings in micro-USDC. `trader` and `balance_micro` appear on every event that changes a balance.

| Event | Fields | Emitted by |
|---|---|---|
| `owner` | `owner` | `accept_owner` |
| `fee` | `fee_bps` | `set_fee_bps` |
| `swarm` | `swarm` | `set_swarm` |
| `treasury` | `from`, `amount_micro` | `ft_on_transfer` (treasury deposit), `on_treasury_withdraw` (refund) |
| `deposit` | `to`, `trader`, `amount_micro`, `balance_micro` | `ft_on_transfer` |
| `withdraw` | `trader`, `amount_micro`, `balance_micro` | `withdraw` |
| `withdraw_refunded` | `to`, `trader`, `amount_micro`, `balance_micro` | `on_withdraw` |
| `treasury_withdraw` | `to`, `amount_micro` | `withdraw_treasury` |
| `lane_credit` | `trader`, `amount_micro` | `credit_lane_if_new` |
| `lane_claim` | `trader`, `to`, `amount_micro`, `balance_micro` (the credit left behind), `to_balance_micro` | `claim_lane` |
| `agent_release` | `trader`, `to`, `amount_micro`, `balance_micro`, `to_balance_micro` | `release_agent` |
| `charge` | `trader`, `amount_micro`, `usage_hash`, `balance_micro` | `charge_inference` |
| `house_agent` | `account`, `proposed`, `accepted` | `set_house_agent`, `accept_house_agent`, `leave_house_agent` |
| `open` | `claim_id`, `p0_ppm`, `b_micro`, `reserve_micro` | `open` |
| `reopen` | `claim_id` (the new one), `prev` | `reopen` |
| `trade` | `claim_id`, `trader`, `side` (`yes`, `no`, `sell_yes`, `sell_no`), `shares_micro`, `amount_micro` (what moved in the balance: paid on a buy, received on a sale, fee included), `fee_micro`, `price_yes_ppm` (after), `balance_micro` | `buy`, `sell` |
| `bounty` | `claim_id`, `trader`, `amount_micro`, `bounty_micro`, `expires_ns`, `balance_micro` | `fund_question` |
| `bounty_refund` | `claim_id`, `trader`, `amount_micro`, `balance_micro` | `refund_bounty` |
| `challenge` | `challenge_id`, `claim_id`, `claimed`, `trader`, `amount_micro`, `jury_deadline_ns`, `balance_micro` | `challenge` |
| `verdict` | `challenge_id`, `model`, `outcome` | `submit_verdict` |
| `provisional` | `challenge_id`, `claim_id`, `outcome`, `window_ends_ns` | `submit_verdict` |
| `dispute` | `challenge_id`, `claim_id`, `trader`, `amount_micro`, `round`, `proposed`, `window_ends_ns`, `balance_micro` | `dispute` |
| `escalate` | `challenge_id`, `claim_id` | `dispute` (third) |
| `settle` | `claim_id`, `challenge_id`, `outcome`, `payout_micro`, `treasury_micro` (the leftover) | `resolve` |
| `bond_paid` | `challenge_id`, `trader`, `amount_micro`, `balance_micro` | `resolve`, `council_settle` (void) |
| `bond_forfeit` | `challenge_id`, `amount_micro` | `resolve` |
| `bounty_paid` | `claim_id`, `trader`, `amount_micro`, `balance_micro` | `resolve` |
| `void` | `challenge_id`, `claim_id` | `council_settle(None)` |
| `challenge_expired` | `challenge_id`, `claim_id`, `trader`, `amount_micro`, `balance_micro` | `expire_challenge` |
| `redeem` | `claim_id`, `trader`, `side`, `shares_micro`, `amount_micro`, `balance_micro` | `redeem` |
| `rewrite` | `claim_id`, `version`, `prices_hash`, `request_hash`, `response_hash`, `signature`, `model` | `anchor_rewrite` |

Real logs from testnet, from before v3 (read with `EXPERIMENTAL_tx_status`):

```
tx 55GJAbUYwxgHXtDA4JRQpcTgUzUP3AsaUArNYiqLfuiK (the seeded lane bet)
EVENT_JSON:{"standard":"pricedin","version":"2.0.0","event":"lane_credit","data":[{"trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","amount_micro":"1000000"}]}
EVENT_JSON:{"standard":"pricedin","version":"2.0.0","event":"trade","data":[{"claim_id":6,"trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","side":"no","shares_micro":"1292110","amount_micro":"1000000","price_yes_ppm":189970,"balance_micro":"0"}]}
```

`rules::verdict_of_response`, `split_bonds`, `window_secs`, `tiers_ok` and `extras_ok` have a Node port in `tools/judge/lib/rules.mjs`, proven equal on the crate's own vectors (judge check 2).

## Views

| View | Returns |
|---|---|
| `get_claim(claim_id)` | `ClaimView`: `id`, `text`, `page`, `kind`, `price_yes_ppm`, `cost_up_10_micro`, `cost_down_10_micro`, `status`, `outcome`, `provisional`, `trades`, `volume_micro`, `open_interest_micro`, `collected_micro`, `payout_left_micro`, `challenge_id`, `prev`, `next`, `bounty_micro`, and the market itself: `b_micro`, `d0` (opening log-odds at SCALE), `q_yes_micro`, `q_no_micro`, `fee_bps`. `b` and `q` are whole micros as stored, so `lmsr.ts` `marketFromClaim` rebuilds the exact market and quotes the fill to the micro. |
| `get_claims(from, limit)` | Up to 100 `ClaimView`s |
| `quote_buy(claim_id, side, amount_micro)` | What `buy` would fill now, by the same `fill_buy`: `claim_id`, `side`, `shares_micro`, `amount_micro` (what it would take from the balance), `fee_micro`, `fee_bps`, `price_yes_ppm_before`, `price_yes_ppm_after`. Zero shares means the buy would be refused. It reads no balance. Panics on a settled claim. |
| `quote_sell(claim_id, side, shares_micro)` | What `sell` would credit now, after the fee, by the same `fill_sell`, in the same fields. It reads no position, and panics above the shares outstanding. |
| `get_balance(trader)` | micro-USDC |
| `get_position(claim_id, trader)` | `yes_micro`, `no_micro` |
| `get_challenge(challenge_id)` | The `Challenge`, with verdicts and stakes. `None` after `expire_challenge`. |
| `dispute_ends_ns(challenge_id)` | The live window end, or `None` |
| `canonical_request(challenge_id, model)` | The exact request bytes |
| `get_model(model)` | `signing_address_hex`, `extras_json` |
| `get_bounty(claim_id, funder)` | `amount_micro`, `expires_ns` |
| `lane_claimable(trader)` | Balance above the credit |
| `get_house_agent(account)` | `proposed`, `accepted`, `chargeable` |
| `get_resolution()` | Bond, jury deadline, tiers, top window, bounty TTL, swarm |
| `stats()` | `claims`, `challenges`, `treasury_micro`, `reserved_micro`, `lane_budget_micro`, `lane_credit_micro`, `paused`, `held_micro`, `balances_micro`, `collected_micro`, `payouts_micro`, `bonds_micro`, `bounties_micro`, `rewrites_anchored`, `fee_bps`, `fees_micro` (every fee taken since v3) |

**Cost to move** (`cost_to_move`, in `get_claim`): the cost of the shares that move `d` to `logit(p +/- 0.10)`. It is 0 when the target is within 0.001 of 0 or 1. It is the pot's cost, without the taker fee.

## The swarm (`contracts/swarm/src/lib.rs`)

| Method | Who | What |
|---|---|---|
| `spawn_agent(model, persona_hash, runner_public_key)` | anyone, at least `min_spawn_yocto` (5 NEAR) | Creates `a<N>.<swarm>` with `agent_near_yocto` (0.26 NEAR), the agent wallet, and the runner key (market; `buy,sell,redeem`; 0.25 NEAR). Escrow = deposit - 0.26 NEAR - record storage. `on_spawn` refunds the whole deposit if creation fails. |
| `sweep_escrow(agent_id, amount_yocto, usage_hash)` | operators | Up to the escrow left, sent to the owner-set `treasury` account. At zero the agent sleeps. |
| `set_sleeping(agent_id)` | anyone, only at zero escrow | |
| `top_up_escrow(agent_id)` | anyone, payable | Wakes the agent. Refused once closed. |
| `release_bankroll(agent_id, amount_micro)` | the agent's owner | Calls the market's `release_agent` to the owner. Works after close. |
| `close_agent(agent_id)` | the agent's owner | Returns the escrow, releases the whole bankroll. |
| `delete_agent(agent_id)` | the agent's owner, after close | Calls the wallet's `close`; `on_delete` marks it deleted. Unredeemed shares are given up. |
| `propose_owner`, `accept_owner`, `set_operator`, `set_treasury`, `set_limits` | owner | |
| Views | | `get_agent`, `get_agents(from, limit)`, `stats` |

Swarm events use standard `pricedin-swarm`, version `1.0.0`: `spawn` (`agent`, `owner`, `model`, `persona_hash`, `escrow_yocto`), `spawn_failed`, `sweep` (`agent`, `amount_yocto`, `usage_hash`, `escrow_yocto`, `sleeping`), `sleep`, `top_up`, `close` (`agent`, `owner`, `refund_yocto`), `delete`, `owner`.
