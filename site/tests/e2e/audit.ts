// What a person sees wrong on a screen of some width, as a list of sentences: anything past the edge,
// a header that doesn't fit, a row that fell into a column, text cut off, an image that didn't load.
import type { Page } from "@playwright/test";

/** Text meant to end in an ellipsis: live bets in a fixed strip, and a long account name. */
const MAY_TRUNCATE = ".sr-only, .tk, .tk *, .lastbets li, .proofline, .mbadge b, .mbadge small, .vcard b, .pf-hist .w span, .wmenu .a, a.fromwiki";

export async function audit(page: Page): Promise<string[]> {
  return page.evaluate((mayTruncate) => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const name = (el: Element) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}`;

    // sideways scroll, and anything past the edge that body's overflow would quietly hide
    const over = document.documentElement.scrollWidth - vw;
    if (over > 0) out.push(`the page scrolls sideways by ${over} px`);
    const scrollers = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg, script, style, dialog:not([open]), .skip") || !shown(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !scrollers(el)) { out.push(`${name(el)} runs past the edge (${Math.round(r.left)} to ${Math.round(r.right)} of ${vw})`); break; }
    }

    // the header: every piece inside the screen, none on top of another, none clipped
    for (const bar of document.querySelectorAll("header.nav .wrap, .pbar")) {
      if (!shown(bar)) continue;
      const parts = [...bar.children].filter(shown);
      const inner = parts.flatMap((p) => (p.matches(".r, .nav-actions") ? [...p.children].filter(shown) : [p]));
      inner.forEach((a, i) => {
        const ra = a.getBoundingClientRect();
        if (ra.left < -0.5 || ra.right > vw + 0.5) out.push(`header: ${name(a)} is cut off (${Math.round(ra.right)} of ${vw})`);
        if (a.scrollWidth > a.clientWidth + 1 && !a.matches("form")) out.push(`header: ${name(a)} clips its text`);
        for (const b of inner.slice(i + 1)) {
          const rb = b.getBoundingClientRect();
          if (ra.right > rb.left + 0.5 && rb.right > ra.left + 0.5 && ra.bottom > rb.top + 0.5 && rb.bottom > ra.top + 0.5) out.push(`header: ${name(a)} overlaps ${name(b)}`);
        }
      });
      const box = bar.querySelector<HTMLInputElement>(".search input");
      if (box && shown(box)) {
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = getComputedStyle(box).font;
        if (ctx.measureText(box.placeholder).width > box.clientWidth) out.push(`header: the search box cuts off "${box.placeholder}"`);
      }
      const search = bar.querySelector(".search");
      if (search && shown(search) && search.getBoundingClientRect().width < 100) out.push(`header: search is only ${Math.round(search.getBoundingClientRect().width)} px wide`);
    }

    // rows that must stay rows: at least two of their items side by side
    const rows = [".home .proof", ".bets", ".seg", ".pnav", ".foot-cols", ".kpis", ".steps3", ".judges3", ".books"];
    for (const sel of rows) {
      for (const row of document.querySelectorAll(sel)) {
        if (!shown(row)) continue;
        const kids = [...row.children].filter(shown).map((k) => k.getBoundingClientRect());
        if (kids.length < 2) continue;
        const sideBySide = kids.some((a, i) => kids.slice(i + 1).some((b) => Math.abs(a.top - b.top) < a.height / 2));
        const narrow = vw <= 760 && /steps3|judges3/.test(sel);
        if (!sideBySide && !narrow) out.push(`${sel} collapsed into a column`);
      }
    }

    // text cut off: anything that hides what it holds, unless it's meant to
    for (const el of document.querySelectorAll<HTMLElement>("main *, .foot *, .nav *, .pbar *, .pnav *")) {
      if (el.closest("svg") || el.matches(mayTruncate) || !shown(el) || !el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") continue;
      if (el.matches(".card, .feature, .phero, .panel, .art, .ticker, .pagec, .rulingp, .books, .slip")) continue; // a rounded frame's clip, not text
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${name(el)} cuts off "${el.textContent.trim().slice(0, 40)}" sideways`);
      else if (el.scrollHeight > el.clientHeight + 2 && Number(cs.getPropertyValue("-webkit-line-clamp")) > 0) out.push(`${name(el)} cuts off "${el.textContent.trim().slice(0, 40)}" at ${cs.getPropertyValue("-webkit-line-clamp")} lines`);
    }
    return [...new Set(out)];
  }, MAY_TRUNCATE);
}

/** Every image on the page, lazy ones included: scroll through once, then check each decoded. */
export async function brokenImages(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const step = innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    scrollTo(0, 0);
    const imgs = [...document.images].filter((i) => i.getBoundingClientRect().width > 0);
    await Promise.all(imgs.map((i) => (i.complete ? null : Promise.race([new Promise((r) => { i.onload = i.onerror = r; }), new Promise((r) => setTimeout(r, 6000))]))));
    return imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  });
}
