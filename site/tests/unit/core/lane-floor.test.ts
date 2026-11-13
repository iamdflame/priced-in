// The free bet's floor (lib/core/lane.ts, laneFloor): the fewest shares the chain may fill it with.
// It used to be 0, which accepted any price. The contract refuses a fill under the floor, and nothing is spent.
import { describe, expect, test } from "vitest";
import { LANE_FLOOR_BPS, laneFloor } from "@/lib/core/lane";
import { marketFromClaim, quoteBuy } from "@/lib/core/lmsr";

describe("the free bet's floor", () => {
  test("nine tenths of the shares the page quoted, rounded down", () => {
    expect(LANE_FLOOR_BPS).toBe(9000n);
    expect(laneFloor(1_256_951n)).toBe(1_131_255n);
    expect(laneFloor(1n)).toBe(0n);
    expect(laneFloor(0n)).toBe(0n);
    expect(laneFloor(-5n)).toBe(0n);
  });

  test("the largest fee, 3%, still clears it: the page's quote has no fee in it and the fill does", () => {
    // claim 60 as it opened on mainnet: 25% yes, b $0.50
    const m = marketFromClaim({ b_micro: "500000", q_yes_micro: "0", q_no_micro: "0", d0: "-1098612288678" });
    expect(m).not.toBeNull();
    for (const side of ["yes", "no"] as const) {
      const shown = quoteBuy(m!, side, 1);
      const filled = quoteBuy(m!, side, 1, 300);
      expect(filled.sharesMicro).toBeLessThan(shown.sharesMicro);
      expect(filled.sharesMicro).toBeGreaterThan(laneFloor(shown.sharesMicro));
    }
  });
});
