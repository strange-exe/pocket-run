// Phones show the editor and the output as two tabs (Code, Output) so each gets the whole screen and they are
// one tap apart. Wider screens show both side by side, so there the tabs and their roles go away. The tabs follow
// the WAI-ARIA APG tabs pattern: arrow keys, Home and End move between them, and only the selected tab is in the
// Tab order. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
export type View = "code" | "output";

export interface ViewTabs {
  /** Shows a view (phones only; on wider screens both are always shown). */
  show(view: View): void;
  /** Marks the Output tab when a result arrives while the Code tab is showing. */
  markNewOutput(): void;
  /** Whether the tabs are in use (a phone-width screen). */
  readonly active: boolean;
}

export function setupViewTabs(bench: HTMLElement): ViewTabs {
  const narrow = matchMedia("(max-width: 899px)");
  const list = bench.querySelector<HTMLElement>("#view-tabs")!;
  const tabs: Record<View, HTMLButtonElement> = {
    code: list.querySelector<HTMLButtonElement>("#tab-code")!,
    output: list.querySelector<HTMLButtonElement>("#tab-output")!,
  };
  const panels: Record<View, HTMLElement> = {
    code: bench.querySelector<HTMLElement>("#panel-code")!,
    output: bench.querySelector<HTMLElement>("#panel-output")!,
  };
  const badge = list.querySelector<HTMLElement>("#tab-badge")!;
  const order: View[] = ["code", "output"];
  let current: View = "code";

  function render() {
    bench.dataset.view = current;
    const on = narrow.matches;
    if (on) list.setAttribute("role", "tablist");
    else list.removeAttribute("role");
    for (const view of order) {
      const selected = view === current;
      if (on) {
        tabs[view].setAttribute("role", "tab");
        tabs[view].setAttribute("aria-selected", String(selected));
        tabs[view].tabIndex = selected ? 0 : -1;
        panels[view].setAttribute("role", "tabpanel");
        panels[view].setAttribute("aria-labelledby", tabs[view].id);
      } else {
        tabs[view].removeAttribute("role");
        tabs[view].removeAttribute("aria-selected");
        panels[view].removeAttribute("role");
        panels[view].removeAttribute("aria-labelledby");
      }
    }
  }

  function show(view: View) {
    current = view;
    if (view === "output") badge.hidden = true;
    render();
  }

  for (const view of order) tabs[view].addEventListener("click", () => show(view));
  list.addEventListener("keydown", (e) => {
    const at = order.indexOf(current);
    const next = e.key === "ArrowRight" ? order[(at + 1) % order.length]
      : e.key === "ArrowLeft" ? order[(at + order.length - 1) % order.length]
      : e.key === "Home" ? order[0]
      : e.key === "End" ? order[order.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    show(next);
    tabs[next].focus();
  });
  narrow.addEventListener("change", render);
  render();

  return {
    show,
    markNewOutput() { if (narrow.matches && current !== "output") badge.hidden = false; },
    get active() { return narrow.matches; },
  };
}
