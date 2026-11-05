# Corpus method (pre-registered)

Written and committed on 2026-11-05 before any article text or any verdict data was fetched.
The only thing looked at before this file was the MediaWiki `prop=info` response: page titles, redirects and byte lengths. No page text was read.

If anything here has to change, the change goes in a dated **Deviation** section at the end of this file, with the reason. This text above that section is not edited.

## Question

Of the checkable factual sentences on public encyclopedia pages about crypto and NEAR topics, how many are out of date or wrong today, checked against primary data?

## Articles (20, English Wikipedia, CC BY-SA 4.0)

| # | Title | Slug |
|---|---|---|
| 1 | NEAR (blockchain platform) | near |
| 2 | Ethereum | ethereum |
| 3 | Bitcoin | bitcoin |
| 4 | Solana (blockchain platform) | solana |
| 5 | USDC (cryptocurrency) | usdc |
| 6 | Tether (cryptocurrency) | tether |
| 7 | Uniswap | uniswap |
| 8 | Aave | aave |
| 9 | Chainlink (blockchain oracle) | chainlink |
| 10 | Polymarket | polymarket |
| 11 | Zcash | zcash |
| 12 | Monero | monero |
| 13 | Polkadot (blockchain platform) | polkadot |
| 14 | Prediction market | prediction-market |
| 15 | Stablecoin | stablecoin |
| 16 | Proof of stake | proof-of-stake |
| 17 | Dai (cryptocurrency) | dai |
| 18 | Cardano (blockchain platform) | cardano |
| 19 | Avalanche (blockchain platform) | avalanche |
| 20 | Decentralized finance | defi |

The brief also suggested Synthetix, Cosmos, Arbitrum and Lido. On 2026-11-05 English Wikipedia has no article under those names (`prop=info` returned `missing`, including `Cosmos (blockchain)`, `Cosmos Network`, `Lido Finance`, `Lido DAO`, `Arbitrum One`, `Offchain Labs`). Replacements, chosen by title only, without reading them:

- Dai: an on-chain stablecoin whose supply a contract call can check. Stands in for Synthetix as an on-chain issuer.
- Cardano: a large proof-of-stake layer 1 with a public explorer. Stands in for Cosmos.
- Avalanche: a scaling-oriented chain with a public RPC. Stands in for Arbitrum.
- Decentralized finance: carries sector-level TVL-style claims. Stands in for Lido.

No biography of a living person is in the list. Sentences whose subject is a living person's conduct or biography are classed `sourced` and are never used in `ERRORS.json`.

## Pinned revision rule

Each article is pinned to its newest revision with a timestamp at or before **2026-11-05T00:00:00Z**, found with `rvstart=2026-11-05T00:00:00Z&rvdir=older&rvlimit=1`. The cut-off does not depend on when the script runs, so a re-run gets the same revid. Title, revid, timestamp, and the licence and attribution line are saved in `corpus/revisions.json`.

## Splitting

Source text is the rendered HTML from `action=parse&oldid=<revid>`, so that templates such as `{{As of}}` and `{{Convert}}` are expanded as a reader sees them.

Removed before splitting: reference markers and reference lists, infoboxes, sidebars, navboxes, hatnotes, maintenance banners, tables, figures and their captions, edit links, style blocks, math markup.

Removed sections: See also, References, Notes, Footnotes, Citations, Sources, Bibliography, Further reading, External links.

Kept: `<p>` text, and `<li>` text only if it has at least 6 words and ends in `.`, `!` or `?`.

**Infobox facts do not count as sentences** and are outside every number here. They are field values rather than prose, some are filled from outside the article, and including version fields would push the headline up.

Sentences are split on terminal punctuation with protection for abbreviations, decimals and initials. Each sentence gets the id `<slug>-<4-digit page order>`.

## Sentence classes

Classing comes before any verdict work and is committed before the first verdict. A sentence is classed by its grammar and by whether data could check it, never by a guess at whether it is true.

Step one is a mechanical pre-label by rule. Step two is one annotator (the model doing this work, Claude Opus 5.5) reading every sentence and recording overrides in `corpus/class-overrides.json`.

- `data`: asserts a number, a state or a status that primary data can check today. Present tense or present perfect, or carrying its own date marker ("as of", "currently", "today", "at present"). Includes protocol parameters, supply figures, caps, consensus mechanism, status of a product or chain, rankings, counts, and backing or reserve claims.
- `sourced`: a historical fact a primary source could confirm: an event in the past tense with a past end-point ("launched in 2020", "the hack occurred"). Includes sentences on people.
- `opinion`: unfalsifiable or evaluative. Includes judgments, predictions, attributed views ("critics argue"), general definitions and explanations of a concept that no dataset could contradict.

A sentence with both a historical and a present clause is `data` if the present clause meets the `data` test. The checkable form records only the clauses that made it `data`.

For each `data` sentence, the per-article file holds the claim in checkable form: subject, metric, claimed value, the sentence's own date if it has one.

## Sampling rule

If there are 400 `data` sentences or fewer, all are checked. If more, the sample is the 400 ids with the lowest `sha256("pricedin-corpus-2026-11-05|" + id)`, as lowercase hex, sorted ascending. No substitution: a sampled row that cannot be settled stays in the file as `undecidable`.

A sampled sentence that turns out at checking not to be a `data` sentence is marked `reclassified` with a reason. It leaves the headline denominator, is counted and reported, and is not replaced.

## Source order

1. Chain data by RPC or explorer API.
2. The protocol's own docs, repositories, governance records or filings.
3. Independent aggregators such as DefiLlama or CoinGecko.

The highest available tier is used. A secondary news story alone cannot settle a verdict, except as evidence that a value was true when written (see `stale`).

## Verdicts

Every checked row records: claimed value, checked value, date checked, a receipt (URL or replayable command), the verdict. Where a value changes over time the fetched response or an extract is kept under `corpus/receipts/`.

- `current`: still true on the check date.
- `stale`: true when written and no longer true. Needs evidence for both: (a) today's value from the source order above, and (b) evidence that the claim held when written, namely a historical primary or aggregator value, or the source cited on that sentence, which must have been opened or read through an archive copy.
- `wrong`: never true on the evidence. Gets a second independent check by a different source or route.
- `undecidable`: could not be settled from primary data. Never a guess. If today's value contradicts the page but neither (b) nor a "never true" finding can be shown, the row is `undecidable`.
- `dated` (a flag, not a separate verdict): a sentence dated in its own wording that was true at that date is `current` and carries `dated: true`. Dated rows are counted apart as well. A dated sentence that cannot be confirmed for its date is `undecidable`. The passage of time alone never makes a dated sentence stale.

Tolerances:

- A plain number is true if today's value matches at the precision stated ("$2.5 billion" covers 2.45 to 2.55).
- "About", "approximately", "around", "roughly", "nearly": within 10%.
- "More than", "over", "at least" and the like are one-sided: true if the value meets the bound.
- A ranking is checked against the named metric. If none is named, market capitalisation on the aggregator.
- Several checkable clauses in one sentence: every clause that made it `data` is checked. The sentence takes the worst result in the order `wrong`, `stale`, `undecidable`, `current`.

## Audit

A seeded 15% of checked rows (rounded up): the rows with the lowest `sha256("pricedin-audit-2026-11-05|" + id)`. Each is re-checked from scratch from a blinded packet holding only the sentence and the claim, with fresh fetches, and the agreement rate with the first verdict is reported.

Known limit, stated before the fact: the audit is run by the same agent in the same session. The first verdict is not displayed during the audit, but the agent cannot unlearn it. The agreement rate is therefore an upper bound on what an independent auditor would get. The blinded packet is saved as `corpus/audit/packet.json` so anyone can repeat it cold.

Every `wrong` verdict gets a second check by a different source or route, whether or not it falls in the audit sample.

## Headline formula

Let C be `current` rows (dated rows included), S be `stale`, W be `wrong`, U be `undecidable`, over checked `data` sentences, after removing `reclassified` rows.

**Headline H = (S + W) / (C + S + W)**, the share of decided `data` sentences that are stale or wrong, with a 95% Wilson score interval, z = 1.959964.

Also reported:

- Counts of C, of which dated, S, W, U, and reclassified.
- Lower-bound sensitivity: (S + W) / (C + S + W + U).
- H excluding dated rows: (S + W) / (C - dated + S + W).
- Counts by article and by class.
- The median age of stale facts: days from the first revision whose wikitext holds the stale value to the check date, where a bisection of the page history can find it.

## Tone

Volunteers wrote these pages and a stale figure is not a scandal. The output states what the page says, what the source says, and the date it was checked.
