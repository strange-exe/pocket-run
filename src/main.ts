import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { loadDraft, PREVIOUS_KEY, saveDraft } from "./draft";
import { makeShareUrl, readShareHash, shareProblem } from "./share";
import { HIDDEN, removeHidden } from "./safety";
import { applyTheme, chosenTheme, followDevice } from "./themes";
import { setupThemePicker } from "./theme-picker";
import { setupViewTabs } from "./view-tabs";

// The start-up script in index.html already painted the saved theme; this re-applies it with
// full validation and keeps "match device" in step with the system setting.
applyTheme(chosenTheme());
followDevice();
import { setupSymbolBar } from "./symbol-bar";
import { createEditor } from "./editor";
import { downloadFile, readCodeFile, sanitizeFilename } from "./files";
import { ACCEPTED_EXTENSIONS, detectLanguage, languageById, type Language, type LanguageId } from "./languages";
import { cHint } from "./hints";
import { CppRunner } from "./runner/cpp-runner";
import { Runner, type RunOptions, type RunResult } from "./runner/runner";

const RUN_TIMEOUT_MS = 8000;
const OUTPUT_CAP = 64 * 1024;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const filenameInput = $<HTMLInputElement>("filename");
const langTag = $("lang-tag");
const fileInput = $<HTMLInputElement>("file-input");
const stdinInput = $<HTMLTextAreaElement>("stdin");
const stdinBox = $<HTMLDetailsElement>("stdin-box");
const receipt = $("receipt");
const output = $("output");
// The Output panel (section.printout), not the body around the output: the "arrive" animation is keyed on
// `.printout.fresh`, and adding the class to the body (as before 2026-10-15) meant it never played.
const printout = output.closest<HTMLElement>(".printout")!;
const notice = $("notice");
const runBtn = $<HTMLButtonElement>("run-btn");
const runLabel = $("run-label");
const statusDot = $("status-dot");
const statusText = $("status-text");
const newDialog = $<HTMLDialogElement>("new-dialog");
setupThemePicker($<HTMLButtonElement>("theme-btn"), $<HTMLDialogElement>("theme-dialog"));
const views = setupViewTabs(document.querySelector<HTMLElement>(".bench")!);
const packOffer = $("pack-offer");
const packText = $("pack-text");
const packProgress = $<HTMLProgressElement>("pack-progress");
const packButton = $<HTMLButtonElement>("pack-button");

// ---------- state ----------
const python = languageById("python");
const savedDraft = loadDraft();
/** The sample program's own answer to its input() prompt; it belongs to the sample only. */
const SAMPLE_STDIN = "Abhinesh\n";
const ownDraft = savedDraft ?? { filename: python.defaultFilename, code: python.sample, stdin: SAMPLE_STDIN };
// A share link (#s=…) opens its file in the editor; the student's own file is kept aside.
const received = await readShareHash(location.hash);
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const shared = received?.ok ? received.draft : null;
const draft = shared ?? ownDraft;
if (shared) {
  saveDraft(ownDraft, PREVIOUS_KEY);
  saveDraft(draft);
}
let running = false;
let offlineReady = false;

const isCompiled = (lang: Language | null): lang is Language & { id: "c" | "cpp" } => lang?.id === "c" || lang?.id === "cpp";
const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1);

if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector(".shortcut")!.textContent = "⌘ ↵";

filenameInput.value = draft.filename;
stdinInput.value = draft.stdin;
if (draft.stdin) stdinBox.open = true;
fileInput.accept = ACCEPTED_EXTENSIONS;

// When a student replaces the sample with their own program (pasting over it is the usual way), the sample's
// untouched "Abhinesh" answer must not go along: a C program reading a number would get a name, fail, and
// loop on it forever. A student's own Input text is never touched.
let codeIsSample = draft.code === python.sample;
function onCodeChange() {
  const code = editor.getCode();
  if (codeIsSample && code !== python.sample && stdinInput.value === SAMPLE_STDIN) {
    stdinInput.value = "";
    stdinBox.open = false;
  }
  codeIsSample = code === python.sample;
  persist();
}

const editor = createEditor($("editor"), {
  code: draft.code,
  language: detectLanguage(draft.filename)?.id ?? null,
  onChange: onCodeChange,
  extraKeys: [{ key: "Mod-Enter", run: () => { void onRun(); return true; } }],
});

setupSymbolBar($("symbol-bar"), $("editor"), editor);

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    saveDraft({ filename: filenameInput.value, code: editor.getCode(), stdin: stdinInput.value });
  }, 300);
}

const noticeText = $("notice-text");
const noticeAction = $<HTMLButtonElement>("notice-action");
let noticeHandler: (() => void) | null = null;
/** One line above Run. Errors by default; "info" for confirmations, with an optional action button. */
function showNotice(text: string, opts: { tone?: "error" | "info"; action?: { label: string; run: () => void } } = {}) {
  notice.hidden = !text;
  notice.dataset.tone = opts.tone ?? "error";
  noticeText.textContent = text;
  noticeHandler = opts.action?.run ?? null;
  noticeAction.hidden = !opts.action;
  noticeAction.textContent = opts.action?.label ?? "";
}
noticeAction.addEventListener("click", () => noticeHandler?.());
showNotice("");

// On phones the Run bar is fixed to the bottom and grows when a notice shows; the page
// reserves exactly its height so content can always be scrolled clear of it.
const dock = document.querySelector<HTMLElement>(".run-dock")!;
function syncDockHeight() {
  const fixed = getComputedStyle(dock).position === "fixed";
  document.documentElement.style.setProperty("--dock-h", fixed ? `${dock.offsetHeight}px` : "0px");
}
new ResizeObserver(syncDockHeight).observe(dock);

// ---------- offline support ----------
// The service worker is registered only once Python is up, for two reasons:
// - first visit: its install then reuses the runtime the page just downloaded (HTTP cache)
//   instead of fetching the same 6 MB again in parallel;
// - repeat visits on a hanging connection: its update check for sw.js was measured holding
//   back the Python worker's script by ~5.5 s on Android Chrome.
let swRegistered = false;
function registerServiceWorker() {
  if (swRegistered || !("serviceWorker" in navigator)) return;
  swRegistered = true;
  registerSW({
    immediate: true,
    onOfflineReady() { offlineReady = true; renderStatus(); },
    onRegistered(reg) { if (reg?.active && navigator.serviceWorker.controller) { offlineReady = true; renderStatus(); } },
  });
}
// Already controlled (repeat visit): the app works offline before it re-registers.
if (navigator.serviceWorker?.controller) offlineReady = true;

// ---------- runtimes ----------
const runner = new Runner(() => new Worker(new URL("./workers/python.worker.ts", import.meta.url), { type: "module" }));
const cpp = new CppRunner(
  () => new Worker(new URL("./workers/clang.worker.ts", import.meta.url), { type: "module" }),
  () => new Worker(new URL("./workers/c-runner.worker.ts", import.meta.url), { type: "module" }),
);
runner.onState = (state) => {
  if (state === "ready" || state === "failed") registerServiceWorker();
  renderStatus();
};
cpp.onState = renderStatus;

/** The status line and download offer describe the runtime for the open file's language. */
function renderStatus() {
  if (runner.lastBoot) {
    statusDot.dataset.boot = runner.lastBoot.source;
    statusDot.dataset.bootMs = String(Math.round(runner.lastBoot.ms));
  }
  const lang = detectLanguage(filenameInput.value);
  if (isCompiled(lang)) renderCppStatus();
  else renderPythonStatus();
  renderPackOffer(lang);
}

function renderPythonStatus() {
  const state = runner.state;
  statusDot.dataset.state = state === "failed" ? "failed" : state === "booting" ? "booting" : "ready";
  statusText.textContent =
    state === "booting" ? (offlineReady ? "Starting Python…" : "Downloading Python (6 MB, only once)…")
    : state === "failed" ? "Python couldn't start. Reload to retry."
    : `Python ready${offlineReady ? " · works offline" : ""}`;
}

function renderCppStatus() {
  const s = cpp.state;
  statusDot.dataset.state = s === "ready" || s === "running" ? "ready" : s === "failed" ? "failed" : s === "absent" ? "absent" : "booting";
  const { loaded, total } = cpp.progress;
  statusText.textContent =
    s === "checking" ? "Checking for C/C++…"
    : s === "absent" ? `C/C++ needs a one-time ${megabytes(total)} MB download`
    : s === "downloading" ? `Downloading C/C++… ${Math.floor((loaded / total) * 100)}%`
    : s === "idle" || s === "booting" ? "Starting the C/C++ compiler…"
    : s === "failed" ? "The C/C++ compiler couldn't start. Reload to retry."
    : "C/C++ ready · works offline";
}

function renderPackOffer(lang: Language | null) {
  const show = isCompiled(lang) && (cpp.state === "absent" || cpp.state === "downloading");
  packOffer.hidden = !show;
  if (!show) return;
  const { loaded, total } = cpp.progress;
  const downloading = cpp.state === "downloading";
  packProgress.hidden = !downloading;
  packButton.hidden = downloading;
  if (downloading) {
    packProgress.value = loaded / total;
    packText.textContent = `Downloading the C/C++ compiler… ${megabytes(loaded)} of ${megabytes(total)} MB. Keep this page open.`;
  } else if (cpp.error) {
    packText.textContent = `The download stopped (${cpp.error}). Check your connection and try again; finished parts are kept.`;
    packButton.textContent = "Try again";
  } else {
    packText.textContent = `C and C++ need a one-time ${megabytes(total)} MB download. After that they run offline, like Python.`;
    packButton.textContent = `Download C/C++ (${megabytes(total)} MB)`;
  }
}
packButton.addEventListener("click", () => cpp.download());

// ---------- language follows the file extension ----------
function syncLanguage() {
  const lang = detectLanguage(filenameInput.value);
  editor.setLanguage(lang?.id ?? null);
  langTag.textContent = lang?.label ?? "Unknown type";
  langTag.toggleAttribute("data-unsupported", !lang);
  if (isCompiled(lang)) cpp.prepare(); // warm clang now so Run doesn't wait for it
  showNotice("");
  renderStatus();
}
filenameInput.addEventListener("input", () => { syncLanguage(); persist(); });
stdinInput.addEventListener("input", persist);
syncLanguage();

/** Puts a file into the editor, file name and Input as if the student had opened it. */
function loadFile(file: { filename: string; code: string; stdin: string }) {
  filenameInput.value = file.filename;
  editor.setCode(file.code);
  stdinInput.value = file.stdin;
  if (file.stdin) stdinBox.open = true;
  syncLanguage();
  persist();
}

function announceShared(filename: string) {
  showNotice(`Opened a shared file (${filename}). It hasn't been run. Your own file was kept.`, {
    tone: "info",
    action: {
      label: "Restore mine",
      run: () => {
        const mine = loadDraft(PREVIOUS_KEY);
        if (mine) loadFile(mine);
        showNotice("Your own file is back.", { tone: "info" });
      },
    },
  });
}
const announceBlocked = (reason: string) =>
  showNotice(`A shared link was blocked because ${reason}. Nothing was opened or run, and your file is unchanged.`);
if (shared) announceShared(draft.filename);
else if (received && !received.ok) announceBlocked(received.blocked);

// ---------- first visit: a one-time welcome where the output will appear ----------
// Teaching by doing: the editor already holds a sample program, so the note just says "press Run".
// Shown once, only to someone with no saved work who didn't arrive through a share link.
// On a phone the Output panel starts below the fold, so there the note sits in the notice line
// right above the Run button it points to.
const WELCOMED_KEY = "pocket-run:welcomed";
const welcome = $("welcome");
let welcoming = false;
function dismissWelcome() {
  if (!welcoming) return;
  welcoming = false;
  welcome.hidden = true;
  try { localStorage.setItem(WELCOMED_KEY, "1"); } catch { /* private mode: it may show once more */ }
}
let welcomed = true;
try { welcomed = localStorage.getItem(WELCOMED_KEY) === "1"; } catch { /* storage blocked: skip the note */ }
welcoming = !welcomed && savedDraft === null && received === null;
if (welcoming && matchMedia("(max-width: 899px)").matches) {
  showNotice("New here? Press Run to try the sample program.", {
    tone: "info",
    action: { label: "About Pocket Run", run: () => location.assign("/about/") },
  });
} else {
  welcome.hidden = !welcoming;
}
$("welcome-close").addEventListener("click", dismissWelcome);

// A link pasted into a tab where Pocket Run is already open only changes the fragment (no reload).
window.addEventListener("hashchange", async () => {
  const file = await readShareHash(location.hash);
  history.replaceState(null, "", location.pathname + location.search);
  if (!file || running) return;
  dismissWelcome();
  if (!file.ok) return announceBlocked(file.blocked);
  saveDraft({ filename: filenameInput.value, code: editor.getCode(), stdin: stdinInput.value }, PREVIOUS_KEY);
  loadFile(file.draft);
  announceShared(filenameInput.value);
});

/** Offers to strip invisible characters that could hide what code does. */
function warnHidden(count: number, before: string) {
  showNotice(`This file has ${count} invisible character${count === 1 ? "" : "s"} (shown as red dots) that could hide what the code does.`, {
    action: {
      label: "Remove them",
      run: () => {
        editor.setCode(removeHidden(editor.getCode()));
        persist();
        showNotice(`Removed ${count} invisible character${count === 1 ? "" : "s"}${before}.`, { tone: "info" });
      },
    },
  });
}

// ---------- open / save / new ----------
$("open-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // allow re-opening the same file
  if (!file) return;
  const result = await readCodeFile(file);
  if (!result.ok) return showNotice(result.error);
  filenameInput.value = result.name;
  editor.setCode(result.text);
  syncLanguage();
  persist();
  if (result.hidden) warnHidden(result.hidden, "");
});

$("save-btn").addEventListener("click", () => {
  const name = sanitizeFilename(filenameInput.value);
  filenameInput.value = name;
  downloadFile(name, editor.getCode());
});

$("share-btn").addEventListener("click", async () => {
  const name = sanitizeFilename(filenameInput.value);
  const file = { filename: name, code: editor.getCode(), stdin: stdinInput.value };
  if (!detectLanguage(name)) return showNotice("Only Python, C and C++ files (.py, .c, .cpp) can be shared.");
  const problem = shareProblem(file);
  if (problem) {
    const hidden = editor.getCode().match(HIDDEN)?.length ?? 0;
    if (hidden && !shareProblem({ ...file, code: removeHidden(file.code) })) return warnHidden(hidden, ". Press Share again");
    return showNotice(problem);
  }
  const url = await makeShareUrl(file, location.href);
  if (!url) return showNotice("This file is too long to share as a link. Use Save and send the file instead.");
  // Phones: the system share sheet (WhatsApp, Telegram…). Elsewhere: copy the link.
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: name, url });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // the student closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showNotice("Link copied. Whoever opens it gets this file; it won't run until they press Run.", { tone: "info" });
  } catch {
    showNotice(`Copy this link: ${url}`, { tone: "info" });
  }
});

$("new-btn").addEventListener("click", () => newDialog.showModal());
newDialog.addEventListener("close", () => {
  const choice = newDialog.returnValue as LanguageId | "cancel" | "";
  if (!choice || choice === "cancel") return;
  const lang = languageById(choice);
  filenameInput.value = lang.defaultFilename;
  editor.setCode(lang.sample);
  stdinInput.value = "";
  syncLanguage();
  persist();
  editor.view.focus();
});

// ---------- run ----------
runBtn.addEventListener("click", () => void onRun());

async function onRun() {
  dismissWelcome(); // they found Run: the note has done its job
  if (running) return isCompiled(detectLanguage(filenameInput.value)) ? cpp.stop() : runner.stop();
  const lang = detectLanguage(filenameInput.value);
  if (!lang) return showNotice("Give the file a .py, .c or .cpp name so Pocket Run knows how to run it.");
  if (isCompiled(lang)) {
    if (cpp.state === "absent" || cpp.state === "checking") {
      renderStatus();
      showNotice("Download the C/C++ compiler first (once). The button is in Output.");
      // Phones: the offer is in the Output tab. Bring the whole offer above the fixed Run bar, then focus
      // without the browser's minimal scroll. The notice just made the bar taller; measure it now
      // (ResizeObserver reports only after layout).
      views.show("output");
      syncDockHeight();
      printout.scrollIntoView({ block: "start" });
      packButton.focus({ preventScroll: true });
      return;
    }
    if (cpp.state === "downloading") return showNotice("The C/C++ download is still running. Run will work as soon as it finishes.");
    if (cpp.state === "failed") return showNotice("The C/C++ compiler couldn't start. Reload the page to retry.");
  } else if (runner.state === "failed") {
    return showNotice("Python couldn't start. Check your connection once and reload.");
  }
  showNotice("");

  running = true;
  // An empty Input box only takes space while the program runs (answers are typed where it asks).
  if (!stdinInput.value) stdinBox.open = false;
  views.show("output"); // phones: the run is watched (and answered) in the Output tab
  runBtn.toggleAttribute("data-running", true);
  runLabel.textContent = "Stop";
  output.replaceChildren();
  receipt.removeAttribute("data-status");
  let phase = isCompiled(lang) ? "compiling" : runner.state === "booting" ? "waiting for Python to start" : "running";
  let phaseStarted = performance.now();
  let waitingForInput = false;
  const showPhase = () => {
    receipt.textContent = waitingForInput
      ? "waiting for input, timer paused" // short: keeps the Output header one line on a phone
      : `${phase}… ${((performance.now() - phaseStarted) / 1000).toFixed(1)} s`;
  };
  const tick = setInterval(showPhase, 100);
  showPhase();

  const options: RunOptions = {
    code: editor.getCode(),
    stdin: stdinInput.value,
    filename: sanitizeFilename(filenameInput.value),
    timeoutMs: RUN_TIMEOUT_MS,
    outputCap: OUTPUT_CAP,
    onPhase: (p) => {
      phase = p === "starting" ? "starting the compiler" : p;
      phaseStarted = performance.now();
      showPhase();
    },
    onInputRequest: () => {
      waitingForInput = true;
      showPhase();
      askForInput((line) => {
        waitingForInput = false;
        phaseStarted = performance.now();
        (isCompiled(lang) ? cpp : runner).provideInput(line);
      });
    },
    onOutput: ({ stream, text }) => {
      if (stream === "stderr") {
        const span = document.createElement("span");
        span.className = "err";
        span.textContent = text;
        output.append(span);
      } else {
        output.append(text);
      }
    },
  };

  try {
    const result = isCompiled(lang) ? await cpp.run({ ...options, lang: lang.id }) : await runner.run(options);
    renderReceipt(result, lang.label);
    const hint = isCompiled(lang) ? cHint(options.code, result.status) : null;
    if (hint) showNotice(hint, { tone: "info" });
  } catch (e) {
    receipt.textContent = `couldn't run: ${(e as Error).message}`;
  } finally {
    clearInterval(tick);
    closeLiveInput();
    running = false;
    runBtn.removeAttribute("data-running");
    runLabel.textContent = "Run";
    printout.classList.remove("fresh");
    void printout.offsetWidth; // restart the arrive animation
    printout.classList.add("fresh");
    // Phones: the result is in the Output tab; if the student went back to the code meanwhile, mark the tab.
    views.markNewOutput();
  }
}

// ---------- live input: the program asks while it runs ----------
const liveForm = $<HTMLFormElement>("live-input");
const liveField = $<HTMLInputElement>("live-input-field");
let answer: ((line: string | null) => void) | null = null;

function echo(text: string, className: string) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  output.append(span);
}

function askForInput(reply: (line: string | null) => void) {
  answer = reply;
  liveForm.hidden = false;
  liveField.value = "";
  syncDockHeight();
  liveField.focus({ preventScroll: true });
  keepAboveDock(liveForm);
  // Check again once layout has settled (a focus scroll or late reflow can still move it).
  requestAnimationFrame(() => requestAnimationFrame(() => { if (answer) keepAboveDock(liveForm); }));
}

/**
 * Scrolls just enough that `el` sits fully above the fixed Run bar on phones. Measured directly:
 * WebKit applied the page's scroll-padding to scrollIntoView() only some of the time, leaving the
 * box 14 px short in about half of the runs.
 */
function keepAboveDock(el: HTMLElement) {
  // Phones use the Code/Output tabs: the page doesn't scroll, the output does, and it ends above the Run bar.
  if (views.active || getComputedStyle(dock).position !== "fixed") return el.scrollIntoView({ block: "nearest" });
  const gap = 12;
  const box = el.getBoundingClientRect();
  const limit = dock.getBoundingClientRect().top - gap;
  if (box.bottom > limit) window.scrollBy(0, box.bottom - limit);
  else if (box.top < gap) window.scrollBy(0, box.top - gap);
}

function closeLiveInput() {
  answer = null;
  liveForm.hidden = true;
}

function sendLine(line: string | null) {
  const reply = answer;
  if (!reply) return;
  closeLiveInput();
  // Echo what was typed after the program's prompt, the way a terminal shows it.
  echo(line === null ? "(end of input)\n" : line + "\n", line === null ? "echo muted" : "echo");
  reply(line === null ? null : line + "\n");
}

liveForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendLine(liveField.value);
});
$("live-input-end").addEventListener("click", () => sendLine(null));
liveField.addEventListener("keydown", (e) => {
  if (e.key === "d" && e.ctrlKey) { e.preventDefault(); sendLine(null); } // Ctrl+D = end of input, like a terminal
});

const formatMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

function renderReceipt(r: RunResult, label: string) {
  const head: Record<RunResult["status"], string> = {
    ok: "finished",
    error: r.crash ? "crashed" : `exit ${r.exitCode}`,
    "compile-error": "didn't compile",
    timeout: r.stage === "compile" ? "stopped: compiling took too long" : `stopped: still running after ${RUN_TIMEOUT_MS / 1000} s`,
    stopped: "stopped by you",
    "output-limit": `stopped: output passed ${OUTPUT_CAP / 1024} KB`,
  };
  receipt.dataset.status = r.status;
  const strong = document.createElement("strong");
  strong.textContent = head[r.status];
  const facts = [formatMs(r.ms), label];
  if (r.compileMs !== undefined && r.status !== "compile-error") facts.splice(1, 0, `compiled in ${formatMs(r.compileMs)}`);
  // Separate spans (spaced by CSS) instead of a run of " · " separators.
  receipt.replaceChildren(strong, ...facts.map((text) => Object.assign(document.createElement("span"), { textContent: ` ${text}` })));
}
