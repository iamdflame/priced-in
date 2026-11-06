// The view model and the live sentences: every % says what it means, every question is the planner's,
// every bet sentence comes from the contract's log.
import { describe, expect, test } from "vitest";
import claimsSnap from "./fixtures/claims.json";
import events from "./fixtures/events.json";
import { ago, mmss, pctOf, shortHash, span, traderName } from "@/lib/format";
import { betsFrom } from "@/lib/bets";
import type { MarketEvent } from "@/lib/core/api";
import type { ClaimView } from "@/lib/model";
import { liveNumbers, priceWords, topicsOf } from "@/lib/model";
import { catalogFor, questionFor, toFact, wikiOf } from "@/lib/server/facts";

const claims = claimsSnap.claims as ClaimView[];
const byId = (id: number) => claims.find((c) => c.id === id)!;

describe("facts", () => {
  test("every claim has a plain question, topic art and a Wikipedia source", () => {
    for (const c of claims) {
      expect(questionFor(c.text), `claim ${c.id}`).toBeTruthy();
      const cat = catalogFor(c.id, c.page);
      expect(cat.art).toMatch(/^[a-z]+$/);
      expect(wikiOf(c.page).url).toMatch(/^https:\/\/en\.wikipedia\.org\//);
    }
  });
  test("the snapshot's facts group into 9 topics from 10 Wikipedia articles", () => {
    const facts = claims.map((c) => toFact(c));
    expect(new Set(facts.map((f) => f.page)).size).toBe(10);
    expect(topicsOf(facts)).toHaveLength(9);
  });
  test("a corrected sentence the catalog hasn't met keeps the look of the one it replaced", () => {
    const look = catalogFor(9999, "ethereum", 20);
    expect(look.art).toBe(catalogFor(20, "ethereum").art);
    expect(look.caught).toBeNull();
    expect(look.short).toBe(`${catalogFor(20, "ethereum").short} (corrected)`);
  });
  test("a challenged fact can still be bet on, as the contract allows; a settled one can't", () => {
    expect(liveNumbers({ ...byId(24), status: "Challenged" }).quotes).not.toBeNull();
    expect(liveNumbers({ ...byId(24), status: "Settled" }).quotes).toBeNull();
  });
  test("a settled fact has no quote and says it was decided", () => {
    const f = toFact(byId(18), 500000);
    expect(f.status).toBe("settled");
    expect(f.quotes).toBeNull();
    expect(priceWords(f).whose).toBe("Decided: false");
  });
  test("no bets: the AI's starting estimate, or the reopening price for a correction", () => {
    const f = toFact(byId(24), 400000);
    expect(priceWords(f)).toEqual({ means: "chance it’s true", whose: "No bets yet · our AI’s starting estimate: 40%", brief: "our AI’s estimate", firstRead: true });
    const g = toFact(byId(32), 500000);
    expect(priceWords(g, true).whose).toBe("No bets yet · reopened at 50%");
  });
  test("bets: up or down from the start", () => {
    const f = toFact(byId(0), 750000);
    expect(f.trades).toBe(2);
    expect(priceWords(f).whose).toBe("up from 75% at the start");
  });
});

describe("live sentences from the contract's log", () => {
  const agents = { "h-quant.isitpriced.near": "Quant", "h-archivist.isitpriced.near": "Archivist", "h-skeptic.isitpriced.near": "Skeptic" };
  const bets = betsFrom(events.events as MarketEvent[], agents, { 18: 500000 });
  test("free $1 bets are Someone's; agents by persona; sells left out", () => {
    const first = bets.find((b) => b.claimId === 18)!;
    expect(first.free).toBe(true);
    expect(first.who).toBe("Someone");
    expect(first.priceBefore).toBe(0.5);
    expect(first.priceAfter).toBeCloseTo(0.250874, 6);
    expect(bets.some((b) => b.who === "The Quant")).toBe(true);
    expect(bets.every((b) => b.side === "yes" || b.side === "no")).toBe(true);
  });
  test("each bet's price before is the previous bet's price after", () => {
    const on18 = bets.filter((b) => b.claimId === 18);
    for (let i = 1; i < on18.length; i++) expect(on18[i].priceBefore).toBe(on18[i - 1].priceAfter);
  });
});

describe("format", () => {
  test("numbers and times", () => {
    expect(pctOf(0.004)).toBe(1);
    expect(pctOf(0.996)).toBe(99);
    expect(shortHash("FGFhi1W9mLtCvQ44SzDvpbKVCCPiDtkmMRpM15MBBvc6")).toBe("FGFhi1…BBvc6");
    expect(span(7966)).toBe("8.0 s");
    expect(span(1195938)).toBe("20 min");
    expect(mmss(61_000)).toBe("01:01");
    expect(ago(0, 3 * 60_000)).toBe("3 min ago");
    expect(traderName("lane:ed25519:abc", {}).name).toBe("Someone");
  });
});
