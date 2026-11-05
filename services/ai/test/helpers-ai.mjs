// Shared offline fixtures for the AI layer's tests: a fake web, and a fake signer that answers
// like the real one (intent ids, outcomes with the contract's Trade return value).

export function fakeWeb(pages) {
  return async (url) => {
    const u = String(url);
    const hit = Object.keys(pages).find((k) => u.startsWith(k));
    const v = hit ? pages[hit] : { status: 404, body: "not found" };
    const body = typeof v.body === "string" ? v.body : JSON.stringify(v.body);
    return { status: v.status ?? 200, url: u, text: async () => body, json: async () => JSON.parse(body) };
  };
}

export const WIKI = {
  "https://en.wikipedia.org/w/api.php": { body: { query: { search: [{ title: "Banana" }, { title: "Dead" }] } } },
  "https://en.wikipedia.org/api/rest_v1/page/summary/Banana": { body: { title: "Banana", extract: "A banana is botanically a berry.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Banana" } } } },
  "https://en.wikipedia.org/api/rest_v1/page/summary/Dead": { body: { title: "Dead", extract: "Gone.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Dead" } } } },
  "https://en.wikipedia.org/wiki/Banana": { body: "<html><p>A banana is a berry.</p></html>" },
  "https://en.wikipedia.org/wiki/Dead": { status: 404, body: "gone" },
  "https://www.wikidata.org/w/api.php": { body: { search: [{ id: "Q503", label: "banana", description: "edible fruit" }] } },
  "https://www.wikidata.org/wiki/Q503": { body: "<html>banana</html>" },
};

/** A signer stand-in. Each buy moves the price up 5 points, each sale down 5. */
export function fakeSigner(agents, { startPpm = 500000 } = {}) {
  let price = startPpm, n = 0;
  const s = {
    agents, trades: [], bills: [], redeems: [], fail: false, unheld: 1,
    operator: { market: { ok: true }, swarm: { ok: true } },
    listAgents: async () => ({ ok: true, agents: s.agents, unheld: s.unheld, operator: s.operator }),
    accountOf: (a) => s.agents.find((x) => x.accountId === a || x.label === a)?.accountId || null,
    setPrice: (p) => { price = p; },
    trade: async (intent, d) => {
      s.trades.push({ intent, ...d });
      if (s.fail) return { ok: false, final: true, error: "rpc down" };
      const before = price;
      price = d.action === "sell" ? price + (d.side === "yes" ? -50000 : 50000) : price + (d.side === "yes" ? 50000 : -50000);
      return { ok: true, final: true, txHash: `tx${++n}`, accountId: d.agent, value: { claim_id: d.claim_id, trader: d.agent, side: d.action === "sell" ? `sell_${d.side}` : d.side, shares_micro: d.shares_micro ?? "1500000", amount_micro: d.amount_micro ?? "700000", price_yes_ppm_before: before, price_yes_ppm_after: price, balance_micro: "1" } };
    },
    bill: async (intent, b) => { s.bills.push({ intent, ...b }); return s.billReply ? s.billReply(b) : { ok: true, final: true, txHash: `bill${s.bills.length}`, value: b.route === "escrow" ? String(BigInt(b.amount_micro) * 10n) : null }; },
    redeem: async (intent, agent, claim_id) => { s.redeems.push({ intent, agent, claim_id }); return { ok: true, final: true, txHash: "r1", value: "1000000" }; },
    outcome: async () => s.outcomeReply || { ok: false, final: true, unknownIntent: true, error: "never saw it" },
  };
  return s;
}

/** A signer's view of a swarm agent. */
export const swarmAgent = (id, { owner = "house.testnet", model, persona_hash = "0".repeat(64), sleeping = false, closed = false, escrow_yocto = "1000000", ok = true, error = null, label = "issued" } = {}) => ({
  accountId: `a${id}.swarm.testnet`, label, source: "swarm", ok, error, publicKey: `ed25519:k${id}`,
  swarm: { id, owner, model, persona_hash, escrow_yocto, charged_yocto: "0", sleeping, closed, deleted: false },
});

export const waitFor = async (pred, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await pred(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error("timed out"); };
