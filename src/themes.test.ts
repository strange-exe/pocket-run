/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILT_IN, contrast, parseThemeFile, POCKET, readable, themeTemplate, TOKENS, type Colors } from "./themes";

const TEXT = ["ink", "muted", "ok", "err", "warn", "syn-keyword", "syn-string", "syn-number", "syn-comment", "syn-def"] as const;
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

function expectReadable(colors: Colors) {
  for (const t of TEXT) {
    expect(contrast(colors[t], colors.sheet), `${t} on sheet`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors[t], colors.bar), `${t} on bar`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(colors["on-accent"], colors.accent), "Run button text").toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.accent, colors.sheet), "accent against the page").toBeGreaterThanOrEqual(3);
}

describe("built-in themes", () => {
  it.each(BUILT_IN.filter((t) => t.colors).map((t) => [t.name, t] as const))("%s is readable after the guard", (_, theme) => {
    expectReadable(readable(theme.colors!).colors);
  });

  it.each(["light", "dark"] as const)("Pocket Run %s is readable as designed (no adjustment needed)", (scheme) => {
    const { colors, adjusted } = readable(POCKET[scheme]);
    expect(adjusted).toEqual([]);
    expectReadable(colors);
  });

  it("Pocket Run's colours in themes.ts match tokens.css", () => {
    const css = readFileSync("src/tokens.css", "utf8");
    const block = (selector: string) => css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    for (const [scheme, selector] of [["light", ":root {"], ["dark", ':root[data-theme="dark"] {']] as const) {
      for (const t of TOKENS) expect(block(selector), `${scheme} --${t}`).toContain(`--${t}: ${POCKET[scheme][t]};`);
    }
  });

  it("the guard keeps a theme's hue when it lifts a colour", () => {
    // Catppuccin Latte's green strings are about 3:1 on its background: lifted, but still green.
    const latte = BUILT_IN.find((t) => t.id === "catppuccin-latte")!.colors!;
    const { colors, adjusted } = readable(latte);
    expect(adjusted).toContain("syn-string");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colors["syn-string"].slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});

describe("theme files", () => {
  const good = { name: "Midnight", scheme: "dark", colors: { ...POCKET.dark } };

  it("accepts a valid file and round-trips the template", () => {
    expect(parseThemeFile(json(good))).toMatchObject({ ok: true, theme: { name: "Midnight", scheme: "dark", custom: true } });
    const template = themeTemplate("Mine", "light", POCKET.light);
    expect(parseThemeFile(new TextEncoder().encode(template))).toMatchObject({ ok: true, adjusted: [] });
  });

  it("makes an unreadable theme readable and says which colours changed", () => {
    const grey = { ...good, colors: { ...POCKET.dark, ink: "#202020", "syn-string": "#151a20" } };
    const r = parseThemeFile(json(grey));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adjusted).toEqual(expect.arrayContaining(["ink", "syn-string"]));
      expectReadable(r.theme.colors!);
    }
  });

  it.each([
    ["CSS in a colour", { ...good, colors: { ...POCKET.dark, ink: "red; background: url(https://evil.example/x)" } }],
    ["a CSS function", { ...good, colors: { ...POCKET.dark, accent: "var(--x)" } }],
    ["a named colour", { ...good, colors: { ...POCKET.dark, accent: "red" } }],
    ["short hex", { ...good, colors: { ...POCKET.dark, accent: "#fff" } }],
    ["an unknown colour name", { ...good, colors: { ...POCKET.dark, "font-family": "#000000" } }],
    ["a missing colour", { ...good, colors: { ...POCKET.dark, accent: undefined } }],
    ["an unknown setting", { ...good, css: "body{display:none}" }],
    ["a bad scheme", { ...good, scheme: "neon" }],
    ["no name", { ...good, name: "" }],
  ])("rejects %s", (_, data) => {
    expect(parseThemeFile(json(data)).ok).toBe(false);
  });

  it("rejects non-JSON, binaries, oversized files and hidden characters", () => {
    expect(parseThemeFile(new TextEncoder().encode("<script>alert(1)</script>")).ok).toBe(false);
    expect(parseThemeFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])).ok).toBe(false);
    expect(parseThemeFile(new Uint8Array(17 * 1024).fill(0x20)).ok).toBe(false);
    const hidden = JSON.stringify(good).replace("Midnight", "Mid" + String.fromCodePoint(0x202e) + "night");
    expect(parseThemeFile(new TextEncoder().encode(hidden)).ok).toBe(false);
  });

  it("strips markup and symbols from the name", () => {
    const r = parseThemeFile(json({ ...good, name: "<img src=x onerror=alert(1)>Night" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.name).toBe("img srcx onerroralert(1)Night");
  });
});
