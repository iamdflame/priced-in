// A raw URL is never a link's words, a doubled phrase is said once, and a repeated reason shows once.
import { describe, expect, test } from "vitest";
import { sourceLabel, undouble, withoutRepeats } from "@/lib/tidy";

describe("tidy", () => {
  test("a link's words are its title, or the site's name when the title is missing or a URL", () => {
    expect(sourceLabel("Tether's attestation", "https://tether.io/x")).toBe("Tether's attestation");
    expect(sourceLabel("https://www.nytimes.com/athletic/7767421/2026/11/11/mauricio-pochettino", "https://www.nytimes.com/athletic/7767421/2026/11/11/mauricio-pochettino")).toBe("nytimes.com");
    expect(sourceLabel(null, "https://www.skysports.com/football/news/1")).toBe("skysports.com");
    expect(sourceLabel("", "not a url")).toBe("Its source");
  });

  test("a phrase doubled by its feed is said once; one word twice and real sentences are left alone", () => {
    expect(undouble("White House set to extend set to extend Jones Act waiver, sources say")).toBe("White House set to extend Jones Act waiver, sources say");
    expect(undouble("He had had enough")).toBe("He had had enough");
    expect(undouble("New York, New York")).toBe("New York, New York");
    expect(undouble("Man United hope to seal Mauricio Pochettino deal on Thursday")).toBe("Man United hope to seal Mauricio Pochettino deal on Thursday");
  });

  test("the same reason from the same writer shows once, first given kept", () => {
    const r = (o: object) => ({ account_id: "a", side: "agree", rationale: "same", source_url: "u", credence: 0.55, at: 1, ...o });
    const rows = withoutRepeats([r({ at: 3 }), r({ at: 2 }), r({ at: 1, account_id: "b" }), r({ at: 0, rationale: "other" })]);
    expect(rows.map((x) => x.at)).toEqual([3, 1, 0]);
  });
});
