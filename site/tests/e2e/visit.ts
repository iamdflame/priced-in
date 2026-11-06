// What a visitor's browser really shows, as data: every element's computed style and box, keyed by its
// place in the page, so a page reached by clicking can be held against a fresh load of the same URL.
import type { Browser, BrowserContext, Page } from "@playwright/test";

export interface Shot { path: string; style: string[]; box: [number, number, number, number] }

const STYLE = [
  "display", "position", "flex-direction", "flex-wrap", "justify-content", "align-items", "grid-template-columns", "row-gap", "column-gap",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "white-space", "color", "background-color",
  "border-top-left-radius", "box-shadow", "overflow-x", "overflow-y", "opacity", "max-width", "min-height",
];

/** The page once it has stopped moving: nothing loading, no skeletons, the pointer out of the way. */
export async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("[aria-busy='true'], .sk"), undefined, { timeout: 20_000 }).catch(() => {});
}

export async function shoot(page: Page): Promise<Shot[]> {
  await settle(page);
  return page.evaluate((props) => {
    const key = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        let i = 0;
        for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === e.tagName) i++;
        const cls = typeof e.className === "string" ? e.className.trim().replace(/\s+/g, ".") : "";
        parts.unshift(`${e.tagName.toLowerCase()}${i ? `:${i}` : ""}${cls ? `.${cls}` : ""}`);
      }
      return parts.join(" > ");
    };
    const out: { path: string; style: string[]; box: [number, number, number, number] }[] = [];
    for (const el of document.querySelectorAll("main, main *, header.nav, header.nav *, .pbar, .pbar *, .pnav, .pnav *, .foot, .foot *")) {
      // the live strip and the charts redraw themselves; a countdown changes its own width
      if (el.closest("svg, .ticker, .chartwrap, time, .when, [data-live]")) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push({ path: key(el), style: props.map((p) => cs.getPropertyValue(p)), box: [r.x + scrollX, r.y + scrollY, r.width, r.height] });
    }
    return out;
  }, STYLE);
}

/** Every difference between what the visitor got by clicking and what a fresh load gives. */
export function differences(walked: Shot[], fresh: Shot[]): string[] {
  const byPath = new Map(fresh.map((s) => [s.path, s]));
  const out: string[] = [];
  for (const a of walked) {
    const b = byPath.get(a.path);
    if (!b) continue;
    const name = a.path.split(" > ").slice(-2).join(" > ");
    a.style.forEach((v, i) => { if (v !== b.style[i]) out.push(`${name}: ${STYLE[i]} is "${v}", a fresh load says "${b.style[i]}"`); });
    if (a.box[2] !== b.box[2] && Math.abs(a.box[2] - b.box[2]) > 1.5) out.push(`${name}: ${a.box[2]} px wide, a fresh load says ${b.box[2]}`);
    if (a.box[3] !== b.box[3] && Math.abs(a.box[3] - b.box[3]) > 1.5) out.push(`${name}: ${a.box[3]} px tall, a fresh load says ${b.box[3]}`);
  }
  return out;
}

/** A second tab in the same browser, same size and same saved choices: the fresh load to compare with. */
export async function freshShot(context: BrowserContext, page: Page): Promise<Shot[]> {
  const tab = await context.newPage();
  await tab.setViewportSize(page.viewportSize()!);
  await tab.goto(page.url());
  const shots = await shoot(tab);
  await tab.close();
  return shots;
}

export type { Browser };
