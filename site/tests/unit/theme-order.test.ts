// The default theme's block carries :root, which ties [data-theme] on specificity, so the toggle's block must
// come after it or the toggle changes the attribute and nothing else. It shipped that way once, for one build.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/styles/tokens.css", "utf8");

describe("the theme tokens", () => {
  it("write the default theme first, so the dark toggle wins on <html>", () => {
    const light = css.indexOf(':root, [data-theme="light"]');
    const dark = css.indexOf('[data-theme="dark"] {');
    expect(light).toBeGreaterThanOrEqual(0);
    expect(dark).toBeGreaterThan(light);
  });
});
