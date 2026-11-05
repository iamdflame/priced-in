// The site: the header (the wordmark and one line), the view for the route, and the verify panel.
import type { AppState } from "../core/store";
import { h, onFrame } from "./dom";
import { markSvg, type Ctx } from "./context";
import { VerifyPanel } from "./verify";
import { AgentsView, AuditView, ClaimView, HomeView, NotFoundView, PageView, PostView, VerifyView, type View } from "./views";
import { PLAIN, pageTitle } from "./data";
import "./styles.css";

export function mountApp(root: HTMLElement, ctx: Omit<Ctx, "openVerify">) {
  const panel = new VerifyPanel(ctx as Ctx);
  const full: Ctx = { ...ctx, openVerify: (page, id, opener) => void panel.open(page, id, opener) };
  const nav = h("ul", { class: "nav" },
    h("li", {}, h("a", { href: "/agents" }, "Agents")),
    h("li", {}, h("a", { href: "/audit" }, "Audit")),
    h("li", {}, h("a", { href: "/verify" }, "Verify")));
  const head = h("header", { class: "head" },
    h("a", { class: "mark", href: "/", "aria-label": "Priced In, the front page" }, markSvg(0.5, 22), h("span", { class: "wm", "aria-hidden": "true" }, "Priced ", h("b", {}, "In"))),
    h("p", { class: "tagline" }, PLAIN),
    h("nav", { class: "site-nav", "aria-label": "Site" }, nav));
  const main = h("main", { id: "main", tabindex: "-1" });
  const title = h("h1", { class: "vh" }, "Priced In: every sentence, priced in.");
  root.replaceChildren(h("a", { class: "skip", href: "#main" }, "Skip to the sentence"), head, title, main, panel.el);
  if (ctx.card) document.body.classList.add("card-mode");
  ctx.router.intercept(document);

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
      head.classList.toggle("hero-mode", ["home", "page", "claim", "post"].includes(st.page.kind));
      main.replaceChildren(view.el);
      for (const a of nav.querySelectorAll("a")) a.toggleAttribute("aria-current", a.getAttribute("href") === `/${st.route.name}`);
      if (a11yTitle(st)) document.title = a11yTitle(st)!;
      if (!first) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    }
    view!.update(st);
  };
  onFrame(ctx.store, render);
  render(ctx.store.state);
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

function a11yTitle(st: AppState): string | null {
  const r = st.route;
  switch (r.name) {
    case "home": return "Priced In: every sentence, priced in";
    case "page": return `${pageTitle(r.slug)}, priced in`;
    case "post": return "A post, priced in";
    case "claim": return `Sentence ${r.id}, priced in`;
    case "agents": return "The agents of Priced In";
    case "verify": return "Verify a rewrite, Priced In";
    case "audit": return "The audit, Priced In";
    default: return "Nothing here to price";
  }
}
