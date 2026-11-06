// A pretend chain for the money e2e: a mock wallet whose transactions run the contract's own rules
// (lib/money/quotes.ts, the contract's fills) on in-memory balances, and NEAR RPC views answered from
// the same state. No real wallet loads, and every real NEAR RPC refuses a send, so no money can move.
import type { Page, Route } from "@playwright/test";
import { quoteWalletBuy, quoteWalletSell, isFail } from "@/lib/money/quotes";
import type { TxSpec } from "@/lib/money/tx";
import { moneyConfig } from "@/lib/money/config";

export const ACCOUNT = "judge-e2e.near";
const C = moneyConfig("mainnet");
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
let n = 0;

export interface ClaimState { id: number; text: string; status: "Open" | "Settled"; outcome: boolean | null; b_micro: string; d0: string; q_yes_micro: string; q_no_micro: string; fee_bps: number }

export class FakeChain {
  balance = 0n;
  usdc = 20_000_000n;
  registered = true;
  positions = new Map<number, { yes: bigint; no: bigint }>();
  sent: TxSpec[] = [];
  realSendsBlocked = 0;
  /** the next outcome nobody can confirm (a wallet that returned nothing usable) */
  nextUnknown = false;
  constructor(public claims: Map<number, ClaimState>) {}

  pos(id: number) { if (!this.positions.has(id)) this.positions.set(id, { yes: 0n, no: 0n }); return this.positions.get(id)!; }

  private ok(value: unknown, logs: string[] = []) {
    const hash = `E2eTx${String(++n).padStart(39, "1")}`;
    return { status: { SuccessValue: value === undefined ? "" : b64(value) }, transaction: { hash }, transaction_outcome: { id: hash }, receipts_outcome: [{ id: "r", outcome: { executor_id: C.market, logs, status: { SuccessValue: "" } } }], final_execution_status: "FINAL" };
  }
  private panic(msg: string) {
    const hash = `E2eTx${String(++n).padStart(39, "1")}`;
    return { status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${msg}` } } } } }, transaction: { hash }, transaction_outcome: { id: hash }, receipts_outcome: [] };
  }

  /** One transaction, the way the contract would run it. */
  run(tx: TxSpec) {
    this.sent.push(tx);
    if (this.nextUnknown) { this.nextUnknown = false; return { status: "Started", transaction: { hash: "E2eUnknown1111111111111111111111111111111111" } }; }
    let last: unknown;
    for (const a of tx.actions) {
      const g = a.args as Record<string, any>;
      if (a.method === "ft_transfer_call") {
        const amt = BigInt(g.amount);
        if (amt > this.usdc) return this.panic("The account doesn't have enough balance");
        this.usdc -= amt; this.balance += amt; last = "0";
      } else if (a.method === "buy") {
        const c = this.claims.get(g.claim_id)!;
        const amt = BigInt(g.amount_micro);
        if (amt > this.balance) return this.panic("not enough balance");
        const q = quoteWalletBuy(c, g.side, amt);
        if (isFail(q)) return this.panic("amount too small");
        if (q.sharesMicro < BigInt(g.min_shares_micro)) return this.panic("slippage: fewer shares than min_shares");
        this.balance -= q.paidMicro;
        this.pos(c.id)[g.side as "yes" | "no"] += q.sharesMicro;
        const key = g.side === "yes" ? "q_yes_micro" : "q_no_micro";
        c[key] = String(BigInt(c[key]) + q.sharesMicro);
        last = { claim_id: c.id, trader: ACCOUNT, side: g.side, shares_micro: String(q.sharesMicro), amount_micro: String(q.paidMicro), fee_micro: String(q.feeMicro), price_yes_ppm_before: Math.round(q.priceBefore * 1e6), price_yes_ppm_after: Math.round(q.priceAfter * 1e6), balance_micro: String(this.balance) };
      } else if (a.method === "sell") {
        const c = this.claims.get(g.claim_id)!;
        const sh = BigInt(g.shares_micro);
        const p = this.pos(c.id);
        if (sh > p[g.side as "yes" | "no"]) return this.panic("not enough shares");
        const q = quoteWalletSell(c, g.side, sh);
        if (isFail(q)) return this.panic("not enough shares");
        if (q.receivedMicro < BigInt(g.min_proceeds_micro)) return this.panic("slippage: proceeds below minimum");
        p[g.side as "yes" | "no"] -= sh;
        const key = g.side === "yes" ? "q_yes_micro" : "q_no_micro";
        c[key] = String(BigInt(c[key]) - sh);
        this.balance += q.receivedMicro;
        last = { claim_id: c.id, trader: ACCOUNT, side: `sell_${g.side}`, shares_micro: String(sh), amount_micro: String(q.receivedMicro), fee_micro: String(q.feeMicro), price_yes_ppm_before: 0, price_yes_ppm_after: Math.round(q.priceAfter * 1e6), balance_micro: String(this.balance) };
      } else if (a.method === "redeem") {
        const c = this.claims.get(g.claim_id)!;
        if (c.status !== "Settled") return this.panic("not settled");
        const p = this.pos(c.id);
        const win = c.outcome ? p.yes : p.no;
        if (win === 0n) return this.panic("nothing to redeem");
        p.yes = 0n; p.no = 0n; this.balance += win; last = String(win);
      } else if (a.method === "withdraw") {
        const amt = BigInt(g.amount_micro);
        if (amt > this.balance) return this.panic("not enough balance");
        this.balance -= amt; this.usdc += amt; last = undefined;
      } else if (a.method === "storage_deposit") { this.registered = true; last = undefined; }
      else if (a.method === "ft_transfer") { this.usdc -= BigInt(g.amount); last = undefined; }
      else return this.panic(`e2e: no such method ${a.method}`);
    }
    return this.ok(last);
  }

  private view(contract: string, method: string, args: any): unknown {
    if (contract === C.usdc && method === "ft_balance_of") return String(args.account_id === ACCOUNT ? this.usdc : 0n);
    if (contract === C.usdc && method === "storage_balance_of") return this.registered || args.account_id !== ACCOUNT ? { total: "1250000000000000000000", available: "0" } : null;
    if (contract === C.market && method === "get_balance") return String(args.trader === ACCOUNT ? this.balance : 0n);
    if (contract === C.market && method === "get_position") { const p = args.trader === ACCOUNT ? this.pos(args.claim_id) : { yes: 0n, no: 0n }; return { yes_micro: String(p.yes), no_micro: String(p.no) }; }
    if (contract === C.market && method === "get_claim") {
      const c = this.claims.get(args.claim_id);
      if (!c) return null;
      return { ...c, price_yes_ppm: Math.round((quoteWalletBuy(c, "yes", 1n) as any).priceBefore * 1e6) || 500000 };
    }
    return undefined;
  }

  async install(page: Page) {
    await page.exposeFunction("__piSend", (tx: TxSpec) => this.run(tx));
    await page.addInitScript((account) => {
      (window as any).__PI_MOCK_WALLET__ = { accountId: account, send: (tx: unknown) => (window as any).__piSend(tx) };
    }, ACCOUNT);
    const rpc = async (route: Route) => {
      const body = route.request().postDataJSON() ?? {};
      if (["send_tx", "broadcast_tx_async", "broadcast_tx_commit"].includes(body.method)) { this.realSendsBlocked++; return route.fulfill({ status: 403, body: "e2e: blocked" }); }
      const p = body.params ?? {};
      if (body.method === "query" && p.request_type === "call_function") {
        const args = JSON.parse(Buffer.from(p.args_base64 || "", "base64").toString() || "{}");
        const v = this.view(p.account_id, p.method_name, args);
        if (v !== undefined) return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result: { result: [...Buffer.from(JSON.stringify(v))], logs: [], block_height: 1, block_hash: "x" } } });
      }
      return route.continue();
    };
    await page.route(/(fastnear\.com|rpc\.mainnet\.near\.org)/, rpc);
  }
}
