// Paints the saved colour theme before anything is drawn, so there is no flash of the wrong one.
// Loaded as a small blocking script from index.html's <head> (a file, not inline, so the
// Content-Security-Policy can forbid inline scripts). Written by applyTheme() in src/themes.ts;
// only #rrggbb values are ever applied.
(function () {
  // The default theme (Tokyo Night, after the readability guard). src/themes.test.ts checks it
  // matches DEFAULT_THEME_ID in src/themes.ts.
  var DEFAULT = { system: false, scheme: "dark", colors: {
    "paper": "#16161e", "sheet": "#1a1b26", "bar": "#292e42", "ink": "#c0caf5", "muted": "#a9b1d6", "rule": "#3b4261",
    "accent": "#7aa2f7", "on-accent": "#1a1b26", "ok": "#9ece6a", "err": "#e47878", "warn": "#e0af68",
    "syn-keyword": "#a789dc", "syn-string": "#9ece6a", "syn-number": "#ff9e64", "syn-comment": "#9197b2", "syn-def": "#7aa2f7",
    "accent-ink": "#81a7f7"
  } };
  var POCKET_PAPER = { light: "#eef1f5", dark: "#0b0e13" };
  var root = document.documentElement, saved = null;
  try { saved = JSON.parse(localStorage.getItem("pocket-run:theme-paint")); } catch (e) {}
  if (!saved || typeof saved !== "object") saved = DEFAULT;
  var dark = matchMedia("(prefers-color-scheme: dark)").matches;
  var scheme = saved.system ? (dark ? "dark" : "light") : saved.scheme === "dark" ? "dark" : "light";
  root.dataset.theme = scheme;
  var colors = !saved.system && saved.colors;
  if (colors) for (var k in colors) {
    if (/^[a-z-]{2,20}$/.test(k) && /^#[0-9a-f]{6}$/i.test(colors[k])) root.style.setProperty("--" + k, colors[k]);
  }
  // The browser's toolbar colour follows the theme too (the <meta> tags come before this script).
  var paper = colors && /^#[0-9a-f]{6}$/i.test(colors.paper) ? colors.paper : POCKET_PAPER[scheme];
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", paper);
  // Joined symbols in code (ligatures such as != drawn as one shape) are opt-in: src/ligatures.ts.
  var ligatures = null;
  try { ligatures = localStorage.getItem("pocket-run:ligatures"); } catch (e) {}
  if (ligatures === "on") root.dataset.ligatures = "on";
})();
