// TEMPORARY, UNSTYLED SHELL. It exists so every engine flow can be exercised end to end
// before the real design lands; the design replaces this folder and keeps src/core.
// All text from the API (posts, pastes, rationales) is set with textContent, never as HTML.

import type { Store, AppState, Sentence } from "../core/store";
import { priceable, DOUBT_ORDER } from "../core/store";
import type { Router } from "../core/router";

type Child = Node | string | number | null | undefined | false;

function h(tag: string, attrs: Record<string, string | number | boolean | ((e: Event) => void) | undefined> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "object" ? c : String(c));
  return el;
}

const pct = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(1)}%`);
const usd = (x: number) => `$${x.toFixed(2)}`;

export function mountShell(root: HTMLElement, store: Store, router: Router) {
  const header = h("header", {},
    h("p", {}, h("strong", {}, "Priced In"), " — engine shell (temporary, unstyled). ",
      h("a", { href: "/" }, "home"), " · ", h("a", { href: "/agents" }, "agents"), " · ", h("a", { href: "/verify" }, "verify"), " · ", h("a", { href: "/audit" }, "audit")),
    pasteForm(store),
    h("p", { id: "status" }),
  );
  const main = h("main", { id: "app" });
  root.replaceChildren(header, main);
  router.intercept(document);
  const render = (s: AppState) => {
    header.querySelector("#status")!.replaceChildren(statusLine(s));
    main.replaceChildren(view(s, store));
  };
  store.subscribe(render);
  render(store.state);
}

function pasteForm(store: Store) {
  const ta = h("textarea", { id: "paste", rows: 3, cols: 80, placeholder: "Paste a paragraph or a post's text" }) as HTMLTextAreaElement;
  return h("form", { onsubmit: (e: Event) => { e.preventDefault(); if (ta.value.trim()) void store.paste(ta.value); } }, ta, h("br"), h("button", { type: "submit" }, "Price it"));
}

function statusLine(s: AppState) {
  const lane = s.lane.state === "ready" ? `lane ready (${s.lane.session.trader.slice(0, 22)}…)` : s.lane.state === "failed" ? `lane: ${s.lane.failure.message}` : s.lane.state === "preparing" ? "preparing your $1…" : "lane idle";
  return h("small", { "data-live": s.live, "data-lane": s.lane.state }, `live: ${s.live} · ${lane} · market ${s.marketId ?? "?"}`);
}

function view(s: AppState, store: Store): Node {
  const p = s.page;
  const box = h("section", { "data-page": p.kind, "data-loading": p.loading ? "1" : "0" });
  if (p.loading) { box.append(h("p", {}, "Loading…")); return box; }
  if (p.error) box.append(h("p", { "data-error": p.error.state }, `${p.error.message}`, p.error.retryable ? " (will retry)" : ""));
  switch (p.kind) {
    case "home":
      box.append(h("h1", {}, "Pages"), h("ul", {}, ...p.pages.map((x) => h("li", {}, h("a", { href: `/p/${x.slug}` }, x.slug), ` — ${x.claims} sentences, ${x.trades} trades`))));
      if (p.slug) box.append(h("h2", {}, `Live: ${p.slug}`), sentences(s, store));
      box.append(h("h2", {}, "Ticker"), h("ol", {}, ...s.ticker.slice(0, 10).map((m) => h("li", {}, `${m.mine ? "you" : m.trader} ${m.side} ${usd(m.amountUsd)} → ${pct(m.priceAfter)}`))));
      break;
    case "page": case "claim": case "paste":
      box.append(h("h1", {}, p.slug ?? "Pasted text"));
      if (p.message) box.append(h("p", { "data-message": "1" }, p.message));
      box.append(sentences(s, store), rationales(s));
      break;
    case "post":
      if (p.gone) { box.append(h("p", { "data-gone": p.gone.reason }, p.gone.message)); break; }
      if (p.post) box.append(h("p", {}, `${p.post.authorName} (@${p.post.handle}) · `, h("a", { href: p.post.url, target: "_blank", rel: "noopener" }, "original")));
      for (const n of p.notices) box.append(h("p", { "data-notice": n.code }, n.message));
      if (p.message) box.append(h("p", {}, p.message));
      box.append(sentences(s, store), rationales(s));
      break;
    case "agents":
      box.append(h("h1", {}, "Agents"), h("pre", {}, JSON.stringify(p.aiStatus?.agents ?? null, null, 1)), rationales(s));
      break;
    case "verify":
      box.append(h("h1", {}, "Verify a rewrite"));
      if (!p.verify.rewriteId) box.append(h("p", {}, "Open a rewrite's chip to verify it here."));
      if (p.verify.running) box.append(h("p", {}, "Verifying…"));
      if (p.verify.error) box.append(h("p", { "data-error": "verify" }, p.verify.error));
      if (p.verify.result) {
        const r = p.verify.result;
        box.append(h("p", { "data-verified": r.ok ? "1" : "0" }, r.chip), h("ol", {}, ...r.steps.map((x) => h("li", { "data-step": x.id, "data-status": x.status }, `[${x.status}] ${x.label}: ${x.detail}`))));
      }
      break;
    case "audit":
      box.append(h("h1", {}, "Audit"), h("pre", {}, JSON.stringify(p.audit, null, 1)));
      break;
    case "not_found":
      box.append(h("h1", {}, "Not found"), h("p", {}, p.message ?? ""));
      break;
  }
  return box;
}

function sentences(s: AppState, store: Store) {
  const list = h("ol", { "data-sentences": "1" });
  for (const x of s.page.sentences) list.append(sentence(x, s, store));
  return list;
}

function sentence(x: Sentence, s: AppState, store: Store) {
  const price = store.derived.price(x);
  const cost = store.derived.costToMove10(x);
  const selected = s.selected === x.key;
  const li = h("li", { "data-sentence": x.key, "data-claim": x.claimId ?? "", "data-price": price ?? "", "data-ink": store.derived.ink(x) ?? "", "data-status": x.status },
    h("span", { onclick: () => store.select(selected ? null : x.key), role: "button", tabindex: 0 }, x.text),
    ` [${x.status}${price !== null ? ` ${pct(price)}` : ""}${x.optimisticPpm !== null ? " (quote)" : ""}]`,
    cost ? ` costs ${usd(cost.downUsd)} to move 10 points down, ${usd(cost.upUsd)} up` : "",
    x.reason ? ` — ${x.reason}` : "",
    x.source ? h("span", {}, " source: ", h("a", { href: x.source.url, target: "_blank", rel: "noopener nofollow" }, x.source.url)) : "",
    x.rewrite ? h("span", {}, " ", x.rewrite.signed && s.page.slug
      ? h("a", { href: `/verify/${encodeURIComponent(x.rewrite.id)}?page=${encodeURIComponent(s.page.slug)}`, "data-chip": "signed" }, `signed by ${x.rewrite.model} in a TEE · verify`)
      : h("em", { "data-chip": x.rewrite.status }, x.rewrite.status === "template" ? "unsigned (template)" : x.rewrite.status)) : "",
  );
  if (selected) li.append(doubtPanel(x, s, store));
  return li;
}

function doubtPanel(x: Sentence, s: AppState, store: Store) {
  const d = s.doubt;
  const mine = d.ctx?.key === x.key;
  const preparing = s.lane.state === "preparing" || (mine && d.ctx?.waitingFor === "lane");
  const label = preparing && mine ? "Preparing your $1…" : "Doubt it · $1";
  const panel = h("div", { "data-doubt-panel": x.key },
    priceable(x) ? h("button", { "data-doubt": x.key, onclick: () => void store.doubt(x.key) }, label) : h("em", {}, x.reason ?? "Not priced."),
  );
  const q = store.derived.quote(x);
  if (q && priceable(x)) panel.append(h("small", {}, ` $1 moves it from ${pct(q.priceBefore)} to ${pct(q.priceAfter)}`));
  if (mine) {
    panel.append(h("p", { id: "doubt-state", "data-stage": d.stage }, `stage: ${d.stage} (${DOUBT_ORDER.filter((st) => d.ctx?.t[st] !== undefined).join(" → ")})`));
    if (d.ctx?.txHash) panel.append(h("p", {}, `tx ${d.ctx.txHash}`));
    if (d.ctx?.finalNote) panel.append(h("p", {}, d.ctx.finalNote));
    if (d.failure) panel.append(h("p", { "data-failure": d.failure.reason }, d.failure.message, d.failure.readOnly ? " (prices still update live)" : ""));
    if (d.ctx?.answer) panel.append(h("p", { "data-answer": "1" }, `${d.ctx.answer.agent}: ${d.ctx.answer.text} — `, d.ctx.answer.source_url ? h("a", { href: d.ctx.answer.source_url, target: "_blank", rel: "noopener nofollow" }, "source") : "no source"));
    if (d.ctx?.rewrite?.diff) panel.append(h("p", { "data-diff": "1" }, ...d.ctx.rewrite.diff.map((op) => op.op === "eq" ? op.text : h(op.op === "ins" ? "ins" : "del", {}, op.text))));
  }
  return panel;
}

function rationales(s: AppState) {
  if (!s.page.rationales.length) return h("span");
  return h("div", {}, h("h3", {}, "Agents"), h("ul", {}, ...s.page.rationales.slice(0, 10).map((r) => h("li", {}, `${r.agent} (house) on #${r.claim_id}: ${r.text}. ${r.rationale} `, r.source_url ? h("a", { href: r.source_url, target: "_blank", rel: "noopener nofollow" }, "source") : ""))));
}
