/**
 * Flowchart editor (SVG, pointer events — mouse, pen and touch alike).
 *  - palette: drag a shape onto the grid, or tap it to add one under the selected shape (auto-connected)
 *  - drag shapes to move (snap to grid); drag from a dot (or tap a dot, then tap a shape) to draw an arrow
 *  - tap a shape to edit it in the side panel; Delete key; Ctrl+Z / Ctrl+Y; wheel / drag / pinch to pan & zoom
 *  - "Tidy up", starter templates, export as PNG
 * Shapes are drawn with presentation attributes (not CSS) so the PNG export looks the same.
 */
import type { BlocksOptions } from "../core/modules";
import {
  ACTIONS, COLORS, CMP_OPS, GRID, KIND_NAMES, LIMITS, READINGS, READING_BY_ID, defaultArgs, fieldsFor, nodeLabel,
  nodeProblem, nodeSize, nodeVars, varNameProblem, valueCode,
  type Field, type FlowChart, type FlowEdge, type FlowNode, type NodeKind, type Port,
} from "./model";
import { TEMPLATES, blankChart, isBlankChart, portsOf, sanitizeChart, snap, tidy } from "./chart";
import { generateFlowchart, type FlowProgram } from "./generate";
import type { FlowError } from "./structure";
import { FLOW_CSS } from "./styles";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = "Geist, 'Segoe UI', Roboto, Arial, sans-serif";

export const SHAPE_STYLE: Record<NodeKind, { fill: string; stroke: string; text: string }> = {
  start: { fill: "#DDF0E3", stroke: "#1E6B3A", text: "#0C0B0A" },
  end: { fill: "#0C0B0A", stroke: "#0C0B0A", text: "#FFFDF9" },
  action: { fill: "#FFE1C9", stroke: "#D6540E", text: "#0C0B0A" },
  input: { fill: "#DCEBFA", stroke: "#2B5C8A", text: "#0C0B0A" },
  output: { fill: "#EDE3F7", stroke: "#6A3F94", text: "#0C0B0A" },
  decision: { fill: "#FFF1B8", stroke: "#9A7400", text: "#0C0B0A" },
};

export interface FlowchartEditor {
  getPython(): string;
  getState(): unknown;
  setState(state: unknown): void;
  highlightLine(line: number): void;
  setHardware(hw: { pen: boolean; magnet: boolean }): void;
  setReadOnly(ro: boolean): void;
  resize(): void;
  dispose(): void;
  /** The reason the chart can't become Python (null = fine). */
  getError(): FlowError | null;
  /** Select and flash the shape or arrow an error points at. */
  showError(e: FlowError): void;
  /** Only a Start shape. */
  isBlank(): boolean;
  /** PNG data URL of the chart ("" when blank). */
  exportImage(): Promise<string>;
}

type Sel = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v; else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

let cssAdded = false;
function addCss() {
  if (cssAdded) return;
  cssAdded = true;
  const s = document.createElement("style");
  s.textContent = FLOW_CSS;
  document.head.appendChild(s);
}

/** Port position relative to the node's top-left. */
function portPos(kind: NodeKind, port: Port): { x: number; y: number; dir: "down" | "right" } {
  const { w, h } = nodeSize(kind);
  return port === "no" ? { x: w, y: h / 2, dir: "right" } : { x: w / 2, y: h, dir: "down" };
}

/** Wrap a label into ≤ 2 lines of ≤ max chars. */
function wrap(text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + " " + w).length <= max) lines[lines.length - 1] = cur + " " + w;
    else lines.push(w);
  }
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].slice(0, max - 1) + "…"; }
  return lines.map((l) => (l.length > max ? l.slice(0, max - 1) + "…" : l));
}

function shapeEl(kind: NodeKind): SVGElement {
  const { w, h } = nodeSize(kind);
  const st = SHAPE_STYLE[kind];
  const common = { fill: st.fill, stroke: st.stroke, "stroke-width": 2, class: "fc-shape" };
  switch (kind) {
    case "start": case "end": return svg("rect", { ...common, x: 0, y: 0, width: w, height: h, rx: h / 2 });
    case "action": return svg("rect", { ...common, x: 0, y: 0, width: w, height: h, rx: 6 });
    case "decision": return svg("polygon", { ...common, points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}` });
    default: return svg("polygon", { ...common, points: `18,0 ${w},0 ${w - 18},${h} 0,${h}` });
  }
}

/** SVG path for an arrow from a port to a target shape's top centre. `lane` spreads loop-back arrows. */
function edgePath(src: FlowNode, port: Port, dst: FlowNode, lane: number): { d: string; lx: number; ly: number } {
  const pp = portPos(src.kind, port);
  const x1 = src.x + pp.x, y1 = src.y + pp.y;
  const dsz = nodeSize(dst.kind);
  const x2 = dst.x + dsz.w / 2, y2 = dst.y;
  if (pp.dir === "down") {
    if (y2 >= y1 + 24) {
      if (Math.abs(x2 - x1) < 1) return { d: `M${x1},${y1} V${y2}`, lx: x1 + 8, ly: y1 + 16 };
      const my = y2 - 20;
      return { d: `M${x1},${y1} V${my} H${x2} V${y2}`, lx: x1 + 8, ly: y1 + 16 };
    }
    const lx = Math.min(src.x, dst.x) - 30 - lane * 14;
    return { d: `M${x1},${y1} V${y1 + 20} H${lx} V${y2 - 20} H${x2} V${y2}`, lx: x1 + 8, ly: y1 + 16 };
  }
  // right-hand (No) port
  if (y2 >= y1 + 24 && x2 > x1 + 20) return { d: `M${x1},${y1} H${x2} V${y2}`, lx: x1 + 10, ly: y1 - 6 };
  if (y2 >= y1 + 24) {
    const rx = x1 + 24;
    return { d: `M${x1},${y1} H${rx} V${y2 - 20} H${x2} V${y2}`, lx: x1 + 10, ly: y1 - 6 };
  }
  const rx = Math.max(src.x + nodeSize(src.kind).w, dst.x + dsz.w) + 30 + lane * 14;
  return { d: `M${x1},${y1} H${rx} V${y2 - 20} H${x2} V${y2}`, lx: x1 + 10, ly: y1 - 6 };
}

export function createFlowchartEditor(host: HTMLElement, opts: BlocksOptions): FlowchartEditor {
  addCss();
  let chart: FlowChart = blankChart();
  let hardware = { ...opts.hardware };
  let program: FlowProgram | null = null;
  let sel: Sel = null;
  let readOnly = false;
  let running: string | null = null;      // id of the shape being run
  let flash: string | null = null;        // id of node/edge an error points at
  let view = { tx: 40, ty: 20, k: 1 };
  let pendingPort: { id: string; port: Port } | null = null; // tap-a-dot-then-tap-a-shape
  const undoStack: string[] = [], redoStack: string[] = [];
  let idSeq = 1;

  // ---------------------------------------------------------------- DOM
  const root = el("div", { class: "fc", tabindex: "-1" });
  const bar = el("div", { class: "fc-bar", role: "toolbar", "aria-label": "Flowchart tools" });
  const stage = el("div", { class: "fc-stage" });
  const panel = el("div", { class: "fc-panel", "aria-label": "Edit shape" });
  panel.hidden = true;
  const banner = el("div", { class: "fc-banner", role: "status", "aria-live": "polite" });
  banner.hidden = true;
  const hint = el("div", { class: "fc-hint" });
  root.append(bar, stage, panel);
  stage.append(banner, hint);
  host.appendChild(root);

  const sv = svg("svg", { class: "fc-svg", role: "img", "aria-label": "Flowchart" });
  const defs = svg("defs");
  const pat = svg("pattern", { id: "fcGrid", width: GRID, height: GRID, patternUnits: "userSpaceOnUse" });
  pat.append(svg("circle", { cx: 1, cy: 1, r: 1, fill: "#E2D8C8" }));
  const mk = (id: string, color: string) => {
    const m = svg("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    m.append(svg("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
    return m;
  };
  defs.append(pat, mk("fcArrow", "#5E584E"), mk("fcArrowSel", "#FF6A1A"), mk("fcArrowBad", "#B3261E"));
  const bg = svg("rect", { class: "fc-bg", x: -50000, y: -50000, width: 100000, height: 100000, fill: "url(#fcGrid)" });
  const vp = svg("g", { class: "fc-vp" });
  const edgeLayer = svg("g", { class: "fc-edges" });
  const nodeLayer = svg("g", { class: "fc-nodes" });
  const rubber = svg("path", { class: "fc-rubber", fill: "none", stroke: "#FF6A1A", "stroke-width": 3, "stroke-dasharray": "6 5", "marker-end": "url(#fcArrowSel)" });
  rubber.style.display = "none";
  vp.append(bg, edgeLayer, nodeLayer, rubber);
  sv.append(defs, vp);
  stage.prepend(sv);

  // ---------------------------------------------------------------- toolbar
  const PALETTE: { kind: NodeKind; label: string; title: string }[] = [
    { kind: "action", label: "Action", title: "Rectangle: a robot command (drive, turn, wait, set a variable…)" },
    { kind: "input", label: "Input", title: "Parallelogram: read a sensor or the controller into a variable" },
    { kind: "output", label: "Output", title: "Parallelogram: show text or a value" },
    { kind: "decision", label: "Decision", title: "Diamond: a yes/no question with two arrows" },
    { kind: "end", label: "End", title: "Oval: the program stops here" },
  ];
  const pal = el("div", { class: "fc-pal" });
  for (const p of PALETTE) {
    const b = el("button", { class: `fc-pal-btn fc-k-${p.kind}`, type: "button", title: p.title, "data-kind": p.kind });
    const ico = svg("svg", { width: 24, height: 16, viewBox: "-2 -2 34 24", "aria-hidden": "true" });
    const st = SHAPE_STYLE[p.kind];
    const a = { fill: st.fill, stroke: st.stroke, "stroke-width": 2 };
    if (p.kind === "action") ico.append(svg("rect", { ...a, x: 0, y: 2, width: 30, height: 16, rx: 2 }));
    else if (p.kind === "decision") ico.append(svg("polygon", { ...a, points: "15,0 30,10 15,20 0,10" }));
    else if (p.kind === "end") ico.append(svg("rect", { ...a, x: 0, y: 2, width: 30, height: 16, rx: 8 }));
    else ico.append(svg("polygon", { ...a, points: "6,2 30,2 24,18 0,18" }));
    b.append(ico, document.createTextNode(p.label));
    pal.append(b);
    paletteDrag(b, p.kind);
  }
  const tool = (label: string, title: string, fn: () => void, cls = "") => {
    const b = el("button", { class: `fc-tool ${cls}`, type: "button", title, "aria-label": title }, label);
    b.addEventListener("click", fn);
    return b;
  };
  const undoBtn = tool("↶", "Undo (Ctrl+Z)", () => undo());
  const redoBtn = tool("↷", "Redo (Ctrl+Y)", () => redo());
  const delBtn = tool("🗑", "Delete the selected shape or arrow (Delete)", () => deleteSelection());
  const tidyBtn = tool("Tidy up", "Line the shapes up neatly", () => { commit(() => { chart = tidy(chart); }); fit(); }, "fc-tool-text");
  const zoomOut = tool("−", "Zoom out", () => zoomBy(1 / 1.25));
  const zoomIn = tool("+", "Zoom in", () => zoomBy(1.25));
  const fitBtn = tool("⤢", "Show the whole flowchart", () => fit());
  const tplSel = el("select", { class: "fc-tpl", "aria-label": "Start from a template", title: "Start from a template" });
  tplSel.append(el("option", { value: "" }, "Templates…"));
  for (const t of TEMPLATES) tplSel.append(el("option", { value: t.id, title: t.about }, t.title));
  tplSel.append(el("option", { value: "__blank" }, "Empty flowchart"));
  tplSel.addEventListener("change", () => {
    const v = tplSel.value;
    tplSel.value = "";
    if (!v || readOnly) return;
    const t = TEMPLATES.find((x) => x.id === v);
    if (!isBlankChart(chart) && !window.confirm(`Replace your flowchart with ${t ? `“${t.title}”` : "an empty one"}? (Undo brings it back.)`)) return;
    commit(() => { chart = t ? t.make() : blankChart(); sel = null; });
    fit();
  });
  const imgBtn = tool("🖼", "Save the flowchart as a picture (PNG) for your engineering notebook", () => void savePicture());
  const tools = el("div", { class: "fc-tools" });
  tools.append(undoBtn, redoBtn, delBtn, tidyBtn, tplSel, imgBtn);
  bar.append(pal, tools);
  const zoomBox = el("div", { class: "fc-zoom" });
  zoomBox.append(zoomIn, zoomOut, fitBtn);
  stage.append(zoomBox);

  // ---------------------------------------------------------------- model helpers
  const nodeById = (id: string) => chart.nodes.find((n) => n.id === id);
  const edgeById = (id: string) => chart.edges.find((e) => e.id === id);
  const newId = (p: string) => {
    const used = new Set([...chart.nodes.map((n) => n.id), ...chart.edges.map((e) => e.id)]);
    let id: string;
    do id = `${p}${idSeq++}`; while (used.has(id));
    return id;
  };
  const currentProgram = () => (program ??= generateFlowchart(chart));
  const snapshot = () => JSON.stringify(chart);

  /** Apply a change as one undo step. */
  function commit(fn: () => void): void {
    if (readOnly) return;
    const before = snapshot();
    fn();
    if (snapshot() === before) { render(); return; }
    undoStack.push(before);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    changed();
  }
  function changed(): void {
    program = null;
    flash = null;
    render();
    renderPanel();
    opts.onChange();
  }
  function undo(): void {
    if (readOnly || !undoStack.length) return;
    redoStack.push(snapshot());
    chart = JSON.parse(undoStack.pop()!) as FlowChart;
    if (sel && !(sel.kind === "node" ? nodeById(sel.id) : edgeById(sel.id))) sel = null;
    changed();
  }
  function redo(): void {
    if (readOnly || !redoStack.length) return;
    undoStack.push(snapshot());
    chart = JSON.parse(redoStack.pop()!) as FlowChart;
    if (sel && !(sel.kind === "node" ? nodeById(sel.id) : edgeById(sel.id))) sel = null;
    changed();
  }

  function addNode(kind: NodeKind, x: number, y: number, connectFrom?: { id: string; port: Port }): string | null {
    if (chart.nodes.length >= LIMITS.nodes) { showHint(`A flowchart can have at most ${LIMITS.nodes} shapes.`); return null; }
    const id = newId("n");
    const op = kind === "action" ? "drive_for" : undefined;
    const { w, h } = nodeSize(kind);
    const n: FlowNode = { id, kind, x: snap(x - w / 2), y: snap(y - h / 2), args: defaultArgs(kind, op), ...(op ? { op } : {}) };
    commit(() => {
      chart.nodes.push(n);
      if (connectFrom) connect(connectFrom.id, connectFrom.port, id);
      sel = { kind: "node", id };
    });
    return id;
  }
  /** Replace the arrow from (from, port) with one to `to`. Mutates chart (call inside commit). */
  function connect(from: string, port: Port, to: string): void {
    const t = nodeById(to);
    if (!t || t.kind === "start") return;
    chart.edges = chart.edges.filter((e) => !(e.from === from && e.port === port));
    if (chart.edges.length >= LIMITS.edges) return;
    chart.edges.push({ id: newId("e"), from, port, to });
  }
  function freePort(n: FlowNode): Port | null {
    return portsOf(n.kind).find((p) => !chart.edges.some((e) => e.from === n.id && e.port === p)) ?? null;
  }
  function deleteSelection(): void {
    if (readOnly || !sel) return;
    const s = sel;
    if (s.kind === "node") {
      const n = nodeById(s.id);
      if (!n) return;
      if (n.kind === "start") { showHint("Every flowchart needs its Start shape, so it can't be deleted."); return; }
      commit(() => {
        chart.nodes = chart.nodes.filter((x) => x.id !== s.id);
        chart.edges = chart.edges.filter((e) => e.from !== s.id && e.to !== s.id);
        sel = null;
      });
    } else commit(() => { chart.edges = chart.edges.filter((e) => e.id !== s.id); sel = null; });
  }

  // ---------------------------------------------------------------- render
  const nodeEls = new Map<string, { g: SVGGElement; sig: string }>();
  let frame = 0;
  function render(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; renderNow(); });
  }
  function renderNow(): void {
    vp.setAttribute("transform", `translate(${view.tx},${view.ty}) scale(${view.k})`);
    const prog = currentProgram();
    const err = prog.error;
    const badNode = flash ?? err?.nodeId ?? null;
    const badEdge = flash ?? err?.edgeId ?? null;
    // nodes (keyed)
    const live = new Set<string>();
    for (const n of chart.nodes) {
      live.add(n.id);
      const label = nodeLabel(n);
      const sig = `${n.kind}|${label}|${n.kind === "decision" ? "d" : ""}`;
      let rec = nodeEls.get(n.id);
      if (!rec || rec.sig !== sig) {
        rec?.g.remove();
        rec = { g: buildNode(n, label), sig };
        nodeEls.set(n.id, rec);
      }
      const g = rec.g;
      if (g.parentNode !== nodeLayer) nodeLayer.append(g);
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
      const cls = ["fc-node", `fc-k-${n.kind}`];
      if (sel?.kind === "node" && sel.id === n.id) cls.push("fc-sel");
      if (running === n.id) cls.push("fc-run");
      if (badNode === n.id) cls.push("fc-bad");
      if (!prog.reachable.has(n.id) && n.kind !== "start") cls.push("fc-off");
      if (pendingPort?.id === n.id) cls.push("fc-pending");
      g.setAttribute("class", cls.join(" "));
      for (const p of g.querySelectorAll<SVGElement>(".fc-port")) {
        const port = p.dataset.port as Port;
        const used = chart.edges.some((e) => e.from === n.id && e.port === port);
        p.classList.toggle("fc-used", used);
        p.classList.toggle("fc-armed", pendingPort?.id === n.id && pendingPort.port === port);
      }
    }
    for (const [id, rec] of nodeEls) if (!live.has(id)) { rec.g.remove(); nodeEls.delete(id); }
    // edges (rebuilt; cheap)
    edgeLayer.textContent = "";
    let lane = 0;
    for (const e of chart.edges) {
      const a = nodeById(e.from), b = nodeById(e.to);
      if (!a || !b) continue;
      const pp = portPos(a.kind, e.port);
      const isBackish = b.y <= a.y + pp.y;
      const { d, lx, ly } = edgePath(a, e.port, b, isBackish ? lane++ % 4 : 0);
      const g = svg("g", { class: "fc-edge", "data-id": e.id });
      const selected = sel?.kind === "edge" && sel.id === e.id;
      const bad = badEdge === e.id;
      g.append(svg("path", { d, class: "fc-edge-hit", fill: "none", stroke: "transparent", "stroke-width": 18 }));
      g.append(svg("path", {
        d, class: "fc-edge-line", fill: "none", stroke: bad ? "#B3261E" : selected ? "#FF6A1A" : "#5E584E",
        "stroke-width": selected || bad ? 3.5 : 2, "stroke-linejoin": "round",
        "marker-end": `url(#${bad ? "fcArrowBad" : selected ? "fcArrowSel" : "fcArrow"})`,
      }));
      if (bad) g.classList.add("fc-bad");
      if (!prog.reachable.has(e.from)) g.classList.add("fc-off");
      if (e.port !== "out") {
        const t = svg("text", { x: lx, y: ly, "font-family": FONT, "font-size": 13, "font-weight": 700, fill: e.port === "yes" ? "#1E6B3A" : "#B3261E" });
        t.textContent = e.port === "yes" ? "Yes" : "No";
        g.append(t);
      }
      edgeLayer.append(g);
    }
    // banner
    if (err && !isBlankChart(chart)) {
      banner.hidden = false;
      banner.textContent = "";
      banner.title = err.message;
      banner.append(el("span", { class: "fc-banner-ico", "aria-hidden": "true" }, "⚠"), el("span", { class: "fc-banner-text" }, err.message));
      if (err.nodeId || err.edgeId) {
        const b = el("button", { type: "button", class: "fc-banner-btn" }, "Show me");
        b.addEventListener("click", () => editor.showError(err));
        banner.append(b);
      }
    } else banner.hidden = true;
    undoBtn.disabled = readOnly || !undoStack.length;
    redoBtn.disabled = readOnly || !redoStack.length;
    delBtn.disabled = readOnly || !sel || (sel.kind === "node" && nodeById(sel.id)?.kind === "start");
  }

  function buildNode(n: FlowNode, label: string): SVGGElement {
    const { w, h } = nodeSize(n.kind);
    const st = SHAPE_STYLE[n.kind];
    const g = svg("g", { "data-id": n.id });
    const title = svg("title");
    title.textContent = `${KIND_NAMES[n.kind]}: ${label}`;
    g.append(title, svg("rect", { class: "fc-glow", x: -6, y: -6, width: w + 12, height: h + 12, rx: 14, fill: "none" }), shapeEl(n.kind));
    const max = n.kind === "decision" ? 17 : n.kind === "start" || n.kind === "end" ? 14 : 22;
    const lines = wrap(label, max);
    const lh = 16;
    lines.forEach((l, i) => {
      const t = svg("text", {
        x: w / 2, y: h / 2 + (i - (lines.length - 1) / 2) * lh + 5, "text-anchor": "middle", "font-family": FONT,
        "font-size": n.kind === "start" || n.kind === "end" ? 16 : 14, "font-weight": n.kind === "start" || n.kind === "end" ? 700 : 600, fill: st.text,
      });
      t.textContent = l;
      g.append(t);
    });
    for (const p of portsOf(n.kind)) {
      const pp = portPos(n.kind, p);
      const pg = svg("g", { class: "fc-port", "data-port": p, transform: `translate(${pp.x},${pp.y})` });
      pg.dataset.port = p;
      pg.append(svg("circle", { class: "fc-port-hit", r: 20, fill: "transparent" }));
      pg.append(svg("circle", { class: "fc-port-dot", r: 7, fill: "#FFFDF9", stroke: p === "no" ? "#B3261E" : p === "yes" ? "#1E6B3A" : "#5E584E", "stroke-width": 2.5 }));
      g.append(pg);
    }
    return g;
  }

  // ---------------------------------------------------------------- side panel
  function renderPanel(): void {
    renderPanelNow();
    requestAnimationFrame(() => ensureVisible());
  }
  function renderPanelNow(): void {
    panel.textContent = "";
    const s = sel;
    if (!s) { panel.hidden = true; return; }
    panel.hidden = false;
    const perr = currentProgram().error;
    const culprit = !!perr && ((s.kind === "node" && perr.nodeId === s.id) || (s.kind === "edge" && perr.edgeId === s.id));
    const head = el("div", { class: "fc-panel-head" });
    const close = el("button", { type: "button", class: "fc-x", "aria-label": "Close" }, "✕");
    close.addEventListener("click", () => { sel = null; render(); renderPanel(); });
    if (s.kind === "edge") {
      const e = edgeById(s.id);
      if (!e) { panel.hidden = true; return; }
      const a = nodeById(e.from), b = nodeById(e.to);
      head.append(el("h3", {}, e.port === "out" ? "Arrow" : `${e.port === "yes" ? "Yes" : "No"} arrow`), close);
      panel.append(head);
      if (culprit) panel.append(el("p", { class: "fc-problem" }, perr!.message));
      panel.append(el("p", { class: "fc-note" }, `From “${a ? nodeLabel(a) : "?"}” to “${b ? nodeLabel(b) : "?"}”.`),
        el("p", { class: "fc-note" }, "To change where it goes, drag a new arrow from the same dot."));
      panel.append(delButton("Delete arrow"));
      return;
    }
    const n = nodeById(s.id);
    if (!n) { panel.hidden = true; return; }
    head.append(el("h3", {}, KIND_NAMES[n.kind]), close);
    panel.append(head);
    if (n.kind === "start") {
      panel.append(el("p", { class: "fc-note" }, "Your program begins here. Drag from the dot at the bottom to the first shape."));
      return;
    }
    if (n.kind === "end") {
      panel.append(el("p", { class: "fc-note" }, "The program stops when it gets here. You can have more than one End."), delButton("Delete shape"));
      return;
    }
    const vars = knownVars();
    const dl = el("datalist", { id: `fcVars-${s.id}` });
    for (const v of vars) dl.append(el("option", { value: v }));
    panel.append(dl);
    if (n.kind === "action") {
      const cmd = el("select", { "aria-label": "Command" });
      const groups = new Map<string, HTMLOptGroupElement>();
      for (const [op, spec] of Object.entries(ACTIONS)) {
        if (spec.hw && !hardware[spec.hw] && n.op !== op) continue;
        let og = groups.get(spec.group);
        if (!og) { og = el("optgroup"); og.label = spec.group; groups.set(spec.group, og); cmd.append(og); }
        og.append(el("option", { value: op }, spec.label));
      }
      cmd.value = n.op ?? "drive_for";
      cmd.disabled = readOnly;
      cmd.addEventListener("change", () => commit(() => { n.op = cmd.value; n.args = { ...defaultArgs("action", cmd.value) }; }));
      panel.append(row("Command", cmd));
    }
    for (const f of fieldsFor(n)) panel.append(fieldRow(n, f, dl.id));
    const prob = culprit ? perr!.message : nodeProblem(n);
    if (prob) panel.append(el("p", { class: "fc-problem" }, prob));
    const help = n.kind === "decision" ? "Yes arrow: bottom dot. No arrow: right dot. Point one of them back up to make a loop."
      : n.kind === "input" ? "Reads the robot (or the controller) and keeps the answer in a variable you can use later." : "";
    if (help) panel.append(el("p", { class: "fc-note" }, help));
    panel.append(delButton("Delete shape"));
  }
  function delButton(label: string): HTMLButtonElement {
    const b = el("button", { type: "button", class: "fc-del" }, label);
    b.disabled = readOnly;
    b.addEventListener("click", () => deleteSelection());
    return b;
  }
  function row(label: string, control: HTMLElement): HTMLElement {
    const l = el("label", { class: "fc-row" });
    l.append(el("span", {}, label), control);
    return l;
  }
  function knownVars(): string[] {
    const s = new Set<string>();
    for (const n of chart.nodes) { const v = nodeVars(n); v.sets.forEach((x) => s.add(x)); }
    return [...s].sort();
  }
  function fieldRow(n: FlowNode, f: Field, listId: string): HTMLElement {
    const a = n.args;
    const set = (k: string, v: string, extra?: (x: Record<string, string>) => void) =>
      commit(() => { n.args = { ...n.args, [k]: v }; extra?.(n.args); });
    let control: HTMLElement;
    const lhsType = n.kind === "decision" ? (a.lhs === "var" ? "var" : READING_BY_ID.get(a.lhs)?.type) : null;
    if (f.kind === "choice" || f.kind === "color" || (f.key === "rhs" && lhsType === "color")) {
      const s = el("select");
      let opts2: [string, string][] = f.kind === "choice" ? f.options : COLORS.map((c) => [c, c]);
      if (f.key === "rhs" && lhsType === "color") opts2 = COLORS.map((c) => [c, c]);
      if (f.key === "cmp") opts2 = lhsType === "color" ? [["==", "="], ["!=", "≠"]] : lhsType === "var" ? [...CMP_OPS, ["true", "is True"]] : CMP_OPS;
      for (const [v, t] of opts2) s.append(el("option", { value: v }, t));
      s.value = a[f.key] ?? "";
      if (s.selectedIndex < 0) s.selectedIndex = 0;
      s.addEventListener("change", () => set(f.key, s.value));
      control = s;
    } else if (f.kind === "reading") {
      const s = el("select");
      if (n.kind === "decision") s.append(el("option", { value: "var" }, "a variable"));
      const groups = new Map<string, HTMLOptGroupElement>();
      for (const r of READINGS) {
        if (!f.types.includes(r.type)) continue;
        let og = groups.get(r.group);
        if (!og) { og = el("optgroup"); og.label = r.group; groups.set(r.group, og); s.append(og); }
        og.append(el("option", { value: r.id }, r.needsColor ? `${r.label} a colour` : r.label));
      }
      s.value = a[f.key];
      s.addEventListener("change", () => set(f.key, s.value, (x) => {
        if (n.kind !== "decision") return;
        const t = s.value === "var" ? "var" : READING_BY_ID.get(s.value)?.type;
        if (t === "color") { x.cmp = "=="; x.rhs = "BLACK"; }
        else if (t === "num" || t === "var") { if (!CMP_OPS.some((c) => c[0] === x.cmp) && !(t === "var" && x.cmp === "true")) x.cmp = "<"; if (!valueCode(x.rhs)) x.rhs = "200"; }
      }));
      control = s;
    } else {
      const inp = el("input", { type: "text", autocomplete: "off", spellcheck: "false", maxlength: String(f.kind === "text" ? LIMITS.text : LIMITS.value) });
      if (f.kind !== "text") inp.setAttribute("list", listId);
      if (f.kind === "value") inp.setAttribute("inputmode", "decimal");
      inp.value = a[f.key] ?? "";
      const check = () => {
        const v = inp.value.trim();
        const bad = f.kind === "value" ? valueCode(v) === null : f.kind === "var" ? !!varNameProblem(v) : f.kind === "optvar" ? !!v && !!varNameProblem(v) : false;
        inp.classList.toggle("fc-invalid", bad);
        inp.setAttribute("aria-invalid", String(bad));
      };
      check();
      inp.addEventListener("input", check);
      inp.addEventListener("change", () => set(f.key, f.kind === "text" ? inp.value : inp.value.trim()));
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
      control = inp;
    }
    (control as HTMLInputElement).disabled = readOnly;
    return row(f.label, control);
  }

  // ---------------------------------------------------------------- view
  const toWorld = (cx: number, cy: number) => {
    const r = sv.getBoundingClientRect();
    return { x: (cx - r.left - view.tx) / view.k, y: (cy - r.top - view.ty) / view.k };
  };
  function zoomAt(f: number, cx: number, cy: number): void {
    const r = sv.getBoundingClientRect();
    const k = Math.max(0.3, Math.min(2.5, view.k * f));
    const px = cx - r.left, py = cy - r.top;
    view = { k, tx: px - ((px - view.tx) / view.k) * k, ty: py - ((py - view.ty) / view.k) * k };
    render();
  }
  function zoomBy(f: number): void {
    const r = sv.getBoundingClientRect();
    zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
  }
  function fit(): void {
    const r = sv.getBoundingClientRect();
    if (r.width < 20 || r.height < 20 || !chart.nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of chart.nodes) {
      const { w, h } = nodeSize(n.kind);
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
    }
    x0 -= 70; x1 += 70; y0 -= 30; y1 += 40;
    if (!banner.hidden) y1 += 44;
    const k = Math.max(0.3, Math.min(1.1, r.width / (x1 - x0), r.height / (y1 - y0)));
    view = { k, tx: (r.width - (x1 - x0) * k) / 2 - x0 * k, ty: Math.max(8, (r.height - (y1 - y0) * k) / 2) - y0 * k };
    render();
  }
  sv.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    else { view = { ...view, tx: view.tx - e.deltaX, ty: view.ty - e.deltaY }; render(); }
  }, { passive: false });

  // ---------------------------------------------------------------- pointer interaction
  type Drag =
    | { t: "pan"; sx: number; sy: number; tx: number; ty: number }
    | { t: "move"; id: string; dx: number; dy: number; before: string; moved: boolean; sx: number; sy: number }
    | { t: "wire"; id: string; port: Port; sx: number; sy: number; moved: boolean }
    | { t: "pinch" };
  let drag: Drag | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { d: number; k: number; cx: number; cy: number; tx: number; ty: number } | null = null;

  sv.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    root.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { sv.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: view.tx, ty: view.ty };
      drag = { t: "pinch" };
      rubber.style.display = "none";
      return;
    }
    const target = e.target as Element;
    const portEl = target.closest(".fc-port") as SVGGElement | null;
    const nodeEl = target.closest(".fc-node") as SVGGElement | null;
    const edgeEl = target.closest(".fc-edge") as SVGGElement | null;
    if (portEl && nodeEl && !readOnly) {
      drag = { t: "wire", id: nodeEl.dataset.id!, port: portEl.dataset.port as Port, sx: e.clientX, sy: e.clientY, moved: false };
      e.preventDefault();
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.id!;
      if (pendingPort && !readOnly) {
        const pp = pendingPort;
        pendingPort = null;
        hint.classList.remove("show");
        commit(() => { connect(pp.id, pp.port, id); sel = { kind: "node", id }; });
        drag = null;
        return;
      }
      const n = nodeById(id)!;
      sel = { kind: "node", id };
      const w = toWorld(e.clientX, e.clientY);
      drag = { t: "move", id, dx: w.x - n.x, dy: w.y - n.y, before: snapshot(), moved: false, sx: e.clientX, sy: e.clientY };
      render(); renderPanel();
      return;
    }
    pendingPort = null;
    if (edgeEl) { sel = { kind: "edge", id: edgeEl.dataset.id! }; drag = null; render(); renderPanel(); return; }
    if (sel) { sel = null; renderPanel(); }
    drag = { t: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    render();
  });
  sv.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (drag.t === "pinch" && pinchStart && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.max(0.3, Math.min(2.5, pinchStart.k * d / pinchStart.d));
      const r = sv.getBoundingClientRect();
      const px = pinchStart.cx - r.left, py = pinchStart.cy - r.top;
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      view = { k, tx: cx - ((px - pinchStart.tx) / pinchStart.k) * k, ty: cy - ((py - pinchStart.ty) / pinchStart.k) * k };
      render();
    } else if (drag.t === "pan") {
      view = { ...view, tx: drag.tx + e.clientX - drag.sx, ty: drag.ty + e.clientY - drag.sy };
      render();
    } else if (drag.t === "move") {
      if (readOnly) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.moved = true;
      const n = nodeById(drag.id);
      if (!n) return;
      const w = toWorld(e.clientX, e.clientY);
      const nx = snap(w.x - drag.dx), ny = snap(w.y - drag.dy);
      if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; render(); }
    } else if (drag.t === "wire") {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.moved = true;
      const n = nodeById(drag.id)!;
      const pp = portPos(n.kind, drag.port);
      const w = toWorld(e.clientX, e.clientY);
      rubber.setAttribute("d", `M${n.x + pp.x},${n.y + pp.y} L${w.x},${w.y}`);
      rubber.style.display = "";
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".fc-node") as SVGGElement | null;
      for (const g of nodeLayer.querySelectorAll(".fc-drop")) g.classList.remove("fc-drop");
      if (over && !over.classList.contains("fc-k-start")) over.classList.add("fc-drop");
    }
  });
  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (drag?.t === "pinch") { if (pointers.size === 0) { drag = null; pinchStart = null; } return; }
    const d = drag;
    drag = null;
    rubber.style.display = "none";
    for (const g of nodeLayer.querySelectorAll(".fc-drop")) g.classList.remove("fc-drop");
    if (!d) return;
    if (d.t === "move" && d.moved) {
      if (snapshot() !== d.before) { undoStack.push(d.before); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; changed(); }
    } else if (d.t === "wire") {
      if (!d.moved) {
        // tap on a dot: arm it, then tap the shape to connect to
        pendingPort = { id: d.id, port: d.port };
        sel = { kind: "node", id: d.id };
        showHint("Now tap the shape this arrow should go to.");
        render(); renderPanel();
        return;
      }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".fc-node") as SVGGElement | null;
      const to = over?.dataset.id;
      if (to && e.type === "pointerup") {
        const t = nodeById(to);
        if (t?.kind === "start") showHint("Arrows can't go into Start.");
        else commit(() => connect(d.id, d.port, to));
      } else if (e.type === "pointerup") {
        // dropped on empty grid: add a shape there? Keep it simple: tell the student.
        showHint("Drop the arrow on a shape to connect it.");
      }
    }
  };
  sv.addEventListener("pointerup", endPointer);
  sv.addEventListener("pointercancel", endPointer);

  function paletteDrag(btn: HTMLButtonElement, kind: NodeKind): void {
    btn.addEventListener("pointerdown", (e) => {
      if (readOnly || (e.button !== 0 && e.pointerType === "mouse")) return;
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const sx = e.clientX, sy = e.clientY;
      let ghost: HTMLElement | null = null;
      const move = (m: PointerEvent) => {
        if (!ghost && Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
        if (!ghost) {
          ghost = el("div", { class: `fc-ghost fc-k-${kind}` }, KIND_NAMES[kind]);
          document.body.append(ghost);
        }
        ghost.style.left = `${m.clientX}px`; ghost.style.top = `${m.clientY}px`;
      };
      const up = (u: PointerEvent) => {
        btn.removeEventListener("pointermove", move);
        btn.removeEventListener("pointerup", up);
        btn.removeEventListener("pointercancel", up);
        if (ghost) {
          ghost.remove();
          const r = sv.getBoundingClientRect();
          if (u.type === "pointerup" && u.clientX >= r.left && u.clientX <= r.right && u.clientY >= r.top && u.clientY <= r.bottom) {
            const w = toWorld(u.clientX, u.clientY);
            addNode(kind, w.x, w.y);
          }
        } else if (u.type === "pointerup") addByTap(kind);
      };
      btn.addEventListener("pointermove", move);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
    });
    btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addByTap(kind); } });
  }
  /** Tap a palette shape: put it under the selected shape and connect its free dot, or in view. */
  function addByTap(kind: NodeKind): void {
    if (readOnly) return;
    const s = sel?.kind === "node" ? nodeById(sel.id) : undefined;
    const port = s ? freePort(s) : null;
    if (s && port) {
      const pp = portPos(s.kind, port);
      const { h } = nodeSize(kind);
      const x = port === "no" ? s.x + pp.x + 140 : s.x + pp.x;
      const y = port === "no" ? s.y + pp.y + 60 + h / 2 : s.y + pp.y + 60 + h / 2;
      addNode(kind, x, y, { id: s.id, port });
      ensureVisible();
      return;
    }
    const r = sv.getBoundingClientRect();
    const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    // avoid stacking on another shape
    let y = w.y;
    while (chart.nodes.some((n) => Math.abs(n.y + nodeSize(n.kind).h / 2 - y) < 40 && Math.abs(n.x + nodeSize(n.kind).w / 2 - w.x) < 100)) y += 80;
    addNode(kind, w.x, y);
  }
  function ensureVisible(): void {
    if (sel?.kind !== "node") return;
    const n = nodeById(sel.id);
    if (!n) return;
    const r = sv.getBoundingClientRect();
    const { w, h } = nodeSize(n.kind);
    // room on the right taken by the floating panel (wide layout) or the zoom buttons
    const right = !panel.hidden && !root.classList.contains("fc-narrow") ? panel.offsetWidth + 16 : 56;
    const sx = n.x * view.k + view.tx, sy = n.y * view.k + view.ty;
    let { tx, ty } = view;
    if (sy + h * view.k > r.height - 20) ty -= sy + h * view.k - r.height + 40;
    if (sy < 10) ty += 10 - sy;
    if (sx + w * view.k > r.width - right) tx -= sx + w * view.k - (r.width - right);
    if (sx + (tx - view.tx) < 10) tx = view.tx + 10 - sx;
    if (tx !== view.tx || ty !== view.ty) { view = { ...view, tx, ty }; render(); }
  }

  let hintTimer = 0;
  function showHint(text: string): void {
    hint.textContent = text;
    hint.classList.add("show");
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.remove("show"), 3200);
  }

  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".fc-panel") || t.tagName === "SELECT" || t.tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); }
    else if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    else if (e.key === "Escape") { pendingPort = null; sel = null; render(); renderPanel(); }
    else if (e.key.startsWith("Arrow") && sel?.kind === "node" && !readOnly) {
      e.preventDefault();
      const id = sel.id;
      const dx = e.key === "ArrowLeft" ? -GRID : e.key === "ArrowRight" ? GRID : 0;
      const dy = e.key === "ArrowUp" ? -GRID : e.key === "ArrowDown" ? GRID : 0;
      commit(() => { const n = nodeById(id); if (n) { n.x += dx; n.y += dy; } });
    }
  });

  // ---------------------------------------------------------------- export
  async function exportImage(): Promise<string> {
    if (isBlankChart(chart)) return "";
    renderNow();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    try {
      const b = (nodeLayer as SVGGraphicsElement).getBBox(), b2 = (edgeLayer as SVGGraphicsElement).getBBox();
      x0 = Math.min(b.x, b2.width ? b2.x : b.x); y0 = Math.min(b.y, b2.height ? b2.y : b.y);
      x1 = Math.max(b.x + b.width, b2.x + b2.width); y1 = Math.max(b.y + b.height, b2.y + b2.height);
    } catch { /* fall back to shapes */ }
    if (!Number.isFinite(x0)) for (const n of chart.nodes) {
      const { w, h } = nodeSize(n.kind);
      x0 = Math.min(x0, n.x - 80); y0 = Math.min(y0, n.y - 10); x1 = Math.max(x1, n.x + w + 80); y1 = Math.max(y1, n.y + h + 30);
    }
    const pad = 24;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
    const out = svg("svg", { xmlns: SVG_NS, width: W, height: H, viewBox: `${x0} ${y0} ${W} ${H}` });
    out.append(defs.cloneNode(true), svg("rect", { x: x0, y: y0, width: W, height: H, fill: "#FFFFFF" }));
    const e2 = edgeLayer.cloneNode(true) as SVGGElement, n2 = nodeLayer.cloneNode(true) as SVGGElement;
    for (const p of n2.querySelectorAll(".fc-port, .fc-glow, title")) p.remove();
    for (const p of e2.querySelectorAll(".fc-edge-line")) { p.setAttribute("stroke", "#5E584E"); p.setAttribute("stroke-width", "2"); p.setAttribute("marker-end", "url(#fcArrow)"); }
    out.append(e2, n2);
    const text = new XMLSerializer().serializeToString(out);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("image")); img.src = url; });
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = Math.min(8000, W * scale); c.height = Math.min(8000, H * scale);
    const ctx = c.getContext("2d")!;
    ctx.scale(c.width / W, c.height / H);
    ctx.drawImage(img, 0, 0, W, H);
    return c.toDataURL("image/png");
  }
  async function savePicture(): Promise<void> {
    try {
      const url = await exportImage();
      if (!url) { showHint("Add some shapes first."); return; }
      const a = document.createElement("a");
      a.href = url; a.download = "flowchart.png";
      document.body.append(a); a.click(); a.remove();
      showHint("Saved flowchart.png — add it to your engineering notebook.");
    } catch (e) { console.error(e); showHint("Couldn't make the picture in this browser."); }
  }

  // ---------------------------------------------------------------- public
  const ro = new ResizeObserver(() => {
    root.classList.toggle("fc-narrow", root.getBoundingClientRect().width < 640);
    render();
  });
  ro.observe(stage);
  render();

  const editor: FlowchartEditor = {
    getPython: () => currentProgram().code,
    getState: () => JSON.parse(snapshot()),
    setState(state: unknown) {
      const r = state == null ? { chart: blankChart(), warnings: [] } : sanitizeChart(state);
      if (!r) throw new Error("This flowchart couldn't be read.");
      chart = r.chart;
      sel = null; pendingPort = null; running = null; flash = null;
      undoStack.length = 0; redoStack.length = 0;
      program = null;
      render(); renderPanel();
      requestAnimationFrame(() => fit());
    },
    highlightLine(line: number) {
      const id = line > 0 ? currentProgram().lineMap[line - 1] ?? null : null;
      if (id === running) return;
      running = id;
      for (const [nid, rec] of nodeEls) rec.g.classList.toggle("fc-run", nid === id);
    },
    setHardware(hw) {
      hardware = { ...hw };
      renderPanel();
    },
    setReadOnly(on: boolean) {
      readOnly = on;
      pendingPort = null;
      root.classList.toggle("fc-ro", on);
      for (const b of bar.querySelectorAll<HTMLButtonElement | HTMLSelectElement>("button, select")) {
        if (b === zoomIn || b === zoomOut || b === fitBtn || b === imgBtn) continue;
        b.disabled = on;
      }
      render(); renderPanel();
    },
    resize() { render(); },
    dispose() { ro.disconnect(); root.remove(); },
    getError: () => currentProgram().error,
    showError(err: FlowError) {
      flash = err.nodeId ?? err.edgeId ?? null;
      if (err.nodeId) sel = { kind: "node", id: err.nodeId };
      else if (err.edgeId) sel = { kind: "edge", id: err.edgeId };
      renderNow(); renderPanel();
      const target = err.nodeId ? nodeById(err.nodeId) : err.edgeId ? nodeById(edgeById(err.edgeId)?.from ?? "") : undefined;
      if (target) {
        const r = sv.getBoundingClientRect();
        const { w, h } = nodeSize(target.kind);
        const sx = target.x * view.k + view.tx, sy = target.y * view.k + view.ty;
        if (sx < 0 || sy < 0 || sx + w * view.k > r.width || sy + h * view.k > r.height) {
          view = { ...view, tx: r.width / 2 - (target.x + w / 2) * view.k, ty: r.height / 2 - (target.y + h / 2) * view.k };
          render();
        }
      }
    },
    isBlank: () => isBlankChart(chart),
    exportImage,
  };
  return editor;
}
