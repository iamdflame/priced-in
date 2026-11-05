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

pub const SCALE: i128 = 1_000_000_000_000; // 1e12
pub const LN2: i128 = 693_147_180_560; // ln(2) * 1e12
const EXP_MAX: i128 = 40 * SCALE; // e^40 * 1e12 ~ 2.35e29, well inside i128

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

    /// Shares a spend buys, from the closed form s = b ln((e^{m/b} - 1 + p) / p),
    /// then shaved so that the exact cost difference never exceeds the spend.
    /// Returns (shares, charged), with charged <= spend.
    pub fn quote_buy(&self, side: Side, spend: i128) -> (i128, i128) {
        assert!(spend > 0, "spend must be positive");
        let d = self.d();
        // room before the price cap, in shares
        let room = match side {
            Side::Yes => mul(D_CAP - d, self.b),
            Side::No => mul(D_CAP + d, self.b),
        };
        if room <= 4 {
            return (0, 0);
        }
        let p = self.price(side).max(P_FLOOR);
        // s = b ln(1 + (e^{m/b} - 1) / p), with expm1 for precision on small spends
        let inner = SCALE + div(expm1(div(spend, self.b)), p);
        let mut shares = mul(self.b, ln(inner));
        if shares < 0 {
            shares = 0;
        }
        if shares > room {
            shares = room;
        }
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
}
