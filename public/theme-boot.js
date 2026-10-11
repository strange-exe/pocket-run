// Paints the saved colour theme before anything is drawn, so there is no flash of the wrong one.
// Loaded as a small blocking script from index.html's <head> (a file, not inline, so the
// Content-Security-Policy can forbid inline scripts). Written by applyTheme() in src/themes.ts;
// only #rrggbb values are ever applied.
(function () {
  var root = document.documentElement, saved = null;
  try { saved = JSON.parse(localStorage.getItem("pocket-run:theme-paint")); } catch (e) {}
  var dark = matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = !saved || saved.system ? (dark ? "dark" : "light") : saved.scheme === "dark" ? "dark" : "light";
  var colors = saved && !saved.system && saved.colors;
  if (colors) for (var k in colors) {
    if (/^[a-z-]{2,20}$/.test(k) && /^#[0-9a-f]{6}$/i.test(colors[k])) root.style.setProperty("--" + k, colors[k]);
  }
})();
