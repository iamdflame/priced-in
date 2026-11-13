// The live strip shows the judges' rulings: newest first, open-to-objection ones say so, expired
// challenges and the jury's pending ones are left out, and the judge count is the verdicts that agree.
import { describe, expect, test } from "vitest";
import rulingsSnap from "./fixtures/rulings.json";
import { rulingWords, stripRulings } from "@/lib/rulingStrip";
import type { Ruling, Verdict } from "@/lib/server/api";

const v = (verdict: string): Verdict => ({ model: "m", verdict, at: 0, tx: "t", signature: "s" });
const ruling = (o: Partial<Ruling>): Ruling => ({
  challenge_id: 1, claim_id: 1, claim: "", page: "p", challenger: "c", challenger_name: "C", claimed: "FALSE", bond_usd: 1, opened_at: 100,
  open_tx: "", jury_deadline_at: 0, evidence: "", verdicts: [], provisional: null, provisional_at: null, window_ends_at: null, disputes: [],
  escalated: false, status: "jury", outcome: null, settled_at: null, settle_tx: null, payout_usd: null, correction: null, ...o,
} as Ruling);

describe("the live strip's rulings", () => {
  test("settled and open-to-objection rulings, newest first; the jury's pending and expired ones left out", () => {
    const items = stripRulings([
      ruling({ challenge_id: 1, claim_id: 10, status: "settled", outcome: "FALSE", settled_at: 300, verdicts: [v("FALSE"), v("FALSE"), v("FALSE")] }),
      ruling({ challenge_id: 2, claim_id: 11, status: "window", provisional: "TRUE", provisional_at: 500, verdicts: [v("TRUE"), v("TRUE"), v("FALSE")] }),
      ruling({ challenge_id: 3, claim_id: 12, status: "jury" }),
      ruling({ challenge_id: 4, claim_id: 13, status: "expired" }),
      ruling({ challenge_id: 5, claim_id: 14, status: "settled", outcome: "TRUE", settled_at: 400, verdicts: [v("TRUE"), v("TRUE")] }),
    ]);
    expect(items.map((i) => i.claimId)).toEqual([11, 14, 10]);
    expect(items[0]).toMatchObject({ outcome: true, final: false, judges: 2 });
    expect(items[2]).toMatchObject({ outcome: false, final: true, judges: 3 });
  });

  test("the words say the outcome, who ruled, and whether it can still be objected to", () => {
    const [open, settled] = stripRulings([
      ruling({ challenge_id: 2, status: "window", provisional: "FALSE", provisional_at: 9, verdicts: [v("FALSE"), v("FALSE")] }),
      ruling({ challenge_id: 1, status: "settled", outcome: "TRUE", settled_at: 5, verdicts: [v("TRUE"), v("TRUE"), v("TRUE")] }),
    ]);
    expect(rulingWords(open)).toEqual({ verdict: "Ruled false", rest: ", open to objection" });
    expect(rulingWords(settled)).toEqual({ verdict: "Ruled true", rest: " by 3 AI judges" });
  });

  test("on a real snapshot of /api/rulings, every settled ruling shows once", () => {
    const rulings = rulingsSnap.rulings as unknown as Ruling[];
    const items = stripRulings(rulings);
    expect(items.filter((i) => i.final)).toHaveLength(rulings.filter((r) => r.status === "settled").length);
    for (let i = 1; i < items.length; i++) expect(items[i - 1].at).toBeGreaterThanOrEqual(items[i].at);
  });
});
