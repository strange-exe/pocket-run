// Colour themes. A theme is a set of base colours; hover, tint and border shades are derived in CSS
// with color-mix(), so every theme (built-in or loaded from a file) styles every part of the app.
// Built-in palettes are the themes' official values (sources below); a readability guard lifts any
// colour that falls under WCAG AA contrast, keeping its hue, so no theme can make code unreadable.
import { checkBytes } from "./safety";

export const TOKENS = [
  "paper", "sheet", "bar", "ink", "muted", "rule", "accent", "on-accent", "ok", "err", "warn",
  "syn-keyword", "syn-string", "syn-number", "syn-comment", "syn-def",
] as const;
export type Token = (typeof TOKENS)[number];
export type Colors = Record<Token, string>;
export type Scheme = "light" | "dark";

export interface Theme {
  id: string;
  name: string;
  scheme: Scheme;
  /** Undefined for Pocket Run's own themes, whose colours live in styles.css. */
  colors?: Colors;
  custom?: boolean;
}

const c = (
  paper: string, sheet: string, bar: string, ink: string, muted: string, rule: string,
  accent: string, onAccent: string, ok: string, err: string, warn: string,
  keyword: string, string: string, number: string, comment: string, def: string,
): Colors => ({
  paper, sheet, bar, ink, muted, rule, accent, "on-accent": onAccent, ok, err, warn,
  "syn-keyword": keyword, "syn-string": string, "syn-number": number, "syn-comment": comment, "syn-def": def,
});

/** Pocket Run's own palettes (also in styles.css, which paints them before any script runs). */
export const POCKET: Record<Scheme, Colors> = {
  light: c("#eef1f5", "#fbfcfd", "#f4f6f9", "#131922", "#5a6475", "#dde2e9", "#0a7d55", "#ffffff", "#0a7d55", "#c42b2b", "#8f5600",
    "#a8326e", "#8f5600", "#1d63c7", "#667080", "#0b7489"),
  dark: c("#0b0e13", "#12161d", "#171c24", "#e4e8ee", "#95a0b0", "#232a35", "#3ecf8e", "#052116", "#3ecf8e", "#ff7b72", "#e7b86e",
    "#ee8fcb", "#e7b86e", "#79b8ff", "#7b8697", "#56d0e0"),
};

// Sources (fetched 2026-10-10): Catppuccin github.com/catppuccin/palette (MIT); Dracula draculatheme.com/spec (MIT);
// Tokyo Night github.com/folke/tokyonight.nvim extras (Apache-2.0); GitHub-style github.com/primer/github-vscode-theme
// v6.3.5 (MIT); One Dark Pro github.com/Binaryify/OneDark-Pro (MIT). Popularity: VS Code Marketplace installs.
export const BUILT_IN: Theme[] = [
  { id: "system", name: "Pocket Run (match device)", scheme: "light" },
  { id: "pocket-light", name: "Pocket Run Light", scheme: "light" },
  { id: "pocket-dark", name: "Pocket Run Dark", scheme: "dark" },
  {
    id: "high-contrast", name: "High contrast", scheme: "dark",
    colors: c("#050608", "#0a0c10", "#14171d", "#f7f9fb", "#c9d1db", "#5c6672", "#ffd60a", "#0a0c10", "#4ade80", "#ff8080", "#ffd60a",
      "#ff9ff3", "#fde68a", "#7dd3fc", "#b8c2cc", "#67e8f9"),
  },
  {
    id: "github-dark", name: "GitHub-style Dark", scheme: "dark",
    colors: c("#010409", "#0d1117", "#161b22", "#e6edf3", "#7d8590", "#30363d", "#238636", "#ffffff", "#3fb950", "#f85149", "#d29922",
      "#ff7b72", "#a5d6ff", "#79c0ff", "#8b949e", "#d2a8ff"),
  },
  {
    id: "github-light", name: "GitHub-style Light", scheme: "light",
    colors: c("#f6f8fa", "#ffffff", "#f6f8fa", "#1f2328", "#656d76", "#d0d7de", "#1f883d", "#ffffff", "#1a7f37", "#cf222e", "#9a6700",
      "#cf222e", "#0a3069", "#0550ae", "#6e7781", "#8250df"),
  },
  {
    id: "one-dark-pro", name: "One Dark Pro", scheme: "dark",
    colors: c("#21252b", "#282c34", "#1d1f23", "#abb2bf", "#7f848e", "#3e4452", "#61afef", "#282c34", "#8cc265", "#c24038", "#d19a66",
      "#c678dd", "#98c379", "#d19a66", "#7f848e", "#61afef"),
  },
  {
    id: "dracula", name: "Dracula", scheme: "dark",
    colors: c("#21222c", "#282a36", "#343746", "#f8f8f2", "#6272a4", "#44475a", "#bd93f9", "#282a36", "#50fa7b", "#ff5555", "#ffb86c",
      "#ff79c6", "#f1fa8c", "#ffb86c", "#6272a4", "#50fa7b"),
  },
  {
    id: "tokyo-night", name: "Tokyo Night", scheme: "dark",
    colors: c("#16161e", "#1a1b26", "#292e42", "#c0caf5", "#a9b1d6", "#3b4261", "#7aa2f7", "#1a1b26", "#9ece6a", "#db4b4b", "#e0af68",
      "#9d7cd8", "#9ece6a", "#ff9e64", "#565f89", "#7aa2f7"),
  },
  {
    id: "tokyo-night-day", name: "Tokyo Night Day", scheme: "light",
    colors: c("#d0d5e3", "#e1e2e7", "#c4c8da", "#3760bf", "#6172b0", "#a8aecb", "#2e7de9", "#e1e2e7", "#587539", "#c64343", "#8c6c3e",
      "#7847bd", "#587539", "#b15c00", "#848cb5", "#2e7de9"),
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin Mocha", scheme: "dark",
    colors: c("#11111b", "#1e1e2e", "#181825", "#cdd6f4", "#a6adc8", "#313244", "#cba6f7", "#11111b", "#a6e3a1", "#f38ba8", "#f9e2af",
      "#cba6f7", "#a6e3a1", "#fab387", "#9399b2", "#89b4fa"),
  },
  {
    id: "catppuccin-latte", name: "Catppuccin Latte", scheme: "light",
    colors: c("#dce0e8", "#eff1f5", "#e6e9ef", "#4c4f69", "#6c6f85", "#ccd0da", "#8839ef", "#eff1f5", "#40a02b", "#d20f39", "#df8e1d",
      "#8839ef", "#40a02b", "#fe640b", "#7c7f93", "#1e66f5"),
  },
];

// ---------- contrast (WCAG 2.x relative luminance) ----------
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (v: number[]) => `#${v.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves `fg` towards black or white (whichever the background needs) until it reaches `target` against every background. */
function lift(fg: string, backgrounds: string[], target: number): string {
  const towards = luminance(backgrounds[0]) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = rgb(fg);
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const hex = toHex(from.map((v, i) => v + (towards[i] - v) * t));
    if (backgrounds.every((bg) => contrast(hex, bg) >= target)) return hex;
  }
  return toHex(towards);
}

/** Text colours must reach 4.5:1 (WCAG AA) on the editor and the panel strips. */
const TEXT_TOKENS: Token[] = ["ink", "muted", "ok", "err", "warn", "syn-keyword", "syn-string", "syn-number", "syn-comment", "syn-def"];

/** Returns readable colours and the names of any it had to adjust. */
export function readable(colors: Colors): { colors: Colors; adjusted: Token[] } {
  const out = { ...colors };
  const adjusted: Token[] = [];
  const set = (t: Token, v: string) => { if (v !== out[t]) { out[t] = v; adjusted.push(t); } };
  const surfaces = [out.sheet, out.bar];
  for (const t of TEXT_TOKENS) set(t, lift(out[t], surfaces, 4.5));
  set("accent", lift(out.accent, [out.sheet], 3)); // the Run button must stand out from the page (UI contrast)
  if (contrast(out["on-accent"], out.accent) < 4.5) {
    const best = [out.ink, out.sheet, "#0b0e13", "#fbfcfd"].sort((a, b) => contrast(b, out.accent) - contrast(a, out.accent))[0];
    set("on-accent", best);
  }
  return { colors: out, adjusted };
}

// ---------- custom themes from a file ----------
export const MAX_THEME_BYTES = 16 * 1024;
export const MAX_CUSTOM_THEMES = 8;

export type Parsed = { ok: true; theme: Theme; adjusted: Token[] } | { ok: false; error: string };

/**
 * Reads a theme file. Only plain colour values for known names are accepted: no CSS, no URLs, no
 * script, so a shared theme file can't change anything but colours.
 */
export function parseThemeFile(bytes: Uint8Array): Parsed {
  if (bytes.length > MAX_THEME_BYTES) return { ok: false, error: `A theme file is at most ${MAX_THEME_BYTES / 1024} KB; this one is bigger.` };
  const text = checkBytes(bytes);
  if (!text.ok) return { ok: false, error: `This isn't a theme file: ${text.reason}.` };
  if (text.hidden) return { ok: false, error: "This theme file contains invisible characters." };
  let data: unknown;
  try {
    data = JSON.parse(text.text);
  } catch {
    return { ok: false, error: "This isn't a theme file: it isn't valid JSON." };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, error: "This isn't a theme file." };
  const d = data as Record<string, unknown>;
  const extra = Object.keys(d).filter((k) => !["name", "scheme", "colors"].includes(k));
  if (extra.length) return { ok: false, error: `Unknown setting in the theme file: ${extra.slice(0, 3).join(", ")}.` };
  if (typeof d.name !== "string" || !d.name.trim()) return { ok: false, error: "The theme needs a \"name\"." };
  const name = d.name.replace(/[^\p{L}\p{N} ._'()&+-]/gu, "").trim().slice(0, 40);
  if (!name) return { ok: false, error: "The theme's name has no letters or digits." };
  if (d.scheme !== "light" && d.scheme !== "dark") return { ok: false, error: "\"scheme\" must be \"light\" or \"dark\"." };
  if (typeof d.colors !== "object" || d.colors === null || Array.isArray(d.colors)) return { ok: false, error: "The theme needs \"colors\"." };
  const given = d.colors as Record<string, unknown>;
  const unknown = Object.keys(given).filter((k) => !(TOKENS as readonly string[]).includes(k));
  if (unknown.length) return { ok: false, error: `Unknown colour name: ${unknown.slice(0, 3).join(", ")}.` };
  const missing = TOKENS.filter((t) => !(t in given));
  if (missing.length) return { ok: false, error: `Missing colours: ${missing.join(", ")}.` };
  const bad = TOKENS.filter((t) => typeof given[t] !== "string" || !HEX.test(given[t] as string));
  if (bad.length) return { ok: false, error: `These must be colours like "#1e1e2e": ${bad.join(", ")}.` };
  const colors = Object.fromEntries(TOKENS.map((t) => [t, (given[t] as string).toLowerCase()])) as Colors;
  const { colors: safe, adjusted } = readable(colors);
  return { ok: true, theme: { id: `custom:${name.toLowerCase()}`, name, scheme: d.scheme, colors: safe, custom: true }, adjusted };
}

/** A theme file for the given colours, as a starting point for making your own. */
export function themeTemplate(name: string, scheme: Scheme, colors: Colors): string {
  return JSON.stringify({ name, scheme, colors }, null, 2) + "\n";
}

// ---------- the chosen theme, kept on this device ----------
const CHOSEN_KEY = "pocket-run:theme";
const CUSTOM_KEY = "pocket-run:custom-themes";
/** Read by the start-up script in index.html, so the theme is painted before any module loads. */
export const PAINT_KEY = "pocket-run:theme-paint";

const storage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode: not remembered */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/** Custom themes saved on this device. Re-validated on every load, in case storage was edited. */
export function customThemes(): Theme[] {
  try {
    const list = JSON.parse(storage.get(CUSTOM_KEY) ?? "[]") as unknown[];
    return list.flatMap((item) => {
      const parsed = parseThemeFile(new TextEncoder().encode(JSON.stringify(item)));
      return parsed.ok ? [parsed.theme] : [];
    }).slice(0, MAX_CUSTOM_THEMES);
  } catch {
    return [];
  }
}

export function saveCustomTheme(theme: Theme): { ok: boolean; error?: string } {
  const others = customThemes().filter((t) => t.id !== theme.id);
  if (others.length >= MAX_CUSTOM_THEMES) return { ok: false, error: `You can keep up to ${MAX_CUSTOM_THEMES} themes. Delete one first.` };
  const all = [...others, theme].map((t) => ({ name: t.name, scheme: t.scheme, colors: t.colors }));
  storage.set(CUSTOM_KEY, JSON.stringify(all));
  return { ok: true };
}

export function deleteCustomTheme(id: string) {
  storage.set(CUSTOM_KEY, JSON.stringify(customThemes().filter((t) => t.id !== id).map((t) => ({ name: t.name, scheme: t.scheme, colors: t.colors }))));
}

export function allThemes(): Theme[] {
  return [...BUILT_IN, ...customThemes()];
}

export function chosenTheme(): Theme {
  const id = storage.get(CHOSEN_KEY) ?? "system";
  return allThemes().find((t) => t.id === id) ?? BUILT_IN[0];
}

const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Paints a theme: data-theme picks light/dark CSS; other themes set their colours as inline variables. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const t of TOKENS) root.style.removeProperty(`--${t}`);
  const scheme: Scheme = theme.id === "system" ? (prefersDark() ? "dark" : "light") : theme.scheme;
  root.dataset.theme = scheme;
  const colors = theme.colors ? readable(theme.colors).colors : null;
  if (colors) for (const t of TOKENS) root.style.setProperty(`--${t}`, colors[t]);
  const paper = colors?.paper ?? POCKET[scheme].paper;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = paper;
  // What the start-up script needs to paint this theme before the app loads next time.
  storage.set(PAINT_KEY, JSON.stringify({ system: theme.id === "system", scheme, colors }));
}

export function chooseTheme(theme: Theme) {
  storage.set(CHOSEN_KEY, theme.id);
  applyTheme(theme);
}

/** Follows the device's light/dark setting while "match device" is chosen. */
export function followDevice() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const theme = chosenTheme();
    if (theme.id === "system") applyTheme(theme);
  });
}
