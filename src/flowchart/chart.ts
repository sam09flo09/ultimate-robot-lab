/**
 * Chart helpers: blank chart, defensive validation of untrusted saved state, starter templates
 * and the "Tidy up" auto-layout.
 */
import {
  ACTIONS, COLORS, DECISION_FIELDS, GRID, INPUT_FIELDS, LIMITS, OUTPUT_FIELDS, READING_BY_ID, defaultArgs, nodeSize,
  type Field, type FlowChart, type FlowEdge, type FlowNode, type NodeKind, type Port,
} from "./model";

const KINDS: NodeKind[] = ["start", "end", "action", "input", "output", "decision"];
const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function blankChart(): FlowChart {
  return { format: "robot-lab-flowchart", version: 1, nodes: [{ id: "start", kind: "start", x: 100, y: 40, args: {} }], edges: [] };
}

/** True when the chart is just a Start shape (nothing to keep). */
export function isBlankChart(c: FlowChart): boolean {
  return c.nodes.length === 1 && c.nodes[0].kind === "start" && c.edges.length === 0;
}

export function portsOf(kind: NodeKind): Port[] {
  return kind === "decision" ? ["yes", "no"] : kind === "end" ? [] : ["out"];
}

function allFields(kind: NodeKind, op?: string): Field[] {
  if (kind === "action") return ACTIONS[op ?? ""]?.fields ?? [];
  if (kind === "input") return INPUT_FIELDS;
  if (kind === "output") return OUTPUT_FIELDS;
  if (kind === "decision") return DECISION_FIELDS;
  return [];
}

function cleanArgs(kind: NodeKind, op: string | undefined, raw: unknown): Record<string, string> {
  const a = defaultArgs(kind, op);
  if (!isObj(raw)) return a;
  for (const f of allFields(kind, op)) {
    const v = raw[f.key];
    if (typeof v !== "string" && typeof v !== "number") continue;
    // eslint-disable-next-line no-control-regex
    const s = String(v).replace(/[\u0000-\u001f\u007f]/g, "");
    switch (f.kind) {
      case "choice": if (f.options.some((o) => o[0] === s)) a[f.key] = s; break;
      case "color": if ((COLORS as string[]).includes(s)) a[f.key] = s; break;
      case "reading": if (READING_BY_ID.has(s) || (kind === "decision" && s === "var")) a[f.key] = s; break;
      case "text": a[f.key] = s.slice(0, LIMITS.text); break;
      default: a[f.key] = s.slice(0, LIMITS.value); break; // value / var / optvar: validated when generating
    }
  }
  if (kind === "decision" && typeof raw.cmp === "string" && raw.cmp === "true") a.cmp = "true";
  return a;
}

/** Validate an untrusted chart (from a file or storage). Never throws; returns null if unusable. */
export function sanitizeChart(raw: unknown): { chart: FlowChart; warnings: string[] } | null {
  if (!isObj(raw) || !Array.isArray(raw.nodes)) return null;
  if (raw.format !== undefined && raw.format !== "robot-lab-flowchart") return null;
  const warnings: string[] = [];
  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  const clampCoord = (v: unknown) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return Math.round(Math.max(-LIMITS.coord, Math.min(LIMITS.coord, n)));
  };
  let hasStart = false;
  for (const r of raw.nodes.slice(0, LIMITS.nodes)) {
    if (!isObj(r) || typeof r.id !== "string" || !ID_RE.test(r.id) || ids.has(r.id)) continue;
    const kind = KINDS.find((k) => k === r.kind);
    if (!kind) continue;
    if (kind === "start") { if (hasStart) continue; hasStart = true; }
    let op: string | undefined;
    if (kind === "action") {
      op = typeof r.op === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, r.op) ? r.op : undefined;
      if (!op) continue;
    }
    ids.add(r.id);
    const n: FlowNode = { id: r.id, kind, x: clampCoord(r.x), y: clampCoord(r.y), args: cleanArgs(kind, op, r.args) };
    if (op) n.op = op;
    nodes.push(n);
  }
  if (raw.nodes.length > LIMITS.nodes) warnings.push(`Only the first ${LIMITS.nodes} shapes of the flowchart were kept.`);
  if (!hasStart) nodes.unshift({ ...blankChart().nodes[0], id: ids.has("start") ? `start${nodes.length}` : "start" });
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const edges: FlowEdge[] = [];
  const used = new Set<string>();
  const eids = new Set<string>();
  for (const r of Array.isArray(raw.edges) ? raw.edges.slice(0, LIMITS.edges) : []) {
    if (!isObj(r) || typeof r.from !== "string" || typeof r.to !== "string" || typeof r.port !== "string") continue;
    const fk = kindOf.get(r.from), tk = kindOf.get(r.to);
    if (!fk || !tk || tk === "start") continue;
    const port = portsOf(fk).find((p) => p === r.port);
    if (!port || used.has(`${r.from}:${port}`)) continue;
    let id = typeof r.id === "string" && ID_RE.test(r.id) && !eids.has(r.id) ? r.id : "";
    if (!id) { let k = edges.length; while (eids.has(`e${k}`)) k++; id = `e${k}`; }
    used.add(`${r.from}:${port}`); eids.add(id);
    edges.push({ id, from: r.from, port, to: r.to });
  }
  return { chart: { format: "robot-lab-flowchart", version: 1, nodes, edges }, warnings };
}

// ---------------------------------------------------------------- templates

type T = { id: string; kind: NodeKind; op?: string; args?: Record<string, string> };
function build(list: T[], arrows: [string, Port, string][]): FlowChart {
  const nodes: FlowNode[] = list.map((t) => ({ id: t.id, kind: t.kind, x: 0, y: 0, ...(t.op ? { op: t.op } : {}),
    args: { ...defaultArgs(t.kind, t.op), ...(t.args ?? {}) } }));
  const edges: FlowEdge[] = arrows.map(([from, port, to], i) => ({ id: `e${i + 1}`, from, port, to }));
  return tidy({ format: "robot-lab-flowchart", version: 1, nodes, edges });
}

export interface Template { id: string; title: string; about: string; make: () => FlowChart; }

export const TEMPLATES: Template[] = [
  {
    id: "square", title: "Drive a square", about: "A counting loop: drive and turn 4 times.",
    make: () => build([
      { id: "start", kind: "start" },
      { id: "n1", kind: "action", op: "set_var", args: { var: "count", a: "0", math: "", b: "1" } },
      { id: "n2", kind: "decision", args: { lhs: "var", name: "count", cmp: "<", rhs: "4" } },
      { id: "n3", kind: "action", op: "drive_for", args: { dir: "FORWARD", dist: "400", units: "MM" } },
      { id: "n4", kind: "action", op: "turn_for", args: { dir: "RIGHT", angle: "90" } },
      { id: "n5", kind: "action", op: "set_var", args: { var: "count", a: "count", math: "+", b: "1" } },
      { id: "end", kind: "end" },
    ], [["start", "out", "n1"], ["n1", "out", "n2"], ["n2", "yes", "n3"], ["n3", "out", "n4"], ["n4", "out", "n5"],
      ["n5", "out", "n2"], ["n2", "no", "end"]]),
  },
  {
    id: "wall", title: "Stop at the wall", about: "Input + decision loop: drive until the bumper is pressed.",
    make: () => build([
      { id: "start", kind: "start" },
      { id: "n1", kind: "action", op: "drive", args: { dir: "FORWARD" } },
      { id: "n2", kind: "input", args: { reading: "bumper", var: "hit" } },
      { id: "n3", kind: "decision", args: { lhs: "var", name: "hit", cmp: "true", rhs: "" } },
      { id: "n4", kind: "action", op: "stop" },
      { id: "end", kind: "end" },
    ], [["start", "out", "n1"], ["n1", "out", "n2"], ["n2", "out", "n3"], ["n3", "no", "n2"], ["n3", "yes", "n4"], ["n4", "out", "end"]]),
  },
  {
    id: "driver", title: "Driver control", about: "A forever loop: controller sticks → wheel motors (tank drive).",
    make: () => build([
      { id: "start", kind: "start" },
      { id: "n1", kind: "input", args: { reading: "axis3", var: "left" } },
      { id: "n2", kind: "input", args: { reading: "axis2", var: "right" } },
      { id: "n3", kind: "action", op: "motor_spin", args: { motor: "left_motor", dir: "FORWARD", velocity: "left" } },
      { id: "n4", kind: "action", op: "motor_spin", args: { motor: "right_motor", dir: "FORWARD", velocity: "right" } },
      { id: "n5", kind: "action", op: "wait", args: { time: "20", units: "MSEC" } },
    ], [["start", "out", "n1"], ["n1", "out", "n2"], ["n2", "out", "n3"], ["n3", "out", "n4"], ["n4", "out", "n5"], ["n5", "out", "n1"]]),
  },
];

// ---------------------------------------------------------------- tidy up (layered layout)

const COL_W = 260, ROW_H = 140, ORIGIN = 40;

/** Returns a copy of the chart with shapes laid out top-to-bottom (Yes/out down, No to the right). */
export function tidy(chart: FlowChart): FlowChart {
  const nodes = chart.nodes.map((n) => ({ ...n, args: { ...n.args } }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, FlowEdge[]>();
  for (const e of chart.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }
  const rank = (p: Port) => (p === "no" ? 1 : 0);
  for (const l of out.values()) l.sort((a, b) => rank(a.port) - rank(b.port));

  // DFS from Start, then any shapes left over: retreating arrows are loops (ignored for layering).
  const state = new Map<string, 1 | 2>();
  const back = new Set<FlowEdge>();
  const order: string[] = [];
  const col = new Map<string, number>();
  const roots = [...nodes].sort((a, b) => (a.kind === "start" ? -1 : b.kind === "start" ? 1 : 0));
  let nextFreeCol = 0;
  for (const r of roots) {
    if (state.has(r.id)) continue;
    col.set(r.id, nextFreeCol);
    const stack: { id: string; i: number }[] = [{ id: r.id, i: 0 }];
    state.set(r.id, 1); order.push(r.id);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const es = out.get(top.id) ?? [];
      if (top.i < es.length) {
        const e = es[top.i++];
        const s = state.get(e.to);
        if (s === 1) { back.add(e); continue; }
        if (s === 2) continue;
        if (!col.has(e.to)) col.set(e.to, col.get(top.id)! + (e.port === "no" ? 1 : 0));
        state.set(e.to, 1); order.push(e.to);
        stack.push({ id: e.to, i: 0 });
      } else { state.set(top.id, 2); stack.pop(); }
    }
    nextFreeCol = Math.max(...[...col.values()]) + 1;
  }
  // longest-path layering on forward arrows (order is a topological order of them)
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const topo = topoOrder(nodes.map((n) => n.id), out, back);
  for (const id of topo) for (const e of out.get(id) ?? []) {
    if (back.has(e)) continue;
    layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(id)! + 1));
  }
  // resolve collisions: same (layer, column) → shift right
  const taken = new Set<string>();
  for (const id of order) {
    let c = col.get(id) ?? 0;
    const L = layer.get(id)!;
    while (taken.has(`${L}:${c}`)) c++;
    taken.add(`${L}:${c}`);
    col.set(id, c);
  }
  for (const n of nodes) {
    const { w, h } = nodeSize(n.kind);
    n.x = snap(ORIGIN + col.get(n.id)! * COL_W + (200 - w) / 2);
    n.y = snap(ORIGIN + layer.get(n.id)! * ROW_H + (100 - h) / 2);
  }
  return { ...chart, nodes, edges: chart.edges.map((e) => ({ ...e })) };
}

function topoOrder(ids: string[], out: Map<string, FlowEdge[]>, back: Set<FlowEdge>): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const es of out.values()) for (const e of es) if (!back.has(e)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const q = ids.filter((id) => indeg.get(id) === 0);
  const res: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    res.push(id);
    for (const e of out.get(id) ?? []) {
      if (back.has(e)) continue;
      indeg.set(e.to, indeg.get(e.to)! - 1);
      if (indeg.get(e.to) === 0) q.push(e.to);
    }
  }
  return res;
}

export const snap = (v: number) => Math.round(v / GRID) * GRID;
