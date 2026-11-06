"use client";
// The person's own NEAR wallet: NEAR Wallet Selector with HOT, Meteor, MyNearWallet and Intear, loaded
// only when someone opens the wallet menu or was connected before. Read-only until connected. The wallet
// signs every transaction itself; this layer only hands it the transactions (lib/money/tx.ts) after the
// screen has shown the sentence that says what each one does.
//
// Tests: Playwright injects window.__PI_MOCK_WALLET__ ({ accountId, send(txs) }) before the page loads;
// then no wallet module loads and nothing can be signed, and `send` receives the TxSpecs as plain data.
import type { TxOutcome } from "../core/rpc";
import { resultOf, type TxResult } from "./chain";
import { moneyConfig } from "./config";
import type { TxSpec } from "./tx";

export interface WalletOption { id: string; name: string; iconUrl: string; description: string | null; kind: string }

export interface WalletState {
  status: "idle" | "loading" | "out" | "in";
  accountId: string | null;
  walletId: string | null;
  walletName: string | null;
  options: WalletOption[];
  error: string | null;
}

interface MockWallet { accountId: string; send(txs: TxSpec[]): Promise<TxOutcome[]> }

const OPTIONS_FALLBACK: WalletOption[] = [
  { id: "hot-wallet", name: "HOT Wallet", iconUrl: "", description: "Telegram, mobile and browser extension", kind: "injected" },
  { id: "meteor-wallet", name: "Meteor Wallet", iconUrl: "", description: "Browser extension and web", kind: "injected" },
  { id: "my-near-wallet", name: "MyNearWallet", iconUrl: "", description: "Web wallet, no install", kind: "browser" },
  { id: "intear-wallet", name: "Intear Wallet", iconUrl: "", description: "Web wallet, no install", kind: "injected" },
];

const DESCRIBE: Record<string, string> = {
  "hot-wallet": "Telegram, mobile and browser extension",
  "meteor-wallet": "Browser extension and web",
  "my-near-wallet": "Web wallet, no install",
  "intear-wallet": "Web wallet, no install",
};

const SEEN_KEY = "pricedin.wallet.seen";

class WalletHub {
  st: WalletState = { status: "idle", accountId: null, walletId: null, walletName: null, options: OPTIONS_FALLBACK, error: null };
  private listeners = new Set<() => void>();
  private selector: Promise<any> | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(p: Partial<WalletState>) { this.st = { ...this.st, ...p }; for (const fn of this.listeners) fn(); }

  private mock(): MockWallet | null {
    return typeof window !== "undefined" ? ((window as any).__PI_MOCK_WALLET__ as MockWallet | undefined) ?? null : null;
  }

  /** Restore a session from before without loading any wallet code if there was none. */
  boot() {
    if (this.st.status !== "idle" || typeof window === "undefined") return;
    const m = this.mock();
    if (m) {
      const was = sessionStorage.getItem("pi.mock.in") === "1";
      this.set({ status: was ? "in" : "out", accountId: was ? m.accountId : null, walletId: was ? "mock" : null, walletName: was ? "Test wallet" : null });
      return;
    }
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* private mode */ }
    // MyNearWallet comes back from its own page with ?account_id=: load the selector to finish sign-in
    if (seen || /[?&](account_id|transactionHashes|errorCode)=/.test(location.search)) void this.load();
    else this.set({ status: "out" });
  }

  load(): Promise<any> {
    if (this.mock()) return Promise.resolve(null);
    if (this.selector) return this.selector;
    this.set({ status: this.st.status === "in" ? "in" : "loading" });
    this.selector = (async () => {
      const [{ setupWalletSelector }, { setupHotWallet }, { setupMeteorWallet }, { setupMyNearWallet }, { setupIntearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/intear-wallet"),
      ]);
      const c = moneyConfig();
      const selector = await setupWalletSelector({
        network: c.network,
        fallbackRpcUrls: c.rpcUrls,
        modules: [setupHotWallet(), setupMeteorWallet(), setupMyNearWallet(), setupIntearWallet()],
      } as any);
      const sync = (s: any) => {
        const acct = s.accounts?.find((a: any) => a.active) ?? s.accounts?.[0] ?? null;
        const mod = s.modules?.find((m: any) => m.id === s.selectedWalletId);
        const options: WalletOption[] = (s.modules || []).map((m: any) => ({ id: m.id, name: m.metadata.name, iconUrl: m.metadata.iconUrl, description: DESCRIBE[m.id] ?? m.metadata.description ?? null, kind: m.type }));
        this.set({ status: acct ? "in" : "out", accountId: acct?.accountId ?? null, walletId: acct ? s.selectedWalletId : null, walletName: acct ? mod?.metadata.name ?? null : null, options: options.length ? options : OPTIONS_FALLBACK });
        try { if (acct) localStorage.setItem(SEEN_KEY, "1"); else localStorage.removeItem(SEEN_KEY); } catch { /* private mode */ }
      };
      sync(selector.store.getState());
      selector.store.observable.subscribe(sync);
      return selector;
    })().catch((e) => {
      this.selector = null;
      this.set({ status: "out", error: `The wallet list didn’t load (${(e as Error)?.message || e}). Check your connection and try again.` });
      throw e;
    });
    return this.selector;
  }

  async connect(id: string): Promise<void> {
    const m = this.mock();
    if (m) {
      sessionStorage.setItem("pi.mock.in", "1");
      this.set({ status: "in", accountId: m.accountId, walletId: "mock", walletName: "Test wallet", error: null });
      return;
    }
    this.set({ error: null });
    const selector = await this.load();
    const wallet = await selector.wallet(id);
    await wallet.signIn({});
  }

  async disconnect(): Promise<void> {
    const m = this.mock();
    if (m) {
      sessionStorage.removeItem("pi.mock.in");
      this.set({ status: "out", accountId: null, walletId: null, walletName: null });
      return;
    }
    const selector = await this.load();
    const wallet = await selector.wallet().catch(() => null);
    await wallet?.signOut().catch(() => {});
    try { localStorage.removeItem(SEEN_KEY); } catch { /* private mode */ }
    this.set({ status: "out", accountId: null, walletId: null, walletName: null });
  }

  /** Hand the transactions to the wallet, in order; one result each. Nothing is sent without the wallet. */
  async send(txs: TxSpec[]): Promise<TxResult[]> {
    if (!this.st.accountId) throw new Error("Connect a wallet first.");
    const m = this.mock();
    if (m) return (await m.send(JSON.parse(JSON.stringify(txs)))).map(resultOf);
    const selector = await this.load();
    const wallet = await selector.wallet();
    const { actionCreators } = await import("@near-js/transactions");
    const transactions = txs.map((t) => ({
      signerId: this.st.accountId!,
      receiverId: t.receiverId,
      actions: t.actions.map((a) => actionCreators.functionCall(a.method, a.args, BigInt(a.gasTgas) * 1_000_000_000_000n, BigInt(a.depositYocto))),
    }));
    const outcomes: TxOutcome[] | void = transactions.length === 1
      ? [await wallet.signAndSendTransaction(transactions[0])].filter(Boolean)
      : await wallet.signAndSendTransactions({ transactions });
    // a redirect wallet (MyNearWallet) leaves the page here and comes back with ?transactionHashes=
    if (!outcomes || !outcomes.length) return txs.map(() => ({ ok: true, hash: null, value: null, error: null }));
    return outcomes.map((o) => resultOf(o));
  }
}

let hub: WalletHub | null = null;
export function wallet(): WalletHub {
  if (!hub) hub = new WalletHub();
  return hub;
}

/** A wallet's refusal, in plain words. */
export function walletError(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? "");
  if (/reject|denied|cancel|closed|user/i.test(m)) return "You didn’t approve it in your wallet, so nothing happened.";
  if (/not enough|insufficient|NotEnoughBalance/i.test(m)) return "Your wallet doesn’t hold enough NEAR for the network fee.";
  return m ? `Your wallet said: ${m.slice(0, 160)}` : "Your wallet didn’t answer. Nothing was sent.";
}
