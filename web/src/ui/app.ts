// The site: the nav (logo, three plain links and the network it is on), the view for the route, and
// the verify panel with its scrim.
import type { AppState } from "../core/store";
import { h, onFrame } from "./dom";
import { markSvg, type Ctx } from "./context";
import { VerifyPanel } from "./verify";
import { AgentsView, AuditView, ClaimView, HomeView, NotFoundView, PageView, PostView, VerifyView, type View } from "./views";
import { pageTitle } from "./data";
import "./styles.css";

/** "Real USDC on NEAR", "Test money · NEAR testnet", or plainly recorded. */
function networkPill(ctx: Omit<Ctx, "openVerify">, status: LinkStatus): HTMLElement {
  if (status === "connecting") return h("span", { class: "live rec", title: "Showing the recorded page while we reach the live one" }, markSvg(0.5, 12), "Connecting to NEAR…");
  if (ctx.mode === "recorded") return h("span", { class: "live rec", title: `Recorded on ${ctx.recordedDate}: we can’t reach the live service right now` }, markSvg(0.5, 12), "Recorded", h("em", {}, " · not live"));
  return ctx.config.network === "mainnet"
    ? h("span", { class: "live" }, markSvg(1, 12), "Real USDC on NEAR")
    : h("span", { class: "live" }, markSvg(0.5, 12), "Test money", h("em", {}, " · NEAR testnet"));
}

/** What the pill says while the first health checks run, and after two fail. */
export type LinkStatus = "connecting" | "recorded" | "live";
let wired = false;
let currentRoute: () => string = () => "home";

/** Document-level wiring, once per page load: link interception and in-page anchors. */
function wire(router: Ctx["router"], route: () => () => string) {
  // in-page links on the front page scroll; from another page they go home first, then scroll
  document.addEventListener("click", (ev) => {
    const a = (ev.target as Element | null)?.closest?.("a[href^='/#']") as HTMLAnchorElement | null;
    if (!a || (ev as MouseEvent).button !== 0) return;
    const id = a.getAttribute("href")!.slice(2);
    ev.preventDefault();
    ev.stopPropagation();
    const go = () => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (route()() === "home") { history.replaceState({}, "", `/#${id}`); go(); }
    else router.go(`/#${id}`);
  }, true);
  router.intercept(document);
}

export function mountApp(root: HTMLElement, ctx: Omit<Ctx, "openVerify">, status: LinkStatus = ctx.mode === "live" ? "live" : "recorded"): { setStatus(s: LinkStatus): void } {
  const panel = new VerifyPanel(ctx as Ctx);
  const full: Ctx = { ...ctx, openVerify: (page, id, opener) => void panel.open(page, id, opener) };
  const nav = h("nav", { class: "topnav wrap", "aria-label": "Site" },
    h("a", { class: "logo", href: "/", "aria-label": "Priced In, the front page" }, markSvg(0.5, 22), h("span", { "aria-hidden": "true" }, "Priced ", h("b", {}, "In"))),
    h("ul", { class: "links" },
      h("li", {}, h("a", { href: "/#how" }, "How it works")),
      h("li", {}, h("a", { href: "/#agents" }, "The AI agents")),
      h("li", {}, h("a", { href: "/#check" }, "Check our work")),
      h("li", { class: "keep", id: "netpill" }, networkPill(ctx, status))));
  const main = h("main", { id: "main", tabindex: "-1" });
  root.replaceChildren(h("a", { class: "skip", href: "#main" }, "Skip to the page"), h("header", {}, nav), main, panel.scrim, panel.el);
  if (ctx.card) document.body.classList.add("card-mode");
  currentRoute = () => ctx.store.state.route.name;
  if (!wired) { wired = true; wire(ctx.router, () => currentRoute); }

  let view: View | null = null;
  let route: AppState["route"] | null = null;
  let kind = "";
  const render = (st: AppState) => {
    full.agents.learnFrom(st);
    if (st.route !== route || st.page.kind !== kind) {
      const first = route === null;
      route = st.route;
      kind = st.page.kind;
      view?.destroy();
      view = make(st, full);
      view.el.setAttribute("data-page", st.page.kind);
      main.replaceChildren(view.el);
      document.title = title(st);
      if (!first && !location.hash) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    }
    view!.update(st);
  };
  onFrame(ctx.store, render);
  render(ctx.store.state);
  return { setStatus: (s) => nav.querySelector("#netpill")?.replaceChildren(networkPill(ctx, s)) };
}

function make(st: AppState, ctx: Ctx): View {
  switch (st.page.kind) {
    case "home": return new HomeView(ctx);
    case "page": return new PageView(ctx);
    case "claim": return new ClaimView(ctx);
    case "post": return new PostView(ctx);
    case "agents": return new AgentsView(ctx);
    case "verify": return new VerifyView(ctx);
    case "audit": return new AuditView(ctx);
    case "paste": return new PageView(ctx);
    default: return new NotFoundView(ctx);
  }
}

function title(st: AppState): string {
  const r = st.route;
  switch (r.name) {
    case "home": return "Priced In: every sentence here has odds of being true";
    case "page": return `${pageTitle(r.slug)}, with the odds on every sentence · Priced In`;
    case "post": return "A post, with the odds on every line · Priced In";
    case "claim": return `Sentence ${r.id}, with its odds · Priced In`;
    case "agents": return "The AI agents · Priced In";
    case "verify": return "Check a signature · Priced In";
    case "audit": return "The audit · Priced In";
    default: return "Nothing here to price · Priced In";
  }
}
