// The money guard for every e2e test: the mainnet lane budget is real (each free bet costs $1 of it),
// so nothing here may reach it. POST /lane/key is answered by the test with a key for a fake RPC, every
// call to that RPC is answered with a scripted outcome, and every known NEAR RPC refuses send_tx and
// broadcast_tx_async. Read-only views (a signature check reads a model's key) may pass.
import { expect, type Page } from "@playwright/test";

export const FAKE_RPC = "https://rpc.e2e-intercept.invalid";
const b64 = (s: string) => Buffer.from(s).toString("base64");

export interface Guard { laneKeys: number; sends: number; realSendsBlocked: number; errors: string[] }

export async function guard(page: Page, trade?: { claimId: number; side: "yes" | "no"; beforePpm: number; afterPpm: number; sharesMicro: string }): Promise<Guard> {
  const g: Guard = { laneKeys: 0, sends: 0, realSendsBlocked: 0, errors: [] };
  page.on("console", (m) => { if (m.type() === "error") g.errors.push(m.text()); });
  page.on("pageerror", (e) => g.errors.push(String(e)));

  await page.route(/\/(api\/)?lane\/key$/, async (route) => {
    g.laneKeys++;
    const { publicKey } = route.request().postDataJSON();
    await route.fulfill({ json: {
      laneAccountId: "lane.isitpriced.near", contractId: "market.isitpriced.near", publicKey, nonce: "1",
      blockHash: "11111111111111111111111111111111", rpc: FAKE_RPC, rpcs: [FAKE_RPC], methods: ["buy", "sell", "open_and_buy", "redeem", "claim_lane"],
      allowanceYocto: "250000000000000000000000", maxGasTgas: 20, reused: false,
    } });
  });
  await page.route(/\/api\/after-trade$/, (route) => route.fulfill({ json: { status: "e2e: not recorded" } }));

  // the scripted chain
  await page.route(`${FAKE_RPC}/**`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "send_tx" || body.method === "broadcast_tx_async") g.sends++;
    if (!trade) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN" }, data: "e2e: no trade scripted" } } });
    const t = { claim_id: trade.claimId, trader: "lane:e2e", side: trade.side, shares_micro: trade.sharesMicro, amount_micro: "1000000", price_yes_ppm_before: trade.beforePpm, price_yes_ppm_after: trade.afterPpm, balance_micro: "0" };
    const ev = { standard: "pricedin", version: "3.0.0", event: "trade", data: { claim_id: trade.claimId, trader: "lane:e2e", side: trade.side, shares_micro: trade.sharesMicro, amount_micro: "1000000", price_yes_ppm: trade.afterPpm, balance_micro: "0" } };
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: {
      status: { SuccessValue: b64(JSON.stringify(t)) },
      transaction: { hash: "E2eFakeTx1111111111111111111111111111111111", signer_id: "lane.isitpriced.near" },
      transaction_outcome: { id: "E2eFakeTx1111111111111111111111111111111111" },
      receipts_outcome: [{ id: "r1", outcome: { executor_id: "market.isitpriced.near", logs: [`EVENT_JSON:${JSON.stringify(ev)}`], status: { SuccessValue: b64(JSON.stringify(t)) } } }],
      final_execution_status: "FINAL",
    } } });
  });

  // the real chain: nothing may be sent
  await page.route(/(fastnear\.com|near\.org|drpc\.org|intea\.rs|nearblocks\.io\/api)/, async (route) => {
    const req = route.request();
    const m = req.method() === "POST" ? (req.postDataJSON()?.method as string | undefined) : undefined;
    if (m === "send_tx" || m === "broadcast_tx_async" || m === "broadcast_tx_commit") { g.realSendsBlocked++; return route.fulfill({ status: 403, body: "e2e: blocked" }); }
    return route.continue();
  });
  return g;
}

export function noMoneySpent(g: Guard) {
  expect(g.realSendsBlocked, "a transaction tried to reach a real NEAR RPC").toBe(0);
}
