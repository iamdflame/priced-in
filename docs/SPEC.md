# Market specification

This is what `contracts/market/src/lib.rs` (the contract `PricedIn`), `crates/lmsr/src/lib.rs` and `crates/rules/src/lib.rs` do, function by function. Where this text and the code disagree, the code wins; please report it.

Checks that run this spec: `cargo test -p lmsr --release` (4 tests), `cargo test -p rules --release` (9 tests), `npm run judge` checks 1 and 2, and `node contracts/market/test/lifecycle.mjs` (141 checks on testnet; the last full run is in `.apex/streams/contracts-result.md`). Quoted check names below are from that file.

## Units

| Quantity | Unit |
|---|---|
| Money and shares inside the maths | `i128` at `SCALE` = 1e12 per dollar or per share (`lmsr::SCALE`) |
| Money and shares in the contract's storage and API | micro-USDC (1e-6 dollar) and micro-shares. `MICRO` = 1,000,000 SCALE units per micro (`lib.rs`) |
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
1. `s` is capped by the room left before the price cap: `(D_CAP - d) * b` for YES, `(D_CAP + d) * b` for NO. If the room is 4 units or less, the quote is zero shares.
2. 4 units are shaved off for rounding.
3. The charge is `C(after) - C(before) + 1`. While it exceeds the spend, the shares step back by `(charge - spend) / p_after + 1`.

It returns `(shares, charged)` with `charged <= spend`.

### Selling (`Market::quote_sell`)

Proceeds for `s` shares are `C(before) - C(after) - 1`, never below zero. You cannot sell more than is outstanding on that side.

### The opening clamp and the price cap

- **Opening clamp:** `Market::open` clamps `p0` to [0.2, 0.8] (`P_MIN`, `P_MAX`) before computing `d0`. The contract does not refuse a `p0_ppm` outside that range: it opens at the clamped price. The planner never signs one outside it (`services/api/src/planner.mjs`, `P_MIN`/`P_MAX`; test "opening probabilities clamp to 0.2..0.8 and round to 0.1 point").
- **Price cap:** `|d| <= D_CAP = ln(9999)` (9,210,240,366,976 at SCALE), so prices stay in [0.0001, 0.9999]. A buy that reaches the cap buys up to it and is charged only for what it bought. At the cap, `buy` panics with "the price is at its cap".
- **Known overflow:** a spend above about 33 times `b` overflows i128 inside `quote_buy` (`div(expm1(spend / b), p)`). The release build has `overflow-checks = true` (`Cargo.toml`), so the call panics instead of buying up to the cap. The $1 lane bet is safe for `b >= $0.10`. Found by the web stream (`.apex/streams/webcore-result.md`, finding 1). Not fixed.

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
3. `0 < amount_micro <= balance`.
4. `quote_buy` at SCALE, then shares are floored to whole micro-shares. The charge is the exact cost of those shares, rounded up to a micro. It must not exceed `amount_micro` ("slippage"), and the shares must be at least `min_shares_micro`.
5. The trader's balance is debited, the position grows, `collected_micro`, `trades` and `volume_micro` grow.

`side` accepts `yes`, `YES`, `Yes`, `no`, `NO`, `No`.

### `sell(claim_id, side, shares_micro, min_proceeds_micro) -> Trade`

The claim must not be `Settled`. You must hold the shares. Proceeds are `quote_sell` floored to a micro and must be at least `min_proceeds_micro`. The balance is credited. The event's `side` is `sell_yes` or `sell_no`.

### `redeem(claim_id) -> U128`

After `Settled`. The trader's winning shares pay 1 micro-USDC per micro-share, out of `payout_left_micro`. The position is removed, so a second redeem fails ("nothing to redeem"). Works for accounts, agents and lane keys (checks "a lane key redeems its winning shares", "an agent redeems with its function-call key").

### Settlement of the pot (`resolve`, internal)

`payout = q(winning side) / MICRO`. The pot is `collected + reserve`, and must cover the payout. `pot - payout` goes back to the treasury. `payout_left_micro` is set to the payout.

## Money in and out

- **`ft_on_transfer(sender_id, amount, msg)`**: only from the configured USDC token. `msg` containing `"treasury":true` funds the treasury. `{"for":"<account>"}` credits that account. Anything else credits the sender. The lane account can't be credited.
- **`withdraw(amount_micro)`**: your own balance, as USDC. Refused for the lane account. If the transfer fails, `on_withdraw` credits the balance back (check "a failed withdraw is refunded to the ledger").
- **`withdraw_treasury(amount_micro)`**: owner only, from `treasury_micro` only. `on_treasury_withdraw` restores it on failure.
- **`release_agent(agent, to, amount_micro)`**: callable only by the swarm, for a swarm sub-account, never to the lane. `None` moves everything.

## The lane (no-wallet bets)

- Lane visitors are function-call keys on one lane account. Each key is its own trader, `lane:<public key>`.
- **Credit:** on a lane identity's first `buy` (`credit_lane_if_new`), `lane_credit_micro` (default $1) moves from both `lane_budget_micro` and `treasury_micro` to its balance, and `credited` records it. If either can't cover it: "the judges' lane is used up for now".
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

Owner only (the council). The claim must be `Escalated`. `Some(o)` settles on `o`. `None` voids: every bond goes back to its poster, and the claim returns to `Open` with no provisional and no challenge (`void` event). Checks: "only the council rules", "the council settles the claim", "a council void returns every bond and reopens the claim". An escalated claim keeps trading.

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

Operators only, not paused. `agent` must be a swarm agent (a direct one-label sub-account of the swarm, `is_swarm_agent`) or an owner-listed house agent (`set_house_agent`). `usage_hash` is 64 lowercase hex. It moves `amount_micro` from the agent's balance to the treasury. Checks: "an operator can't charge an ordinary trader", "charge_inference moves the agent's balance to the treasury, on-chain".

The swarm's NEAR-side meter is `sweep_escrow` (below). The operator must use one meter per agent.

## Administration

| Method | Who | What |
|---|---|---|
| `new(owner, usdc, lane)` | init | Defaults: $1 lane credit, $0 lane budget, $1 bond, 1 h jury, the table above, 30-day bounty TTL, $2,000 reserve cap |
| `propose_owner(account)`, `accept_owner()` | owner, then the proposed account | Two-step handover. `accept_owner` emits `owner`. |
| `set_operator(account, allowed)` | owner | |
| `set_swarm(swarm)` | owner | Its direct sub-accounts are agents. |
| `set_house_agent(account, allowed)` | owner | Makes an account chargeable by `charge_inference`. |
| `set_planner_key(key_hex)` | owner | 32-byte ed25519 key |
| `set_limits(reserve_cap_micro, lane_budget_micro, lane_credit_micro, challenge_bond_micro)` | owner | The bond must be positive. |
| `set_resolution(jury_deadline_secs, dispute_tiers, dispute_top_secs, bounty_ttl_secs)` | owner | `tiers_ok`; times positive. Running windows keep their stored end. |
| `pause(paused)` | owner | Stops `buy`, `sell`, `open_*`, `reopen`, `withdraw`, `claim_lane`, `release_agent`, `charge_inference`, `fund_question`, `refund_bounty`, `challenge`, `submit_verdict`, `finalize`, `expire_challenge`, `redeem` and `anchor_rewrite`. **Not stopped:** `dispute` (on purpose), `council_settle`, `withdraw_treasury`, deposits and admin methods. |
| `register_model(model, signing_address_hex, extras_json)` | owner | Model name 1 to 128 bytes, a 32-byte key, and extras that pass `rules::extras_ok`: at most 512 bytes, valid JSON object members, and none of `model`, `messages`, `temperature`, `stream`, `n`. |

## Events

Every market event is `EVENT_JSON:{"standard":"pricedin","version":"2.0.0","event":"<name>","data":[{...}]}`. Amounts are strings in micro-USDC. `trader` and `balance_micro` appear on every event that changes a balance.

| Event | Fields | Emitted by |
|---|---|---|
| `owner` | `owner` | `accept_owner` |
| `treasury` | `from`, `amount_micro` | `ft_on_transfer` (treasury deposit), `on_treasury_withdraw` (refund) |
| `deposit` | `to`, `trader`, `amount_micro`, `balance_micro` | `ft_on_transfer` |
| `withdraw` | `trader`, `amount_micro`, `balance_micro` | `withdraw` |
| `withdraw_refunded` | `to`, `trader`, `amount_micro`, `balance_micro` | `on_withdraw` |
| `treasury_withdraw` | `to`, `amount_micro` | `withdraw_treasury` |
| `lane_credit` | `trader`, `amount_micro` | `credit_lane_if_new` |
| `lane_claim` | `trader`, `to`, `amount_micro`, `balance_micro` (the credit left behind), `to_balance_micro` | `claim_lane` |
| `agent_release` | `trader`, `to`, `amount_micro`, `balance_micro`, `to_balance_micro` | `release_agent` |
| `charge` | `trader`, `amount_micro`, `usage_hash`, `balance_micro` | `charge_inference` |
| `open` | `claim_id`, `p0_ppm`, `b_micro`, `reserve_micro` | `open` |
| `reopen` | `claim_id` (the new one), `prev` | `reopen` |
| `trade` | `claim_id`, `trader`, `side` (`yes`, `no`, `sell_yes`, `sell_no`), `shares_micro`, `amount_micro`, `price_yes_ppm` (after), `balance_micro` | `buy`, `sell` |
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

Real logs from testnet (read with `EXPERIMENTAL_tx_status`):

```
tx 55GJAbUYwxgHXtDA4JRQpcTgUzUP3AsaUArNYiqLfuiK (the seeded lane bet)
EVENT_JSON:{"standard":"pricedin","version":"2.0.0","event":"lane_credit","data":[{"trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","amount_micro":"1000000"}]}
EVENT_JSON:{"standard":"pricedin","version":"2.0.0","event":"trade","data":[{"claim_id":6,"trader":"lane:ed25519:6237QdS6SP63oys9apSKnmMN9bkcF3MBNyV7dUHr16eT","side":"no","shares_micro":"1292110","amount_micro":"1000000","price_yes_ppm":189970,"balance_micro":"0"}]}
```

`rules::verdict_of_response`, `split_bonds`, `window_secs`, `tiers_ok` and `extras_ok` have a Node port in `tools/judge/lib/rules.mjs`, proven equal on the crate's own vectors (judge check 2).

## Views

| View | Returns |
|---|---|
| `get_claim(claim_id)` | `ClaimView`: `id`, `text`, `page`, `kind`, `price_yes_ppm`, `cost_up_10_micro`, `cost_down_10_micro`, `status`, `outcome`, `provisional`, `trades`, `volume_micro`, `open_interest_micro`, `collected_micro`, `payout_left_micro`, `challenge_id`, `prev`, `next`, `bounty_micro`. It has no `b` or `q`; clients infer `b` from the cost-to-move figures. |
| `get_claims(from, limit)` | Up to 100 `ClaimView`s |
| `get_balance(trader)` | micro-USDC |
| `get_position(claim_id, trader)` | `yes_micro`, `no_micro` |
| `get_challenge(challenge_id)` | The `Challenge`, with verdicts and stakes. `None` after `expire_challenge`. |
| `dispute_ends_ns(challenge_id)` | The live window end, or `None` |
| `canonical_request(challenge_id, model)` | The exact request bytes |
| `get_model(model)` | `signing_address_hex`, `extras_json` |
| `get_bounty(claim_id, funder)` | `amount_micro`, `expires_ns` |
| `lane_claimable(trader)` | Balance above the credit |
| `get_resolution()` | Bond, jury deadline, tiers, top window, bounty TTL, swarm |
| `stats()` | `claims`, `challenges`, `treasury_micro`, `reserved_micro`, `lane_budget_micro`, `lane_credit_micro`, `paused`, `held_micro`, `balances_micro`, `collected_micro`, `payouts_micro`, `bonds_micro`, `bounties_micro`, `rewrites_anchored` |

**Cost to move** (`cost_to_move`, in `get_claim`): the cost of the shares that move `d` to `logit(p +/- 0.10)`. It is 0 when the target is within 0.001 of 0 or 1.

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
