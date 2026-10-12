// The about page's small interactive layer. The page is complete without any of it.
// - The phone tilts towards the pointer (a CSS 3D transform; mouse and pen only, never with reduced motion).
// - Feature tiles light their border where the pointer is.
// - When motion, data and the network allow, a 3D dot field (about-field.ts) loads after the page is idle.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

// ---------- phone tilt ----------
const stage = document.querySelector<HTMLElement>(".phone-stage");
const phone = document.querySelector<HTMLElement>(".phone");
if (stage && phone) {
  stage.addEventListener("pointermove", (e) => {
    if (reduced.matches || !finePointer.matches || e.pointerType === "touch") return;
    const box = stage.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;
    phone.style.setProperty("--tilt-x", `${(-y * 8).toFixed(2)}deg`);
    phone.style.setProperty("--tilt-y", `${(x * 10).toFixed(2)}deg`);
  });
  stage.addEventListener("pointerleave", () => {
    phone.style.removeProperty("--tilt-x");
    phone.style.removeProperty("--tilt-y");
  });
}

// ---------- border spotlight on the feature tiles ----------
for (const cell of document.querySelectorAll<HTMLElement>(".cell")) {
  cell.addEventListener("pointermove", (e) => {
    const box = cell.getBoundingClientRect();
    cell.style.setProperty("--spot-x", `${e.clientX - box.left}px`);
    cell.style.setProperty("--spot-y", `${e.clientY - box.top}px`);
  });
}

// ---------- the 3D field: only when it costs the student nothing they'd notice ----------
// It is about 240 KB (gzip), so: wide screens only, and never with reduced motion, offline, Save-Data,
// a 2G/3G connection or a low-memory device (Network Information and Device Memory are Chromium-only; elsewhere they don't block).
type NetworkInfo = { saveData?: boolean; effectiveType?: string };
function fieldAllowed(): boolean {
  const nav = navigator as Navigator & { connection?: NetworkInfo; deviceMemory?: number };
  // On a phone the field would sit almost entirely behind the phone mock-up: not worth 240 KB there.
  if (reduced.matches || !nav.onLine || !matchMedia("(min-width: 960px)").matches) return false;
  if (nav.connection?.saveData || /(^|-)2g$|^3g$/.test(nav.connection?.effectiveType ?? "")) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  return true;
}

const host = document.querySelector<HTMLElement>(".field");
if (host && fieldAllowed()) {
  const start = () => {
    import("./about-field")
      .then(({ startField }) => startField(host))
      .then((field) => {
        host.dataset.state = "live";
        // Someone switching reduced motion on mid-visit gets the static page back.
        reduced.addEventListener("change", () => { field.stop(); delete host.dataset.state; }, { once: true });
      })
      .catch(() => {
        // No WebGPU or WebGL 2, or the download failed: the static dotted backdrop is already there.
        host.querySelector("canvas")?.remove();
      });
  };
  const idle = () => ("requestIdleCallback" in window ? requestIdleCallback(start, { timeout: 3000 }) : setTimeout(start, 1200));
  if (document.readyState === "complete") idle();
  else addEventListener("load", idle, { once: true });
}
