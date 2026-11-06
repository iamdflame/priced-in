"use client";
// The person's own NEAR wallet: NEAR Wallet Selector with HOT, Meteor, MyNearWallet and Intear, loaded
// only when someone opens the wallet list or was connected before. Read-only until connected. The wallet
// signs every transaction itself; this layer hands it the transactions (lib/money/tx.ts) after the
// screen has shown the sentence that says what each one does.
//
// Tests: Playwright injects window.__PI_MOCK_WALLET__ before the page loads. Then no wallet module loads
// and nothing can be signed: `send` receives each TxSpec as plain data and answers with an outcome.
import type { TxOutcome } from "../core/rpc";
import { moneyChain, resultOf, unknownResult, type TxResult } from "./chain";
import { moneyConfig } from "./config";
import type { TxSpec } from "./tx";

export interface WalletOption { id: string; name: string; iconUrl: string; description: string }

export interface WalletState {
  status: "idle" | "loading" | "out" | "in";
  accountId: string | null;
  walletName: string | null;
  options: WalletOption[];
  error: string | null;
}

interface MockWallet { accountId: string; send(tx: TxSpec): Promise<TxOutcome> }

/** What the wallet list shows while the selector loads, and how each wallet is described once it has. */
const WALLETS: WalletOption[] = [
  { id: "hot-wallet", name: "HOT Wallet", iconUrl: "", description: "Telegram, mobile and browser extension" },
  { id: "meteor-wallet", name: "Meteor Wallet", iconUrl: "", description: "Browser extension and web" },
  { id: "my-near-wallet", name: "MyNearWallet", iconUrl: "", description: "Web wallet, no install" },
  { id: "intear-wallet", name: "Intear Wallet", iconUrl: "", description: "Web wallet, no install" },
];

const SEEN_KEY = "pricedin.wallet.seen";
const MOCK_IN_KEY = "pricedin.wallet.mock";
const TGAS = 1_000_000_000_000n;

/** A wallet's error, in plain words: a refusal means nothing was sent; anything else, nobody can say. */
export function walletFailure(e: unknown): TxResult {
  const m = String((e as Error)?.message ?? e ?? "");
  const refused = (error: string): TxResult => ({ ok: false, hash: null, value: null, error, unknown: false });
  if (/reject|denied|cancel|closed/i.test(m)) return refused("You didn’t approve it in your wallet, so nothing happened.");
  if (/popup/i.test(m)) return refused("Your browser blocked the wallet’s window. Allow pop-ups for this site and try again.");
  if (/not enough|insufficient/i.test(m)) return refused("Your wallet doesn’t hold enough NEAR for the network fee.");
  return unknownResult();
}

class WalletHub {
  st: WalletState = { status: "idle", accountId: null, walletName: null, options: WALLETS, error: null };
  private listeners = new Set<() => void>();
  private selector: Promise<any> | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(p: Partial<WalletState>) { this.st = { ...this.st, ...p }; for (const fn of this.listeners) fn(); }

  private mock(): MockWallet | null {
    return typeof window === "undefined" ? null : ((window as any).__PI_MOCK_WALLET__ as MockWallet | undefined) ?? null;
  }

  /** Restore a session from before; with none, no wallet code loads at all. */
  boot() {
    if (this.st.status !== "idle" || typeof window === "undefined") return;
    const mock = this.mock();
    if (mock) {
      const was = sessionStorage.getItem(MOCK_IN_KEY) === "1";
      this.set({ status: was ? "in" : "out", accountId: was ? mock.accountId : null, walletName: was ? "Test wallet" : null });
      return;
    }
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* private mode */ }
    if (seen) void this.load().catch(() => {});
    else this.set({ status: "out" });
  }

  load(): Promise<any> {
    // under the mock the selector must never load: its empty account list would sign the mock out
    if (this.mock()) return Promise.resolve(null);
    if (this.selector) return this.selector;
    // a connected session stays connected while the wallet code loads
    if (this.st.status !== "in") this.set({ status: "loading" });
    this.selector = (async () => {
      const [{ setupWalletSelector }, { setupHotWallet }, { setupMeteorWallet }, { setupMyNearWallet }, { setupIntearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/intear-wallet"),
      ]);
      const c = moneyConfig();
      const selector = await setupWalletSelector({ network: c.network, fallbackRpcUrls: c.rpcUrls, modules: [setupHotWallet(), setupMeteorWallet(), setupMyNearWallet(), setupIntearWallet()] });
      const sync = (s: any) => {
        const account = s.accounts?.find((a: any) => a.active) ?? s.accounts?.[0] ?? null;
        const module = s.modules?.find((m: any) => m.id === s.selectedWalletId);
        const options = WALLETS.map((w) => ({ ...w, iconUrl: s.modules?.find((m: any) => m.id === w.id)?.metadata.iconUrl ?? "" }));
        this.set({ status: account ? "in" : "out", accountId: account?.accountId ?? null, walletName: account ? module?.metadata.name ?? null : null, options });
        try { if (account) localStorage.setItem(SEEN_KEY, "1"); else localStorage.removeItem(SEEN_KEY); } catch { /* private mode */ }
      };
      sync(selector.store.getState());
      selector.store.observable.subscribe(sync);
      return selector;
    })().catch((e) => {
      this.selector = null;
      this.set({ status: "out", error: "The wallet list didn’t load. Check your connection and try again." });
      throw e;
    });
    return this.selector;
  }

  async connect(id: string): Promise<void> {
    const mock = this.mock();
    if (mock) {
      sessionStorage.setItem(MOCK_IN_KEY, "1");
      this.set({ status: "in", accountId: mock.accountId, walletName: "Test wallet", error: null });
      return;
    }
    this.set({ error: null });
    const selector = await this.load();
    await (await selector.wallet(id)).signIn({});
  }

  async disconnect(): Promise<void> {
    if (this.mock()) sessionStorage.removeItem(MOCK_IN_KEY);
    else await (await (await this.load()).wallet()).signOut().catch(() => {});
    this.set({ status: "out", accountId: null, walletName: null });
  }

  /** One transaction through the wallet, read back until its outcome is known. */
  private async sendOne(tx: TxSpec, account: string): Promise<TxResult> {
    const market = moneyConfig().market;
    const mock = this.mock();
    if (mock) return resultOf(await mock.send(JSON.parse(JSON.stringify(tx))), market);
    const { actionCreators } = await import("@near-js/transactions");
    const wallet = await (await this.load()).wallet();
    // always the plural call: the single one needs a contract from sign-in on MyNearWallet, and we hold none
    const outcomes: TxOutcome[] | undefined = await wallet.signAndSendTransactions({
      transactions: [{ signerId: account, receiverId: tx.receiverId, actions: tx.actions.map((a) => actionCreators.functionCall(a.method, a.args, BigInt(a.gasTgas) * TGAS, BigInt(a.depositYocto))) }],
    });
    const outcome = outcomes?.[0];
    if (!outcome) return unknownResult();
    if (outcome.receipts_outcome?.length) return resultOf(outcome, market);
    const hash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? null;
    if (!hash) return unknownResult();
    return moneyChain().rpc.waitFinal(hash, account).then((o) => resultOf(o, market), () => unknownResult(hash));
  }

  /**
   * Send in order, one wallet approval each, and stop at the first that doesn't land, so a later step
   * never runs on an earlier one that failed. Results has one entry per step tried: a refusal is a
   * failed result, and what landed before it stays visible.
   */
  async send(txs: TxSpec[], onStep?: (index: number) => void): Promise<TxResult[]> {
    const account = this.st.accountId;
    if (!account) throw new Error("Connect a wallet first.");
    const results: TxResult[] = [];
    for (const [i, tx] of txs.entries()) {
      onStep?.(i);
      const r = await this.sendOne(tx, account).catch(walletFailure);
      results.push(r);
      if (!r.ok) break;
    }
    return results;
  }
}

let hub: WalletHub | null = null;
export const wallet = () => (hub ??= new WalletHub());
