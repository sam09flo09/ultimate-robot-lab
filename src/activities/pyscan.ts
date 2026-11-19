/**
 * A small, tolerant Python tokenizer for activity code checks.
 * It never throws: broken or half-typed code still scans (an unterminated string runs to the end
 * of its line, unbalanced brackets are clamped). Comments and string literals become their own
 * tokens, so checks never match text inside them.
 */

export type TokKind = "name" | "number" | "string" | "op" | "comment";

export interface Tok {
  kind: TokKind;
  text: string;
  line: number;      // 1-based physical line where the token starts
  endLine: number;   // physical line where it ends (multi-line strings)
}

/** One simple statement. `a = 1; b = 2` gives two; `if x: go()` gives the header and the body. */
export interface Stmt {
  /** Indent width of the logical line (tabs to multiples of 8). A body written after a colon on the
   *  same line gets the header's indent + 0.5, so it sits "inside" the header for scope purposes. */
  indent: number;
  toks: Tok[];
  line: number;
}

export interface Scan {
  stmts: Stmt[];
  comments: Tok[];
  /** Physical lines that hold at least some code (not just blanks or comments). */
  codeLines: Set<number>;
}

const MAX_SOURCE = 200_000;

const OPS3 = ["**=", "//=", ">>=", "<<=", "..."];
const OPS2 = ["->", ":=", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=", "**", "//", "<<", ">>"];
const STRING_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

/** Keywords that open a compound statement (their header ends with a colon). */
export const COMPOUND = new Set(["if", "elif", "else", "for", "while", "def", "class", "with", "try", "except", "finally", "async"]);

export const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

export function scanPython(input: string): Scan {
  const src = String(input ?? "").slice(0, MAX_SOURCE).replace(/\r\n?/g, "\n");
  const comments: Tok[] = [];
  const codeLines = new Set<number>();
  const logical: { indent: number; toks: Tok[] }[] = [];

  let i = 0, line = 1, depth = 0;
  let cur: Tok[] = [];
  let curIndent = 0;
  let lineStart = 0;          // index of the first char of the current physical line
  let atLogicalStart = true;  // the next token begins a new logical line

  const indentOf = (from: number, to: number): number => {
    let w = 0;
    for (let k = from; k < to; k++) {
      const c = src[k];
      if (c === " ") w++;
      else if (c === "\t") w = (Math.floor(w / 8) + 1) * 8;
      else if (c === "\f") w = 0;
    }
    return w;
  };
  const push = (t: Tok) => {
    if (atLogicalStart) { curIndent = indentOf(lineStart, i); atLogicalStart = false; }
    cur.push(t);
    for (let l = t.line; l <= t.endLine; l++) codeLines.add(l);
  };
  const endLogical = () => {
    if (cur.length) logical.push({ indent: curIndent, toks: cur });
    cur = []; atLogicalStart = true; depth = 0;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      i++; line++;
      lineStart = i;
      if (depth === 0) endLogical();
      continue;
    }
    if (c === " " || c === "\t" || c === "\f") { i++; continue; }
    if (c === "\\" && src[i + 1] === "\n") { i += 2; line++; lineStart = i; continue; } // explicit continuation
    if (c === "#") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      comments.push({ kind: "comment", text: src.slice(i, j), line, endLine: line });
      i = j;
      continue;
    }
    // names (and string prefixes)
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < src.length && NAME_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      if ((src[j] === "'" || src[j] === '"') && STRING_PREFIX.test(word)) {
        readString(j, i);
        continue;
      }
      push({ kind: "name", text: word, line, endLine: line });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') { readString(i, i); continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9a-zA-Z_.]/.test(src[j])) j++;
      push({ kind: "number", text: src.slice(i, j), line, endLine: line });
      i = j;
      continue;
    }
    // operators
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    let op = c;
    if (OPS3.includes(three)) op = three;
    else if (OPS2.includes(two)) op = two;
    if (op === "(" || op === "[" || op === "{") depth++;
    else if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
    push({ kind: "op", text: op, line, endLine: line });
    i += op.length;
  }
  endLogical();

  /** Reads a string literal whose opening quote is at q (prefix starts at p). */
  function readString(q: number, p: number): void {
    const quote = src[q];
    const triple = src.slice(q, q + 3) === quote.repeat(3);
    const startLine = line;
    let j = q + (triple ? 3 : 1);
    let ln = line;
    let closed = false;
    while (j < src.length) {
      const ch = src[j];
      if (ch === "\\") {
        if (src[j + 1] === "\n") ln++;
        j += 2;
        continue;
      }
      if (ch === "\n") {
        if (!triple) break; // unterminated single-line string: stop at end of line
        ln++; j++; continue;
      }
      if (triple ? src.slice(j, j + 3) === quote.repeat(3) : ch === quote) {
        j += triple ? 3 : 1; closed = true; break;
      }
      j++;
    }
    if (!closed && triple) j = src.length;
    i = p; // so push() measures the indent from the prefix position
    push({ kind: "string", text: src.slice(p, j), line: startLine, endLine: ln });
    // physical line bookkeeping for multi-line strings
    if (ln > line) {
      const lastNl = src.lastIndexOf("\n", j - 1);
      lineStart = lastNl + 1;
      line = ln;
    }
    i = j;
  }

  return { stmts: splitStatements(logical), comments, codeLines };
}

/** Split logical lines on top-level ";" and after the header colon of a one-line compound statement. */
function splitStatements(logical: { indent: number; toks: Tok[] }[]): Stmt[] {
  const out: Stmt[] = [];
  for (const ll of logical) {
    let parts: Tok[][] = [[]];
    let d = 0;
    for (const t of ll.toks) {
      if (t.kind === "op") {
        if (t.text === "(" || t.text === "[" || t.text === "{") d++;
        else if (t.text === ")" || t.text === "]" || t.text === "}") d = Math.max(0, d - 1);
        else if (t.text === ";" && d === 0) { parts.push([]); continue; }
      }
      parts[parts.length - 1].push(t);
    }
    parts = parts.filter((p) => p.length);
    let indent = ll.indent;
    for (const p of parts) {
      // one-line compound: `if x: go()`, `def f(): return 1`, `else: stop()`
      let rest = p;
      let ind = indent;
      while (rest.length && rest[0].kind === "name" && COMPOUND.has(rest[0].text)) {
        const colon = headerColon(rest);
        if (colon < 0 || colon === rest.length - 1) break;
        out.push({ indent: ind, toks: rest.slice(0, colon + 1), line: rest[0].line });
        rest = rest.slice(colon + 1);
        ind += 0.5;
      }
      if (rest.length) out.push({ indent: ind, toks: rest, line: rest[0].line });
      // statements after ";" on a one-line body stay at that body's level
      if (ind !== indent) indent = ind;
    }
  }
  return out;
}

/** Index of the colon that ends a compound-statement header (top level, not a lambda's). */
function headerColon(toks: Tok[]): number {
  let d = 0, lambdas = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "name" && t.text === "lambda" && d === 0) lambdas++;
    if (t.kind !== "op") continue;
    if (t.text === "(" || t.text === "[" || t.text === "{") d++;
    else if (t.text === ")" || t.text === "]" || t.text === "}") d = Math.max(0, d - 1);
    else if (t.text === ":" && d === 0) {
      if (lambdas > 0) { lambdas--; continue; }
      return k;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- queries used by the checks

/** First token of a statement, skipping `async`. */
export function lead(s: Stmt): string {
  const t = s.toks[0]?.kind === "name" && s.toks[0].text === "async" ? s.toks[1] : s.toks[0];
  return t && t.kind === "name" ? t.text : "";
}

/** Every call in the program as a dotted name: "drivetrain.drive_for", "print", "brain.screen.print".
 *  Calls on expressions (`f().g()`, `x[0].y()`) are reported with a leading "." and keywords are skipped. */
export function calls(scan: Scan): string[] {
  const out: string[] = [];
  for (const s of scan.stmts) {
    const t = s.toks;
    for (let j = 1; j < t.length; j++) {
      if (t[j].kind !== "op" || t[j].text !== "(") continue;
      let k = j - 1;
      if (t[k].kind !== "name" || KEYWORDS.has(t[k].text)) continue;
      const parts = [t[k].text];
      while (k >= 2 && t[k - 1].kind === "op" && t[k - 1].text === "." && t[k - 2].kind === "name") {
        parts.unshift(t[k - 2].text);
        k -= 2;
      }
      const before = t[k - 1];
      if (before && before.kind === "name" && (before.text === "def" || before.text === "class")) continue;
      const onExpr = !!before && before.kind === "op" && before.text === ".";
      out.push((onExpr ? "." : "") + parts.join("."));
    }
  }
  return out;
}

/** Names assigned by a statement (`a = 1`, `a, b = 1, 2`, `a += 1`, `a: int = 1`, `x = y = 0`). */
export function assignedNames(s: Stmt): string[] {
  const t = s.toks;
  if (!t.length) return [];
  const walrus: string[] = [];
  for (let k = 1; k < t.length; k++) if (t[k].kind === "op" && t[k].text === ":=" && t[k - 1].kind === "name") walrus.push(t[k - 1].text);
  const first = lead(s);
  if (first && KEYWORDS.has(first) && first !== "True" && first !== "False" && first !== "None") return walrus;
  const AUG = new Set(["+=", "-=", "*=", "/=", "//=", "%=", "**=", ">>=", "<<=", "&=", "|=", "^=", "@="]);
  const targets: Tok[][] = [];
  let d = 0, start = 0, sawAssign = false;
  for (let k = 0; k < t.length; k++) {
    const x = t[k];
    if (x.kind !== "op") continue;
    if (x.text === "(" || x.text === "[" || x.text === "{") d++;
    else if (x.text === ")" || x.text === "]" || x.text === "}") d = Math.max(0, d - 1);
    else if (d === 0 && (x.text === "=" || AUG.has(x.text))) {
      targets.push(t.slice(start, k));
      start = k + 1; sawAssign = true;
      if (AUG.has(x.text)) break;
    }
  }
  if (!sawAssign) return walrus;
  const names: string[] = [...walrus];
  for (const tg of targets) {
    // annotated assignment: name : type = value
    let toks = tg;
    if (toks.length >= 2 && toks[0].kind === "name" && toks[1].kind === "op" && toks[1].text === ":") toks = toks.slice(0, 1);
    // split on top-level commas, strip surrounding brackets
    let dd = 0; let part: Tok[] = [];
    const parts: Tok[][] = [];
    for (const x of toks) {
      if (x.kind === "op" && (x.text === "(" || x.text === "[")) { dd++; continue; }
      if (x.kind === "op" && (x.text === ")" || x.text === "]")) { dd = Math.max(0, dd - 1); continue; }
      if (x.kind === "op" && x.text === ",") { parts.push(part); part = []; continue; }
      if (x.kind === "op" && x.text === "*") continue; // starred target
      part.push(x);
    }
    parts.push(part);
    for (const p of parts) if (p.length === 1 && p[0].kind === "name" && !KEYWORDS.has(p[0].text)) names.push(p[0].text);
  }
  return names;
}

/** Statements with a flag saying whether they are at module level (not inside any def or class). */
export function withScope(scan: Scan): { stmt: Stmt; moduleLevel: boolean }[] {
  const stack: { indent: number; fn: boolean }[] = [];
  const out: { stmt: Stmt; moduleLevel: boolean }[] = [];
  for (const s of scan.stmts) {
    while (stack.length && stack[stack.length - 1].indent >= s.indent) stack.pop();
    out.push({ stmt: s, moduleLevel: !stack.some((b) => b.fn) });
    const kw = lead(s);
    const last = s.toks[s.toks.length - 1];
    if (COMPOUND.has(kw) && last?.kind === "op" && last.text === ":") stack.push({ indent: s.indent, fn: kw === "def" || kw === "class" });
  }
  return out;
}
