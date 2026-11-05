//! Prints LMSR test vectors as JSON, computed by crates/lmsr itself.
//! Every amount is an i128 at SCALE (1e12), written as a decimal string.
//! `cost_to_move` is the market contract's view (contracts/market/src/lib.rs), copied verbatim
//! because it lives in the contract, not the crate.

use lmsr::{Market, Side, SCALE};

const MICRO: i128 = 1_000_000;

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
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn s(x: i128) -> String {
    format!("\"{}\"", x)
}

fn side_str(side: Side) -> &'static str {
    match side {
        Side::Yes => "yes",
        Side::No => "no",
    }
}

fn market_json(m: &Market) -> String {
    format!("{{\"b\":{},\"d0\":{},\"q_yes\":{},\"q_no\":{}}}", s(m.b), s(m.d0), s(m.q_yes), s(m.q_no))
}

/// contracts/market/src/lib.rs `cost_to_move`, in micro-USDC.
fn cost_to_move(m: &Market, up: bool) -> u128 {
    let p = m.price_yes();
    let target = if up { p + lmsr::SCALE / 10 } else { p - lmsr::SCALE / 10 };
    let edge = lmsr::SCALE / 1000;
    if target <= edge || target >= lmsr::SCALE - edge {
        return 0;
    }
    let d_target = lmsr::ln(lmsr::div(target, lmsr::SCALE - target));
    let d_now = m.d0 + lmsr::div(m.q_yes - m.q_no, m.b);
    let delta = lmsr::mul(d_target - d_now, m.b);
    let mut after = *m;
    if delta > 0 {
        after.apply_buy(Side::Yes, delta);
    } else {
        after.apply_buy(Side::No, -delta);
    }
    ((after.cost() - m.cost()).max(0) / MICRO) as u128
}

/// The contract's whole-micro buy: shares floored to micro, charged the exact cost rounded up.
fn contract_buy(m: &Market, side: Side, amount_micro: i128) -> (i128, i128) {
    let (shares, _charged) = m.quote_buy(side, amount_micro * MICRO);
    let shares_micro = shares / MICRO;
    if shares_micro <= 0 {
        return (0, 0);
    }
    let mut after = *m;
    after.apply_buy(side, shares_micro * MICRO);
    let exact = after.cost() - m.cost();
    let charged_micro = (exact.max(0) + MICRO - 1) / MICRO;
    (shares_micro, charged_micro)
}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let mut out: Vec<String> = Vec::new();

    // ---- the primitives ----
    let mut xs: Vec<i128> = vec![0, 1, -1, SCALE, -SCALE, SCALE / 2, -SCALE / 2, SCALE / 2 - 1, -(SCALE / 2) + 1, 40 * SCALE, 40 * SCALE + 1, -40 * SCALE, -40 * SCALE - 1, 41 * SCALE, -41 * SCALE, lmsr::LN2, -lmsr::LN2, lmsr::D_CAP, -lmsr::D_CAP];
    let mut rng = Rng(0x5eed_1234_abcd_ef01);
    for _ in 0..120 {
        let v = (rng.next() % (80 * SCALE as u64 / 1000)) as i128 * 1000 - 40 * SCALE;
        xs.push(v);
    }
    for _ in 0..40 {
        xs.push((rng.next() % 2_000_000_000_000) as i128 - 1_000_000_000_000);
    }
    let exp_rows: Vec<String> = xs.iter().map(|&x| format!("[{},{},{},{},{}]", s(x), s(lmsr::exp(x)), s(lmsr::expm1(x)), s(lmsr::softplus(x)), s(lmsr::sigmoid(x)))).collect();
    out.push(format!("\"exp_expm1_softplus_sigmoid\":[{}]", exp_rows.join(",")));

    let mut ys: Vec<i128> = vec![1, 2, 7, 1_000, 999_999, SCALE - 1, SCALE, SCALE + 1, 2 * SCALE, 2 * SCALE - 1, 3 * SCALE, 1_000_000 * SCALE, 25 * SCALE / 100, 9999 * SCALE];
    for _ in 0..120 {
        ys.push((rng.next() % (1_000_000 * SCALE as u64 / 1000)) as i128 * 1000 + 1);
    }
    for _ in 0..40 {
        ys.push((rng.next() % (SCALE as u64)) as i128 + 1);
    }
    let ln_rows: Vec<String> = ys.iter().map(|&y| format!("[{},{}]", s(y), s(lmsr::ln(y)))).collect();
    out.push(format!("\"ln\":[{}]", ln_rows.join(",")));

    let pairs: Vec<(i128, i128)> = vec![(7, 3), (-7, 3), (7, -3), (-7, -3), (SCALE, SCALE), (3 * SCALE, -SCALE / 3), (-123_456_789_012, 987_654_321)];
    let md_rows: Vec<String> = pairs.iter().map(|&(a, b)| format!("[{},{},{},{}]", s(a), s(b), s(lmsr::mul(a, b)), s(lmsr::div(a, b)))).collect();
    out.push(format!("\"mul_div\":[{}]", md_rows.join(",")));

    // ---- markets: open, then random trade sequences ----
    let mut markets: Vec<String> = Vec::new();
    let opens: Vec<(i128, i128)> = vec![
        (3 * SCALE, SCALE / 2),
        (SCALE, SCALE / 2),
        (SCALE, 2 * SCALE / 10),
        (SCALE, 8 * SCALE / 10),
        (SCALE, SCALE / 10),          // clamped to 0.2
        (SCALE, 95 * SCALE / 100),    // clamped to 0.8
        (SCALE / 10, 637 * SCALE / 1000),
        (100 * SCALE, 333 * SCALE / 1000),
        (2_500_000 * MICRO, 712 * SCALE / 1000),
    ];
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    for (case, &(b, p0)) in opens.iter().enumerate() {
        let mut m = Market::open(b, p0);
        let mut steps: Vec<String> = Vec::new();
        let mut held_yes: i128 = 0;
        let mut held_no: i128 = 0;
        let n = if case == 0 { 40 } else { 24 };
        for _ in 0..n {
            let before = m;
            let side = if rng.below(2) == 0 { Side::Yes } else { Side::No };
            let held = if side == Side::Yes { held_yes } else { held_no };
            let state = format!("\"before\":{},\"price_yes\":{},\"cost\":{},\"cost_up_10_micro\":\"{}\",\"cost_down_10_micro\":\"{}\"", market_json(&before), s(before.price_yes()), s(before.cost()), cost_to_move(&before, true), cost_to_move(&before, false));
            if rng.below(4) == 0 && held > 10 * MICRO {
                // sell a whole-micro share count, as the contract does
                let sh_micro = ((held / MICRO) as u64 * (1 + rng.below(1000)) / 1000).max(1) as i128;
                let shares = sh_micro * MICRO;
                let proceeds = m.quote_sell(side, shares);
                m.apply_sell(side, shares);
                if side == Side::Yes { held_yes -= shares } else { held_no -= shares }
                steps.push(format!("{{{},\"op\":\"sell\",\"side\":\"{}\",\"shares\":{},\"proceeds\":{},\"proceeds_micro\":\"{}\",\"price_yes_after\":{}}}", state, side_str(side), s(shares), s(proceeds), proceeds.max(0) / MICRO, s(m.price_yes())));
            } else {
                // spends from one cent to $20, sometimes a big one that runs into the price cap,
                // and now and then a huge one ($1,000 to $10^9): far above 33 b, where the old
                // order of quote_buy overflowed i128
                let amount_micro: i128 = match rng.below(20) {
                    0 => 10i128.pow(9 + rng.below(7) as u32) + rng.below(1_000_000) as i128,
                    1 | 2 => (50 + rng.below(500)) as i128 * MICRO,
                    _ => 10_000 + rng.below(20_000_000) as i128,
                };
                let spend = amount_micro * MICRO;
                let mm = m;
                let r = std::panic::catch_unwind(move || (mm.quote_buy(side, spend), contract_buy(&mm, side, amount_micro)));
                let ((shares, charged), (sh_micro, charged_micro)) = match r {
                    Ok(v) => v,
                    Err(_) => {
                        // i128 overflow inside the fixed-point maths: the contract would panic too.
                        // Since quote_buy checks the cap first no vector lands here; the web test
                        // requires that there are none
                        steps.push(format!("{{{},\"op\":\"buy\",\"side\":\"{}\",\"spend\":{},\"amount_micro\":\"{}\",\"overflow\":true,\"price_yes_after\":{}}}", state, side_str(side), s(spend), amount_micro, s(m.price_yes())));
                        continue;
                    }
                };
                if sh_micro > 0 {
                    m.apply_buy(side, sh_micro * MICRO);
                    if side == Side::Yes { held_yes += sh_micro * MICRO } else { held_no += sh_micro * MICRO }
                }
                steps.push(format!("{{{},\"op\":\"buy\",\"side\":\"{}\",\"spend\":{},\"shares\":{},\"charged\":{},\"amount_micro\":\"{}\",\"shares_micro\":\"{}\",\"charged_micro\":\"{}\",\"price_yes_after\":{}}}", state, side_str(side), s(spend), s(shares), s(charged), amount_micro, sh_micro, charged_micro, s(m.price_yes())));
            }
        }
        markets.push(format!(
            "{{\"b\":{},\"p0\":{},\"open\":{},\"cost_open\":{},\"max_loss_yes\":{},\"max_loss_no\":{},\"price_no\":{},\"steps\":[{}],\"final\":{}}}",
            s(b), s(p0), market_json(&Market::open(b, p0)), s(Market::open(b, p0).cost_open()),
            s(Market::open(b, p0).max_loss(Side::Yes)), s(Market::open(b, p0).max_loss(Side::No)), s(Market::open(b, p0).price_no()),
            steps.join(","), market_json(&m)
        ));
    }
    out.push(format!("\"markets\":[{}]", markets.join(",")));

    // ---- the architect's number: b = $3, p0 = 0.5, $1 on YES ----
    let m = Market::open(3 * SCALE, SCALE / 2);
    let (sh, ch) = m.quote_buy(Side::Yes, SCALE);
    out.push(format!("\"architect\":{{\"shares\":{},\"charged\":{}}}", s(sh), s(ch)));

    println!("{{\"generator\":\"web/tools/lmsr-vectors (crates/lmsr)\",\"scale\":{},{}}}", s(SCALE), out.join(","));
}
