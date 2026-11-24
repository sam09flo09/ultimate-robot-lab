/**
 * Turns a Python error into a student-friendly explanation (safe HTML).
 * Pure functions with no Skulpt dependency, so they are easy to unit-test.
 * Wording follows friendly() in docs/reference/original-app-script.js.
 */
import type { FriendlyError } from "../core/modules";
import {
  API_OBJECTS, CONSTANTS, TOP_LEVEL, PY_NAMES, ALL_METHOD_NAMES, CONTROLLER_AXES, CONTROLLER_BUTTONS, objectByClass, ownersOf,
} from "./names";

export interface ErrorInfo {
  type: string;      // Python exception class name
  raw: string;       // Python's own message
  line: number;      // 1-based, 0 if unknown
  /** true when the message was written by Robot Lab's own argument checks (already friendly) */
  ours?: boolean;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
const code = (s: string) => "<code>" + esc(s) + "</code>";

/** Optimal-string-alignment edit distance (insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) { d.push(new Array(n + 1).fill(0)); d[i][0] = i; }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/**
 * Best correction for `name` among `candidates`:
 * an exact case-insensitive match first ("case"), else the closest spelling ("typo"), else null.
 */
export function closestName(name: string, candidates: Iterable<string>): { name: string; kind: "case" | "typo" } | null {
  const list = Array.from(new Set(candidates)).filter((c) => c && c !== name);
  const lower = name.toLowerCase();
  const ci = list.find((c) => c.toLowerCase() === lower);
  if (ci) return { name: ci, kind: "case" };
  if (name.length < 3) return null;
  const limit = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | null = null, bestD = Infinity;
  for (const c of list) {
    if (Math.abs(c.length - name.length) > limit) continue;
    const dist = editDistance(lower, c.toLowerCase());
    if (dist < bestD) { bestD = dist; best = c; }
  }
  return best !== null && bestD <= limit ? { name: best, kind: "typo" } : null;
}

/** Names the student defined (functions, variables, loop variables, imports, parameters). */
export function userNames(source: string): string[] {
  const out = new Set<string>();
  const add = (re: RegExp) => { for (const m of source.matchAll(re)) out.add(m[1]); };
  add(/^\s*def\s+([A-Za-z_]\w*)/gm);
  add(/^\s*class\s+([A-Za-z_]\w*)/gm);
  add(/^\s*([A-Za-z_]\w*)\s*[+\-*/]?=(?!=)/gm);
  add(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g);
  add(/^\s*import\s+([A-Za-z_]\w*)/gm);
  add(/^\s*global\s+([A-Za-z_]\w*)/gm);
  for (const m of source.matchAll(/^\s*def\s+\w+\s*\(([^)]*)\)/gm)) {
    for (const p of m[1].split(",")) { const nm = p.trim().split(/[=:\s]/)[0]; if (/^[A-Za-z_]\w*$/.test(nm)) out.add(nm); }
  }
  return Array.from(out);
}

const COMMON_FIX = "Check the commas between values, that every <code>(</code> has a <code>)</code>, the colon after <code>def main()</code>, and the capitals.";

function syntaxTip(raw: string, line: number, source: string): string {
  const src = source.split("\n");
  let prev = "";
  for (let j = line - 2; j >= 0; j--) {
    if (src[j] !== undefined && src[j].trim() !== "" && !/^\s*#/.test(src[j])) { prev = src[j]; break; }
  }
  const thisLine = src[line - 1] || "";
  const indentOf = (s: string) => (s.match(/^ */) as RegExpMatchArray)[0].length;
  const stripped = thisLine.replace(/#.*$/, "").trim();
  const missingIndent = /:\s*(#.*)?$/.test(prev) && indentOf(thisLine) <= indentOf(prev);
  if (/\t/.test(thisLine)) {
    return "Indenting problem. This line uses a Tab. Use 4 spaces for each level of indenting instead.";
  }
  if (/indent/i.test(raw) || missingIndent || (line === 1 && /^\s+\S/.test(thisLine))) {
    return "Indenting problem. Statements inside <code>def main():</code> are indented 4 spaces. <code>start(main)</code> is not indented.";
  }
  if (/EOF in multi-line/i.test(raw)) {
    // find the line that opened a bracket that was never closed
    let depth = 0, opener = 0;
    src.forEach((l, i) => {
      for (const ch of l.replace(/#.*$/, "")) {
        if ("([{".includes(ch)) { if (depth === 0) opener = i + 1; depth++; }
        else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      }
    });
    return "A bracket was opened but never closed" + (opener ? " (look at line " + opener + ")" : "") +
      ". Every <code>(</code> needs a matching <code>)</code>, and every <code>[</code> a <code>]</code>.";
  }
  if (/^(def|if|elif|else|while|for|class|try|except|finally|with)\b/.test(stripped) && !/:$/.test(stripped)) {
    return "This line needs a colon <code>:</code> at the end, like <code>def main():</code> or <code>while True:</code>.";
  }
  if (/^(if|elif|while)\b[^=]*[^=!<>]=[^=]/.test(stripped)) {
    return "To compare two things use <code>==</code> (two equals signs). One <code>=</code> stores a value.";
  }
  const opens = (stripped.match(/\(/g) || []).length, closes = (stripped.match(/\)/g) || []).length;
  if (opens > closes) return "This line is missing a <code>)</code>. Every <code>(</code> needs a matching <code>)</code>.";
  if (closes > opens) return "This line has an extra <code>)</code>, or is missing a <code>(</code>.";
  if (/\(\s*\w+\s+\w+/.test(stripped) && !/["']/.test(stripped)) {
    return "It looks like a comma is missing between two values. Example: <code>drivetrain.drive_for(FORWARD, 200, MM)</code>.";
  }
  return "Syntax error: Python can't read this line, so nothing ran. " + COMMON_FIX;
}

function nameTip(nm: string, source: string): string {
  const owners = ownersOf(nm);
  if (owners.length) {
    const ex = owners[0].methods[nm];
    return "Python doesn't know the name " + code(nm) + " by itself. It belongs to " +
      owners.map((o) => code(o.path)).join(" / ") + ", so write it with a dot: " + code(ex) + ".";
  }
  if (nm === "main") {
    return "Python doesn't know the name <code>main</code>. <code>start(main)</code> needs a function called main: check that <code>def main():</code> is spelled the same and comes before <code>start(main)</code>.";
  }
  const constCase = CONSTANTS.find((c) => c.toLowerCase() === nm.toLowerCase());
  if (constCase) {
    return "Python doesn't know the name " + code(nm) + ". Capitals matter: did you mean " + code(constCase) + "? Constants like FORWARD and MM are written in CAPITALS.";
  }
  const candidates = [...CONSTANTS, ...TOP_LEVEL, ...PY_NAMES, ...userNames(source)];
  const guess = closestName(nm, candidates);
  if (guess && guess.kind === "case") return "Python doesn't know the name " + code(nm) + ". Capitals matter: did you mean " + code(guess.name) + "?";
  if (guess) return "Python doesn't know the name " + code(nm) + ". Did you mean " + code(guess.name) + "? Check the spelling.";
  if (/^["']/.test(nm)) return "Python doesn't know the name " + code(nm) + ".";
  return "Python doesn't know the name " + code(nm) + ". Check the spelling and capitals. If it is a variable, give it a value (like <code>" + esc(nm) + " = 0</code>) before you use it.";
}

const AXES_TEXT = "axis1 = right stick left/right, axis2 = right stick up/down, axis3 = left stick up/down, axis4 = left stick left/right";

/** controller.<something it doesn't have> */
function controllerAttrTip(attr: string): string {
  const parts = [...CONTROLLER_AXES, ...CONTROLLER_BUTTONS] as string[];
  const head = code("controller") + " has no " + code(attr) + ". ";
  const guess = closestName(attr, parts);
  if (guess && guess.kind === "case") return head + "Capitals matter: did you mean " + code("controller." + guess.name) + "?";
  if (/^ax[ie]s/i.test(attr)) {
    return head + "The controller has axis1 to axis4 (" + AXES_TEXT + "). Example: " + code("controller.axis3.position()") + ".";
  }
  if (/^button/i.test(attr)) {
    return head + "Its buttons are: " + CONTROLLER_BUTTONS.join(", ") + ". Example: " + code("controller.buttonA.pressing()") + ".";
  }
  if (attr === "position") return head + "Read one of its sticks: " + code("controller.axis3.position()") + " (" + AXES_TEXT + ").";
  if (attr === "pressing") return head + "Ask one of its buttons: " + code("controller.buttonA.pressing()") + ".";
  if (guess) return head + "Did you mean " + code("controller." + guess.name) + "?";
  return head + "The controller has axis1 to axis4 (use " + code(".position()") + ") and the buttons " +
    CONTROLLER_BUTTONS.join(", ") + " (use " + code(".pressing()") + ").";
}

function attributeTip(raw: string): string {
  const m = raw.match(/'([^']+)' object has no attribute '([^']+)'/);
  const mod = raw.match(/module '([^']+)' has no attribute '([^']+)'/);
  if (m) {
    const [, cls, attr] = m;
    if (cls === "Controller") return controllerAttrTip(attr);
    const obj = objectByClass(cls);
    if (obj) {
      const methods = Object.keys(obj.methods);
      const guess = closestName(attr, methods);
      if (guess) {
        return code(obj.path) + " has no command " + code(attr) + ". " +
          (guess.kind === "case" ? "Capitals matter: did you mean " : "Did you mean ") + code(obj.path + "." + guess.name) + "?";
      }
      const elsewhere = ownersOf(attr).filter((o) => o !== obj);
      if (elsewhere.length) {
        return code(obj.path) + " has no command " + code(attr) + ". " + code(attr) + " belongs to " +
          code(elsewhere[0].path) + ": " + code(elsewhere[0].methods[attr]) + ".";
      }
      return code(obj.path) + " has no command " + code(attr) + ". It can do: " +
        methods.map((x) => code(x)).join(", ") + " (check the spelling and the underscores).";
    }
    if (cls === "str" && ALL_METHOD_NAMES.includes(attr)) {
      return "You used " + code("." + attr) + " on a piece of text. Did you put quotes around a sensor name? Write it without quotes, like " + code(ownersOf(attr)[0].methods[attr]) + ".";
    }
    if (cls === "function" || cls === "method") {
      return "You used a dot on a function. Check the dots and brackets: for example " + code("drivetrain.drive_for(FORWARD, 200, MM)") + ".";
    }
    return "A " + code(cls) + " value has no " + code(attr) + ". Check the spelling.";
  }
  if (mod) {
    return "The " + code(mod[1]) + " module has no " + code(mod[2]) + ". Check the spelling" +
      (mod[1] === "math" ? " (for example <code>math.sqrt</code>, <code>math.pi</code>, <code>math.floor</code>)." :
        mod[1] === "random" ? " (for example <code>random.randint(1, 6)</code>, <code>random.choice</code>)." : ".");
  }
  return esc(raw);
}

function typeTip(raw: string): string {
  let m = raw.match(/^'([^']+)' object is not callable/);
  if (m) {
    const obj = objectByClass(m[1]);
    if (obj) {
      return code(obj.path) + " is not a command by itself, so it can't have <code>()</code> right after it. Use one of its commands with a dot, like " + code(obj.example) + ".";
    }
    if (m[1] === "str") return "You put <code>()</code> after a piece of text or a constant (like <code>FORWARD()</code>). Constants don't take <code>()</code>.";
    if (m[1] === "NoneType") return "You put <code>()</code> after something that is <code>None</code>. If you wrote <code>start(main())</code>, write <code>start(main)</code> instead.";
    return "You put <code>()</code> after a " + code(m[1]) + " value, which is not a function.";
  }
  m = raw.match(/^(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were)\s+given/);
  if (m) {
    return code(m[1] + "()") + " takes " + m[2] + " value" + (m[2] === "1" ? "" : "s") + " inside the <code>()</code>, but you gave " + m[3] + ".";
  }
  m = raw.match(/^(\w+)\(\) missing (\d+) required argument/);
  if (m) return code(m[1] + "()") + " needs " + m[2] + " more value" + (m[2] === "1" ? "" : "s") + " inside the <code>()</code>. " + esc(raw);
  if (/unsupported operand|can only concatenate|must be str|can't convert|cannot concatenate/.test(raw)) {
    return esc(raw) + ". You can't mix text and numbers with <code>+</code>. Use <code>str(number)</code> to turn a number into text, or <code>print(\"x is\", x)</code> with a comma.";
  }
  return esc(raw);
}

/** Main entry: Python error info -> FriendlyError. */
export function friendly(info: ErrorInfo, source: string): FriendlyError {
  const { type, raw } = info;
  const srcLines = source.split("\n").length;
  const isSyntax = type === "SyntaxError" || type === "IndentationError" || type === "TabError";
  // Skulpt reports "EOF in multi-line statement" one line past the end; keep the line on the page.
  const line = info.line > 0 ? (isSyntax ? Math.min(info.line, Math.max(1, srcLines)) : info.line) : 0;
  const where = line ? "Line " + line + ": " : "";
  let tip: string;
  let showRaw = false;
  if (info.ours) {
    tip = esc(raw);
  } else if (isSyntax) {
    tip = syntaxTip(raw, line, source);
    showRaw = true;
  } else if (type === "NameError" || type === "UnboundLocalError") {
    const m = raw.match(/name '([^']+)'/);
    const nm = m ? m[1] : "";
    tip = nameTip(nm, source);
    if (type === "UnboundLocalError" || /referenced before assignment/.test(raw)) {
      tip = "The variable " + code(nm) + " is used before it gets a value inside this function. Give it a value first, or add <code>global " + esc(nm) + "</code> at the top of the function.";
    }
  } else if (type === "AttributeError") {
    tip = attributeTip(raw);
  } else if (type === "TypeError") {
    tip = typeTip(raw);
  } else if (type === "ZeroDivisionError") {
    tip = "You divided by zero, which has no answer. Check the number after <code>/</code> or <code>%</code> (maybe a sensor or variable was 0).";
  } else if (type === "TimeLimitError" || type === "TimeoutError") {
    tip = "Your program ran too long without stopping. Check for a loop that never ends, and put a <code>wait(…)</code> or a robot command inside it.";
  } else if (type === "RecursionError" || /call stack|recursion/i.test(raw)) {
    tip = "A function kept calling itself and never stopped. Make sure your function doesn't call itself forever.";
  } else if (type === "ImportError" || type === "ModuleNotFoundError") {
    const m = raw.match(/named '?([\w.]+)'?/);
    tip = "Robot Lab can't find the module " + code(m ? m[1] : "?") + ". You can use <code>import math</code> and <code>import random</code>. The robot commands are already there: you don't need to import them.";
  } else if (type === "IndexError") {
    tip = esc(raw) + ". A list was asked for a position it doesn't have. Remember that the first item is number 0.";
  } else if (type === "KeyError") {
    tip = "That key isn't in the dictionary: " + esc(raw) + ".";
  } else if (type === "ExternalError" || type === "Error") {
    tip = "Robot Lab had a problem running this command: " + esc(raw);
  } else {
    tip = esc(raw);
  }
  const html = "<b>" + esc(where + type) + "</b><br>" + tip +
    (showRaw ? "<br><span style='opacity:.8'>Python says: " + esc(raw) + "</span>" : "");
  return { line, type, html, raw };
}

/** Program-shape problems found before running (e.g. start(main()) ). */
export function precheck(source: string): FriendlyError | null {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/#.*$/, "");
    const m = l.match(/^\s*start\s*\(\s*([A-Za-z_]\w*)\s*\(\s*\)\s*\)/);
    if (m) {
      const fn = m[1];
      return {
        line: i + 1, type: "TypeError",
        raw: "start(" + fn + "()) calls " + fn + " too early",
        html: "<b>Line " + (i + 1) + ": TypeError</b><br>Write " + code("start(" + fn + ")") + " with no <code>()</code> after " + esc(fn) +
          ". With the <code>()</code>, Python would run " + esc(fn) + " first and give <code>start</code> its result instead of the function.",
      };
    }
  }
  return null;
}

/** Shown (as a warning log entry) when a program ends without ever calling start(). */
export const MISSING_START_TEXT = "Program finished, but main() never started. Is start(main) still on the last line, not indented?";

/** Names known to the API, for tests and other tools. */
export const KNOWN_NAMES: string[] = [...CONSTANTS, ...TOP_LEVEL, ...API_OBJECTS.map((o) => o.path)];
