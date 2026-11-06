//! Fixed-point binary LMSR (logarithmic market scoring rule) market maker.
//!
//! Units: every amount is `i128` at `SCALE` = 1e12 per dollar (or per share).
//! One share pays $1 if its side wins. USDC (6 decimals) converts by `* 1_000_000`.
//! The math is dependency-free so it runs identically in a NEAR contract and in
//! native property tests.
//!
//! Cost function with an opening-price offset d0 = ln(p0 / (1 - p0)):
//!   C(q_yes, q_no) = q_no + b * softplus(d0 + (q_yes - q_no) / b)
//!   price_yes      = sigmoid(d0 + (q_yes - q_no) / b)
//! A trade is always charged C(after) - C(before), rounded in the market's favour,
//! so the money collected equals C(final) - C(open) up to rounding, whatever the
//! path. The market maker's worst-case loss is b * ln(1 / p0) if YES wins and
//! b * ln(1 / (1 - p0)) if NO wins.
//!
//! `fill_buy` and `fill_sell` are the market contract's fills in whole micro units, with its
//! taker fee: the contract calls them for every trade and for its quote views, so a quote and
//! the fill it predicts are the same code.

pub const SCALE: i128 = 1_000_000_000_000; // 1e12
pub const LN2: i128 = 693_147_180_560; // ln(2) * 1e12
const EXP_MAX: i128 = 40 * SCALE; // e^40 * 1e12 ~ 2.35e29, well inside i128
/// SCALE units per micro-USDC (1e-6 dollar) and per micro-share: the contract's storage and
/// API count in whole micros.
pub const MICRO: i128 = 1_000_000;
/// Basis points in a whole: a fee of `bps` takes bps / 10,000 of an amount.
pub const BPS: u128 = 10_000;

/// The taker fee on `amount_micro` at `fee_bps`: amount * fee_bps / 10,000, rounded up, so a
/// fee is never below its rate. It is at most the amount while `fee_bps <= BPS`.
pub fn fee_on(amount_micro: u128, fee_bps: u128) -> u128 {
    (amount_micro * fee_bps).div_ceil(BPS)
}

/// a * b / SCALE, rounded toward zero.
#[inline]
pub fn mul(a: i128, b: i128) -> i128 {
    a * b / SCALE
}

/// a * SCALE / b, rounded toward zero.
#[inline]
pub fn div(a: i128, b: i128) -> i128 {
    a * SCALE / b
}

/// e^x for x at SCALE. Saturates at e^40 and returns 0 below e^-40.
pub fn exp(x: i128) -> i128 {
    if x > EXP_MAX {
        return exp(EXP_MAX);
    }
    if x < -EXP_MAX {
        return 0;
    }
    // x = k ln2 + r, |r| <= ln2 / 2
    let k = if x >= 0 { (x + LN2 / 2) / LN2 } else { (x - LN2 / 2) / LN2 };
    let r = x - k * LN2;
    // Taylor series for e^r
    let mut sum = SCALE;
    let mut term = SCALE;
    for n in 1..=24i128 {
        term = term * r / (n * SCALE);
        if term == 0 {
            break;
        }
        sum += term;
    }
    if k >= 0 {
        sum << (k as u32)
    } else {
        sum >> ((-k) as u32)
    }
}

/// e^x - 1 at SCALE, computed directly for |x| < 1/2 so small arguments keep their precision.
pub fn expm1(x: i128) -> i128 {
    if x.abs() >= SCALE / 2 {
        return exp(x) - SCALE;
    }
    let mut sum = 0i128;
    let mut term = x;
    let mut n = 1i128;
    while term != 0 && n < 40 {
        sum += term;
        n += 1;
        term = term * x / (n * SCALE);
    }
    sum
}

/// ln(x) for x > 0 at SCALE.
pub fn ln(x: i128) -> i128 {
    assert!(x > 0, "ln of non-positive");
    // x = m * 2^k with m in [SCALE, 2 SCALE)
    let mut k: i128 = 0;
    let mut m = x;
    while m >= 2 * SCALE {
        m >>= 1;
        k += 1;
    }
    while m < SCALE {
        m <<= 1;
        k -= 1;
    }
    // ln(m) = 2 atanh(z), z = (m - 1) / (m + 1), z in [0, 1/3)
    let z = div(m - SCALE, m + SCALE);
    let z2 = mul(z, z);
    let mut term = z;
    let mut sum = 0i128;
    let mut n = 1i128;
    while term != 0 && n < 80 {
        sum += term / n;
        term = mul(term, z2);
        n += 2;
    }
    k * LN2 + 2 * sum
}

/// ln(1 + e^x), stable for any x.
pub fn softplus(x: i128) -> i128 {
    let ax = if x < 0 { -x } else { x };
    let pos = if x > 0 { x } else { 0 };
    pos + ln(SCALE + exp(-ax))
}

/// 1 / (1 + e^-x) at SCALE.
pub fn sigmoid(x: i128) -> i128 {
    if x >= 0 {
        let e = exp(-x);
        div(SCALE, SCALE + e)
    } else {
        let e = exp(x);
        div(e, SCALE + e)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Market {
    /// liquidity parameter, dollars at SCALE
    pub b: i128,
    /// opening log-odds ln(p0 / (1 - p0)) at SCALE
    pub d0: i128,
    /// outstanding YES shares at SCALE
    pub q_yes: i128,
    /// outstanding NO shares at SCALE
    pub q_no: i128,
}

/// Opening prices are clamped to [0.2, 0.8] so the subsidy stays bounded.
pub const P_MIN: i128 = SCALE / 5;
pub const P_MAX: i128 = SCALE - SCALE / 5;
/// Prices are capped to [0.0001, 0.9999]: |d| <= ln(9999). A buy that would cross the
/// cap buys up to it and refunds the rest.
pub const D_CAP: i128 = 9_210_240_366_976;
/// Floor used only inside the closed-form estimate, so a saturated side never divides by zero.
const P_FLOOR: i128 = 1_000_000; // 1e-6
/// The most micro-shares `fill_buy` steps back when rounding puts the cost a micro over budget.
/// One micro-share costs at least 100 units at the 0.0001 price floor, so a few steps cover the
/// rounding; the property test measures how many it takes.
pub const FILL_STEPS: u32 = 16;

impl Market {
    pub fn open(b: i128, p0: i128) -> Self {
        assert!(b > 0, "b must be positive");
        let p0 = p0.clamp(P_MIN, P_MAX);
        let d0 = ln(div(p0, SCALE - p0));
        Market { b, d0, q_yes: 0, q_no: 0 }
    }

    fn d(&self) -> i128 {
        self.d0 + div(self.q_yes - self.q_no, self.b)
    }

    pub fn price_yes(&self) -> i128 {
        sigmoid(self.d())
    }

    pub fn price_no(&self) -> i128 {
        SCALE - self.price_yes()
    }

    pub fn price(&self, side: Side) -> i128 {
        match side {
            Side::Yes => self.price_yes(),
            Side::No => self.price_no(),
        }
    }

    /// C(q) at SCALE.
    pub fn cost(&self) -> i128 {
        self.q_no + mul(self.b, softplus(self.d()))
    }

    /// C at the opening state.
    pub fn cost_open(&self) -> i128 {
        mul(self.b, softplus(self.d0))
    }

    fn with(&self, side: Side, delta: i128) -> Market {
        let mut m = *self;
        match side {
            Side::Yes => m.q_yes += delta,
            Side::No => m.q_no += delta,
        }
        m
    }

    /// Shares `side` can still buy before the price cap.
    fn room(&self, side: Side) -> i128 {
        match side {
            Side::Yes => mul(D_CAP - self.d(), self.b),
            Side::No => mul(D_CAP + self.d(), self.b),
        }
    }

    /// Whether `side` is at the price cap: not one whole micro-share is left to buy before it,
    /// so every `fill_buy` on that side is empty, whatever the amount.
    pub fn at_cap(&self, side: Side) -> bool {
        self.room(side) - 4 < MICRO
    }

    /// Shares a spend buys, from the closed form s = b ln((e^{m/b} - 1 + p) / p),
    /// then shaved so that the exact cost difference never exceeds the spend.
    /// Returns (shares, charged), with charged <= spend.
    ///
    /// A spend that would cross the price cap buys up to the cap: `charged` is what those
    /// shares cost, and the rest of the spend is never charged. The cap check comes first,
    /// so the closed form only ever sees a spend below the cost of reaching the cap, which is
    /// at most b ln(1 / 0.0001) + rounding, about 9.3 b. Without that order e^{spend/b}
    /// overflows i128 for spends above about 33 b.
    pub fn quote_buy(&self, side: Side, spend: i128) -> (i128, i128) {
        assert!(spend > 0, "spend must be positive");
        // room before the price cap, in shares
        let room = self.room(side);
        if room <= 4 {
            return (0, 0);
        }
        // what every share up to the cap costs, rounded up as the loop below charges
        let to_cap = self.with(side, room).cost() - self.cost() + 1;
        let mut shares = if spend >= to_cap {
            room
        } else {
            let p = self.price(side).max(P_FLOOR);
            // s = b ln(1 + (e^{m/b} - 1) / p), with expm1 for precision on small spends
            let inner = SCALE + div(expm1(div(spend, self.b)), p);
            mul(self.b, ln(inner)).clamp(0, room)
        };
        // safety shave for rounding; then charge the exact cost difference, rounded up.
        // If the charge still exceeds the spend, step back by excess / marginal price.
        shares -= 4;
        loop {
            if shares <= 0 {
                return (0, 0);
            }
            let after = self.with(side, shares);
            let charged = after.cost() - self.cost() + 1;
            if charged <= spend {
                return (shares, charged);
            }
            let p_after = after.price(side).max(P_FLOOR);
            shares -= div(charged - spend, p_after) + 1;
        }
    }

    /// Proceeds for selling `shares`, rounded down: C(before) - C(after) - 1.
    pub fn quote_sell(&self, side: Side, shares: i128) -> i128 {
        assert!(shares > 0, "shares must be positive");
        let held = match side {
            Side::Yes => self.q_yes,
            Side::No => self.q_no,
        };
        assert!(shares <= held, "cannot sell more than outstanding");
        let proceeds = self.cost() - self.with(side, -shares).cost() - 1;
        if proceeds < 0 {
            0
        } else {
            proceeds
        }
    }

    pub fn apply_buy(&mut self, side: Side, shares: i128) {
        *self = self.with(side, shares);
    }

    pub fn apply_sell(&mut self, side: Side, shares: i128) {
        *self = self.with(side, -shares);
    }

    /// The market maker's loss if `side` wins, given the money collected so far.
    pub fn loss_if(&self, side: Side, collected: i128) -> i128 {
        let payout = match side {
            Side::Yes => self.q_yes,
            Side::No => self.q_no,
        };
        payout - collected
    }

    /// b ln(1 / p0) for YES, b ln(1 / (1 - p0)) for NO.
    pub fn max_loss(&self, side: Side) -> i128 {
        let p0 = sigmoid(self.d0);
        let p = match side {
            Side::Yes => p0,
            Side::No => SCALE - p0,
        };
        mul(self.b, -ln(p))
    }

    /// The market contract's buy, in whole micro units: the trader pays at most `amount_micro`,
    /// fee included.
    /// 1. The pot's budget is what leaves room for the fee: floor(amount * 10,000 / (10,000 + bps)).
    /// 2. `quote_buy` on that budget, the shares floored to whole micro-shares.
    /// 3. Those shares cost exactly C(after) - C(before), rounded up to a micro; the fee is
    ///    `fee_on` that cost.
    /// 4. Near a price cap the fixed-point cost carries rounding of a few hundred units, more than
    ///    the true cost of the fraction the floor dropped, so the cost of the floored shares can
    ///    come out a micro above the budget. Then it steps back one micro-share at a time, at most
    ///    `FILL_STEPS` times, until the cost fits (the contract used to refuse such a buy).
    ///
    /// cost + fee <= amount always: the cost is at most the budget, and budget + fee_on(budget)
    /// <= amount. A fill of zero shares (the price at its cap, or an amount too small for one
    /// micro-share) charges nothing.
    pub fn fill_buy(&self, side: Side, amount_micro: u128, fee_bps: u128) -> BuyFill {
        let budget = amount_micro.saturating_mul(BPS) / (BPS + fee_bps);
        // any budget past i128 at SCALE buys to the cap; quote_buy takes spends up to i128::MAX
        let spend = budget.min((i128::MAX / MICRO) as u128) as i128 * MICRO;
        if spend <= 0 {
            return BuyFill::default();
        }
        let mut shares_micro = self.quote_buy(side, spend).0 / MICRO;
        let before = self.cost();
        for _ in 0..=FILL_STEPS {
            if shares_micro <= 0 {
                break;
            }
            let exact = self.with(side, shares_micro * MICRO).cost() - before;
            let cost_micro = ((exact.max(0) + MICRO - 1) / MICRO) as u128;
            if cost_micro <= budget {
                return BuyFill { shares_micro: shares_micro as u128, cost_micro, fee_micro: fee_on(cost_micro, fee_bps) };
            }
            shares_micro -= 1;
        }
        BuyFill::default()
    }

    /// The market contract's sale of whole micro-shares: the pot pays `quote_sell` rounded down
    /// to a micro, and the fee is `fee_on` those proceeds.
    pub fn fill_sell(&self, side: Side, shares_micro: u128, fee_bps: u128) -> SellFill {
        let proceeds = self.quote_sell(side, shares_micro as i128 * MICRO);
        let proceeds_micro = (proceeds.max(0) / MICRO) as u128;
        SellFill { proceeds_micro, fee_micro: fee_on(proceeds_micro, fee_bps) }
    }
}

/// A buy as the market contract fills it (`Market::fill_buy`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BuyFill {
    /// whole micro-shares bought
    pub shares_micro: u128,
    /// what they cost, into the claim's pot: C(after) - C(before), rounded up to a micro
    pub cost_micro: u128,
    /// the taker fee on that cost, rounded up; it goes to the treasury
    pub fee_micro: u128,
}

impl BuyFill {
    /// What the trader pays: the cost and the fee.
    pub fn paid_micro(&self) -> u128 {
        self.cost_micro + self.fee_micro
    }
}

/// A sale as the market contract fills it (`Market::fill_sell`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SellFill {
    /// what the claim's pot pays for the shares, rounded down to a micro
    pub proceeds_micro: u128,
    /// the taker fee on those proceeds, rounded up; it goes to the treasury
    pub fee_micro: u128,
}

impl SellFill {
    /// What the trader receives: the proceeds less the fee.
    pub fn received_micro(&self) -> u128 {
        self.proceeds_micro - self.fee_micro
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(x: i128) -> f64 {
        x as f64 / SCALE as f64
    }
    fn s(x: f64) -> i128 {
        (x * SCALE as f64).round() as i128
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn unit(&mut self) -> f64 {
            (self.next() >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    #[test]
    fn exp_ln_match_f64() {
        // fixed-point has absolute resolution 1e-12: require 1e-9 relative error,
        // or 2e-12 absolute error for values below 1e-3
        let mut worst: f64 = 0.0;
        let mut x = -39.0f64;
        while x <= 39.0 {
            let got = f(exp(s(x)));
            let want = x.exp();
            let err = (got - want).abs();
            let tol = 1e-9 * want + 2e-12;
            worst = worst.max(err / tol);
            x += 0.137;
        }
        assert!(worst <= 1.0, "exp error exceeds tolerance by {worst}x");
        // below 1e-3 the input itself carries less than 1e-9 relative precision at SCALE
        let mut worst_ln: f64 = 0.0;
        let mut y = 1e-3f64;
        while y < 1e6 {
            let got = f(ln(s(y)));
            let want = y.ln();
            worst_ln = worst_ln.max((got - want).abs());
            y *= 1.37;
        }
        assert!(worst_ln < 1e-9, "ln worst absolute error {worst_ln}");
    }

    #[test]
    fn architect_numbers() {
        // b = $3, p0 = 0.5, spend $1 on YES moves 50% to about 64%
        let mut m = Market::open(3 * SCALE, SCALE / 2);
        let (sh, charged) = m.quote_buy(Side::Yes, SCALE);
        assert!(charged <= SCALE);
        m.apply_buy(Side::Yes, sh);
        let p = f(m.price_yes());
        assert!((p - 0.6417).abs() < 0.001, "price after $1 was {p}");
        // b = $3, p0 = 0.2: worst case loss if YES wins is 3 ln 5 = 4.828
        let m2 = Market::open(3 * SCALE, SCALE / 5);
        let ml = f(m2.max_loss(Side::Yes));
        assert!((ml - 4.8283).abs() < 0.001, "max loss {ml}");
    }

    #[test]
    fn prices_sum_to_one_and_move_monotonically() {
        let mut m = Market::open(3 * SCALE, s(0.37));
        let mut last = m.price_yes();
        for _ in 0..50 {
            assert!((m.price_yes() + m.price_no() - SCALE).abs() <= 1);
            let (sh, _) = m.quote_buy(Side::Yes, s(0.25));
            m.apply_buy(Side::Yes, sh);
            let now = m.price_yes();
            assert!(now > last, "buying YES must raise the YES price");
            last = now;
        }
    }

    #[test]
    fn property_random_sequences() {
        let mut rng = Rng(0x9e3779b97f4a7c15);
        let mut max_f64_gap: f64 = 0.0;
        for case in 0..10_000 {
            let b = s(0.5 + rng.unit() * 20.0);
            let p0 = s(0.2 + rng.unit() * 0.6);
            let mut m = Market::open(b, p0);
            let open = m;
            let mut collected: i128 = 0;
            let mut trades: i128 = 0;
            let mut held_yes: i128 = 0;
            let mut held_no: i128 = 0;
            let steps = 1 + (rng.next() % 12) as usize;
            for _ in 0..steps {
                let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
                let sell = rng.next() % 4 == 0;
                if sell {
                    let held = if side == Side::Yes { held_yes } else { held_no };
                    if held > 10 {
                        let sh = (held as f64 * rng.unit()) as i128 + 1;
                        let sh = sh.min(held);
                        let got = m.quote_sell(side, sh);
                        m.apply_sell(side, sh);
                        collected -= got;
                        if side == Side::Yes { held_yes -= sh } else { held_no -= sh }
                        trades += 1;
                    }
                } else {
                    let spend = s(0.01 + rng.unit() * 5.0);
                    let (sh, charged) = m.quote_buy(side, spend);
                    assert!(charged <= spend, "case {case}: charged more than spend");
                    if sh > 0 {
                        // f64 check of the closed form against the fixed-point shares,
                        // only when the trade was not stopped by the price cap
                        let p = f(m.price(side));
                        let bf = f(m.b);
                        let want = bf * (((f(spend) / bf).exp() - 1.0 + p) / p).ln();
                        let d_after = f(m.d0) + (f(m.q_yes) - f(m.q_no)) / bf + if side == Side::Yes { want / bf } else { -want / bf };
                        let capped = d_after.abs() > f(D_CAP) - 1e-6 || p < 1e-4;
                        // tolerance: 1e-9 relative plus 5e-10 dollars absolute, i.e. below a
                        // two-thousandth of the smallest USDC unit (1e-6). The absolute part covers
                        // cost-function rounding, which scales with b, and the charged <= spend step.
                        let gap = (f(sh) - want).abs();
                        if want > 1e-3 && !capped && gap > max_f64_gap {
                            max_f64_gap = gap;
                        }
                        m.apply_buy(side, sh);
                        collected += charged;
                        if side == Side::Yes { held_yes += sh } else { held_no += sh }
                        trades += 1;
                    }
                }
                assert!((m.price_yes() + m.price_no() - SCALE).abs() <= 1, "case {case}: prices must sum to 1");
            }
            // path independence: what was collected equals C(final) - C(open), up to rounding in the market's favour
            let path_free = m.cost() - open.cost_open();
            let slack = collected - path_free;
            assert!(slack >= -2 && slack <= 8 * (trades + 1), "case {case}: slack {slack} over {trades} trades");
            // bounded loss in either outcome
            for side in [Side::Yes, Side::No] {
                let loss = m.loss_if(side, collected);
                let bound = open.max_loss(side);
                assert!(loss <= bound + 1_000, "case {case}: loss {} exceeds bound {}", f(loss), f(bound));
            }
        }
        eprintln!("MEASURED max |fixed-point shares - f64 shares| = {max_f64_gap:e} dollars over uncapped trades");
        // bound that matters for money: under 1/10 of the smallest USDC unit (1e-6 dollars);
        // measured 2026-11-05: 3.0e-8 dollars over 10,000 random sequences
        assert!(max_f64_gap < 1e-7, "fixed-point vs f64 share error {max_f64_gap:e} dollars");
    }

    /// The fee-free whole-micro buy exactly as the market contract wrote it before it called
    /// `fill_buy`: shares floored to whole micro-shares, charged their exact cost rounded up to a
    /// whole micro-USDC. When that charge came out above the order, the contract refused the buy
    /// ("slippage"). The oracle `fill_buy` must equal at 0 bps wherever the old buy went through.
    fn reference_buy(m: &Market, side: Side, amount_micro: i128) -> (i128, i128) {
        let (shares, charged) = m.quote_buy(side, amount_micro * MICRO);
        assert!(charged <= amount_micro * MICRO);
        let shares_micro = shares / MICRO;
        if shares_micro <= 0 {
            return (0, 0);
        }
        let after = m.with(side, shares_micro * MICRO);
        let exact = after.cost() - m.cost();
        let charged_micro = (exact.max(0) + MICRO - 1) / MICRO;
        (shares_micro, charged_micro)
    }

    #[test]
    fn a_spend_far_above_the_liquidity_buys_to_the_cap_and_keeps_the_rest() {
        // b = $0.10 at 50%: $5 is 50 b. Before the cap-first order this overflowed i128.
        let m = Market::open(SCALE / 10, SCALE / 2);
        let spend = 5 * SCALE;
        let (sh, charged) = m.quote_buy(Side::Yes, spend);
        assert!(sh > 0 && charged > 0 && charged < spend);
        let mut after = m;
        after.apply_buy(Side::Yes, sh);
        assert!(after.price_yes() > SCALE - SCALE / 5_000, "price after {}", f(after.price_yes()));
        assert!(after.room(Side::Yes) <= 5 && after.at_cap(Side::Yes), "stopped {} short of the cap", after.room(Side::Yes));
        // b ln(0.5 / 0.0001) = $0.852: that is all it costs; the other $4.15 is never charged
        assert!((f(charged) - 0.1 * (0.5f64 / 0.0001).ln()).abs() < 1e-6, "charged {}", f(charged));
        // at the cap a further buy gets nothing and is charged nothing
        assert_eq!(after.quote_buy(Side::Yes, spend), (0, 0));
        // the contract's fill of the same order: $5 in, $0.851720 into the pot, and at 1% a fee of
        // $0.008518 on that cost (rounded up); the other $4.14 is never charged
        let fill = m.fill_buy(Side::Yes, 5_000_000, 0);
        assert!(fill.shares_micro > 0 && fill.cost_micro == 851_720 && fill.fee_micro == 0, "{fill:?}");
        let fee = m.fill_buy(Side::Yes, 5_000_000, 100);
        assert_eq!((fee.shares_micro, fee.cost_micro, fee.fee_micro, fee.paid_micro()), (fill.shares_micro, 851_720, 8_518, 860_238));
        let mut capped = m;
        capped.apply_buy(Side::Yes, fee.shares_micro as i128 * MICRO);
        assert_eq!(capped.fill_buy(Side::Yes, 5_000_000, 100), BuyFill::default());
        // the closed form alone, which the old order evaluated first, overflows on this order
        let closed_form = std::panic::catch_unwind(|| div(expm1(div(spend, m.b)), m.price_yes()));
        assert!(closed_form.is_err(), "e^50 / p should overflow i128 at SCALE");
    }

    #[test]
    fn the_taker_fee_on_buys_and_sales() {
        // fee_on rounds up and is never more than the amount
        assert_eq!((fee_on(0, 300), fee_on(1, 1), fee_on(10_000, 100), fee_on(10_001, 100), fee_on(7, 10_000)), (0, 1, 100, 101, 7));
        // $1 at 1% on b = $3 at 50%: the pot's budget is floor(1,000,000 / 1.01) = 990,099
        let m = Market::open(3 * SCALE, SCALE / 2);
        let buy = m.fill_buy(Side::Yes, 1_000_000, 100);
        assert!(buy.shares_micro > 0 && buy.cost_micro <= 990_099 && buy.paid_micro() <= 1_000_000, "{buy:?}");
        assert_eq!(buy.fee_micro, buy.cost_micro.div_ceil(100));
        assert_eq!(buy, BuyFill { shares_micro: m.fill_buy(Side::Yes, 990_099, 0).shares_micro, cost_micro: m.fill_buy(Side::Yes, 990_099, 0).cost_micro, fee_micro: buy.fee_micro });
        // at 0 bps the fill is the contract's fill before the fee, to the micro
        let (sh, ch) = reference_buy(&m, Side::Yes, 1_000_000);
        assert_eq!(m.fill_buy(Side::Yes, 1_000_000, 0), BuyFill { shares_micro: sh as u128, cost_micro: ch as u128, fee_micro: 0 });
        // an amount too small to leave a micro for the pot buys nothing and pays nothing
        assert_eq!(m.fill_buy(Side::Yes, 1, 100), BuyFill::default());
        // a sale pays the fee out of its proceeds, and a round trip pays both fees
        let mut after = m;
        after.apply_buy(Side::Yes, buy.shares_micro as i128 * MICRO);
        let sale = after.fill_sell(Side::Yes, buy.shares_micro, 100);
        assert_eq!(sale.fee_micro, fee_on(sale.proceeds_micro, 100));
        assert_eq!(sale.proceeds_micro, (after.quote_sell(Side::Yes, buy.shares_micro as i128 * MICRO) / MICRO) as u128);
        assert!(sale.received_micro() + buy.fee_micro + sale.fee_micro <= buy.paid_micro(), "{buy:?} {sale:?}");
        assert_eq!(after.fill_sell(Side::Yes, buy.shares_micro, 0).fee_micro, 0);
    }

    #[test]
    fn property_fills_never_overcharge_and_round_trips_never_profit() {
        // The contract's liquidity range ($0.10..$100 in whole micros), any opening price, the
        // market pushed anywhere, amounts from 1 micro to $10^12, fees from 0 to the 300 bps cap.
        let mut rng = Rng(0xfee_b05_0f_f111);
        let (mut fills, mut capped, mut empty, mut refused_before, mut max_steps) = (0u32, 0u32, 0u32, 0u32, 0u128);
        for case in 0..20_000 {
            let b = (100_000 + rng.next() % 99_900_001) as i128 * MICRO;
            let p0 = s(0.2 + rng.unit() * 0.6);
            let mut m = Market::open(b, p0);
            for _ in 0..(rng.next() % 4) {
                let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
                let f = m.fill_buy(side, 1 + rng.next() as u128 % (40 * b / MICRO) as u128, 0);
                m.apply_buy(side, f.shares_micro as i128 * MICRO);
            }
            let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
            let amount = (10f64.powf(rng.unit() * 18.0)) as u128 + 1;
            let fee_bps = match rng.next() % 5 { 0 => 0, 1 => 100, 2 => 300, _ => (rng.next() % 301) as u128 };
            let f = m.fill_buy(side, amount, fee_bps);
            let budget = amount * BPS / (BPS + fee_bps);
            assert!(f.paid_micro() <= amount && f.cost_micro <= budget, "case {case}: {f:?} for {amount} at {fee_bps} bps");
            assert_eq!(f.fee_micro, fee_on(f.cost_micro, fee_bps), "case {case}");
            // at 0 bps it is the contract's old fill, to the micro, wherever the old buy went
            // through; where the old charge came out above the order (refused), it steps back
            let (sh0, ch0) = reference_buy(&m, side, amount as i128);
            let free = m.fill_buy(side, amount, 0);
            if ch0 as u128 <= amount {
                assert_eq!(free, BuyFill { shares_micro: sh0 as u128, cost_micro: ch0 as u128, fee_micro: 0 }, "case {case}");
            } else {
                refused_before += 1;
                assert!(free.shares_micro < sh0 as u128 && free.cost_micro <= amount, "case {case}: {free:?}");
            }
            let raw = (m.quote_buy(side, (budget.min((i128::MAX / MICRO) as u128) as i128 * MICRO).max(1)).0 / MICRO) as u128;
            if f.shares_micro > 0 {
                max_steps = max_steps.max(raw - f.shares_micro);
            }
            // a fee never buys more shares than no fee
            assert!(f.shares_micro <= free.shares_micro, "case {case}");
            if f.shares_micro == 0 {
                assert_eq!(f, BuyFill::default(), "case {case}: charged for nothing");
                empty += 1;
                continue;
            }
            fills += 1;
            let mut after = m;
            after.apply_buy(side, f.shares_micro as i128 * MICRO);
            // the cost is the exact cost difference, rounded up to a micro
            assert_eq!(f.cost_micro, ((after.cost() - m.cost()) as u128).div_ceil(MICRO as u128), "case {case}");
            if after.at_cap(side) {
                capped += 1;
            }
            // selling it all back never returns more than was paid, less both fees
            let sale = after.fill_sell(side, f.shares_micro, fee_bps);
            assert!(sale.fee_micro <= sale.proceeds_micro && sale.received_micro() + f.fee_micro + sale.fee_micro <= f.paid_micro(), "case {case}: {f:?} {sale:?}");
        }
        eprintln!("MEASURED {fills} fills with fees from 0 to 300 bps ({capped} to the cap, {empty} empty): never above the amount, the fee always fee_on(cost); {refused_before} buys the old fill refused now fill, at most {max_steps} micro-shares stepped back (FILL_STEPS = {FILL_STEPS})");
        // a third of the orders find their side already at the cap, or are too small for a share
        assert!(fills > 12_000 && capped > 5_000 && refused_before > 0, "fills {fills}, capped {capped}, refused before {refused_before}");
        assert!(max_steps < FILL_STEPS as u128 / 2, "stepping back took {max_steps} micro-shares");
    }

    #[test]
    fn property_extreme_spends_and_liquidity_never_overflow() {
        // The release profile checks overflow (workspace Cargo.toml), so an i128 overflow anywhere
        // in the maths panics here exactly as it would in the contract.
        // Liquidity from $0.01 to $1e9 (the contract allows $0.10..$100), spends from 1e-9 b to
        // 1e12 b, plus i128::MAX, on markets pushed anywhere between the two caps.
        let mut rng = Rng(0x5eed_0f_b16_5e7d);
        let mut capped = 0u32;
        let mut quotes = 0u32;
        for case in 0..20_000 {
            let b = (10f64.powf(-2.0 + rng.unit() * 11.0) * SCALE as f64) as i128;
            let p0 = s(0.2 + rng.unit() * 0.6);
            let open = Market::open(b, p0);
            let mut m = open;
            let mut collected: i128 = 0;
            // push the market somewhere, sometimes all the way to a cap
            for _ in 0..(rng.next() % 4) {
                let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
                let spend = (f(b) * 10f64.powf(-3.0 + rng.unit() * 5.0) * SCALE as f64) as i128 + 1;
                let (sh, ch) = m.quote_buy(side, spend);
                if sh > 0 {
                    m.apply_buy(side, sh);
                    collected += ch;
                }
            }
            for _ in 0..6 {
                let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
                let spend = if rng.next() % 12 == 0 {
                    i128::MAX
                } else {
                    let x = (f(b) * 10f64.powf(-9.0 + rng.unit() * 21.0) * SCALE as f64) as i128;
                    x.max(1)
                };
                quotes += 1;
                let (sh, ch) = m.quote_buy(side, spend);
                assert!(sh >= 0 && ch >= 0 && ch <= spend, "case {case}: charged {ch} for spend {spend}");
                let r = m.room(side);
                assert!(sh <= r, "case {case}: bought past the cap");
                if sh == 0 {
                    assert_eq!(ch, 0, "case {case}: charged for nothing");
                    continue;
                }
                let after = m.with(side, sh);
                assert_eq!(ch, after.cost() - m.cost() + 1, "case {case}: charge is not the exact cost");
                let to_cap = m.with(side, r).cost() - m.cost() + 1;
                if spend >= to_cap {
                    // it bought to the cap (less the 4-unit shave) and the rest was never charged
                    capped += 1;
                    assert!(r - sh <= 4, "case {case}: stopped {} short of the cap", r - sh);
                    assert!(spend - ch >= spend - to_cap, "case {case}");
                    let p = after.price(side);
                    assert!(p > SCALE - SCALE / 9_000, "case {case}: capped price {}", f(p));
                }
                // more money never buys fewer shares
                if spend < i128::MAX / 2 {
                    let (sh2, _) = m.quote_buy(side, spend * 2);
                    assert!(sh2 >= sh, "case {case}: doubling the spend bought fewer shares");
                }
                m = after;
                collected += ch;
                // bounded loss in either outcome, also after a buy to the cap
                for o in [Side::Yes, Side::No] {
                    let loss = m.loss_if(o, collected);
                    let bound = open.max_loss(o);
                    assert!(loss <= bound + 1_000, "case {case}: loss {} exceeds bound {}", f(loss), f(bound));
                }
                assert!((m.price_yes() + m.price_no() - SCALE).abs() <= 1);
            }
            // the contract's own path, with orders up to $10^12 on the contract's liquidity range,
            // with and without the fee, and an amount of u128::MAX micro-USDC
            let bc = ((0.1 + rng.unit() * 99.9) * SCALE as f64) as i128;
            let mc = Market::open(bc, p0);
            let amount_micro = (10f64.powf(rng.unit() * 18.0)) as i128 + 1;
            let side = if rng.next() % 2 == 0 { Side::Yes } else { Side::No };
            reference_buy(&mc, side, amount_micro);
            let f = mc.fill_buy(side, amount_micro as u128, 300);
            assert!(f.paid_micro() <= amount_micro as u128, "case {case}");
            let all = mc.fill_buy(side, u128::MAX, (rng.next() % 301) as u128);
            assert!(all.shares_micro > 0 && all.paid_micro() < u128::MAX, "case {case}");
        }
        eprintln!("MEASURED {quotes} extreme quotes, {capped} bought to the cap, no overflow");
        assert!(capped > 5_000, "the test must reach the cap often: {capped}");
    }
}
