// The market's books, read at one block: the USDC it holds against every bucket in `stats`, and
// each bucket against the claims and balances it sums. Shared by check 4 (testnet) and check 11
// (mainnet). `view(contract, method, args)` and `state(prefix)` must read the same block: trades
// land every few seconds on mainnet, and reads from two blocks would not reconcile.

/** The balances in the contract's own storage: the "b" map, borsh String -> u128. */
export function sumBalances(values = []) {
  let total = 0n, holders = 0;
  for (const { key, value } of values) {
    const k = Buffer.from(key, "base64");
    if (k[0] !== 0x62 || k.length < 5 || k.readUInt32LE(1) !== k.length - 5) continue;
    const v = Buffer.from(value, "base64");
    if (v.length !== 16) continue;
    total += v.readBigUInt64LE(0) + (v.readBigUInt64LE(8) << 64n);
    holders++;
  }
  return { total, holders };
}

/**
 * Rows are [name, true | false | null]: null is a row that could not be read ("not listed"),
 * which neither passes nor fails. `traders`, when given, stands in for an RPC that refuses to
 * list storage (testnet's seed traders); without it that row is null.
 */
export async function booksAt(view, market, usdc, { state = null, traders = null } = {}) {
  const s = await view(market, "stats");
  const held = BigInt(await view(usdc, "ft_balance_of", { account_id: market }));
  const b = (k) => BigInt(s[k] ?? 0);
  const buckets = b("treasury_micro") + b("reserved_micro") + b("balances_micro") + b("collected_micro") + b("payouts_micro") + b("bonds_micro") + b("bounties_micro");
  let collected = 0n, payouts = 0n, bounties = 0n, n = 0;
  for (let from = 0; ; from += 100) {
    const page = await view(market, "get_claims", { from, limit: 100 });
    for (const c of page) {
      n++;
      if (c.status !== "Settled") collected += BigInt(c.collected_micro);
      payouts += BigInt(c.payout_left_micro);
      bounties += BigInt(c.bounty_micro);
    }
    if (page.length < 100) break;
  }
  let balancesRow, how;
  try {
    if (!state) throw new Error("no state reader");
    const { total, holders } = sumBalances((await state("b")).values);
    balancesRow = total === b("balances_micro");
    how = `${holders} balances read from the contract's storage`;
  } catch (e) {
    const why = String(e.message).slice(0, 60);
    if (traders?.length) {
      let total = 0n;
      for (const t of traders) total += BigInt(await view(market, "get_balance", { trader: t }));
      balancesRow = total === b("balances_micro");
      how = `the RPC would not list storage (${why}), so the ${traders.length} seed traders' balances`;
    } else {
      balancesRow = null;
      how = `balances not listed: the RPC would not list storage (${why})`;
    }
  }
  const rows = [
    ["USDC the market holds = held_micro", held === b("held_micro")],
    ["held = treasury + reserved + balances + collected + payouts + bonds + bounties", held === buckets],
    [balancesRow === null ? "sum of balances = balances_micro: not listed" : "sum of balances = balances_micro", balancesRow],
    ["sum of open claims' collected = collected_micro", collected === b("collected_micro")],
    ["sum of payouts left = payouts_micro", payouts === b("payouts_micro")],
    ["sum of bounties = bounties_micro", bounties === b("bounties_micro")],
  ];
  const failed = rows.filter((r) => r[1] === false).map((r) => r[0]);
  const usd = (k) => (Number(b(k)) / 1e6).toFixed(6);
  const equation = `USDC held ${held} = treasury ${s.treasury_micro} + reserved ${s.reserved_micro} + balances ${s.balances_micro} + collected ${s.collected_micro} + payouts ${s.payouts_micro} + bonds ${s.bonds_micro} + bounties ${s.bounties_micro} (micro-USDC)`;
  // in dollars, naming only the buckets that hold something
  const dollars = `${(Number(held) / 1e6).toFixed(6)} held = ${["treasury", "reserved", "balances", "collected", "payouts", "bonds", "bounties"].filter((k) => b(`${k}_micro`) !== 0n).map((k) => `${k} ${usd(`${k}_micro`)}`).join(" + ") || "0"}`;
  return { ok: failed.length === 0 && !s.paused && n > 0, failed, rows, stats: s, held, claims: n, paused: !!s.paused, how, equation, dollars };
}
