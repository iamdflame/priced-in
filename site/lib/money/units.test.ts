// Amounts stay exact from the keyboard to the chain.
import { describe, expect, test } from "vitest";
import { fmtMicro, fmtMicroDown, fmtShares, microToInput, parseUsd, toUnits } from "./units";

describe("parsing", () => {
  test("exact at any size, where a float would drift", () => {
    expect(parseUsd("12.5")).toBe(12_500_000n);
    expect(parseUsd("0.000001")).toBe(1n);
    expect(parseUsd("1.1")).toBe(1_100_000n);
    expect(parseUsd(".5")).toBe(500_000n);
    expect(parseUsd("5.")).toBe(5_000_000n);
    expect(toUnits("0.009089969282154021", 18)).toBe(9_089_969_282_154_021n);
    expect(toUnits("123456789.123456789012345678", 18)).toBe(123_456_789_123_456_789_012_345_678n);
  });
  test("anything that isn't a positive amount that fits is null", () => {
    for (const s of ["", ".", "0", "0.00", "-1", "1e3", "abc", "1.2.3", "1.0000001"]) expect(parseUsd(s)).toBeNull();
  });
});

describe("back to text", () => {
  test("an amount field gets the exact decimal", () => {
    for (const [m, s] of [[12_500_000n, "12.5"], [1n, "0.000001"], [5_000_000n, "5"], [0n, "0"]] as const) expect(microToInput(m)).toBe(s);
  });
  test("what the chain will pay rounds down, what moved rounds to the nearest cent", () => {
    expect(fmtMicroDown(1_819_999n)).toBe("$1.81");
    expect(fmtMicro(1_819_999n)).toBe("$1.82");
    expect(fmtMicro(1_814_999n)).toBe("$1.81");
    expect(fmtMicro(1_815_000n)).toBe("$1.82");
    expect(fmtMicro(0n)).toBe("$0.00");
    expect(fmtMicroDown(50_000n)).toBe("$0.05");
  });
  test("large amounts keep every digit", () => expect(fmtMicro(123_456_789_012_340_000n)).toBe("$123456789012.34"));
  test("shares", () => expect(fmtShares(1_819_999n)).toBe("1.81"));
});
