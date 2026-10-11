import { downloadFile } from "./files";
import {
  allThemes, BUILT_IN, chooseTheme, chosenTheme, deleteCustomTheme, MAX_THEME_BYTES, parseThemeFile, POCKET, readable,
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
    row.append(radio, swatches, name);
    if (theme.custom) {
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "theme-delete", textContent: "Delete" });
      remove.setAttribute("aria-label", `Delete ${theme.name}`);
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        deleteCustomTheme(theme.id);
        if (chosenTheme().id === theme.id || current === theme.id) chooseTheme(BUILT_IN[0]);
        render();
        say(`Deleted “${theme.name}”.`);
      });
      row.append(remove);
    }
    return row;
  }

  function render() {
    const current = chosenTheme().id;
    const groups: [string, Theme[]][] = [
      ["Pocket Run", BUILT_IN.slice(0, 4)],
      ["Popular editor themes", BUILT_IN.slice(4)],
      ["Yours", allThemes().filter((t) => t.custom)],
    ];
    list.replaceChildren(...groups.filter(([, themes]) => themes.length).flatMap(([title, themes]) => [
      Object.assign(document.createElement("p"), { className: "theme-group", textContent: title }),
      ...themes.map((t) => option(t, current)),
    ]));
  }

  open.addEventListener("click", () => {
    render();
    say("");
    dialog.showModal();
    list.querySelector<HTMLInputElement>("input:checked")?.focus();
  });

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
