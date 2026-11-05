# LMSR core (stream A foundation): 4/4 tests pass, 2026-11-05

A pure-Rust fixed-point binary LMSR with no dependencies, at 1e12 per dollar. The same code runs in the NEAR contract and in native tests.

| Property | Result |
|---|---|
| exp and ln against f64 | exp within 1e-9 relative plus 2e-12 absolute over [-39, 39]; ln within 1e-9 absolute for inputs >= 1e-3 |
| the architect's numbers | b = $3, p0 = 0.5, $1 on YES moves the price to 0.6417; worst-case subsidy at p0 = 0.2 is 4.828 (3 ln 5) |
| prices sum to one; buying a side raises its price | yes, across 50 consecutive buys |
| 10,000 random buy and sell sequences | charged <= spend every time; collected = C(final) - C(open) within rounding, always in the market's favour (path independence); the maker's loss <= b ln(1/p0) if YES wins and <= b ln(1/(1-p0)) if NO wins |
| share amounts against exact f64 math | max 3.0e-8 dollars over uncapped trades, which is 3% of the smallest USDC unit |

**Design decisions:**
- Prices are capped to [0.0001, 0.9999], or |d| <= ln 9999. A buy that would cross the cap buys up to it and refunds the rest. This stops a saturated side from dividing by zero, which was a real bug the property test found.
- Opening prices are clamped to [0.2, 0.8], so the worst-case subsidy per claim is <= b ln 5.
- e^x - 1 is computed with expm1 for small spends.
- After the closed-form estimate, trades are charged exactly C(after) - C(before), rounded up. Overshoot is corrected by excess divided by marginal price.

**Claims we can make, measured:**
- Prices sum to one.
- Cost is path-independent.
- The subsidy loss is bounded by b ln(1/p0).
- Share amounts are within 3e-8 dollars of exact LMSR math.

**Not claimed:** 1e-9 relative precision on tiny trades. Fixed-point resolution makes it untrue for trades of a few cents.
