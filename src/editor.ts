import { closeBrackets, closeBracketsKeymap, insertBracket } from "@codemirror/autocomplete";
import { cursorCharLeft, cursorCharRight, defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type KeyBinding,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { LanguageId } from "./languages";

// Colours come from CSS variables so light/dark switch with the page, not with JS.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string), t.character], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.function(t.definition(t.variableName)), t.definition(t.className)], color: "var(--syn-def)" },
  // Calls like print() / input() / printf(): beginners read code by its function calls.
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.standard(t.variableName)], color: "var(--syn-def)" },
  { tag: [t.processingInstruction, t.meta], color: "var(--syn-keyword)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--ink)", backgroundColor: "var(--sheet)" },
  ".cm-scroller": { fontFamily: "var(--font-code)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--accent)", padding: "12px 0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-gutters": { backgroundColor: "var(--sheet)", color: "var(--muted)", border: "none", paddingLeft: "4px" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--selection)" },
  ".cm-matchingBracket": { backgroundColor: "var(--selection)", outline: "none" },
  "&.cm-focused": { outline: "none" },
});

const languageExtension = (id: LanguageId | null): Extension =>
  id === "python" ? python() : id === "c" || id === "cpp" ? cpp() : [];

export interface CodeEditor {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  setLanguage(id: LanguageId | null): void;
  /** Inserts text at the cursor the way typing it would (brackets and quotes get their pair). */
  type(text: string): void;
  moveCursor(direction: "left" | "right"): void;
}

export function createEditor(
  parent: HTMLElement,
  options: { code: string; language: LanguageId | null; onChange: () => void; extraKeys: KeyBinding[] },
): CodeEditor {
  const lang = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.code,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        indentUnit.of("    "),
        // Wrap long lines instead of scrolling sideways: on a phone, sideways scrolling hides
        // the start of every line (the line number stays with the first row of a wrapped line).
        EditorView.lineWrapping,
        EditorState.tabSize.of(4),
        // Tab indents; Escape then Tab leaves the editor (CodeMirror's keyboard-trap escape hatch).
        keymap.of([...options.extraKeys, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(highlight),
        theme,
        lang.of(languageExtension(options.language)),
        EditorView.contentAttributes.of({ "aria-label": "Code editor", autocapitalize: "off", autocorrect: "off", spellcheck: "false" }),
        EditorView.updateListener.of((u) => { if (u.docChanged) options.onChange(); }),
      ],
    }),
  });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    setLanguage: (id) => view.dispatch({ effects: lang.reconfigure(languageExtension(id)) }),
    type: (text) => {
      const bracket = text.length === 1 ? insertBracket(view.state, text) : null;
      view.dispatch(bracket ?? { ...view.state.replaceSelection(text), scrollIntoView: true, userEvent: "input.type" });
    },
    moveCursor: (direction) => { (direction === "left" ? cursorCharLeft : cursorCharRight)(view); },
  };
}
