// Copied unchanged from web/src/core/router.ts (the proven engine). Fix bugs there first, then copy.
// Routes. A post opens by its own link with x.com changed to our domain, so /:user/status/:id
// (and X's /i/status/:id, /i/web/status/:id, trailing /photo/1 and /video/1) is a post page,
// read through services/api's GET /post/:id. /x/:id is the short form.

export type Route =
  | { name: "home" }
  | { name: "page"; slug: string }
  | { name: "post"; id: string; user: string | null; apiPath: string }
  | { name: "claim"; id: number }
  | { name: "agents" }
  | { name: "verify"; rewrite: string | null; page: string | null }
  | { name: "audit" }
  | { name: "not_found"; path: string; reason: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const POST_ID = /^\d{1,20}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const RESERVED = new Set(["p", "c", "x", "i", "agents", "verify", "audit", "assets", "api"]);
const U64_MAX = 18446744073709551615n;

const notFound = (path: string, reason = "No page at this address.") => ({ name: "not_found" as const, path, reason });

export function matchRoute(input: string): Route {
  let url: URL;
  // a path that starts with // would parse as a host: collapse it first
  const raw = input.startsWith("//") ? input.replace(/^\/+/, "/") : input;
  try { url = new URL(raw, "http://local"); } catch { return notFound(input); }
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  // a legacy #!/user/status/id link
  if (path === "/" && url.hash.startsWith("#!/")) path = url.hash.slice(2).replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean);

  if (seg.length === 0) return { name: "home" };
  const [a, b, c, d] = seg;

  if (a === "p") {
    if (seg.length === 2 && SLUG.test(b)) return { name: "page", slug: b };
    return notFound(path, "Page names are lowercase letters, digits and dashes.");
  }
  if (a === "c") {
    if (seg.length === 2 && /^\d{1,15}$/.test(b)) return { name: "claim", id: Number(b) };
    return notFound(path, "Claim numbers are whole numbers.");
  }
  if (a === "x") {
    if (seg.length === 2 && validPostId(b)) return { name: "post", id: b, user: null, apiPath: b };
    return notFound(path, "That isn't a post number.");
  }
  if (a === "agents" && seg.length === 1) return { name: "agents" };
  if (a === "audit" && seg.length === 1) return { name: "audit" };
  if (a === "verify" && seg.length <= 2) return { name: "verify", rewrite: b ?? url.searchParams.get("rewrite"), page: url.searchParams.get("page") };

  // /i/status/:id and /i/web/status/:id
  if (a === "i") {
    const id = b === "status" ? c : b === "web" && c === "status" ? d : undefined;
    const rest = b === "status" ? seg.slice(3) : seg.slice(4);
    if (id && validPostId(id) && mediaTail(rest)) return { name: "post", id, user: null, apiPath: id };
    return notFound(path, "That isn't a link to a post.");
  }
  // /:user/status/:id (also /statuses/), optionally with /photo/1 or /video/1
  if ((b === "status" || b === "statuses") && c && !RESERVED.has(a)) {
    if (HANDLE.test(a) && validPostId(c) && mediaTail(seg.slice(3))) return { name: "post", id: c, user: a, apiPath: `${a}/status/${c}` };
    return notFound(path, "That isn't a link to a post.");
  }
  return notFound(path);
}

function validPostId(s: string | undefined): boolean {
  return Boolean(s && POST_ID.test(s) && BigInt(s) > 0n && BigInt(s) <= U64_MAX);
}

function mediaTail(rest: string[]): boolean {
  if (rest.length === 0) return true;
  return rest.length === 2 && (rest[0] === "photo" || rest[0] === "video") && /^\d{1,2}$/.test(rest[1]);
}

/** The canonical path of a route. */
export function pathOf(r: Route): string {
  switch (r.name) {
    case "home": return "/";
    case "page": return `/p/${r.slug}`;
    case "post": return r.user ? `/${r.user}/status/${r.id}` : `/x/${r.id}`;
    case "claim": return `/c/${r.id}`;
    case "agents": return "/agents";
    case "verify": return r.rewrite ? `/verify/${encodeURIComponent(r.rewrite)}${r.page ? `?page=${encodeURIComponent(r.page)}` : ""}` : "/verify";
    case "audit": return "/audit";
    case "not_found": return r.path;
  }
}

/** A tiny history router: listeners hear every route change, including back and forward. */
export class Router {
  route: Route;
  private listeners = new Set<(r: Route) => void>();
  private w: Window | null;

  constructor(w: Window | null = typeof window !== "undefined" ? window : null, initial?: string) {
    this.w = w;
    this.route = matchRoute(initial ?? (w ? w.location.pathname + w.location.search + w.location.hash : "/"));
    w?.addEventListener("popstate", () => this.set(matchRoute(w.location.pathname + w.location.search + w.location.hash)));
  }

  subscribe(fn: (r: Route) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  go(path: string, { replace = false } = {}) {
    const r = matchRoute(path);
    if (this.w) this.w.history[replace ? "replaceState" : "pushState"]({}, "", path);
    this.set(r);
  }

  private set(r: Route) {
    this.route = r;
    for (const fn of this.listeners) { try { fn(r); } catch { /* keep going */ } }
  }

  /** Follow same-origin <a> clicks without reloading. */
  intercept(root: Document | HTMLElement) {
    root.addEventListener("click", (ev) => {
      const e = ev as MouseEvent;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      this.go(href);
    });
  }
}
