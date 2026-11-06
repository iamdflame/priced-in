// The geofence's rule. proxy.test.ts runs it through the real proxy; this holds the list itself.
import { describe, expect, test } from "vitest";
import { accessFor, canAddMoney, canTakeOut, decodeGeo, encodeGeo, geoLine, REGIONS } from "./geo";

describe("what a place may do", () => {
  test("countries", () => {
    expect(accessFor("KE")).toBe("open");
    expect(accessFor("us")).toBe("close_only");
    expect(accessFor("GB")).toBe("close_only");
    expect(accessFor("IR")).toBe("blocked");
  });
  test("regions, as Vercel sends them (without the country) and in full", () => {
    expect(accessFor("CA", "ON")).toBe("close_only");
    expect(accessFor("CA", "CA-QC")).toBe("close_only");
    expect(accessFor("CA", "NS")).toBe("open");
    expect(accessFor("CA")).toBe("open");
    expect(accessFor("UA", "43")).toBe("blocked");
    expect(accessFor("UA", "30")).toBe("open");
  });
  test("a country that is blocked outright stays blocked whatever its region", () => expect(accessFor("KP", "01")).toBe("blocked"));
  test("no country: open on a local run, closed to new money where the header is required", () => {
    for (const c of [null, undefined, "", "XX"]) {
      expect(accessFor(c)).toBe("unknown");
      expect(accessFor(c, null, { required: true })).toBe("close_only");
    }
  });
});

describe("what each access allows", () => {
  test.each([["open", true, true], ["unknown", true, true], ["close_only", false, true], ["blocked", false, false]] as const)("%s", (a, addMoney, takeOut) => {
    expect(canAddMoney(a)).toBe(addMoney);
    expect(canTakeOut(a)).toBe(takeOut);
  });
});

describe("the cookie", () => {
  test("round-trips", () => expect(decodeGeo(encodeGeo("close_only", "US"))).toEqual({ access: "close_only", country: "US" }));
  test("a tampered or missing value reads as unknown, never as a stronger right", () => {
    expect(decodeGeo("admin.US").access).toBe("unknown");
    expect(decodeGeo(null)).toEqual({ access: "unknown", country: null });
    expect(decodeGeo("open.XX")).toEqual({ access: "open", country: null });
  });
});

describe("the notice", () => {
  test("says the free $1 still works, and nothing where nothing is restricted", () => {
    expect(geoLine("blocked", "IR")).toMatch(/free \$1 still works/);
    expect(geoLine("close_only", "US")).toMatch(/the United States.*sell, collect and withdraw/);
    expect(geoLine("open", "KE")).toBeNull();
    expect(geoLine("unknown", null)).toBeNull();
  });
});

describe("the list", () => {
  test("every code is well formed, and no place is on both lists", () => {
    const { blocked, close_only: closeOnly } = REGIONS;
    for (const c of [...blocked.countries, ...closeOnly.countries]) expect(c).toMatch(/^[A-Z]{2}$/);
    for (const r of [...blocked.regions, ...closeOnly.regions]) expect(r).toMatch(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);
    expect(blocked.countries.filter((c) => closeOnly.countries.includes(c))).toEqual([]);
  });
  test("it names its sources", () => {
    for (const s of REGIONS.sources) expect(s.url).toMatch(/^https:\/\//);
    expect(REGIONS.sources.length).toBeGreaterThan(0);
  });
});
