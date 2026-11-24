/**
 * debugger: read the student's variables out of a Skulpt 1.2 suspension chain.
 *
 * With `debugging: true`, every Python frame that suspends is saved by the compiled code's
 * `$saveSuspension`: the suspension carries `$gbl` (the module globals object), `$loc`
 * (=== $gbl at module level) and `$tmps` — a snapshot of the frame's JS locals, which are the
 * Python locals (parameters included) plus compiler temporaries (names starting with "$").
 * Names that clash with JS reserved words are stored mangled as `name_$rw$`.
 * The chain runs outermost (module) → innermost via `.child`.
 *
 * Everything here is defensive: it must never throw (the panel calls it while a program runs).
 */
import type { VarView } from "../core/modules";
import { CONSTANTS, TOP_LEVEL } from "../runtime/names";

const MAIN_FILE = "<stdin>.py";
const MAX_VALUE = 80;
const MAX_VARS = 60;

/** Names never shown: the robot API objects, start/wait/print and the constants. */
const HIDDEN_NAMES = new Set<string>([...TOP_LEVEL, ...CONSTANTS]);
/** Python types never shown (functions, classes, modules...). */
const HIDDEN_TYPES = new Set<string>([
  "function", "builtin_function_or_method", "method", "module", "type", "classmethod", "staticmethod",
  "generator", "method-wrapper", "wrapper_descriptor", "method_descriptor", "getset_descriptor",
  // the robot API classes (src/runtime makeObject)
  "Drivetrain", "DistanceSensor", "FrontEye", "DownEye", "Bumper", "Location", "Pen", "Magnet", "Brain", "Screen", "Timer",
]);

function unmangle(name: string): string {
  return name.endsWith("_$rw$") ? name.slice(0, -5) : name;
}

function typeName(v: any): string {
  try { return String(Sk.abstr.typeName(v)); } catch { return "object"; }
}

function clip(s: string, max = MAX_VALUE): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Float shown the student-friendly way: 2.0, 3.142, 0.3 (not 0.30000000000000004). */
export function formatFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);
  const a = Math.abs(x);
  if (a < 1e-3 || a >= 1e16) return x.toPrecision(3);
  const r = parseFloat(x.toFixed(3));
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
}

function quote(s: string, budget: number): string {
  const body = s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  const q = body.includes("'") && !body.includes('"') ? '"' : "'";
  const esc = q === "'" ? body.replace(/'/g, "\\'") : body;
  const max = Math.max(4, budget - 2);
  return q + (esc.length > max ? esc.slice(0, max - 1) + "…" : esc) + q;
}

/** A short repr of a Python value. `budget` = rough max characters. Never throws. */
export function formatValue(v: any, budget = MAX_VALUE, depth = 0): string {
  try {
    if (v === undefined || v === null) return "?";
    if (v === Sk.builtin.none.none$) return "None";
    if (v instanceof Sk.builtin.bool) return v === Sk.builtin.bool.true$ ? "True" : "False";
    if (v instanceof Sk.builtin.float_) return formatFloat(Number(v.v));
    if (v instanceof Sk.builtin.int_ || (Sk.builtin.lng && v instanceof Sk.builtin.lng)) {
      return clip(String(Sk.misceval.objectRepr(v)), budget);
    }
    if (v instanceof Sk.builtin.str) return quote(String(v.v), budget);
    const isList = v instanceof Sk.builtin.list, isTuple = v instanceof Sk.builtin.tuple;
    const isSet = (Sk.builtin.set && v instanceof Sk.builtin.set) || (Sk.builtin.frozenset && v instanceof Sk.builtin.frozenset);
    if (isList || isTuple || isSet) {
      const items: any[] = isSet ? Sk.misceval.arrayFromIterable(v) : v.v;
      const [open, close] = isList ? ["[", "]"] : isTuple ? ["(", ")"] : ["{", "}"];
      if (isSet && items.length === 0) return "set()";
      if (depth >= 2) return open + (items.length ? "…" : "") + close;
      return seq(open, close, items.map((x) => (b: number) => formatValue(x, b, depth + 1)), budget, isTuple && items.length === 1);
    }
    if (v instanceof Sk.builtin.dict) {
      const keys: any[] = Sk.misceval.arrayFromIterable(v);
      if (depth >= 2) return keys.length ? "{…}" : "{}";
      return seq("{", "}", keys.map((k) => (b: number) => {
        const ks = formatValue(k, Math.max(8, b / 2), depth + 1);
        return ks + ": " + formatValue(v.mp$lookup(k), Math.max(4, b - ks.length - 2), depth + 1);
      }), budget, false);
    }
    return "<" + typeName(v) + ">";
  } catch {
    return "?";
  }
}

function seq(open: string, close: string, parts: ((budget: number) => string)[], budget: number, trailingComma: boolean): string {
  let out = open;
  for (let i = 0; i < parts.length; i++) {
    const room = budget - out.length - close.length;
    if (room < 4) { out += "…"; break; }
    const s = parts[i](Math.min(room, 40));
    if (out.length + s.length + close.length > budget) { out += "…"; break; }
    out += (i ? ", " : "") + s;
    if (i < parts.length - 1 && out.length + 2 + close.length >= budget) { out += ", …"; break; }
  }
  if (trailingComma) out += ",";
  return clip(out + close, budget + 2);
}

function view(name: string, v: any, scope: "global" | "local"): VarView | null {
  if (v === undefined || v === null) return null;          // not assigned yet
  const n = unmangle(name);
  if (n.startsWith("$") || n.startsWith("__") || HIDDEN_NAMES.has(n)) return null;
  const t = typeName(v);
  if (HIDDEN_TYPES.has(t)) return null;
  return { name: n, value: formatValue(v), type: t, scope };
}

/** The student's variables visible from the innermost Python frame of a suspension. Never throws. */
export function collectVars(susp: any): VarView[] {
  const out: VarView[] = [];
  try {
    const frames: any[] = [];
    for (let s = susp, guard = 0; s && guard < 200; s = s.child, guard++) {
      if (s.$filename === MAIN_FILE && s.$tmps) frames.push(s);
    }
    if (!frames.length) return out;
    const inner = frames[frames.length - 1];
    if (inner.$loc !== inner.$gbl) {
      for (const k of Object.keys(inner.$tmps)) {
        const r = view(k, inner.$tmps[k], "local");
        if (r) out.push(r);
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
    }
    const gbl = inner.$gbl || frames[0].$gbl;
    if (gbl) {
      for (const k of Object.keys(gbl)) {
        if (out.length >= MAX_VARS) break;
        const r = view(k, gbl[k], "global");
        if (r) out.push(r);
      }
    }
  } catch { /* never throw from the panel */ }
  return out.slice(0, MAX_VARS);
}
