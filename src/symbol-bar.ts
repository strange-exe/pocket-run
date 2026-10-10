import type { CodeEditor } from "./editor";

// Symbols code needs that sit two or three keyboard pages deep on a phone.
const KEYS: { label: string; insert?: string; move?: "left" | "right"; aria?: string }[] = [
  { label: "Tab", insert: "    ", aria: "Indent" },
  { label: "←", move: "left", aria: "Cursor left" },
  { label: "→", move: "right", aria: "Cursor right" },
  ...["(", ")", "{", "}", "[", "]", ";", ":", '"', "'", "<", ">", "=", "+", "-", "*", "/", "%", "&", "|", "!", "#", "_", "\\", ",", "."]
    .map((s) => ({ label: s })),
];

/** Shows the symbol bar on touch screens while the code editor has focus. */
export function setupSymbolBar(bar: HTMLElement, editorPane: HTMLElement, editor: CodeEditor) {
  for (const key of KEYS) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1; // never takes focus: the editor (and the phone keyboard) must stay up
    button.textContent = key.label;
    if (key.aria) button.setAttribute("aria-label", key.aria);
    if (key.label.length > 1) button.className = "wide";
    const press = () => {
      if (key.move) editor.moveCursor(key.move);
      else editor.type(key.insert ?? key.label);
      editor.view.focus();
    };
    // Cancelling pointerdown keeps focus (and the phone keyboard) in the editor. WebKit then also
    // skips the click, so pointer input acts on pointerup and click only covers keyboard/mouse.
    let pressedByPointer = false;
    let startX = 0;
    button.addEventListener("pointerdown", (e) => { e.preventDefault(); pressedByPointer = false; startX = e.clientX; });
    button.addEventListener("pointerup", (e) => {
      pressedByPointer = true;
      if (Math.abs(e.clientX - startX) < 10) press(); // a sideways swipe scrolls the bar instead
    });
    button.addEventListener("click", () => {
      if (pressedByPointer) { pressedByPointer = false; return; }
      press();
    });
    bar.append(button);
  }

  const touch = matchMedia("(pointer: coarse)");
  const update = () => { bar.hidden = !(touch.matches && editorPane.contains(document.activeElement)); };
  editorPane.addEventListener("focusin", update);
  editorPane.addEventListener("focusout", () => setTimeout(update, 0)); // after focus has moved
  touch.addEventListener("change", update);
  update();

  // Phone keyboards overlay the page (the visual viewport shrinks, the layout doesn't), which would
  // hide the fixed Run bar. Lift it by the covered height; this is 0 whenever no keyboard is open.
  const vv = window.visualViewport;
  if (vv) {
    const lift = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--kb-inset", `${inset}px`);
    };
    vv.addEventListener("resize", lift);
    vv.addEventListener("scroll", lift);
  }
}
