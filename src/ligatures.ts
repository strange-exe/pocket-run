// "Joined symbols" in code: JetBrains Mono's ligatures draw != as one symbol, == as one long bar and -> as an
// arrow. Off by default, so code shows the characters a student actually types; this is the opt-in. The choice
// is kept on the device, and public/theme-boot.js applies it before the first paint (app and about page).
const KEY = "pocket-run:ligatures";

export function ligaturesOn(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}

export function setLigatures(on: boolean) {
  if (on) document.documentElement.dataset.ligatures = "on";
  else delete document.documentElement.dataset.ligatures;
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch { /* private mode: applies to this visit only */ }
}
