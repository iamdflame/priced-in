import { describe, expect, test } from "vitest";
import { loadConfig, assertNetwork, networkOf, ConfigError } from "../src/core/config";

describe("config: never mainnet unless asked", () => {
  test("testnet by default, with testnet RPCs", () => {
    const c = loadConfig({});
    expect(c.network).toBe("testnet");
    expect(c.rpcUrls.every((u) => networkOf(u) !== "mainnet")).toBe(true);
    expect(c.doubtMicro).toBe(1_000_000n);
  });

  test("mainnet only when NEAR_NETWORK=mainnet is set explicitly", () => {
    expect(loadConfig({ NEAR_NETWORK: "mainnet" }).network).toBe("mainnet");
    expect(loadConfig({ VITE_NEAR_NETWORK: "mainnet" }).network).toBe("mainnet");
    expect(() => loadConfig({ NEAR_NETWORK: "mainet" })).toThrow(ConfigError);
  });

  test("a testnet build refuses mainnet RPCs and accounts, and the reverse", () => {
    expect(() => loadConfig({ VITE_RPC_URLS: "https://rpc.mainnet.near.org" })).toThrow(/belongs to mainnet/);
    expect(() => loadConfig({ VITE_RPC_URLS: "https://free.rpc.fastnear.com" })).toThrow(/mainnet/);
    expect(() => loadConfig({ NEAR_NETWORK: "mainnet", VITE_RPC_URLS: "https://rpc.testnet.near.org" })).toThrow(/testnet/);
    expect(() => assertNetwork("testnet", "lane.basalt.testnet", "market.alice.near")).toThrow(/market.alice.near belongs to mainnet/);
    expect(() => assertNetwork("testnet", "lane.basalt.testnet", "http://127.0.0.1:3030", null)).not.toThrow();
    expect(networkOf("testnetfan.near")).toBe("mainnet");
    expect(networkOf("https://test.rpc.fastnear.com")).toBe("testnet");
  });
});
