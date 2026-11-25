/**
 * Flowchart model: the saved chart, the vocabulary of shapes (robot commands, sensor readings,
 * conditions) and how ONE shape turns into Python. Everything emitted here is from docs/API.md.
 *
 * Shapes keep their settings in `args` (a flat string map) so the side panel, the sanitiser and the
 * generator can all be driven by the same field tables below.
 */
import type { ColorName } from "../core/types";
import { AXIS_NAMES, BUTTON_NAMES, type AxisName, type ButtonName } from "../core/modules";

// ---------------------------------------------------------------- saved chart

export type NodeKind = "start" | "end" | "action" | "input" | "output" | "decision";
/** Where an arrow leaves a shape. Decisions have "yes" and "no"; End has none; the rest "out". */
export type Port = "out" | "yes" | "no";

export interface FlowNode {
  id: string;
  kind: NodeKind;
  x: number;            // top-left, canvas units (grid = 20)
  y: number;
  /** action: the command id (ACTIONS key). Other kinds: unused. */
  op?: string;
  args: Record<string, string>;
}
export interface FlowEdge { id: string; from: string; port: Port; to: string; }
export interface FlowChart {
  format: "robot-lab-flowchart";
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const GRID = 20;
export const LIMITS = { nodes: 200, edges: 400, text: 60, value: 32, id: 24, coord: 20000 };

// ---------------------------------------------------------------- shape sizes (shared by editor, layout, export)

export function nodeSize(kind: NodeKind): { w: number; h: number } {
  switch (kind) {
    case "start": case "end": return { w: 160, h: 60 }; // centre lines up with 200-wide shapes on the 20 grid
    case "decision": return { w: 200, h: 100 };
    default: return { w: 200, h: 60 };
  }
}

// ---------------------------------------------------------------- names

export const COLORS: ColorName[] = ["RED", "GREEN", "BLUE", "YELLOW", "ORANGE", "PURPLE", "WHITE", "BLACK", "NONE"];

const PY_KEYWORDS = ["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
  "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "print", "int", "float", "str",
  "len", "range", "abs", "round", "min", "max", "list", "dict", "set", "bool", "type", "input", "open", "exec", "eval"];
const API_NAMES = ["main", "start", "wait", "competition", "autonomous", "driver_control", // match
  "math", "random", "drivetrain", "distance", "front_eye", "down_eye", "bumper",
  "location", "pen", "magnet", "brain", "controller", "left_motor", "right_motor",
  "FORWARD", "REVERSE", "LEFT", "RIGHT", "MM", "INCHES", "DEGREES", "SECONDS", "MSEC", "PERCENT", "UP", "DOWN",
  "BOOST", "DROP", "X", "Y", ...COLORS];
const RESERVED = new Set([...PY_KEYWORDS, ...API_NAMES]);
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,23}$/;
const NUM_RE = /^-?(\d{1,9}(\.\d{0,6})?|\.\d{1,6})$/;

/** Why a variable name can't be used ("" = fine). */
export function varNameProblem(name: string): string {
  if (!name) return "Give the variable a name.";
  if (!IDENT_RE.test(name)) return "Variable names use letters, digits and _ (no spaces), start with a letter and are at most 24 long.";
  if (RESERVED.has(name)) return `“${name}” is already used by Python or the robot. Pick another name.`;
  return "";
}
export const isVarName = (s: string) => varNameProblem(s) === "";
export const isNumber = (s: string) => NUM_RE.test(s);

/** A "value" field: a number or a variable name. Returns Python or null if invalid. */
export function valueCode(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  if (isNumber(v)) {
    const n = Number(v);
    return Object.is(n, -0) ? "0" : String(n);
  }
  if (isVarName(v)) return v;
  return null;
}
/** Variable referenced by a value field, if any. */
export function valueVar(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  return !isNumber(v) && isVarName(v) ? v : null;
}
/** Python string literal (JSON escapes are valid Python 3 escapes). */
export function pyString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return JSON.stringify(s.replace(/[\u0000-\u001f\u007f]/g, " "));
}

// ---------------------------------------------------------------- sensor / controller readings

export type ReadingType = "num" | "bool" | "color";
export interface Reading { id: string; label: string; type: ReadingType; group: string; needsColor?: boolean; code: (color: string) => string; }

const AXIS_HELP: Record<AxisName, string> = { axis1: "right stick ↔", axis2: "right stick ↕", axis3: "left stick ↕", axis4: "left stick ↔" };
const BUTTON_LABEL = (b: ButtonName) => b.replace("button", "");

export const READINGS: Reading[] = [
  { id: "distance_mm", label: "distance (mm)", type: "num", group: "Sensors", code: () => "distance.get_distance(MM)" },
  { id: "distance_in", label: "distance (inches)", type: "num", group: "Sensors", code: () => "distance.get_distance(INCHES)" },
  { id: "found_object", label: "distance sensor finds an object", type: "bool", group: "Sensors", code: () => "distance.found_object()" },
  { id: "bumper", label: "bumper pressed", type: "bool", group: "Sensors", code: () => "bumper.pressed()" },
  { id: "near_object", label: "front eye near an object", type: "bool", group: "Sensors", code: () => "front_eye.near_object()" },
  { id: "front_detect", label: "front eye sees", type: "bool", group: "Sensors", needsColor: true, code: (c) => `front_eye.detect(${c})` },
  { id: "down_detect", label: "down eye sees", type: "bool", group: "Sensors", needsColor: true, code: (c) => `down_eye.detect(${c})` },
  { id: "front_color", label: "front eye colour", type: "color", group: "Sensors", code: () => "front_eye.color()" },
  { id: "down_color", label: "down eye colour", type: "color", group: "Sensors", code: () => "down_eye.color()" },
  { id: "front_brightness", label: "front eye brightness (%)", type: "num", group: "Sensors", code: () => "front_eye.brightness(PERCENT)" },
  { id: "down_brightness", label: "down eye brightness (%)", type: "num", group: "Sensors", code: () => "down_eye.brightness(PERCENT)" },
  { id: "heading", label: "heading (degrees)", type: "num", group: "Robot", code: () => "drivetrain.heading(DEGREES)" },
  { id: "rotation", label: "rotation (degrees)", type: "num", group: "Robot", code: () => "drivetrain.rotation(DEGREES)" },
  { id: "is_done", label: "done moving", type: "bool", group: "Robot", code: () => "drivetrain.is_done()" },
  { id: "pos_x", label: "x position (mm)", type: "num", group: "Robot", code: () => "location.position(X, MM)" },
  { id: "pos_y", label: "y position (mm)", type: "num", group: "Robot", code: () => "location.position(Y, MM)" },
  { id: "timer_s", label: "timer (seconds)", type: "num", group: "Robot", code: () => "brain.timer.time(SECONDS)" },
  { id: "timer_ms", label: "timer (msec)", type: "num", group: "Robot", code: () => "brain.timer.time(MSEC)" },
  ...AXIS_NAMES.map((a): Reading => ({ id: a, label: `controller ${a} (${AXIS_HELP[a]})`, type: "num", group: "Controller", code: () => `controller.${a}.position()` })),
  ...BUTTON_NAMES.map((b): Reading => ({ id: b, label: `controller button ${BUTTON_LABEL(b)} pressed`, type: "bool", group: "Controller", code: () => `controller.${b}.pressing()` })),
];
export const READING_BY_ID = new Map(READINGS.map((r) => [r.id, r]));
const colorArg = (c: string | undefined) => (COLORS as string[]).includes(c ?? "") ? c! : "BLACK";

/** Short text for a reading, used in shape labels. */
function readingShort(id: string, color: string | undefined): string {
  const r = READING_BY_ID.get(id);
  if (!r) return "?";
  if (r.needsColor) return `${r.label} ${colorArg(color)}`;
  if (r.group === "Controller") return r.type === "num" ? `controller ${id}` : `button ${BUTTON_LABEL(id as ButtonName)} pressed`;
  return r.label;
}

// ---------------------------------------------------------------- field tables (drive the side panel + sanitiser)

export type Field =
  | { key: string; label: string; kind: "choice"; options: [string, string][]; dflt: string; hw?: "pen" | "magnet" }
  | { key: string; label: string; kind: "value"; dflt: string }      // number or variable
  | { key: string; label: string; kind: "var"; dflt: string }        // a variable to set
  | { key: string; label: string; kind: "optvar"; dflt: string }     // a variable, or blank
  | { key: string; label: string; kind: "text"; dflt: string }       // free text (printed)
  | { key: string; label: string; kind: "reading"; dflt: string; types: ReadingType[] }
  | { key: string; label: string; kind: "color"; dflt: string };

const DIR_FR: [string, string][] = [["FORWARD", "forward"], ["REVERSE", "reverse"]];
const DIR_LR: [string, string][] = [["LEFT", "left"], ["RIGHT", "right"]];
const MOTORS: [string, string][] = [["left_motor", "left motor"], ["right_motor", "right motor"]];
const OUT_FIELDS: Field[] = [
  { key: "text", label: "Text", kind: "text", dflt: "Hello" },
  { key: "value", label: "then the variable", kind: "optvar", dflt: "" },
];

export interface ActionSpec {
  label: string;               // menu text
  group: string;
  hw?: "pen" | "magnet";
  fields: Field[];
  /** Python line(s) — null when a field is invalid. */
  code: (a: Record<string, string>) => string[] | null;
  summary: (a: Record<string, string>) => string;
}

const num = (a: Record<string, string>, k: string) => valueCode(a[k]);
const one = (s: string | null) => (s === null ? null : [s]);
const showVal = (s: string | undefined) => (s ?? "").trim() || "?";

function outputCode(target: "log" | "screen", a: Record<string, string>): string[] | null {
  const parts: string[] = [];
  const text = (a.text ?? "").slice(0, LIMITS.text);
  const v = (a.value ?? "").trim();
  if (v && !isVarName(v)) return null;
  if (text || !v) parts.push(pyString(text));
  if (v) parts.push(v);
  const call = target === "log" ? "print" : "brain.screen.print";
  const lines = [`${call}(${parts.join(", ")})`];
  if (target === "screen" && a.newline !== "no") lines.push("brain.screen.new_line()");
  return lines;
}
function outputSummary(a: Record<string, string>): string {
  const parts: string[] = [];
  if (a.text) parts.push(`"${a.text}"`);
  if ((a.value ?? "").trim()) parts.push(a.value.trim());
  return parts.join(", ") || '""';
}

export const ACTIONS: Record<string, ActionSpec> = {
  drive_for: {
    label: "drive for a distance", group: "Drive",
    fields: [{ key: "dir", label: "Direction", kind: "choice", options: DIR_FR, dflt: "FORWARD" },
      { key: "dist", label: "Distance", kind: "value", dflt: "200" },
      { key: "units", label: "Units", kind: "choice", options: [["MM", "mm"], ["INCHES", "inches"]], dflt: "MM" }],
    code: (a) => { const d = num(a, "dist"); return d === null ? null : [`drivetrain.drive_for(${a.dir}, ${d}, ${a.units})`]; },
    summary: (a) => `drive ${a.dir === "REVERSE" ? "reverse" : "forward"} ${showVal(a.dist)} ${a.units === "INCHES" ? "in" : "mm"}`,
  },
  turn_for: {
    label: "turn for an angle", group: "Drive",
    fields: [{ key: "dir", label: "Direction", kind: "choice", options: DIR_LR, dflt: "RIGHT" },
      { key: "angle", label: "Angle (degrees)", kind: "value", dflt: "90" }],
    code: (a) => { const d = num(a, "angle"); return d === null ? null : [`drivetrain.turn_for(${a.dir}, ${d}, DEGREES)`]; },
    summary: (a) => `turn ${a.dir === "LEFT" ? "left" : "right"} ${showVal(a.angle)}°`,
  },
  turn_to_heading: {
    label: "turn to a heading", group: "Drive",
    fields: [{ key: "angle", label: "Heading (degrees)", kind: "value", dflt: "0" }],
    code: (a) => one(num(a, "angle") === null ? null : `drivetrain.turn_to_heading(${num(a, "angle")}, DEGREES)`),
    summary: (a) => `turn to heading ${showVal(a.angle)}°`,
  },
  drive: {
    label: "start driving", group: "Drive",
    fields: [{ key: "dir", label: "Direction", kind: "choice", options: DIR_FR, dflt: "FORWARD" }],
    code: (a) => [`drivetrain.drive(${a.dir})`],
    summary: (a) => `drive ${a.dir === "REVERSE" ? "reverse" : "forward"}`,
  },
  turn: {
    label: "start turning", group: "Drive",
    fields: [{ key: "dir", label: "Direction", kind: "choice", options: DIR_LR, dflt: "RIGHT" }],
    code: (a) => [`drivetrain.turn(${a.dir})`],
    summary: (a) => `turn ${a.dir === "LEFT" ? "left" : "right"}`,
  },
  stop: { label: "stop driving", group: "Drive", fields: [], code: () => ["drivetrain.stop()"], summary: () => "stop driving" },
  set_velocity: {
    label: "set speed", group: "Drive",
    fields: [{ key: "kind", label: "Speed of", kind: "choice", options: [["drive", "driving"], ["turn", "turning"]], dflt: "drive" },
      { key: "value", label: "Speed (1–100 %)", kind: "value", dflt: "50" }],
    code: (a) => one(num(a, "value") === null ? null : `drivetrain.set_${a.kind === "turn" ? "turn" : "drive"}_velocity(${num(a, "value")}, PERCENT)`),
    summary: (a) => `${a.kind === "turn" ? "turn" : "drive"} speed ${showVal(a.value)}%`,
  },
  wait: {
    label: "wait", group: "Control",
    fields: [{ key: "time", label: "Time", kind: "value", dflt: "1" },
      { key: "units", label: "Units", kind: "choice", options: [["SECONDS", "seconds"], ["MSEC", "msec"]], dflt: "SECONDS" }],
    code: (a) => one(num(a, "time") === null ? null : `wait(${num(a, "time")}, ${a.units})`),
    summary: (a) => `wait ${showVal(a.time)} ${a.units === "MSEC" ? "ms" : "s"}`,
  },
  set_var: {
    label: "set a variable", group: "Variables",
    fields: [{ key: "var", label: "Variable", kind: "var", dflt: "count" },
      { key: "a", label: "= value", kind: "value", dflt: "0" },
      { key: "math", label: "Maths", kind: "choice", options: [["", "(nothing)"], ["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"]], dflt: "" },
      { key: "b", label: "value", kind: "value", dflt: "1" }],
    code: (a) => {
      const v = (a.var ?? "").trim();
      const x = num(a, "a");
      if (!isVarName(v) || x === null) return null;
      if (!a.math) return [`${v} = ${x}`];
      const y = num(a, "b");
      return y === null ? null : [`${v} = ${x} ${a.math} ${y}`];
    },
    summary: (a) => `${showVal(a.var)} = ${showVal(a.a)}${a.math ? ` ${a.math === "*" ? "×" : a.math === "/" ? "÷" : a.math} ${showVal(a.b)}` : ""}`,
  },
  print: {
    label: "print to the log", group: "Output", fields: OUT_FIELDS,
    code: (a) => outputCode("log", a), summary: (a) => `print ${outputSummary(a)}`,
  },
  screen_print: {
    label: "print on the robot screen", group: "Output",
    fields: [...OUT_FIELDS, { key: "newline", label: "Then", kind: "choice", options: [["yes", "go to a new line"], ["no", "stay on this line"]], dflt: "yes" }],
    code: (a) => outputCode("screen", a), summary: (a) => `screen ${outputSummary(a)}`,
  },
  screen_clear: { label: "clear the robot screen", group: "Output", fields: [], code: () => ["brain.screen.clear_screen()"], summary: () => "clear screen" },
  timer_clear: { label: "reset the timer", group: "Control", fields: [], code: () => ["brain.timer.clear()"], summary: () => "reset timer" },
  motor_spin: {
    label: "spin a motor", group: "Motors",
    fields: [{ key: "motor", label: "Motor", kind: "choice", options: MOTORS, dflt: "left_motor" },
      { key: "dir", label: "Direction", kind: "choice", options: DIR_FR, dflt: "FORWARD" },
      { key: "velocity", label: "Speed (−100 to 100 %)", kind: "value", dflt: "50" }],
    code: (a) => one(num(a, "velocity") === null ? null : `${a.motor}.spin(${a.dir}, ${num(a, "velocity")}, PERCENT)`),
    summary: (a) => `${a.motor === "right_motor" ? "right" : "left"} motor ${a.dir === "REVERSE" ? "reverse" : "forward"} ${showVal(a.velocity)}%`,
  },
  motor_stop: {
    label: "stop a motor", group: "Motors",
    fields: [{ key: "motor", label: "Motor", kind: "choice", options: MOTORS, dflt: "left_motor" }],
    code: (a) => [`${a.motor}.stop()`],
    summary: (a) => `${a.motor === "right_motor" ? "right" : "left"} motor stop`,
  },
  pen: {
    label: "pen up / down", group: "Pen & magnet", hw: "pen",
    fields: [{ key: "pos", label: "Pen", kind: "choice", options: [["DOWN", "down (draw)"], ["UP", "up"]], dflt: "DOWN" }],
    code: (a) => [`pen.move(${a.pos})`], summary: (a) => `pen ${a.pos === "UP" ? "up" : "down"}`,
  },
  pen_color: {
    label: "pen colour", group: "Pen & magnet", hw: "pen",
    fields: [{ key: "color", label: "Colour", kind: "color", dflt: "BLUE" }],
    code: (a) => [`pen.set_pen_color(${colorArg(a.color)})`], summary: (a) => `pen colour ${colorArg(a.color)}`,
  },
  magnet: {
    label: "magnet", group: "Pen & magnet", hw: "magnet",
    fields: [{ key: "mode", label: "Magnet", kind: "choice", options: [["BOOST", "pick up (BOOST)"], ["DROP", "drop"]], dflt: "BOOST" }],
    code: (a) => [`magnet.energize(${a.mode})`], summary: (a) => `magnet ${a.mode === "DROP" ? "drop" : "pick up"}`,
  },
};

export const INPUT_FIELDS: Field[] = [
  { key: "reading", label: "Read", kind: "reading", types: ["num", "bool", "color"], dflt: "distance_mm" },
  { key: "color", label: "Colour", kind: "color", dflt: "BLACK" },
  { key: "var", label: "into the variable", kind: "var", dflt: "d" },
];
export const OUTPUT_FIELDS: Field[] = [
  { key: "to", label: "Show on", kind: "choice", options: [["screen", "robot screen"], ["log", "Steps log (print)"]], dflt: "screen" },
  ...OUT_FIELDS,
  { key: "newline", label: "Then", kind: "choice", options: [["yes", "go to a new line"], ["no", "stay on this line"]], dflt: "yes" },
];
export const CMP_OPS: [string, string][] = [["<", "<"], ["<=", "≤"], [">", ">"], [">=", "≥"], ["==", "="], ["!=", "≠"]];
export const DECISION_FIELDS: Field[] = [
  { key: "lhs", label: "Question about", kind: "reading", types: ["num", "bool", "color"], dflt: "bumper" },
  { key: "name", label: "Variable", kind: "var", dflt: "d" },
  { key: "color", label: "Colour", kind: "color", dflt: "BLACK" },
  { key: "cmp", label: "Is it", kind: "choice", options: [...CMP_OPS, ["true", "True"]], dflt: "<" },
  { key: "rhs", label: "than / to", kind: "value", dflt: "200" },
];

/** The fields that apply to a node right now (some depend on other choices). */
export function fieldsFor(n: Pick<FlowNode, "kind" | "op" | "args">): Field[] {
  const a = n.args;
  switch (n.kind) {
    case "action": return ACTIONS[n.op ?? ""]?.fields ?? [];
    case "input": {
      const r = READING_BY_ID.get(a.reading);
      return INPUT_FIELDS.filter((f) => f.key !== "color" || !!r?.needsColor);
    }
    case "output": return OUTPUT_FIELDS.filter((f) => f.key !== "newline" || a.to !== "log");
    case "decision": {
      if (a.lhs === "var") return DECISION_FIELDS.filter((f) => f.key !== "color" && (f.key !== "rhs" || a.cmp !== "true"));
      const r = READING_BY_ID.get(a.lhs);
      if (!r) return DECISION_FIELDS.slice(0, 1);
      if (r.type === "bool") return DECISION_FIELDS.filter((f) => f.key === "lhs" || (f.key === "color" && r.needsColor));
      if (r.type === "color") return DECISION_FIELDS.filter((f) => f.key === "lhs" || f.key === "cmp" || f.key === "rhs");
      return DECISION_FIELDS.filter((f) => f.key === "lhs" || f.key === "cmp" || f.key === "rhs");
    }
    default: return [];
  }
}

/** Default args for a new shape. */
export function defaultArgs(kind: NodeKind, op?: string): Record<string, string> {
  const fields = kind === "action" ? ACTIONS[op ?? ""]?.fields ?? [] : kind === "input" ? INPUT_FIELDS
    : kind === "output" ? OUTPUT_FIELDS : kind === "decision" ? DECISION_FIELDS : [];
  const a: Record<string, string> = {};
  for (const f of fields) a[f.key] = f.dflt;
  return a;
}

// ---------------------------------------------------------------- one shape → Python

export interface Cond { code: string; negated: string; }

/** Decision condition (and its opposite, written readably). null if invalid. */
export function conditionCode(a: Record<string, string>): Cond | null {
  const NEG: Record<string, string> = { "<": ">=", "<=": ">", ">": "<=", ">=": "<", "==": "!=", "!=": "==" };
  const notOf = (c: string) => (/^[\w.]+(\([^()]*\))?$/.test(c) ? `not ${c}` : `not (${c})`);
  let left: string;
  let type: ReadingType;
  if (a.lhs === "var") {
    if (!isVarName((a.name ?? "").trim())) return null;
    left = a.name.trim();
    type = a.cmp === "true" ? "bool" : "num";
  } else {
    const r = READING_BY_ID.get(a.lhs);
    if (!r) return null;
    left = r.code(colorArg(a.color));
    type = r.type;
  }
  if (type === "bool") return { code: left, negated: notOf(left) };
  const op = NEG[a.cmp] ? a.cmp : "<";
  let right: string | null;
  if (type === "color") {
    const c = (a.rhs ?? "").trim();
    right = (COLORS as string[]).includes(c) ? c : null;
    const eq = op === "!=" ? "!=" : "==";
    if (right === null) return null;
    return { code: `${left} ${eq} ${right}`, negated: `${left} ${NEG[eq]} ${right}` };
  }
  right = valueCode(a.rhs);
  if (right === null) return null;
  return { code: `${left} ${op} ${right}`, negated: `${left} ${NEG[op]} ${right}` };
}

/** Python lines for a statement shape (action / input / output). null = a field is invalid. */
export function statementCode(n: FlowNode): string[] | null {
  const a = n.args;
  switch (n.kind) {
    case "action": { const s = ACTIONS[n.op ?? ""]; return s ? s.code(a) : null; }
    case "input": {
      const r = READING_BY_ID.get(a.reading);
      const v = (a.var ?? "").trim();
      if (!r || !isVarName(v)) return null;
      return [`${v} = ${r.code(colorArg(a.color))}`];
    }
    case "output": return outputCode(a.to === "log" ? "log" : "screen", a);
    default: return null;
  }
}

/** What's wrong with a shape's settings ("" = fine). Used for friendly errors and the panel. */
export function nodeProblem(n: FlowNode): string {
  if (n.kind === "start" || n.kind === "end") return "";
  for (const f of fieldsFor(n)) {
    const v = (n.args[f.key] ?? "").trim();
    if (f.kind === "var" && varNameProblem(v)) return varNameProblem(v);
    if (f.kind === "optvar" && v && varNameProblem(v)) return varNameProblem(v);
    if (f.kind === "value" && valueCode(v) === null) {
      if (n.kind === "decision" && READING_BY_ID.get(n.args.lhs)?.type === "color") {
        if (!(COLORS as string[]).includes(v)) return "Pick a colour to compare with.";
        continue;
      }
      return `“${f.label}” needs a number (like 200) or a variable name.`;
    }
  }
  if (n.kind === "decision") return conditionCode(n.args) ? "" : "Finish the question in this diamond.";
  return statementCode(n) ? "" : "Finish setting up this shape.";
}

/** Variables a shape assigns / reads. */
export function nodeVars(n: FlowNode): { sets: string[]; uses: string[] } {
  const a = n.args, sets: string[] = [], uses: string[] = [];
  const use = (s: string | undefined) => { const v = valueVar(s); if (v) uses.push(v); };
  if (n.kind === "input") { if (isVarName((a.var ?? "").trim())) sets.push(a.var.trim()); }
  else if (n.kind === "output") use(a.value);
  else if (n.kind === "decision") {
    for (const f of fieldsFor(n)) if (f.kind === "value" || f.kind === "var") use(a[f.key]);
  } else if (n.kind === "action") {
    if (n.op === "set_var") { if (isVarName((a.var ?? "").trim())) sets.push(a.var.trim()); use(a.a); if (a.math) use(a.b); }
    else for (const f of ACTIONS[n.op ?? ""]?.fields ?? []) if (f.kind === "value" || f.kind === "optvar") use(a[f.key]);
  }
  return { sets, uses: [...new Set(uses)] };
}

// ---------------------------------------------------------------- labels shown in shapes

export function nodeLabel(n: FlowNode): string {
  const a = n.args;
  switch (n.kind) {
    case "start": return "Start";
    case "end": return "End";
    case "action": return ACTIONS[n.op ?? ""]?.summary(a) ?? "?";
    case "input": return `${readingShort(a.reading, a.color)} → ${showVal(a.var)}`;
    case "output": return `${a.to === "log" ? "print" : "screen"} ${outputSummary(a)}`;
    case "decision": {
      if (a.lhs === "var") {
        if (a.cmp === "true") return `${showVal(a.name)}?`;
        return `${showVal(a.name)} ${CMP_OPS.find((c) => c[0] === a.cmp)?.[1] ?? "<"} ${showVal(a.rhs)}?`;
      }
      const r = READING_BY_ID.get(a.lhs);
      if (!r) return "?";
      if (r.type === "bool") return `${readingShort(a.lhs, a.color)}?`;
      return `${r.group === "Controller" ? `controller ${r.id}` : r.label.replace(/ \((mm|inches|%|degrees|seconds|msec)\)$/, "")} ${CMP_OPS.find((c) => c[0] === a.cmp)?.[1] ?? "<"} ${showVal(a.rhs)}?`;
    }
  }
}

export const KIND_NAMES: Record<NodeKind, string> = {
  start: "Start", end: "End", action: "Action", input: "Input", output: "Output", decision: "Decision",
};
