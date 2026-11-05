import { describe, expect, test } from "vitest";
import { matchRoute, pathOf, Router, type Route } from "../src/core/router";

describe("router", () => {
  test("home, pages, claims, agents, verify and audit", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("/p/near-intents")).toEqual({ name: "page", slug: "near-intents" });
    expect(matchRoute("/p/near-intents/")).toEqual({ name: "page", slug: "near-intents" });
    expect(matchRoute("/c/42")).toEqual({ name: "claim", id: 42 });
    expect(matchRoute("/agents")).toEqual({ name: "agents" });
    expect(matchRoute("/audit")).toEqual({ name: "audit" });
    expect(matchRoute("/verify")).toEqual({ name: "verify", rewrite: null, page: null });
    expect(matchRoute("/verify/near-intents%3A0%3Av3?page=near-intents")).toEqual({ name: "verify", rewrite: "near-intents:0:v3", page: "near-intents" });
    expect(matchRoute("/verify?rewrite=x&page=near")).toEqual({ name: "verify", rewrite: "x", page: "near" });
  });

  test("a post by its own link with x.com swapped for our domain, in every form X uses", () => {
    const post = (id: string, user: string | null): Route => ({ name: "post", id, user, apiPath: user ? `${user}/status/${id}` : id });
    expect(matchRoute("/jack/status/20")).toEqual(post("20", "jack"));
    expect(matchRoute("https://isitpriced.in/jack/status/20?s=20&t=abc")).toEqual(post("20", "jack"));
    expect(matchRoute("/elonmusk/status/1585841080431321088/photo/1")).toEqual(post("1585841080431321088", "elonmusk"));
    expect(matchRoute("/jack/statuses/20")).toEqual(post("20", "jack"));
    expect(matchRoute("/i/status/20")).toEqual(post("20", null));
    expect(matchRoute("/i/web/status/20")).toEqual(post("20", null));
    expect(matchRoute("/x/20")).toEqual(post("20", null));
    expect(matchRoute("/#!/jack/status/20")).toEqual(post("20", "jack"));
    expect(matchRoute("//jack//status//20")).toEqual(post("20", "jack"));
  });

  test("everything else is a designed not-found, with the reason", () => {
    for (const p of ["/p/Bad_Slug", "/p", "/c/abc", "/x/abc", "/x/0", "/x/18446744073709551616", "/a_handle_far_too_long/status/20", "/jack/status/20/likes", "/p/status/20", "/nope", "/agents/extra"]) {
      const r = matchRoute(p);
      expect(r.name, p).toBe("not_found");
      expect((r as any).reason.length).toBeGreaterThan(5);
    }
  });

  test("routes round-trip through their paths", () => {
    for (const p of ["/", "/p/near", "/c/7", "/agents", "/audit", "/x/20", "/jack/status/20", "/verify"]) expect(pathOf(matchRoute(p))).toBe(p);
  });

  test("the history router: go, back and forward, and same-origin link clicks", () => {
    const listeners: Record<string, (() => void)[]> = {};
    const loc = { pathname: "/", search: "", hash: "" };
    const w = {
      location: loc,
      history: { pushState: (_s: any, _t: string, p: string) => { loc.pathname = p; }, replaceState: (_s: any, _t: string, p: string) => { loc.pathname = p; } },
      addEventListener: (n: string, fn: () => void) => { (listeners[n] ||= []).push(fn); },
    } as unknown as Window;
    const r = new Router(w);
    const seen: string[] = [];
    r.subscribe((x) => seen.push(x.name));
    r.go("/p/near");
    expect(r.route).toEqual({ name: "page", slug: "near" });
    loc.pathname = "/agents";
    listeners.popstate.forEach((fn) => fn());
    expect(r.route.name).toBe("agents");
    expect(seen).toEqual(["page", "agents"]);

    let clickHandler: (e: any) => void = () => {};
    r.intercept({ addEventListener: (_n: string, fn: any) => { clickHandler = fn; } } as any);
    let prevented = false;
    const a = { getAttribute: () => "/c/3", hasAttribute: () => false, target: "" };
    clickHandler({ defaultPrevented: false, button: 0, target: { closest: () => a }, preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(r.route).toEqual({ name: "claim", id: 3 });
    const ext = { getAttribute: () => "https://x.com/jack", hasAttribute: () => false, target: "" };
    prevented = false;
    clickHandler({ defaultPrevented: false, button: 0, target: { closest: () => ext }, preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(false);
  });
});
