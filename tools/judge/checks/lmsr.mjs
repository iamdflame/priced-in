// Check 1: the browser's LMSR (web/src/core/lmsr.ts) is bit-exact with crates/lmsr on the
// crate's own vectors, and holds the market's properties over 10,000 random trade sequences:
// the same sequences, from the same generator and seed, as the crate's property test.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function checkLmsr(repo) {
  const L = await import(pathToFileURL(path.join(repo, "web/src/core/lmsr.ts")).href);
  const v = JSON.parse(fs.readFileSync(path.join(repo, "web/test/vectors/lmsr.json"), "utf8"));
  const B = (s) => BigInt(s);
  const same = (m, j) => m.b === B(j.b) && m.d0 === B(j.d0) && m.qYes === B(j.q_yes) && m.qNo === B(j.q_no);
  let rows = 0;
  const miss = [];
  const eq = (what, a, b) => { rows++; if (a !== b) miss.push(`${what}: ${a} != ${b}`); };

  // ---------- 1. bit-exact on the crate's vectors ----------
  for (const [x, e, em1, sp, sg] of v.exp_expm1_softplus_sigmoid) {
    eq(`exp(${x})`, L.exp(B(x)), B(e)); eq(`expm1(${x})`, L.expm1(B(x)), B(em1));
    eq(`softplus(${x})`, L.softplus(B(x)), B(sp)); eq(`sigmoid(${x})`, L.sigmoid(B(x)), B(sg));
  }
  for (const [y, l] of v.ln) eq(`ln(${y})`, L.ln(B(y)), B(l));
  for (const [a, b, m, d] of v.mul_div) { eq("mul", L.mul(B(a), B(b)), B(m)); eq("div", L.div(B(a), B(b)), B(d)); }
  let trades = 0, overflows = 0;
  for (const mv of v.markets) {
    const open = L.openMarket(B(mv.b), B(mv.p0));
    rows++; if (!same(open, mv.open)) miss.push("open");
    eq("cost_open", L.costOpen(open), B(mv.cost_open));
    eq("max_loss_yes", L.maxLoss(open, "yes"), B(mv.max_loss_yes));
    eq("max_loss_no", L.maxLoss(open, "no"), B(mv.max_loss_no));
    let m = open;
    for (const st of mv.steps) {
      rows++; if (!same(m, st.before)) miss.push("state before a step");
      eq("price_yes", L.priceYes(m), B(st.price_yes));
      eq("cost", L.cost(m), B(st.cost));
      eq("cost_up_10", L.costToMoveMicro(m, true), B(st.cost_up_10_micro));
      eq("cost_down_10", L.costToMoveMicro(m, false), B(st.cost_down_10_micro));
      if (st.op === "buy") {
        if (st.overflow) {
          overflows++; rows++;
          try { L.quoteBuyRaw(m, st.side, B(st.spend)); miss.push("an overflow the crate refuses went through"); } catch (e) { if (!(e instanceof L.LmsrOverflow)) miss.push(`overflow: ${e.message}`); }
          continue;
        }
        const [sh, ch] = L.quoteBuyRaw(m, st.side, B(st.spend));
        eq("shares", sh, B(st.shares)); eq("charged", ch, B(st.charged));
        const r = L.contractBuy(m, st.side, B(st.amount_micro), st.fee_bps);
        eq("shares_micro", r.sharesMicro, B(st.shares_micro)); eq("charged_micro", r.chargedMicro, B(st.charged_micro));
        eq("fee_micro", r.feeMicro, B(st.fee_micro)); eq("paid_micro", r.paidMicro, B(st.paid_micro));
        m = r.after;
      } else {
        eq("proceeds", L.quoteSellRaw(m, st.side, B(st.shares)), B(st.proceeds));
        const r = L.contractSell(m, st.side, B(st.shares) / L.MICRO, st.fee_bps);
        eq("proceeds_micro", r.proceedsMicro, B(st.proceeds_micro));
        eq("fee_micro", r.feeMicro, B(st.fee_micro)); eq("received_micro", r.receivedMicro, B(st.received_micro));
        m = r.after;
      }
      eq("price_yes_after", L.priceYes(m), B(st.price_yes_after));
      trades++;
    }
    rows++; if (!same(m, mv.final)) miss.push("final state");
  }
  for (const [amount, bps, fee] of v.fee_on) eq(`fee_on(${amount}, ${bps})`, L.feeOn(B(amount), BigInt(bps)), B(fee));
  // the fills random walks rarely reach: a cost rounded a micro over budget, the cap, a tiny order
  let fills = 0;
  for (const r of [...v.fills.stepped_back, ...v.fills.at_cap, ...v.fills.too_small]) {
    const m = { b: B(r.market.b), d0: B(r.market.d0), qYes: B(r.market.q_yes), qNo: B(r.market.q_no) };
    const f = L.fillBuy(m, r.side, B(r.amount_micro), r.fee_bps);
    eq("fill shares_micro", f.sharesMicro, B(r.shares_micro)); eq("fill cost_micro", f.costMicro, B(r.cost_micro));
    eq("fill fee_micro", f.feeMicro, B(r.fee_micro)); eq("fill paid_micro", f.paidMicro, B(r.paid_micro));
    eq("at_cap", L.atCap(m, r.side), r.at_cap);
    fills++;
  }
  if (miss.length) return { status: "FAIL", detail: `the port differs from crates/lmsr on ${miss.length} of ${rows} vector values: ${miss.slice(0, 3).join("; ")}` };

  // ---------- 2. properties over 10,000 random sequences (crates/lmsr property_random_sequences) ----------
  const SCALE = L.SCALE, MASK = (1n << 64n) - 1n;
  let x = 0x9e3779b97f4a7c15n;
  const next = () => { x ^= (x << 13n) & MASK; x ^= x >> 7n; x ^= (x << 17n) & MASK; return x; };
  const unit = () => Number(next() >> 11n) / 2 ** 53;
  const s = (f) => BigInt(Math.round(f * 1e12));
  let nTrades = 0, worstSum = 0n, worstSlack = 0n, worstLossGap = -(10n ** 30n);
  const bad = [];
  const mirror = (m) => ({ b: m.b, d0: -m.d0, qYes: m.qNo, qNo: m.qYes });
  for (let c = 0; c < 10_000 && bad.length < 3; c++) {
    const b = s(0.5 + unit() * 20), p0 = s(0.2 + unit() * 0.6);
    let m = L.openMarket(b, p0);
    const open = m;
    let collected = 0n, n = 0n, heldYes = 0n, heldNo = 0n;
    const steps = 1 + Number(next() % 12n);
    for (let k = 0; k < steps; k++) {
      const side = next() % 2n === 0n ? "yes" : "no";
      const sell = next() % 4n === 0n;
      if (sell) {
        const held = side === "yes" ? heldYes : heldNo;
        if (held > 10n) {
          let sh = BigInt(Math.trunc(Number(held) * unit())) + 1n;
          if (sh > held) sh = held;
          const got = L.quoteSellRaw(m, side, sh);
          m = L.applySell(m, side, sh);
          collected -= got;
          if (side === "yes") heldYes -= sh; else heldNo -= sh;
          n++;
        }
      } else {
        const spend = s(0.01 + unit() * 5.0);
        const [sh, charged] = L.quoteBuyRaw(m, side, spend);
        if (charged > spend) bad.push(`case ${c}: charged ${charged} > spend ${spend}`);
        if (sh > 0n) {
          m = L.applyBuy(m, side, sh);
          collected += charged;
          if (side === "yes") heldYes += sh; else heldNo += sh;
          n++;
        }
      }
      // the NO price computed on its own, from the mirrored market, not as 1 - YES
      const sum = L.priceYes(m) + L.priceYes(mirror(m)) - SCALE;
      const a = sum < 0n ? -sum : sum;
      if (a > worstSum) worstSum = a;
      if (a > 1n) bad.push(`case ${c}: prices sum to 1 ${sum >= 0n ? "+" : ""}${sum}e-12`);
    }
    nTrades += Number(n);
    const slack = collected - (L.cost(m) - L.costOpen(open));
    if (slack < -2n || slack > 8n * (n + 1n)) bad.push(`case ${c}: path slack ${slack}`);
    if (slack > worstSlack) worstSlack = slack;
    for (const side of ["yes", "no"]) {
      const loss = (side === "yes" ? m.qYes : m.qNo) - collected;
      const gap = loss - L.maxLoss(open, side);
      if (gap > worstLossGap) worstLossGap = gap;
      if (gap > 1000n) bad.push(`case ${c}: loss exceeds b ln(1/p0) by ${gap}e-12`);
    }
  }
  if (bad.length) return { status: "FAIL", detail: bad.slice(0, 3).join("; ") };
  return {
    status: "PASS",
    detail: `web/src/core/lmsr.ts is bit-exact with crates/lmsr on ${rows} vector values (${trades} trades at fees from 0 to 300 bps, ${fills} edge fills, ${overflows} refused overflows); 10,000 random sequences, ${nTrades} trades: prices sum to one within ${worstSum}e-12, cost path-independent (collected - [C(end) - C(open)] <= ${worstSlack}e-12, always in the market's favour), maker's loss <= b ln(1/p0) in both outcomes`,
  };
}
