// The top of an official page with rulings ("Corrected by a ruling"), from the page API's `corrections` as the
// live Tether page had them on 9 November 2026, and the one formatter every wait on a clock goes through.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import tether from "./fixtures/page-tether.json";
import { Corrections, correctionWords, rulingHref } from "@/components/pages/Corrections";
import { OfficialArticle } from "@/components/pages/OfficialArticle";
import { mmss, waitWords } from "@/lib/format";
import type { OfficialPage, PageCorrection } from "@/lib/pages";

const STALE = "The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, accounting for $72.6 billion.";
const FIXED = "The majority of Tether’s reserves held in cash and cash equivalents are U.S. T-Bills, which Tether’s attestation report, checked on 5 November 2026, puts at $122.84 billion at 30 September 2026.";
const SRC = "https://assets.ctfassets.net/vyse88cgwfbl/7nQYtcoP9GxIUFSyro2dGK/8d0521470b9e99c8c0831019cabea4ee/ISAE%5F3000R%5F-%5FOpinion%5FTether%5FInternational%5FFinancial%5FFigure%5F30-09-2026.pdf";

const TBILLS: PageCorrection = {
  claim_id: 18, wikipedia: STALE, text: STALE, outcome: "false", by: "three AI judges", trades: 7,
  corrected: { text: FIXED, claim_id: 32, url: "/c/32" },
  source: { name: "Tether’s attestation report", url: SRC, figure: "$122.84 billion at 30 September 2026", on_page: "$72.6 billion in U.S. T-Bills, stated without a date", checked_on: "2026-11-05" },
  price_before: 0.099804, price_written: 0.116287,
  challenge_id: 0, decided_at: 1793937003508, tx: "3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v", explorer: "https://nearblocks.io/txns/3KbCTq6sRK8RtSvhwTzbAmGGiUveqasWCfSGTuTk8K1v", url: "/c/18",
  payout: { usd: 4.9301, side: "no" },
  rewrite: { id: "tether:9:v3", model: "z-ai/glm-5.3-flash", signed: true, tx: "BRsksfdHRsu2gwiAd3SNbVWyM5Ti3EyBeM9ZH6iB2v1m", explorer: "https://nearblocks.io/txns/BRsksfdHRsu2gwiAd3SNbVWyM5Ti3EyBeM9ZH6iB2v1m" },
};
const CHAINS: PageCorrection = {
  ...TBILLS, claim_id: 6, trades: 2, wikipedia: "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS and Tron.", text: "Tether issues tokens on Algorand, Avalanche, Celo, Ethereum, EOS and Tron.",
  corrected: { text: "Tether issues tokens on Avalanche, Celo, Ethereum and Tron; it no longer issues on EOS and Algorand.", claim_id: 33, url: "/c/33" },
  source: null, price_before: 0.439786, price_written: 0, challenge_id: 1, payout: { usd: 0.938864, side: "no" },
  rewrite: { id: "tether:2:v2", model: "z-ai/glm-5.3-flash", signed: true, tx: "6gwJFMaXwAPmW6kHJT5m3poDJXCSTwVaFGCTAS8rwqyq", explorer: "https://nearblocks.io/txns/6gwJFMaXwAPmW6kHJT5m3poDJXCSTwVaFGCTAS8rwqyq" },
};

const html = (items: PageCorrection[] | undefined) => renderToStaticMarkup(createElement(Corrections, { items }));
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("the words of a correction", () => {
  it("says what the market said, who ruled, what was paid and who rewrote it, from the real numbers", () => {
    const w = correctionWords(TBILLS);
    expect(`${w.market!.lead} ${w.market!.pct}${w.market!.tail}`).toBe("The market had it at 10% chance it’s true before the ruling, after 7 bets.");
    expect(w.ruled).toBe("Three AI judges ruled it false");
    expect(w.paid).toEqual({ money: "$4.93", text: " paid to No" });
    expect(w.rewrite).toBe("Rewritten by glm-5.3-flash, signed in a TEE, anchored on NEAR");
    expect(rulingHref(TBILLS)).toBe("/rulings#ruling-0");
  });

  it("names early and missing states honestly, and leaves out what the API couldn't fill", () => {
    const unbet = correctionWords({ ...TBILLS, trades: 0, price_before: 0.3 });
    expect(`${unbet.market!.lead} ${unbet.market!.pct}`).toBe("Nobody had bet yet. Our AI’s estimate was 30% chance it’s true");
    const bare = correctionWords({ ...TBILLS, price_before: null, payout: null, rewrite: null, by: "the council", challenge_id: null });
    expect([bare.market, bare.paid, bare.rewrite, bare.ruled]).toEqual([null, null, null, "The council ruled it false"]);
    expect(rulingHref({ challenge_id: null, url: "/c/18" })).toBe("/c/18");
    expect(correctionWords({ ...TBILLS, payout: { usd: 0, side: "no" } }).paid).toEqual({ money: null, text: "Nobody had bet on No, so nothing was paid out" });
    expect(correctionWords({ ...TBILLS, rewrite: { ...TBILLS.rewrite!, signed: false, tx: null } }).rewrite).toBe("Rewritten by glm-5.3-flash, waiting for its signature");
  });
});

describe("Corrected by a ruling", () => {
  it("leads with the most bet ruling: Wikipedia struck, the page's sentence highlighted, the source and its figure", () => {
    const h = html([TBILLS, CHAINS]);
    expect(h).toContain('id="corrected"');
    expect(text(h)).toContain("Corrected by a ruling");
    expect(text(h)).toContain("2 facts on this page were ruled false.");
    expect(h.indexOf(`<del>${STALE}</del>`)).toBeGreaterThan(-1);
    expect(h.indexOf(`<ins>${FIXED}</ins>`)).toBeGreaterThan(h.indexOf(`<del>${STALE}</del>`));
    expect(h.indexOf("claim_id")).toBe(-1);
    // the T-Bills line first, as the API ordered it
    expect(h.indexOf(STALE)).toBeLessThan(h.indexOf(CHAINS.text));
    expect(h).toContain(`href="${SRC}"`);
    expect(text(h)).toContain("$122.84 billion at 30 September 2026, according to Tether’s attestation report");
    expect(text(h)).toContain("The market had it at 10% chance it’s true before the ruling, after 7 bets.");
    expect(text(h)).toContain("$4.93 paid to No");
    expect(text(h)).toContain("Rewritten by glm-5.3-flash, signed in a TEE, anchored on NEAR BRsksf…B2v1m");
    expect(h).toContain('href="/rulings#ruling-0"');
    expect(h).toContain('href="https://nearblocks.io/txns/BRsksfdHRsu2gwiAd3SNbVWyM5Ti3EyBeM9ZH6iB2v1m"');
    expect(h).toContain('href="/c/32"');
    expect(h.match(/class="crx lead"/g)).toHaveLength(1);
  });

  it("follows the copy rules: curly apostrophes, no em dashes, and words with every side and percent", () => {
    const t = text(html([TBILLS, CHAINS]));
    expect(t).not.toMatch(/—/);
    expect(t.replace(STALE, "").replace(FIXED, "")).not.toMatch(/'/);
    expect(t).toMatch(/\d+% chance it’s true/);
  });

  it("shows nothing with no ruling, keeps a long list short, and skips a line ruled true", () => {
    expect(html(undefined)).toBe("");
    expect(html([])).toBe("");
    expect(html([{ ...TBILLS, outcome: "true" }])).toBe("");
    const many = html([1, 2, 3, 4, 5].map((n) => ({ ...CHAINS, claim_id: n })));
    expect(many.match(/<li class="crx/g)).toHaveLength(5);
    expect(text(many)).toContain("2 more corrections");
    expect(text(html([{ ...TBILLS, corrected: null, source: null }]))).not.toContain("Now");
  });
});

describe("the page with rulings", () => {
  it("says how many facts were decided in its header, and the corrections come before the article", () => {
    const page = { ...(tether as unknown as OfficialPage), totals: { ...(tether as unknown as OfficialPage).totals, facts_decided: 2 }, corrections: [TBILLS, CHAINS] };
    const h = renderToStaticMarkup(createElement(OfficialArticle, { page, facts: [], lead: createElement(Corrections, { items: page.corrections }) }));
    expect(text(h)).toContain("2 facts decided");
    expect(h).toContain('href="#corrected"');
    const at = (s: string) => h.indexOf(s);
    expect(at("<h1>")).toBeLessThan(at('id="corrected"'));
    expect(at('id="corrected"')).toBeLessThan(at('class="viewbar'));
    const none = renderToStaticMarkup(createElement(OfficialArticle, { page: { ...page, totals: { ...page.totals, facts_decided: 0 }, corrections: [] }, facts: [] }));
    expect(none).not.toContain("facts decided");
    expect(none).not.toContain('id="corrected"');
  });
});

describe("waitWords: one formatter for every wait on a clock", () => {
  it("reads under a day as a clock and a day or more as days and hours", () => {
    expect(waitWords(61_000)).toBe(mmss(61_000));
    expect(waitWords(3 * 3600_000 + 5 * 60_000)).toBe("3:05:00");
    expect(waitWords(86_400_000 - 1000)).toBe("23:59:59");
    expect(waitWords(86_400_000)).toBe("1d 0h");
    expect(waitWords((183 * 3600 + 17 * 60 + 54) * 1000)).toBe("7d 15h");
    expect(waitWords(3 * 86_400_000 + 4 * 3600_000 + 59 * 60_000)).toBe("3d 4h");
    expect(waitWords(-5000)).toBe("00:00");
  });
});
