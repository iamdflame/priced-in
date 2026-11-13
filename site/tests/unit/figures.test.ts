// The correction's two figures come from the two sentences themselves, or not at all.
import { describe, expect, test } from "vitest";
import rulingsSnap from "./fixtures/rulings.json";
import { figures } from "@/lib/figures";

describe("a correction's two figures", () => {
  test("the Tether line: $72.6 billion became $122.84 billion; dates are not figures", () => {
    const r = rulingsSnap.rulings.find((x) => x.claim_id === 18)!;
    expect(figures(r.claim, r.correction!.text)).toEqual({ was: "$72.6 billion", now: "$122.84 billion" });
  });
  test("a figure on both sides is not the change", () => {
    expect(figures("About $18.6 billion a week, with 9.7 million wallets.", "About $78 billion a week, with 9.7 million wallets.")).toEqual({ was: "$18.6 billion", now: "$78 billion" });
    expect(figures("Supply rose 2% a year.", "Supply rose 2% a year, per the docs.")).toBeNull();
  });
  test("no amount on a side means no pair: the sentences are shown instead", () => {
    const r = rulingsSnap.rulings.find((x) => x.claim_id === 6)!;
    expect(figures(r.claim, r.correction!.text)).toBeNull();
    expect(figures("It was founded in 2018.", "It was founded in early 2017.")).toBeNull();
  });
});
