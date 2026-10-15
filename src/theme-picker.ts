import { downloadFile } from "./files";
import { ligaturesOn, setLigatures } from "./ligatures";
import {
  allThemes, BUILT_IN, chooseTheme, chosenTheme, DEFAULT_THEME_ID, defaultTheme, deleteCustomTheme, MAX_THEME_BYTES, parseThemeFile, POCKET, readable,
  saveCustomTheme, themeTemplate, type Colors, type Theme, type Token,
} from "./themes";

const SWATCH: Token[] = ["sheet", "ink", "accent", "syn-keyword", "syn-string"];

const colorsOf = (theme: Theme): Colors => (theme.colors ? readable(theme.colors).colors : POCKET[theme.scheme]);

export function setupThemePicker(open: HTMLButtonElement, dialog: HTMLDialogElement) {
  const list = dialog.querySelector<HTMLElement>("#theme-list")!;
  const message = dialog.querySelector<HTMLElement>("#theme-message")!;
  const fileInput = dialog.querySelector<HTMLInputElement>("#theme-file")!;
  const say = (text: string, tone: "info" | "error" = "info") => {
    message.textContent = text;
    message.dataset.tone = tone;
  };

  function option(theme: Theme, current: string): HTMLElement {
    const row = document.createElement("label");
    row.className = "theme-option";
    const radio = Object.assign(document.createElement("input"), { type: "radio", name: "theme", value: theme.id, checked: theme.id === current });
    radio.addEventListener("change", () => { chooseTheme(theme); say(""); });
    const swatches = document.createElement("span");
    swatches.className = "swatches";
    swatches.setAttribute("aria-hidden", "true");
    const colors = colorsOf(theme);
    for (const t of SWATCH) {
      const s = document.createElement("span");
      s.style.background = colors[t]; // validated #rrggbb only (themes.ts)
      swatches.append(s);
    }
    const name = Object.assign(document.createElement("span"), { className: "theme-name", textContent: theme.name });
    if (theme.id === DEFAULT_THEME_ID) name.append(" ", Object.assign(document.createElement("span"), { className: "theme-default", textContent: "Default" }));
    row.append(radio, swatches, name);
    if (theme.custom) {
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "theme-delete", textContent: "Delete" });
      remove.setAttribute("aria-label", `Delete ${theme.name}`);
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        deleteCustomTheme(theme.id);
        if (chosenTheme().id === theme.id || current === theme.id) chooseTheme(defaultTheme());
        render();
        say(`Deleted “${theme.name}”.`);
      });
      row.append(remove);
    }
    return row;
  }

  function render() {
    const current = chosenTheme().id;
    const pocket = new Set(["system", "pocket-light", "pocket-dark", "high-contrast"]);
    const popular = BUILT_IN.filter((t) => !pocket.has(t.id) && !t.more)
      .sort((a, b) => Number(b.id === DEFAULT_THEME_ID) - Number(a.id === DEFAULT_THEME_ID));
    const more = BUILT_IN.filter((t) => t.more);
    const heading = (text: string) => Object.assign(document.createElement("p"), { className: "theme-group", textContent: text });
    const groups: [string, Theme[]][] = [
      ["Popular editor themes", popular],
      ["Pocket Run", BUILT_IN.filter((t) => pocket.has(t.id))],
      ["Yours", allThemes().filter((t) => t.custom)],
    ];
    const folded = document.createElement("details");
    folded.className = "theme-more";
    folded.open = more.some((t) => t.id === current);
    const summary = Object.assign(document.createElement("summary"), { textContent: `More themes (${more.length})` });
    // Opening it at the bottom of the list would leave the new options out of sight (click covers Enter and Space too).
    summary.addEventListener("click", () => requestAnimationFrame(() => { if (folded.open) folded.lastElementChild?.scrollIntoView({ block: "nearest" }); }));
    folded.append(summary, ...more.map((t) => option(t, current)));
    list.replaceChildren(
      ...groups.slice(0, 2).flatMap(([title, themes]) => [heading(title), ...themes.map((t) => option(t, current))]),
      folded,
      ...groups.slice(2).filter(([, themes]) => themes.length).flatMap(([title, themes]) => [heading(title), ...themes.map((t) => option(t, current))]),
    );
  }

  open.addEventListener("click", () => {
    render();
    say("");
    dialog.showModal();
    list.querySelector<HTMLInputElement>("input:checked")?.focus();
  });

  const joined = dialog.querySelector<HTMLInputElement>("#ligatures")!;
  joined.checked = ligaturesOn();
  joined.addEventListener("change", () => setLigatures(joined.checked));

  dialog.querySelector("#theme-load")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_THEME_BYTES) return say(`A theme file is at most ${MAX_THEME_BYTES / 1024} KB; this one is bigger.`, "error");
    const parsed = parseThemeFile(new Uint8Array(await file.arrayBuffer()));
    if (!parsed.ok) return say(parsed.error, "error");
    const saved = saveCustomTheme(parsed.theme);
    if (!saved.ok) return say(saved.error!, "error");
    chooseTheme(parsed.theme);
    render();
    const n = parsed.adjusted.length;
    say(`Loaded “${parsed.theme.name}”.${n ? ` ${n} colour${n === 1 ? " was" : "s were"} made easier to read (${parsed.adjusted.join(", ")}).` : ""}`);
  });

  dialog.querySelector("#theme-template")!.addEventListener("click", () => {
    const theme = chosenTheme();
    const scheme = theme.id === "system" ? (document.documentElement.dataset.theme === "dark" ? "dark" : "light") : theme.scheme;
    downloadFile("pocket-run-theme.json", themeTemplate(`My ${theme.name}`.slice(0, 40), scheme, colorsOf({ ...theme, scheme })));
    say("Saved pocket-run-theme.json. Change the colours, rename it, then load it here.");
  });
}
