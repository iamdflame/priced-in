// The 1Click routes this site offers, and the address checks that keep money off the wrong chain.
import { describe, expect, test } from "vitest";
import { bridgeDone, CURATED, routesFrom, validAddress, validNearAccount, type TokenRow } from "./oneclick";

const row = (blockchain: string, symbol: string, assetId: string, decimals = 6, price: number | null = 1): TokenRow => ({ blockchain, symbol, assetId, decimals, price });

describe("the routes", () => {
  const tokens = [
    row("base", "USDC", "nep141:base-usdc.omft.near"),
    row("eth", "ETH", "nep141:eth.omft.near", 18, 2228.55),
    row("bsc", "USDC", "nep245:v2_1.omni.hot.tg:56_x", 18),
    row("near", "USDT", "nep141:usdt.tether-token.near"),
    row("near", "USDT", "nep141:another-usdt.near"),
    row("eth", "USDT", "1cs_v1:eth:erc20:0xnot-a-nep141"),
  ];
  const routes = routesFrom(tokens);

  test("only what is curated and listed today", () => {
    expect(routes.map((r) => r.key)).toEqual(["base:USDC", "eth:ETH", "near:USDT"]);
  });
  test("each carries 1Click's own id, decimals and price", () => {
    expect(routes.find((r) => r.key === "eth:ETH")).toMatchObject({ assetId: "nep141:eth.omft.near", decimals: 18, price: 2228.55, chainName: "Ethereum", in: true, out: false });
  });
  test("a pinned asset id wins over a same-named token", () => {
    expect(routes.find((r) => r.key === "near:USDT")?.assetId).toBe("nep141:usdt.tether-token.near");
  });
  test("money only goes out as a stablecoin", () => {
    for (const c of CURATED.filter((x) => x.out)) expect(["USDC", "USDT"]).toContain(c.symbol);
  });
  test("a missing price stays missing", () => {
    expect(routesFrom([row("base", "USDC", "nep141:x", 6, null)])[0].price).toBeNull();
  });
});

describe("addresses", () => {
  test.each([
    ["evm", "0x1111111111111111111111111111111111111111", true],
    ["evm", "0x111", false],
    ["evm", "isitpriced.near", false],
    ["sol", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", true],
    ["sol", "0x1111111111111111111111111111111111111111", false],
    ["btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", true],
    ["btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", true],
    ["btc", "0x1111111111111111111111111111111111111111", false],
    ["tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", true],
    ["tron", "0x1111111111111111111111111111111111111111", false],
  ] as const)("%s %s", (kind, a, ok) => expect(validAddress(kind, a)).toBe(ok));
  test("NEAR accounts: named, implicit, and not a shouted or dotted mess", () => {
    expect(validNearAccount("isitpriced.near")).toBe(true);
    expect(validNearAccount("cfdc0e1f7d542334b302b80b7cb4035a238e965ac594f317d79bef7758dcfbaa")).toBe(true);
    for (const a of ["Bad.near", "a..near", ".near", "a", "x".repeat(65)]) expect(validNearAccount(a)).toBe(false);
  });
});

describe("the end of a swap", () => {
  test("only these stop the tracking", () => {
    expect(["SUCCESS", "REFUNDED", "FAILED"].every((s) => bridgeDone(s as any))).toBe(true);
    expect(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "INCOMPLETE_DEPOSIT"].some((s) => bridgeDone(s as any))).toBe(false);
  });
});
