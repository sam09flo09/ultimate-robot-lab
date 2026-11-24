/**
 * debugger: autocomplete, hover help and signature hints for the Python editor (CodeMirror 6).
 * All text comes from ./apiDocs (one source, checked against the runtime's names).
 */
import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { localCompletionSource } from "@codemirror/lang-python";
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from "@codemirror/view";
import { ALL_DOCS, KEYWORD_TIPS, docFor, membersOf, type ApiDoc } from "./apiDocs";

// ---------------------------------------------------------------- completion

function infoNode(d: ApiDoc): () => Node {
  return () => tipDom(d);
}

/** "drivetrain.drive_for(FORWARD, 200, MM)" -> "drive_for(${1:FORWARD}, ${2:200}, ${3:MM})" */
function callSnippet(d: ApiDoc): string | null {
  const short = d.name.split(".").pop()!;
  const re = new RegExp("\\b" + short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\(([^)\\n]*)\\)");
  const mm = re.exec(d.example);
  if (!mm) return null;
  const args = mm[1].trim();
  if (!args) return short + "()${}";
  // explicit field numbers: a bare ${200} would be read as "field 200" with no text
  const parts = args.split(/,\s*/).map((a, i) => "${" + (i + 1) + ":" + a.replace(/[{}$\\]/g, "") + "}");
  return short + "(" + parts.join(", ") + ")";
}

function apiCompletion(d: ApiDoc, label: string, boost = 0): Completion {
  const base: Completion = {
    label,
    detail: d.signature || (d.returns ? "→ " + d.returns : undefined),
    info: infoNode(d),
    type: d.kind === "object" ? "namespace" : d.kind === "constant" ? "constant" : d.kind === "method" ? "method" : "function",
    boost,
  };
  if (d.kind === "method" || d.kind === "function") {
    const s = callSnippet(d);
    if (s) return snippetCompletion(s, base);
  }
  return base;
}

const TOP_OPTIONS: Completion[] = [
  ...ALL_DOCS.filter((d) => !d.name.includes(".")).map((d) => apiCompletion(d, d.name, d.kind === "constant" ? 0 : 2)),
  ...KEYWORD_TIPS.map((k): Completion => (k.snippet
    ? snippetCompletion(k.snippet, { label: k.label, detail: k.detail, type: "keyword", boost: -1 })
    : { label: k.label, detail: k.detail, type: "keyword", boost: -1 })),
];

function inStringOrComment(state: EditorState, pos: number): boolean {
  const n = syntaxTree(state).resolveInner(pos, -1);
  for (let x: typeof n | null = n; x; x = x.parent) {
    if (x.name === "Comment" || x.name === "String" || x.name === "FormatString") return true;
  }
  return false;
}

export function apiCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[A-Za-z_][\w.]*$/);
  if (!word && !ctx.explicit) return null;
  if (inStringOrComment(ctx.state, ctx.pos)) return null;
  const text = word ? word.text : "";
  const dot = text.lastIndexOf(".");
  if (dot >= 0) {
    const obj = text.slice(0, dot);
    const members = membersOf(obj);
    if (!members.length) return null;
    return {
      from: word!.from + dot + 1,
      options: members.map((d) => apiCompletion(d, d.name.slice(obj.length + 1))),
      validFor: /^\w*$/,
    };
  }
  return { from: word ? word.from : ctx.pos, options: TOP_OPTIONS, validFor: /^\w*$/ };
}

// ---------------------------------------------------------------- hover + DOM

function tipDom(d: ApiDoc): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-api-tip";
  const head = document.createElement("code");
  head.className = "cm-api-sig";
  head.textContent = d.name + (d.signature || "") + (d.returns ? "  → " + d.returns : "");
  const p = document.createElement("div");
  p.className = "cm-api-desc";
  p.textContent = d.description;
  const ex = document.createElement("pre");
  ex.className = "cm-api-ex";
  ex.textContent = d.example;
  box.append(head, p, ex);
  return box;
}

/** The dotted name under `pos` ("drivetrain.drive_for" when hovering drive_for). */
export function nameAt(lineText: string, offset: number): { name: string; from: number; to: number } | null {
  const isW = (c: string) => /[\w]/.test(c);
  if (offset < 0 || offset > lineText.length) return null;
  let s = offset, e = offset;
  while (s > 0 && (isW(lineText[s - 1]) || lineText[s - 1] === ".")) s--;
  while (e < lineText.length && isW(lineText[e])) e++;
  if (e === s) return null;
  const raw = lineText.slice(s, e);
  const name = raw.replace(/^\.+/, "");
  if (!name || /^\d/.test(name)) return null;
  return { name, from: s + (raw.length - name.length), to: e };
}

const hover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const hit = nameAt(line.text, pos - line.from);
  if (!hit || inStringOrComment(view.state, pos)) return null;
  const d = docFor(hit.name);
  if (!d) return null;
  return {
    pos: line.from + hit.to - hit.name.split(".").pop()!.length,
    end: line.from + hit.to,
    above: true,
    create: () => ({ dom: tipDom(d) }),
  };
}, { hoverTime: 350 });

// ---------------------------------------------------------------- signature hint inside ( )

/** Finds the call the cursor is inside on the current line: name + which argument. */
export function callAt(lineText: string, offset: number): { name: string; arg: number; parenAt: number } | null {
  let depth = 0, arg = 0, quote = "";
  // scan left from the cursor; first work out strings from the left so quotes are skipped
  const inStr: boolean[] = [];
  for (let i = 0; i < lineText.length; i++) {
    const c = lineText[i];
    if (quote) { inStr[i] = true; if (c === "\\") { inStr[i + 1] = true; i++; } else if (c === quote) quote = ""; continue; }
    if (c === "#") { for (let j = i; j < lineText.length; j++) inStr[j] = true; break; }
    if (c === "'" || c === '"') { quote = c; inStr[i] = true; }
  }
  for (let i = offset - 1; i >= 0; i--) {
    if (inStr[i]) continue;
    const c = lineText[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "[" || c === "{") { if (depth) depth--; else return null; }
    else if (c === "(") {
      if (depth) { depth--; continue; }
      const m = /([A-Za-z_][\w.]*)\s*$/.exec(lineText.slice(0, i));
      if (!m) return null;
      return { name: m[1], arg, parenAt: i };
    } else if (c === "," && depth === 0) arg++;
  }
  return null;
}

function sigTooltip(state: EditorState): Tooltip | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const line = state.doc.lineAt(sel.head);
  const call = callAt(line.text, sel.head - line.from);
  if (!call) return null;
  const d = docFor(call.name);
  if (!d || (d.kind !== "method" && d.kind !== "function") || !d.signature || d.signature === "()") return null;
  return {
    pos: line.from + call.parenAt,
    above: true,
    strictSide: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-sig-tip";
      const params = d.signature.slice(1, -1).split(/,\s*/);
      dom.append(d.name.split(".").pop()! + "(");
      params.forEach((p, i) => {
        if (i) dom.append(", ");
        const isCur = i === Math.min(call.arg, params.length - 1) && p !== "...";
        if (isCur) { const b = document.createElement("b"); b.textContent = p; dom.append(b); } else dom.append(p);
      });
      dom.append(")");
      return { dom };
    },
  };
}

const sigField = StateField.define<Tooltip | null>({
  create: sigTooltip,
  update(v, tr) {
    if (!tr.docChanged && !tr.selection) return v;
    return sigTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

const assistTheme = EditorView.baseTheme({
  ".cm-api-tip": { padding: "8px 10px", maxWidth: "380px", fontFamily: "var(--body, system-ui)", fontSize: "13px", lineHeight: "1.35" },
  ".cm-api-sig": { display: "block", fontFamily: "var(--mono, monospace)", fontWeight: "600", color: "#1F4FA8", marginBottom: "4px", whiteSpace: "pre-wrap" },
  ".cm-api-desc": { color: "#0C0B0A" },
  ".cm-api-ex": { margin: "6px 0 0", padding: "4px 6px", background: "#F6F1E8", borderRadius: "4px", fontFamily: "var(--mono, monospace)", fontSize: "12px", whiteSpace: "pre" },
  ".cm-sig-tip": { padding: "3px 8px", fontFamily: "var(--mono, monospace)", fontSize: "12.5px", color: "#3A3631" },
  ".cm-sig-tip b": { color: "#D6540E" },
  ".cm-tooltip": { border: "1px solid #E9E0D2", borderRadius: "6px", background: "#FFFDF9", boxShadow: "0 4px 14px rgba(12,11,10,.12)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#FFE1C9", color: "#0C0B0A" },
  ".cm-completionDetail": { fontStyle: "normal", opacity: ".7", marginLeft: "8px" },
  ".cm-tooltip.cm-completionInfo": { padding: "0" },
});

/** Everything the Python editor needs: completions, hover help, signature hints. */
export function pythonAssist(): Extension {
  return [
    autocompletion({ override: [apiCompletionSource, localCompletionSource], activateOnTyping: true, icons: false }),
    hover,
    sigField,
    assistTheme,
  ];
}
