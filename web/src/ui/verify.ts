// "signed in a TEE · verify": each check from core/verify.ts, run in this browser against the
// rewrite's own bytes and the market contract, with pass or fail, and the anchor transaction.
import type { Rewrite } from "../core/api";
import type { AppState } from "../core/store";
import { explorerTx, h, type Child } from "./dom";
import type { Ctx } from "./context";

const WORD = { pass: "Pass", fail: "Fail", skip: "Skip" } as const;
const short = (x: string | null | undefined, a = 10, b = 6) => (x ? (x.length > a + b + 1 ? `${x.slice(0, a)}…${x.slice(-b)}` : x) : "none");

/** The checks, as a list, from the store's verify state. */
export function verifyBody(st: AppState, ctx: Ctx, rec: Rewrite | null): Child[] {
  const v = st.page.verify;
  if (v.running) return [h("p", { class: "loading" }, "Checking the bytes, the hashes, the signature and the market's registered key, here in your browser…")];
  if (v.error) return [h("p", { class: "msg red" }, v.error)];
  const r = v.result;
  if (!r) return [];
  const anchor = r.steps.find((x) => x.id === "anchor");
  const tx = anchor?.status === "pass" ? /in ([1-9A-HJ-NP-Za-km-z]{32,50})/.exec(anchor.detail)?.[1] ?? null : null;
  const firstFail = r.steps.find((x) => x.status === "fail");
  const p = rec?.provenance;
  return [
    h("p", { class: `verdict${r.ok ? "" : " fail"}`, "data-verified": r.ok ? "1" : "0" }, r.ok ? `Every check passed in your browser. Signed by ${r.model}.` : `Not verified: ${firstFail ? firstFail.label.toLowerCase() : "incomplete"}.`),
    h("ol", { class: "checks" }, ...r.steps.map((x) => h("li", { "data-step": x.id, "data-status": x.status },
      h("span", { class: `st ${x.status}` }, WORD[x.status]),
      h("span", {}, x.label),
      h("span", { class: "d" }, x.detail)))),
    h("dl", {},
      h("dt", {}, "Model"), h("dd", {}, r.model ?? "none"),
      p ? h("dt", {}, "Signature") : null, p ? h("dd", { class: "mono" }, short(p.signature, 16, 8)) : null,
      p ? h("dt", {}, "Signing key") : null, p ? h("dd", { class: "mono" }, short(p.signing_address, 16, 8)) : null,
      h("dt", {}, "Checked by the NEAR contract"),
      h("dd", {}, tx ? h("a", { href: explorerTx(ctx.config.network, tx), target: "_blank", rel: "noopener" }, `anchor_rewrite, transaction ${short(tx, 8, 6)}`) : anchor ? anchor.detail : "Not checked."),
    ),
  ];
}

export class VerifyPanel {
  readonly el = h("div", { class: "panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "vp-title", hidden: true, tabindex: "-1" });
  private body = h("div");
  private opener: HTMLElement | null = null;
  private rec: Rewrite | null = null;
  private unsub: (() => void) | null = null;
  private key = "";

  constructor(private ctx: Ctx) {
    this.el.append(
      h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => this.close() }, "×"),
      h("h2", { id: "vp-title" }, "Signed in a TEE"),
      h("p", { class: "lede" }, "The model's rewrite came with its exact request and response, their hashes and an ed25519 signature. Your browser checks each one, and asks the market contract for the model's registered key."),
      ...(ctx.mode === "recorded" ? [h("p", { class: "lede" }, "This recorded rewrite was signed by a test key standing in for NEAR AI Cloud's enclave; that key is the one registered on the testnet market.")] : []),
      this.body,
    );
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.el.hidden) this.close(); });
  }

  async open(page: string, rewriteId: string, opener?: HTMLElement) {
    this.opener = opener ?? null;
    this.el.hidden = false;
    this.el.focus();
    this.rec = null;
    this.key = "";
    this.unsub?.();
    this.unsub = this.ctx.store.subscribe((st) => this.render(st));
    void this.ctx.api.rewriteById(page, rewriteId).then((r) => { if (r.ok) { this.rec = r.value; this.key = ""; this.render(this.ctx.store.state); } });
    const run = this.ctx.store.verify(page, rewriteId);
    this.render(this.ctx.store.state);
    await run;
  }

  close() {
    this.el.hidden = true;
    this.unsub?.();
    this.unsub = null;
    this.opener?.focus();
  }

  private render(st: AppState) {
    const v = st.page.verify;
    const k = JSON.stringify([v.running, v.error, v.result?.steps.map((x) => x.status), !!this.rec]);
    if (k === this.key) return;
    this.key = k;
    this.body.replaceChildren(...(verifyBody(st, this.ctx, this.rec).filter(Boolean) as Node[]));
  }
}
