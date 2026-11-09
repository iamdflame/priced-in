// The rules behind the 9 November QA fixes: what the market said before a ruling, when a queued fact is
// decided, when a NEAR node is a problem on /status, the leaderboard's waiting line, and a post line's
// closest live fact.
import { describe, expect, test } from "vitest";
import { decideTime, priceBeforeRuling } from "@/lib/rulings";
import { problemsKpi, rpcState, statusTitle } from "@/lib/status";
import { foldWaiting, waitingWords, type BoardRow } from "@/lib/news";
import { closestLive, names, words, type LiveFact } from "@/lib/related";

// claim 18 (Tether's T-Bills) as /api/history?claim=18 gives it: seven bets, then the settlement at 0
const T_BILLS: [number, number][] = [[1793920262734, 500000], [1793921959532, 250874], [1793921971695, 177651], [1793921973822, 279936], [1793922050440, 140457], [1793922061883, 231763], [1793922422372, 116287], [1793927412980, 99804], [1793937003508, 0]];

describe("what the market said before the ruling", () => {
  test("the last price before the settlement: 10% on the T-Bills fact, not the settled 0%", () => {
    expect(priceBeforeRuling(T_BILLS, 1793937003508)).toBe(0.099804);
    expect(Math.round(priceBeforeRuling(T_BILLS, 1793937003508)! * 100)).toBe(10);
  });
  test("with no settlement time, the settlement point (exactly 0 or 1) is skipped", () => {
    expect(priceBeforeRuling(T_BILLS, null)).toBe(0.099804);
    expect(priceBeforeRuling([[1, 400000], [2, 1_000_000]], undefined)).toBe(0.4);
  });
  test("nothing before the ruling: null, never a made-up number", () => {
    expect(priceBeforeRuling([], 5)).toBeNull();
    expect(priceBeforeRuling(undefined, 5)).toBeNull();
    expect(priceBeforeRuling([[10, 300000]], 5)).toBeNull();
  });
});

describe("when the AI judges decide a queued fact", () => {
  const doc = { schedule: [{ claim_id: 27, at: Date.UTC(2026, 10, 12, 15), kind: "wikipedia" }, { claim_id: 40, at: Date.UTC(2026, 10, 15, 6), kind: "news" }] };
  const now = Date.UTC(2026, 10, 9, 16);
  test("its own time from the API's schedule", () => {
    expect(decideTime(doc, 27, now)).toEqual(doc.schedule[0]);
    expect(decideTime(doc, 40, now)?.kind).toBe("news");
  });
  test("a fact not queued, a time already past, or an older API without a schedule: nothing shown", () => {
    expect(decideTime(doc, 26, now)).toBeNull();
    expect(decideTime(doc, 27, Date.UTC(2026, 10, 12, 16))).toBeNull();
    expect(decideTime({}, 27, now)).toBeNull();
    expect(decideTime(null, 27, now)).toBeNull();
  });
});

describe("/status: the market's NEAR nodes and the problem count", () => {
  const node = (url: string, ok: boolean) => ({ url, ok });
  test("a spare that doesn't answer while three others do is running, said plainly", () => {
    const r = rpcState({ reachable: 3, urls: [node("https://near.drpc.org", true), node("https://rpc.fastnear.com", true), node("https://free.rpc.fastnear.com", true), node("https://rpc.intea.rs", false)] });
    expect(r.state).toBe("ok");
    expect(r.note).toBe("rpc.intea.rs doesn’t answer right now. It’s a spare: reads go to the others, so nothing is affected.");
  });
  test("all answering: running, nothing to say", () => {
    expect(rpcState({ reachable: 2, urls: [node("https://a.org", true), node("https://b.org", true)] })).toEqual({ state: "ok", note: null });
  });
  test("one left with no spare is a warning; none is down; unread is unknown", () => {
    expect(rpcState({ reachable: 1, urls: [node("https://a.org", true), node("https://b.org", false)] }).state).toBe("warn");
    expect(rpcState({ reachable: 0, urls: [node("https://a.org", false)] }).state).toBe("down");
    expect(rpcState(undefined).state).toBe("unknown");
  });
  test("the problem count reads right for 0, 1 and many: never “None problems”", () => {
    expect(problemsKpi(0)).toEqual({ v: "0", l: "problems reported" });
    expect(problemsKpi(1)).toEqual({ v: "1", l: "problem reported" });
    expect(problemsKpi(3)).toEqual({ v: "3", l: "problems reported" });
    expect(statusTitle(0, 0)).toBe("Everything is running.");
    expect(statusTitle(0, 1)).toBe("Priced In is running, with one problem.");
    expect(statusTitle(0, 2)).toBe("Priced In is running, with 2 problems.");
    expect(statusTitle(1, 3)).toBe("Part of Priced In is down.");
  });
});

describe("the leaderboard: people waiting for a first result are one line", () => {
  const row = (id: string, o: Partial<BoardRow> = {}): BoardRow => ({ kind: "person", id, name: id, accuracy: null, settled: 0, right: 0, points: 0, streak: { current: 0, best: 0 }, picks_today: 0, picks_total: 1, open_picks: 1, caught: 0, ranked: false, ...o });
  const rows = [row("ai", { kind: "ai" }), ...["v1", "v2", "v3", "v4", "v5", "v6", "v7"].map((id) => row(id)), row("v8", { picks_total: 2 }), row("dflame", { settled: 2, right: 1, picks_total: 5 })];
  test("folded: the AI trader, people with a result and you keep rows", () => {
    const f = foldWaiting(rows, "v3");
    expect(f.rows.map((r) => r.id)).toEqual(["ai", "v3", "dflame"]);
    expect(f.first).toEqual({ people: 7, picks: 8 });
    expect(waitingWords(f.first)).toBe("7 people are waiting for their first result, with 8 picks between them. A pick counts here once its fact is decided.");
  });
  test("one person, one pick; nobody waiting: no line", () => {
    expect(waitingWords({ people: 1, picks: 1 })).toBe("1 person is waiting for a first result, with 1 pick open. A pick counts here once its fact is decided.");
    expect(waitingWords({ people: 0, picks: 0 })).toBeNull();
  });
});

describe("a post line's closest live fact", () => {
  const fact = (id: number, question: string, topic: string): LiveFact => ({ id, question, text: question, topic, pct: 50, quotes: null });
  const live = [
    fact(29, "Was NEAR founded in 2018 by Illia Polosukhin and Alexander Skidanov?", "NEAR"),
    fact(39, "Will the Colts trade a player by 14 November 2026?", "Sports"),
    fact(40, "Will the Ravens sign a player by 14 November 2026?", "Sports"),
    fact(18, "Are most of Tether's cash reserves U.S. T-Bills?", "Tether"),
    fact(30, "Is Augur a now-defunct decentralized prediction market?", "Prediction market"),
  ];
  test("camelCase handles split; dates, numbers and filler never count", () => {
    expect(words("The @NEARProtocol Hackathon is live through November 14 with $250K in prizes.")).toEqual(["near", "protocol", "hackathon", "live", "through", "prizes"]);
  });
  test("only names count: a handle is one name, a capital that opens the sentence is not", () => {
    expect(names("The @NEARProtocol Hackathon is live through November 14 with $250K in prizes.")).toEqual([["near", "protocol"], ["hackathon"]]);
    expect(names("––AI encyclopedia with prediction markets (Augur-style).")).toEqual([["augur", "style"]]);
    expect(names("The official pages are generated by AI based on the current market.")).toEqual([]);
  });
  test("Illia's hackathon line finds the NEAR fact, not a news line that shares its date", () => {
    expect(closestLive("The @NEARProtocol Hackathon is live through November 14 with $250K in prizes.", live)?.id).toBe(29);
  });
  test("a line that shares nothing rare has no closest fact", () => {
    expect(closestLive("The weather in Paris is lovely in spring.", live)).toBeNull();
    expect(closestLive("The official pages are generated by AI based on the current market understanding.", live)).toBeNull();
    expect(closestLive("anything", [])).toBeNull();
  });
});
