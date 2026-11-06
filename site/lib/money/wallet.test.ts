// The wallet hub under the e2e mock: the real wallet selector never loads, so its empty account list can
// never sign the mock out. That race was invisible locally, where the selector loaded before the click,
// and broke the suite on the production CDN, where it loaded after.
import { beforeEach, describe, expect, test, vi } from "vitest";

const selectorLoaded = vi.fn();
vi.mock("@near-wallet-selector/core", () => { selectorLoaded(); return { setupWalletSelector: () => { throw new Error("the real selector must not load under the mock"); } }; });

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

beforeEach(() => {
  vi.resetModules();
  selectorLoaded.mockClear();
  vi.stubGlobal("sessionStorage", store());
  vi.stubGlobal("localStorage", store());
  vi.stubGlobal("window", { __PI_MOCK_WALLET__: { accountId: "judge-e2e.near", send: async () => null } });
});

describe("under the mock", () => {
  test("opening the wallet list loads nothing and keeps the session connected", async () => {
    const { wallet } = await import("./wallet");
    const hub = wallet();
    hub.boot();
    await hub.connect("my-near-wallet");
    expect(hub.st).toMatchObject({ status: "in", accountId: "judge-e2e.near" });
    await expect(hub.load()).resolves.toBeNull();
    expect(hub.st).toMatchObject({ status: "in", accountId: "judge-e2e.near" });
    expect(selectorLoaded).not.toHaveBeenCalled();
  });

  test("a session from before survives a reload", async () => {
    sessionStorage.setItem("pricedin.wallet.mock", "1");
    const { wallet } = await import("./wallet");
    wallet().boot();
    expect(wallet().st).toMatchObject({ status: "in", accountId: "judge-e2e.near" });
  });
});
