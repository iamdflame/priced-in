// Why a page could look right when loaded and wrong after a click: route stylesheets stay live after
// client-side navigation, so a class defined in two of them breaks whichever page loses the cascade.
// The home stats row (.proof) collapsed into a column this way after visiting /trust. These checks hold
// the rule for good: a route's sheet can't reach another route, and no two sheets define one selector.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/styles");

/** Loaded on every page, in a fixed order, and meant to be shared. */
const SHARED = new Set(["tokens.css", "base.css", "shell.css", "instruments.css", "cards.css", "kit.css", "feedback.css", "today.css"]);
/** Each route's sheet and the class on its <main>. */
const SCOPED: Record<string, string> = { "home.css": "home", "market.css": "market", "receipt.css": "market", "pages.css": "pg" };

interface Rule { selector: string; scope: string | null }
interface Sheet { rules: Rule[]; keyframes: string[] }

/** A small reader for our own CSS: each selector, with the scope block it sits in, and the keyframes. */
function parse(css: string): Sheet {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const keyframes: string[] = [];
  const stack: { kind: "scope" | "at" | "rule" | "skip"; text: string }[] = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      const text = buf.trim();
      buf = "";
      if (/^@(-webkit-)?keyframes\b/.test(text)) { keyframes.push(text.split(/\s+/)[1]); stack.push({ kind: "skip", text }); }
      else if (stack.some((s) => s.kind === "skip")) stack.push({ kind: "skip", text });
      else if (text.startsWith("@")) stack.push({ kind: "at", text });
      else if (/^:where\(\.[\w-]+\)$/.test(text)) stack.push({ kind: "scope", text });
      else {
        const scope = stack.find((s) => s.kind === "scope")?.text ?? null;
        for (const selector of text.split(/,(?![^(]*\))/)) rules.push({ selector: selector.trim(), scope });
        stack.push({ kind: "rule", text });
      }
    } else if (ch === "}") { stack.pop(); buf = ""; }
    else if (ch === ";") buf = "";
    else buf += ch;
  }
  return { rules, keyframes };
}

/** The selector's first compound with its states stripped: .proof, .bet.yes, a.q. Under a theme, what follows it. */
function head(selector: string): string {
  const s = selector.replace(/^\[data-theme='\w+'\]\s+(&\s+)?/, "").replace(/^&/, "");
  return s.trim().split(/[\s>+~]+/)[0].replace(/::?[\w-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "");
}

const sheets = new Map(readdirSync(DIR).filter((f) => f.endsWith(".css")).map((f) => [f, parse(readFileSync(join(DIR, f), "utf8"))]));
/** market.css and receipt.css are one route: they load and scope together. */
const owner = (file: string) => SCOPED[file] ?? file;

describe("the route stylesheets", () => {
  it("every sheet is accounted for: shared, scoped to a route, or money's own prefixes", () => {
    for (const f of sheets.keys()) expect(SHARED.has(f) || f in SCOPED || f === "money.css", `${f}: say whether it is shared or which route owns it`).toBe(true);
  });

  for (const [file, root] of Object.entries(SCOPED)) {
    it(`${file}: every rule sits inside .${root}, so it can't reach another route`, () => {
      const loose = sheets.get(file)!.rules.filter((r) => r.scope !== `:where(.${root})` && !new RegExp(`^\\.${root}\\b`).test(r.selector));
      expect(loose.map((r) => r.selector)).toEqual([]);
    });
  }

  it("money.css: every class starts with a money prefix, because its sheets open outside any route", () => {
    const loose = sheets.get("money.css")!.rules.filter((r) => !/^\.(m-|w(btn|wrap|menu|entry)\b|pf-|legal\b|linkbtn\b|score-note\b)/.test(r.selector));
    expect(loose.map((r) => r.selector)).toEqual([]);
  });

  it("no selector is defined in two stylesheets, outside the shared ones", () => {
    const owners = new Map<string, Set<string>>();
    for (const [file, { rules }] of sheets) {
      for (const r of rules) {
        // a rule straight under the route's root belongs to the root
        if (/^[>+~]/.test(r.selector) || new RegExp(`^\\.${SCOPED[file]}\\b`).test(r.selector)) continue;
        const key = head(r.selector);
        if (!key.includes(".")) continue; // element selectors live in base.css
        (owners.get(key) ?? owners.set(key, new Set()).get(key)!).add(file);
      }
    }
    const twice = [...owners]
      .filter(([, files]) => [...files].some((f) => !SHARED.has(f)) && new Set([...files].map(owner)).size > 1)
      .map(([key, files]) => `${key}: ${[...files].join(", ")}`);
    expect(twice).toEqual([]);
  });

  it("no @keyframes name is defined in two sheets: the last one loaded would win everywhere", () => {
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const [file, { keyframes }] of sheets) {
      for (const k of keyframes) {
        if (seen.has(k) && seen.get(k) !== file) twice.push(`${k}: ${seen.get(k)}, ${file}`);
        seen.set(k, file);
      }
    }
    expect(twice).toEqual([]);
  });

  it("the reader catches the bug it was written for", () => {
    const home = parse(".proof { display: flex; }");
    const pages = parse(":where(.pg) {\n.proof { display: grid; }\n}");
    expect(head(home.rules[0].selector)).toBe(head(pages.rules[0].selector));
    expect(home.rules[0].scope).toBeNull();
    expect(pages.rules[0].scope).toBe(":where(.pg)");
    expect(head("[data-theme='light'] & .code .k")).toBe(".code");
    expect(head("a.q:hover")).toBe("a.q");
    expect(head(".bet.yes[aria-pressed='true']")).toBe(".bet.yes");
    expect(parse("@media (max-width: 760px) { .a, .b { color: red; } }").rules.map((r) => r.selector)).toEqual([".a", ".b"]);
  });
});
