//! Prints LMSR test vectors as JSON, computed by crates/lmsr itself.
//! Every amount is an i128 at SCALE (1e12), written as a decimal string.
//! `cost_to_move` is the market contract's view (contracts/market/src/lib.rs), copied verbatim
//! because it lives in the contract, not the crate. The fills are the crate's own `fill_buy` and
//! `fill_sell`, the code the contract runs for every trade, at a fee that varies step by step.

use lmsr::{Market, Side, MICRO, SCALE};

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

/// The fee a step trades at: none, the default, the cap, or anything between.
fn fee_for(rng: &mut Rng) -> u128 {
    match rng.below(4) {
        0 => 0,
        1 => 100,
        2 => 300,
        _ => rng.below(301) as u128,
    }
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
                let fee_bps = fee_for(&mut rng);
                let proceeds = m.quote_sell(side, shares);
                let fill = m.fill_sell(side, sh_micro as u128, fee_bps);
                m.apply_sell(side, shares);
                if side == Side::Yes { held_yes -= shares } else { held_no -= shares }
                steps.push(format!("{{{},\"op\":\"sell\",\"side\":\"{}\",\"shares\":{},\"proceeds\":{},\"fee_bps\":{},\"proceeds_micro\":\"{}\",\"fee_micro\":\"{}\",\"received_micro\":\"{}\",\"price_yes_after\":{}}}", state, side_str(side), s(shares), s(proceeds), fee_bps, fill.proceeds_micro, fill.fee_micro, fill.received_micro(), s(m.price_yes())));
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
                let fee_bps = fee_for(&mut rng);
                let mm = m;
                let r = std::panic::catch_unwind(move || (mm.quote_buy(side, spend), mm.fill_buy(side, amount_micro as u128, fee_bps)));
                let ((shares, charged), fill) = match r {
                    Ok(v) => v,
                    Err(_) => {
                        // i128 overflow inside the fixed-point maths: the contract would panic too.
                        // Since quote_buy checks the cap first no vector lands here; the web test
                        // requires that there are none
                        steps.push(format!("{{{},\"op\":\"buy\",\"side\":\"{}\",\"spend\":{},\"amount_micro\":\"{}\",\"fee_bps\":{},\"overflow\":true,\"price_yes_after\":{}}}", state, side_str(side), s(spend), amount_micro, fee_bps, s(m.price_yes())));
                        continue;
                    }
                };
                let sh_micro = fill.shares_micro as i128;
                if sh_micro > 0 {
                    m.apply_buy(side, sh_micro * MICRO);
                    if side == Side::Yes { held_yes += sh_micro * MICRO } else { held_no += sh_micro * MICRO }
                }
                // shares and charged are quote_buy on the whole amount; the rest is the contract's fill
                steps.push(format!("{{{},\"op\":\"buy\",\"side\":\"{}\",\"spend\":{},\"shares\":{},\"charged\":{},\"amount_micro\":\"{}\",\"fee_bps\":{},\"shares_micro\":\"{}\",\"charged_micro\":\"{}\",\"fee_micro\":\"{}\",\"paid_micro\":\"{}\",\"price_yes_after\":{}}}", state, side_str(side), s(spend), s(shares), s(charged), amount_micro, fee_bps, sh_micro, fill.cost_micro, fill.fee_micro, fill.paid_micro(), s(m.price_yes())));
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

    // ---- fee_on ----
    let mut rng = Rng(0xfee0_0f_0a11);
    let mut fee_rows: Vec<String> = [(0u128, 300u128), (1, 1), (1, 100), (99, 100), (100, 100), (101, 100), (10_000, 100), (10_001, 100), (1_000_000, 300), (7, 10_000)].iter().map(|&(a, b)| format!("[\"{}\",{},\"{}\"]", a, b, lmsr::fee_on(a, b))).collect();
    for _ in 0..60 {
        let (a, b) = (rng.below(10_000_000_000) as u128, rng.below(301) as u128);
        fee_rows.push(format!("[\"{}\",{},\"{}\"]", a, b, lmsr::fee_on(a, b)));
    }
    out.push(format!("\"fee_on\":[{}]", fee_rows.join(",")));

    // ---- fills the random walks above rarely reach ----
    // Near a price cap fill_buy steps back when rounding puts the cost a micro over budget, and at
    // the cap it fills nothing: both are searched for here, on the contract's liquidity range.
    let (mut stepped, mut at_cap, mut tiny): (Vec<String>, Vec<String>, Vec<String>) = (vec![], vec![], vec![]);
    let mut rng = Rng(0x57e9_bacc_fee1);
    for _ in 0..2_000_000 {
        if stepped.len() >= 24 && at_cap.len() >= 12 && tiny.len() >= 12 {
            break;
        }
        let b = (100_000 + rng.below(99_900_001)) as i128 * MICRO;
        let p0 = (rng.below(600_001) as i128 + 200_000) * MICRO;
        let mut m = Market::open(b, p0);
        let pushes = rng.below(4);
        for _ in 0..pushes {
            let side = if rng.below(2) == 0 { Side::Yes } else { Side::No };
            let f = m.fill_buy(side, 1 + rng.below((40 * b / MICRO) as u64) as u128, 0);
            m.apply_buy(side, f.shares_micro as i128 * MICRO);
        }
        let side = if rng.below(2) == 0 { Side::Yes } else { Side::No };
        let amount = 1 + (10f64.powf((rng.below(1_000_000) as f64 / 1_000_000.0) * 12.0)) as u128;
        let fee_bps = fee_for(&mut rng);
        let f = m.fill_buy(side, amount, fee_bps);
        let budget = amount * lmsr::BPS / (lmsr::BPS + fee_bps);
        let raw = if budget > 0 { (m.quote_buy(side, budget as i128 * MICRO).0 / MICRO) as u128 } else { 0 };
        let row = format!(
            "{{\"market\":{},\"side\":\"{}\",\"amount_micro\":\"{}\",\"fee_bps\":{},\"raw_shares_micro\":\"{}\",\"shares_micro\":\"{}\",\"cost_micro\":\"{}\",\"fee_micro\":\"{}\",\"paid_micro\":\"{}\",\"at_cap\":{}}}",
            market_json(&m), side_str(side), amount, fee_bps, raw, f.shares_micro, f.cost_micro, f.fee_micro, f.paid_micro(), m.at_cap(side)
        );
        if raw > f.shares_micro && f.shares_micro > 0 && stepped.len() < 24 {
            stepped.push(row);
        } else if m.at_cap(side) && at_cap.len() < 12 {
            at_cap.push(row);
        } else if f.shares_micro == 0 && !m.at_cap(side) && tiny.len() < 12 {
            tiny.push(row);
        }
    }
    out.push(format!("\"fills\":{{\"stepped_back\":[{}],\"at_cap\":[{}],\"too_small\":[{}]}}", stepped.join(","), at_cap.join(","), tiny.join(",")));

    // ---- the architect's number: b = $3, p0 = 0.5, $1 on YES ----
    let m = Market::open(3 * SCALE, SCALE / 2);
    let (sh, ch) = m.quote_buy(Side::Yes, SCALE);
    out.push(format!("\"architect\":{{\"shares\":{},\"charged\":{}}}", s(sh), s(ch)));

    println!("{{\"generator\":\"web/tools/lmsr-vectors (crates/lmsr)\",\"scale\":{},{}}}", s(SCALE), out.join(","));
}
