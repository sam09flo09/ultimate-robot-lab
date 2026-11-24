/** CodeMirror 6 Python editor with run/error line highlighting. */
import { EditorState, Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  Decoration, type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit, indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";
import { pythonAssist } from "../debug/pythonAssist"; // debugger: autocomplete + hover help

export type LineKind = "run" | "err" | "paused";

const setMark = StateEffect.define<{ line: number; kind: LineKind } | null>();
const runDeco = Decoration.line({ class: "cm-run-line" });
const errDeco = Decoration.line({ class: "cm-err-line" });
const pausedDeco = Decoration.line({ class: "cm-paused-line" });

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setMark)) {
      const v = e.value;
      if (!v || v.line < 1 || v.line > tr.state.doc.lines) deco = Decoration.none;
      else deco = Decoration.set([(v.kind === "err" ? errDeco : v.kind === "paused" ? pausedDeco : runDeco).range(tr.state.doc.line(v.line).from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const style = HighlightStyle.define([
  { tag: t.keyword, color: "#8A2E9E", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#1E6B3A" },
  { tag: t.number, color: "#B3261E" },
  { tag: t.comment, color: "#6B6459", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#1F4FA8" },
  { tag: t.definition(t.variableName), color: "#1F4FA8" },
  { tag: t.bool, color: "#A8420B" },
  { tag: t.operator, color: "#3A3631" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "14px", backgroundColor: "#fff" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "22px" },
  ".cm-gutters": { backgroundColor: "#F6F1E8", color: "#6B6459", border: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(233,224,210,.35)" },
  ".cm-activeLineGutter": { backgroundColor: "#EDE4D5" },
  ".cm-run-line": { backgroundColor: "#FFE1C9 !important", boxShadow: "inset 4px 0 0 #FF6A1A" },
  ".cm-paused-line": { backgroundColor: "#DDEBFF !important", boxShadow: "inset 4px 0 0 #1F4FA8" },
  ".cm-err-line": { backgroundColor: "#FBE9E7 !important", boxShadow: "inset 4px 0 0 #B3261E" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "#0C0B0A" },
  "&.cm-ro .cm-content": { caretColor: "transparent" },
});

export interface PythonEditor {
  view: EditorView;
  getText(): string;
  setText(s: string): void;
  setReadOnly(ro: boolean): void;
  mark(line: number, kind: LineKind): void; // line 0 clears
  focus(): void;
}

export function createPythonEditor(host: HTMLElement, opts: {
  doc: string; onChange?: () => void; onRun?: () => void; readOnly?: boolean; label: string;
  /** debugger: autocomplete, hover help and signature hints (the main Python editor). */
  assist?: boolean;
}): PythonEditor {
  const ro = new Compartment();
  const roExt = (v: boolean): Extension => [EditorState.readOnly.of(v), EditorView.editable.of(!v), EditorView.editorAttributes.of({ class: v ? "cm-ro" : "" })];
  const runKey = keymap.of([{ key: "Mod-Enter", preventDefault: true, run: () => { opts.onRun?.(); return true; } }]);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        runKey,
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
        indentUnit.of("    "), EditorState.tabSize.of(4), indentOnInput(), bracketMatching(),
        python(), syntaxHighlighting(style), theme, markField,
        opts.assist ? pythonAssist() : [],
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        ro.of(roExt(!!opts.readOnly)),
        EditorView.contentAttributes.of({ "aria-label": opts.label, spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
        EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange?.(); }),
      ],
    }),
  });
  let lastMark = "";
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(s) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s }, effects: setMark.of(null) }); lastMark = ""; },
    setReadOnly(v) { view.dispatch({ effects: ro.reconfigure(roExt(v)) }); },
    mark(line, kind) {
      const key = line + kind;
      if (key === lastMark) return;
      lastMark = key;
      if (!line || line > view.state.doc.lines) { view.dispatch({ effects: setMark.of(null) }); return; }
      const pos = view.state.doc.line(line).from;
      view.dispatch({ effects: [setMark.of({ line, kind }), EditorView.scrollIntoView(pos, { y: "nearest", yMargin: 40 })] });
    },
    focus: () => view.focus(),
  };
}
