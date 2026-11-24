/**
 * The teacher level editor UI. `mountLevelEditor` takes the renderer factory as a parameter so the
 * preview page / tests can inject the fallback renderer; the app uses index.ts (real renderer).
 */
import type { ColorName, Goal, Platform, SimState, Vec, World, WorldObject, Zone } from "../core/types";
import { COLOR_HEX } from "../core/types";
import type { LevelEditor, LevelEditorOptions, Renderer } from "../core/modules";
import {
  dist, dragHandle, findItem, handlesFor, hitTest, itemAnchor, rectFromCorners,
  removeItem, ROBOT_SIZE, snapHeading, snapPoint, START_ID, translateItem, type ItemRef,
} from "./geometry";
import { History } from "./history";
import { collectIds, ID_PREFIX, nextId } from "./ids";
import { COLOR_NAMES, LEVEL_EXTENSION, LIMITS, levelFileText, normDeg, parseLevelFile, SIZE_PRESETS, newBlankWorld, sanitizeWorld } from "./levelFile";
import { EDITOR_CSS } from "./styles";
import { GOAL_LABELS, validateWorld, type Issue } from "./validate";
import { clampView, FIT_VIEW, MAX_ZOOM, MIN_ZOOM, panBy, viewWithAnchor, wheelZoomFactor, type EditorView } from "./viewMath";
import { moveGoal, moveVisitZone } from "./goalOrder";

/** The id the renderer uses to outline the robot start. */
const RENDER_START_ID = "start";

export type RendererFactory = (canvas: HTMLCanvasElement) => Renderer;

export type Tool = "select" | "wall" | "paint" | "object" | "zone" | "platform" | "robot" | "erase"; // arm: platform
type PaintShape = "rect" | "circle" | "line";
type TwoPointMode = "wall" | "paintRect" | "paintCircle" | "zoneRect" | "zoneCircle" | "platform"; // arm: platform

type Drag =
  | { mode: "move"; ref: ItemRef; start: Vec; anchor: Vec; orig: World }
  | { mode: "handle"; ref: ItemRef; i: number; orig: World }
  | { mode: "twoPoint"; downPx: { px: number; py: number } }
  | { mode: "erase" };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ------------------------------------------------------------------ tiny DOM helper

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const ICONS: Record<Tool, string> = {
  select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  wall: '<path d="M3 17L21 7" stroke-width="4"/>',
  paint: '<rect x="4" y="5" width="9" height="9" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="4.5" fill="currentColor" stroke="none"/>',
  object: '<circle cx="8" cy="15" r="4.5"/><rect x="12.5" y="4" width="8" height="8"/>',
  zone: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/><path d="M9 12h6M12 9v6"/>',
  platform: '<path d="M4 10l8-4 8 4-8 4z"/><path d="M4 10v6l8 4 8-4v-6M12 14v6"/>', // arm
  robot: '<rect x="6" y="7" width="12" height="13" rx="1"/><path d="M12 2v6M9 5l3-3 3 3"/>',
  erase: '<path d="M4 15l8-8 7 7-5 5H8z"/><path d="M8 19h12"/>',
};
const TOOL_INFO: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select", key: "v", hint: "Click an item to select · drag to move · arrows nudge · Delete removes · wheel/pinch zooms · space+drag pans" },
  { id: "wall", label: "Wall", key: "w", hint: "Drag (or click two points) to draw a wall" },
  { id: "paint", label: "Paint", key: "p", hint: "" },
  { id: "object", label: "Object", key: "o", hint: "Click to place an object" },
  { id: "zone", label: "Zone", key: "z", hint: "Drag (or click two points) to mark a goal zone" },
  { id: "platform", label: "Platform", key: "l", hint: "Drag (or click two points) to draw a raised platform the arm can put objects on" }, // arm
  { id: "robot", label: "Robot", key: "r", hint: "Click/drag to place the start · drag the orange dot or press [ ] to rotate 15°" },
  { id: "erase", label: "Erase", key: "e", hint: "Click or drag over items to erase them" },
];

function staticState(w: World): SimState {
  return {
    time: 0, robot: { ...w.start }, robotSize: ROBOT_SIZE, objects: w.objects, carrying: null,
    penDown: false, penColor: "BLACK", strokes: [], path: [], wallHits: 0, bumperPressed: false,
    distanceRay: null, visitedZones: [],
  };
}

function prepare(w: World): World {
  // Sanitising also guarantees unique ids on every item, which selection needs.
  return sanitizeWorld(clone(w)).world;
}

function defaultGoal(type: Goal["type"], w: World): Goal {
  const z = w.zones[0]?.id ?? "";
  switch (type) {
    case "reachZone": return { type, zone: z };
    case "objectsInZone": return { type, zone: z, count: 1 };
    case "visitInOrder": return { type, zones: w.zones.slice(0, 2).map((q) => q.id) };
    case "noWallHits": return { type };
    case "endFacing": return { type, heading: 0, tolerance: 10 };
    case "maxTime": return { type, seconds: 60 };
    case "objectsOnPlatform": return { type, platform: w.platforms?.[0]?.id ?? "", count: 1 }; // arm
    case "stackHeight": return { type, count: 2 }; // arm
  }
}

function nextZoneLabel(w: World): string {
  const used = new Set(w.zones.map((z) => z.label));
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!used.has(l)) return l; }
  return `Zone ${w.zones.length + 1}`;
}

// ------------------------------------------------------------------ the editor

export function mountLevelEditor(host: HTMLElement, opts: LevelEditorOptions, makeRenderer: RendererFactory): LevelEditor {
  let world = prepare(opts.world);
  const history = new History<World>(world);
  let selectedId: string | null = null;
  let tool: Tool = "select";
  let paintShape: PaintShape = "rect";
  let zoneShape: "rect" | "circle" = "rect";
  let snapOn = true;
  let snapStep = 100;
  const topts = {
    paintColor: "BLACK" as ColorName, lineWidth: 25, wallThickness: 20,
    objShape: "disk" as WorldObject["shape"], objColor: "RED" as ColorName, objSize: 100, movable: true, pickable: false,
    platHeight: 100, platColor: "YELLOW" as ColorName, // arm
  };
  let tab: "item" | "level" | "goals" = "level";
  let drag: Drag | null = null;
  type Pending = { mode: TwoPointMode; a: Vec } | null;
  let pending: Pending = null;
  let linePts: Vec[] = [];
  let hover: Vec | null = null;
  let lastDown = { t: 0, px: -99, py: -99 };
  let disposed = false;

  // ---------------- DOM
  const root = h("div", { class: "le-root", tabindex: 0 });
  root.append(h("style", { text: EDITOR_CSS }));

  const btnUndo = h("button", { class: "le-btn", title: "Undo (Ctrl+Z)", "aria-label": "Undo", text: "Undo" });
  const btnRedo = h("button", { class: "le-btn", title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo", text: "Redo" });
  const btnSnap = h("button", { class: "le-btn le-small", title: "Snap to grid", "aria-pressed": "true", text: "Snap" });
  const selSnap = h("select", { "aria-label": "Snap step", class: "le-btn le-small" });
  for (const s of [50, 100, 200]) selSnap.append(h("option", { value: s, text: `${s} mm` }));
  selSnap.value = String(snapStep);
  const btnNew = h("button", { class: "le-btn le-small le-hide-narrow", title: "Start a new blank level", text: "New" });
  const btnOpen = h("button", { class: "le-btn le-small", title: `Open a ${LEVEL_EXTENSION} file`, text: "Open…" });
  const btnSave = h("button", { class: "le-btn le-small", title: `Save as a ${LEVEL_EXTENSION} file`, text: "Save" });
  const fileInput = h("input", { type: "file", class: "le-file", accept: `${LEVEL_EXTENSION},.json,application/json` });
  const btnTest = h("button", { class: "le-btn le-primary", text: "▶ Test this level" });
  const header = h("div", { class: "le-header" },
    h("div", { class: "le-title" }, "Level ", h("b", { text: "editor" })),
    h("div", { class: "le-group" }, btnUndo, btnRedo),
    h("div", { class: "le-sep" }),
    h("div", { class: "le-group" }, btnSnap, selSnap),
    h("div", { class: "le-spacer" }),
    h("div", { class: "le-group" }, btnNew, btnOpen, ...(opts.embedded ? [] : [btnSave]), fileInput),
    ...(opts.embedded ? [] : [h("div", { class: "le-sep" }), btnTest]));

  const rail = h("div", { class: "le-rail", role: "toolbar", "aria-label": "Tools", "aria-orientation": "vertical" });
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOL_INFO) {
    const b = h("button", { class: "le-tool", title: `${t.label} (${t.key.toUpperCase()})`, "aria-pressed": "false" });
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[t.id]}</svg>`;
    b.append(h("span", { text: t.label }));
    b.addEventListener("click", () => setTool(t.id));
    toolBtns.set(t.id, b);
    rail.append(b);
  }

  const optsBar = h("div", { class: "le-opts" });
  const stage = h("div", { class: "le-stage" });
  const canvas = h("canvas", {});
  const overlay = h("canvas", { class: "le-overlay", "aria-label": "Level canvas" });
  const toast = h("div", { class: "le-toast", role: "status" });
  const btnZoomOut = h("button", { class: "le-btn le-zbtn", title: "Zoom out (−)", "aria-label": "Zoom out", text: "−" });
  const btnZoomIn = h("button", { class: "le-btn le-zbtn", title: "Zoom in (+)", "aria-label": "Zoom in", text: "+" });
  const btnFit = h("button", { class: "le-btn le-zbtn", title: "Fit the whole field (0)", "aria-label": "Fit the whole field", text: "Fit" });
  const zoomLabel = h("span", { class: "le-zoom-label", "aria-live": "polite", text: "100%" });
  const zoomBar = h("div", { class: "le-zoom", role: "group", "aria-label": "Zoom" }, btnZoomOut, zoomLabel, btnZoomIn, btnFit);
  stage.append(canvas, overlay, zoomBar, toast);

  const tabBtns = {
    item: h("button", { class: "le-tab", role: "tab", text: "Item" }),
    level: h("button", { class: "le-tab", role: "tab", text: "Level" }),
    goals: h("button", { class: "le-tab", role: "tab", text: "Goals" }),
  };
  const goalsBadge = h("span", { class: "le-badge" });
  const panels = { item: h("div", { class: "le-panel" }), level: h("div", { class: "le-panel" }), goals: h("div", { class: "le-panel" }) };
  const issuesEl = h("div", { class: "le-issues", "aria-live": "polite" });
  const side = h("div", { class: "le-side" },
    h("div", { class: "le-tabs", role: "tablist" }, tabBtns.item, tabBtns.level, tabBtns.goals),
    panels.item, panels.level, panels.goals, issuesEl);
  (Object.keys(tabBtns) as (keyof typeof tabBtns)[]).forEach((k) => tabBtns[k].addEventListener("click", () => setTab(k)));

  root.append(header, rail, optsBar, stage, side);
  host.append(root);

  const renderer = makeRenderer(canvas);
  /** Zoom/pan needs Renderer.setView (optional in the contract); without it the editor stays at "fit". */
  const canZoom = typeof renderer.setView === "function";
  if (!canZoom) zoomBar.style.display = "none";
  let view: EditorView = { ...FIT_VIEW };
  let viewField = { w: world.width, h: world.height };

  // ---------------- state changes

  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleEmit = () => {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(flushEmit, 150);
  };
  function flushEmit() {
    if (!emitTimer) return;
    clearTimeout(emitTimer);
    emitTimer = null;
    opts.onChange(clone(world));
  }

  function commit() {
    history.record(world);
    updateUndo();
  }

  interface AfterOpts { record?: boolean; rebuild?: "all" | "props" | "none"; emit?: boolean }
  function afterChange(o: AfterOpts = {}) {
    const { record = true, rebuild = "all", emit = true } = o;
    if (selectedId && !findItem(world, selectedId)) selectedId = null;
    if (world.width !== viewField.w || world.height !== viewField.h) applyView(view);
    if (record) commit();
    if (emit) scheduleEmit();
    requestDraw();
    renderIssues();
    if (rebuild === "all") renderPanels();
    else if (rebuild === "props") renderItemPanel();
  }

  /** Apply a change to a fresh copy of the world (a new reference lets the renderer rebuild its cache). */
  function mutate(fn: (w: World) => void, o: AfterOpts = {}) {
    const next = clone(world);
    fn(next);
    world = next;
    afterChange(o);
  }

  function select(id: string | null) {
    if (id === selectedId) return;
    selectedId = id;
    if (id) setTab("item");
    renderItemPanel();
    requestDraw();
  }

  function updateUndo() {
    btnUndo.disabled = !history.canUndo;
    btnRedo.disabled = !history.canRedo;
  }
  function undo() {
    cancelInteraction();
    const s = history.undo();
    if (s) { world = s; afterChange({ record: false }); updateUndo(); }
  }
  function redo() {
    cancelInteraction();
    const s = history.redo();
    if (s) { world = s; afterChange({ record: false }); updateUndo(); }
  }

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function say(msg: string) {
    toast.textContent = msg;
    toast.classList.add("le-show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("le-show"), 2600);
  }

  // ---------------- tools

  function setTool(t: Tool) {
    if (linePts.length >= 2) finishLine(); else linePts = [];
    pending = null;
    tool = t;
    for (const [id, b] of toolBtns) b.setAttribute("aria-pressed", String(id === t));
    setCursor();
    renderOptsBar();
    requestDraw();
  }

  function twoPointMode(): TwoPointMode | null {
    if (tool === "wall") return "wall";
    if (tool === "paint" && paintShape === "rect") return "paintRect";
    if (tool === "paint" && paintShape === "circle") return "paintCircle";
    if (tool === "zone") return zoneShape === "rect" ? "zoneRect" : "zoneCircle";
    if (tool === "platform") return "platform"; // arm
    return null;
  }

  function segmented<T extends string>(items: [T, string][], value: T, onPick: (v: T) => void): HTMLElement {
    const g = h("div", { class: "le-group", role: "group" });
    for (const [v, label] of items) {
      const b = h("button", { class: "le-btn le-small", "aria-pressed": String(v === value), text: label });
      b.addEventListener("click", () => onPick(v));
      g.append(b);
    }
    return g;
  }
  function lab(t: string) { return h("span", { class: "le-lab", text: t }); }

  function renderOptsBar() {
    optsBar.replaceChildren();
    const info = TOOL_INFO.find((t) => t.id === tool)!;
    if (tool === "wall") {
      optsBar.append(lab("Thickness"), optNum(topts.wallThickness, 5, 300, (v) => (topts.wallThickness = v)), lab("mm"));
    } else if (tool === "paint") {
      optsBar.append(segmented<PaintShape>([["rect", "▭ Rect"], ["circle", "◯ Circle"], ["line", "〰 Tape"]], paintShape, (v) => {
        if (linePts.length >= 2) finishLine(); else linePts = [];
        paintShape = v; pending = null; renderOptsBar(); requestDraw();
      }));
      optsBar.append(lab("Colour"), colorControl(topts.paintColor, (c) => (topts.paintColor = c)));
      if (paintShape === "line") {
        optsBar.append(lab("Width"), optNum(topts.lineWidth, 5, 300, (v) => (topts.lineWidth = v)));
        const fin = h("button", { class: "le-btn le-small", text: "✓ Finish" });
        fin.addEventListener("click", finishLine);
        const can = h("button", { class: "le-btn le-small", text: "✕ Cancel" });
        can.addEventListener("click", () => { linePts = []; requestDraw(); });
        optsBar.append(fin, can, h("span", { class: "le-hint", text: "click points · double-click / Enter to finish" }));
      }
    } else if (tool === "object") {
      optsBar.append(segmented<WorldObject["shape"]>([["disk", "● Disk"], ["box", "■ Box"]], topts.objShape, (v) => { topts.objShape = v; renderOptsBar(); }));
      optsBar.append(colorControl(topts.objColor, (c) => (topts.objColor = c)));
      optsBar.append(lab("Size"), optNum(topts.objSize, 10, 1000, (v) => (topts.objSize = v)));
      optsBar.append(check("Movable", topts.movable, (v) => { topts.movable = v; if (!v) topts.pickable = false; renderOptsBar(); }));
      optsBar.append(check("Pickable", topts.pickable, (v) => { topts.pickable = v; if (v) topts.movable = true; renderOptsBar(); }));
    } else if (tool === "platform") { // arm
      optsBar.append(lab("Height"), optNum(topts.platHeight, LIMITS.platformHeightMin, LIMITS.platformHeightMax, (v) => (topts.platHeight = v)), lab("mm"));
      optsBar.append(lab("Colour"), colorControl(topts.platColor, (c) => (topts.platColor = c)));
      optsBar.append(h("span", { class: "le-hint", text: info.hint }));
    } else if (tool === "zone") {
      optsBar.append(segmented<"rect" | "circle">([["rect", "▭ Rect"], ["circle", "◯ Circle"]], zoneShape, (v) => { zoneShape = v; pending = null; renderOptsBar(); }));
      optsBar.append(h("span", { class: "le-hint", text: info.hint }));
    } else {
      optsBar.append(h("span", { class: "le-hint", text: info.hint }));
    }
  }

  function optNum(value: number, min: number, max: number, set: (v: number) => void): HTMLInputElement {
    const i = h("input", { type: "number", min, max, step: 5, value, inputmode: "decimal" });
    i.addEventListener("input", () => { const v = parseFloat(i.value); if (Number.isFinite(v)) set(Math.min(max, Math.max(min, v))); });
    return i;
  }

  function check(label: string, value: boolean, set: (v: boolean) => void): HTMLLabelElement {
    const i = h("input", { type: "checkbox" });
    i.checked = value;
    i.addEventListener("change", () => set(i.checked));
    return h("label", { class: "le-check" }, i, label);
  }

  function colorControl(value: ColorName, set: (c: ColorName) => void): HTMLElement;
  function colorControl(value: ColorName | undefined, set: (c: ColorName | undefined) => void, any: boolean): HTMLElement;
  function colorControl(value: ColorName | undefined, set: (c: ColorName) => void, any = false): HTMLElement {
    const sw = h("span", { class: "le-swatch" });
    const s = h("select", { "aria-label": "Colour" });
    if (any) s.append(h("option", { value: "", text: "Any colour" }));
    for (const c of COLOR_NAMES) if (c !== "NONE") s.append(h("option", { value: c, text: c[0] + c.slice(1).toLowerCase() }));
    s.value = value ?? "";
    const paint = () => { sw.style.background = s.value ? COLOR_HEX[s.value as ColorName] : "repeating-linear-gradient(45deg,#fff 0 4px,#E9E0D2 4px 8px)"; };
    paint();
    s.addEventListener("change", () => { paint(); set((s.value || undefined) as ColorName); });
    return h("div", { class: "le-color" }, sw, s);
  }

  // ---------------- creating items

  const newId = (w: World, prefix: string) => nextId(collectIds(w), prefix);

  function finishTwoPoint(p: Vec) {
    if (!pending) return;
    const { a, mode } = pending;
    pending = null;
    if (dist(a, p) < 10) { requestDraw(); return; }
    if (mode === "platform" && (world.platforms?.length ?? 0) >= LIMITS.platforms) { say("That's the most platforms a level can have."); requestDraw(); return; } // arm
    let id = "";
    mutate((w) => {
      if (mode === "wall") {
        id = newId(w, ID_PREFIX.wall);
        w.walls.push({ id, a: { ...a }, b: { ...p }, thickness: topts.wallThickness });
      } else if (mode === "paintRect") {
        id = newId(w, ID_PREFIX.floor);
        w.floor.push({ kind: "rect", id, ...rectFromCorners(a, p), color: topts.paintColor });
      } else if (mode === "platform") { // arm
        id = newId(w, ID_PREFIX.platform);
        const r = rectFromCorners(a, p);
        const plat: Platform = { id, x: r.x, y: r.y, w: Math.max(40, r.w), h: Math.max(40, r.h), height: topts.platHeight, color: topts.platColor };
        (w.platforms ??= []).push(plat);
      } else if (mode === "paintCircle") {
        id = newId(w, ID_PREFIX.floor);
        w.floor.push({ kind: "circle", id, x: a.x, y: a.y, r: Math.round(dist(a, p)), color: topts.paintColor });
      } else {
        id = newId(w, ID_PREFIX.zone);
        const label = nextZoneLabel(w);
        const z: Zone = mode === "zoneRect"
          ? { id, kind: "rect", ...rectFromCorners(a, p), label }
          : { id, kind: "circle", x: a.x, y: a.y, r: Math.round(dist(a, p)), label };
        w.zones.push(z);
      }
    }, { rebuild: "none" });
    selectedId = id;
    renderPanels();
    setTab("item");
  }

  function finishLine() {
    const pts = linePts;
    linePts = [];
    if (pts.length < 2) { requestDraw(); return; }
    let id = "";
    mutate((w) => {
      id = newId(w, ID_PREFIX.floor);
      w.floor.push({ kind: "line", id, points: pts, width: topts.lineWidth, color: topts.paintColor });
    }, { rebuild: "none" });
    selectedId = id;
    renderPanels();
    setTab("item");
  }

  function placeObject(p: Vec) {
    if (world.objects.length >= LIMITS.objects) { say("That's the most objects a level can have."); return; }
    let id = "";
    mutate((w) => {
      id = newId(w, ID_PREFIX.object);
      const o: WorldObject = { id, shape: topts.objShape, x: p.x, y: p.y, size: topts.objSize, color: topts.objColor, movable: topts.movable || topts.pickable, pickable: topts.pickable };
      if (o.shape === "box") o.rotation = 0;
      w.objects.push(o);
    }, { rebuild: "none" });
    selectedId = id;
    renderPanels();
    setTab("item");
  }

  function eraseAt(p: Vec): void {
    const hit = hitTest(world, p, tolMM());
    if (!hit) return;
    if (hit.kind === "start") { say("The robot start can't be erased — move it instead."); return; }
    mutate((w) => { const r = findItem(w, hit.id); if (r) removeItem(w, r); }, { record: false });
  }

  function deleteSelected() {
    const r = findItem(world, selectedId);
    if (!r) return;
    if (r.kind === "start") { say("The robot start can't be deleted."); return; }
    mutate((w) => { const q = findItem(w, r.id); if (q) removeItem(w, q); });
    selectedId = null;
    renderItemPanel();
  }

  function duplicateSelected() {
    const r = findItem(world, selectedId);
    if (!r || r.kind === "start") return;
    const off = snapOn ? snapStep : 50;
    let id = "";
    mutate((w) => {
      const q = findItem(w, r.id)!;
      if (q.kind === "wall") { id = newId(w, ID_PREFIX.wall); w.walls.push({ ...clone(w.walls[q.index]), id }); }
      else if (q.kind === "floor") { id = newId(w, ID_PREFIX.floor); w.floor.push({ ...clone(w.floor[q.index]), id }); }
      else if (q.kind === "object") { id = newId(w, ID_PREFIX.object); w.objects.push({ ...clone(w.objects[q.index]), id }); }
      else if (q.kind === "platform") { id = newId(w, ID_PREFIX.platform); w.platforms!.push({ ...clone(w.platforms![q.index]), id }); } // arm
      else if (q.kind === "zone") { id = newId(w, ID_PREFIX.zone); w.zones.push({ ...clone(w.zones[q.index]), id, label: nextZoneLabel(w) }); }
      const n = findItem(w, id);
      if (n) translateItem(w, n, off, -off);
    }, { rebuild: "none" });
    selectedId = id;
    renderPanels();
  }

  function rotateSelected(deg: number) {
    const r = findItem(world, selectedId);
    if (!r) return;
    if (r.kind === "start") mutate((w) => { w.start.heading = snapHeading(w.start.heading + deg); }, { rebuild: "props" });
    else if (r.kind === "object" && world.objects[r.index].shape === "box")
      mutate((w) => { const o = w.objects[r.index]; o.rotation = snapHeading((o.rotation ?? 0) + deg); }, { rebuild: "props" });
  }

  function nudge(dx: number, dy: number) {
    const r = findItem(world, selectedId);
    if (!r) return;
    mutate((w) => translateItem(w, r, dx, dy), { rebuild: "props" });
  }

  function cancelInteraction() {
    pending = null;
    linePts = [];
    if (drag && (drag.mode === "move" || drag.mode === "handle")) world = drag.orig;
    drag = null;
    requestDraw();
  }

  // ---------------- pointer input

  const localPt = (e: PointerEvent | MouseEvent) => {
    const r = overlay.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const rawPt = (e: PointerEvent): Vec => { const { px, py } = localPt(e); return renderer.toWorld(px, py); };
  const snapP = (p: Vec): Vec => (snapOn ? snapPoint(p, snapStep) : { x: Math.round(p.x), y: Math.round(p.y) });
  function mmPerPx(): number {
    const a = renderer.toWorld(0, 0), b = renderer.toWorld(100, 0);
    const d = Math.hypot(b.x - a.x, b.y - a.y) / 100;
    return Number.isFinite(d) && d > 0 ? d : 3;
  }
  const tolMM = (px = 6) => px * mmPerPx();
  function handleAt(px: number, py: number, ref: ItemRef): number {
    const hs = handlesFor(world, ref);
    for (let i = hs.length - 1; i >= 0; i--) {
      const c = renderer.toCanvas(hs[i].x, hs[i].y);
      if (Math.hypot(c.px - px, c.py - py) <= 14) return i;
    }
    return -1;
  }

  // ---------------- zoom & pan

  /** CSS px per mm at the current view. */
  const curScale = () => 1 / mmPerPx();
  const stageCentre = () => ({ px: (canvas.clientWidth || overlay.clientWidth) / 2, py: (canvas.clientHeight || overlay.clientHeight) / 2 });

  function setCursor() {
    overlay.style.cursor = pan ? "grabbing" : spaceDown && canZoom ? "grab"
      : tool === "select" ? "default" : tool === "erase" ? "not-allowed" : "crosshair";
  }

  function updateZoomUi() {
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
    btnZoomOut.disabled = view.zoom <= MIN_ZOOM + 1e-6;
    btnZoomIn.disabled = view.zoom >= MAX_ZOOM - 1e-6;
    btnFit.disabled = view.zoom === FIT_VIEW.zoom && view.cx === FIT_VIEW.cx && view.cy === FIT_VIEW.cy;
  }

  /** Clamp and apply a view (no-op when the renderer can't zoom). */
  function applyView(v: EditorView) {
    viewField = { w: world.width, h: world.height };
    if (!canZoom) return;
    const next = clampView(v, world.width, world.height);
    const same = next.zoom === view.zoom && next.cx === view.cx && next.cy === view.cy;
    view = next;
    renderer.setView!(view.zoom === FIT_VIEW.zoom && view.cx === FIT_VIEW.cx && view.cy === FIT_VIEW.cy ? null : view);
    updateZoomUi();
    if (!same) requestDraw();
  }

  /** Zoom to `zoom`, keeping the world point under canvas point `at` (default: the centre) fixed. */
  function zoomTo(zoom: number, at = stageCentre()) {
    if (!canZoom) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const anchor = renderer.toWorld(at.px, at.py);
    applyView(viewWithAnchor(z, anchor, at, stageCentre(), curScale() / view.zoom));
  }

  btnZoomIn.addEventListener("click", () => zoomTo(view.zoom * 1.5));
  btnZoomOut.addEventListener("click", () => zoomTo(view.zoom / 1.5));
  btnFit.addEventListener("click", () => applyView(FIT_VIEW));

  overlay.addEventListener("wheel", (e) => {
    if (!canZoom) return;
    e.preventDefault();
    // zooming keeps the world point under the cursor fixed, so the snapped hover point stays put
    zoomTo(view.zoom * wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), localPt(e));
  }, { passive: false });

  // Pan: middle-button drag, space + drag (mouse/pen), or two fingers (touch, together with pinch).
  let pan: { id: number; px: number; py: number } | null = null;
  let spaceDown = false;
  const touches = new Map<number, { px: number; py: number }>();
  let gesture: { d0: number; zoom0: number; base: number; anchor: Vec } | null = null;
  /** After a two-finger gesture, ignore the remaining finger(s) until all are lifted. */
  let gestureLock = false;
  /** Editor state when the first finger went down, so a pinch can undo what that finger started. */
  let touchSnap: { world: World; json: string; pending: Pending; linePts: Vec[]; selectedId: string | null } | null = null;

  function twoTouches() {
    const [a, b] = Array.from(touches.values());
    return { d: Math.hypot(b.px - a.px, b.py - a.py), mid: { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 } };
  }

  function startGesture() {
    // the first finger may already have started a tool action: take it back
    if (touchSnap) {
      const snap = touchSnap;
      drag = null;
      pending = snap.pending;
      linePts = snap.linePts;
      if (world !== snap.world) {
        if (JSON.stringify(history.current()) !== snap.json) history.undo();
        world = snap.world;
        afterChange({ record: false });
        updateUndo();
      }
      if (selectedId !== snap.selectedId) { selectedId = snap.selectedId; renderItemPanel(); }
      touchSnap = null;
    }
    const { d, mid } = twoTouches();
    gesture = { d0: Math.max(1, d), zoom0: view.zoom, base: curScale() / view.zoom, anchor: renderer.toWorld(mid.px, mid.py) };
    gestureLock = true;
    hover = null;
    requestDraw();
  }

  function updateGesture() {
    if (!gesture || touches.size < 2) return;
    const { d, mid } = twoTouches();
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.zoom0 * (d / gesture.d0)));
    applyView(viewWithAnchor(z, gesture.anchor, mid, stageCentre(), gesture.base));
  }

  function onDown(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, localPt(e));
      if (touches.size === 1) {
        gestureLock = false;
        touchSnap = { world, json: JSON.stringify(history.current()), pending, linePts: linePts.slice(), selectedId };
      } else {
        e.preventDefault();
        try { overlay.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        if (canZoom && !gesture && touches.size === 2) startGesture();
        return;
      }
      if (gestureLock) return;
    }
    if (canZoom && e.pointerType !== "touch" && (e.button === 1 || (e.button === 0 && spaceDown))) {
      e.preventDefault();
      root.focus({ preventScroll: true });
      try { overlay.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const { px, py } = localPt(e);
      pan = { id: e.pointerId, px, py };
      setCursor();
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    root.focus({ preventScroll: true });
    try { overlay.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const { px, py } = localPt(e);
    const now = performance.now();
    const isDouble = now - lastDown.t < 400 && Math.hypot(px - lastDown.px, py - lastDown.py) < 14;
    lastDown = { t: now, px, py };
    const raw = rawPt(e);
    const p = snapP(raw);
    hover = p;

    const tp = twoPointMode();
    if (tp) {
      if (pending) finishTwoPoint(p);
      else { pending = { mode: tp, a: p }; drag = { mode: "twoPoint", downPx: { px, py } }; }
      requestDraw();
      return;
    }
    switch (tool) {
      case "select": {
        const sel = findItem(world, selectedId);
        if (sel) {
          const i = handleAt(px, py, sel);
          if (i >= 0) { drag = { mode: "handle", ref: sel, i, orig: clone(world) }; return; }
        }
        const hit = hitTest(world, raw, tolMM());
        select(hit ? hit.id : null);
        if (hit) drag = { mode: "move", ref: hit, start: raw, anchor: itemAnchor(world, hit), orig: clone(world) };
        break;
      }
      case "paint": // tape line
        if (isDouble && linePts.length >= 2) finishLine();
        else {
          const last = linePts[linePts.length - 1];
          if (!last || dist(last, p) > 1) {
            if (linePts.length >= LIMITS.linePoints) { say("That tape line is long enough!"); break; }
            linePts.push(p);
          }
        }
        break;
      case "object":
        placeObject(p);
        break;
      case "robot": {
        const ref: ItemRef = { kind: "start", id: START_ID, index: -1 };
        select(START_ID);
        if (handleAt(px, py, ref) >= 0) { drag = { mode: "handle", ref, i: 0, orig: clone(world) }; return; }
        mutate((w) => { w.start.x = p.x; w.start.y = p.y; }, { record: false, rebuild: "props" });
        drag = { mode: "move", ref, start: raw, anchor: p, orig: clone(world) };
        break;
      }
      case "erase":
        eraseAt(raw);
        drag = { mode: "erase" };
        break;
    }
    requestDraw();
  }

  function onMove(e: PointerEvent) {
    if (e.pointerType === "touch" && touches.has(e.pointerId)) touches.set(e.pointerId, localPt(e));
    if (gesture) { updateGesture(); return; }
    if (pan) {
      if (e.pointerId !== pan.id) return;
      const { px, py } = localPt(e);
      applyView(panBy(view, px - pan.px, py - pan.py, curScale()));
      pan.px = px; pan.py = py;
      return;
    }
    if (gestureLock && e.pointerType === "touch") return;
    const raw = rawPt(e);
    if (tool !== "select" && tool !== "erase") hover = snapP(raw);
    if (drag) {
      if (drag.mode === "move") {
        const d = drag;
        const target = snapP({ x: d.anchor.x + raw.x - d.start.x, y: d.anchor.y + raw.y - d.start.y });
        const dx = target.x - d.anchor.x, dy = target.y - d.anchor.y;
        world = clone(d.orig);
        translateItem(world, d.ref, dx, dy);
        afterChange({ record: false, rebuild: "props" });
      } else if (drag.mode === "handle") {
        const d = drag;
        world = clone(d.orig);
        dragHandle(world, d.orig, d.ref, d.i, d.ref.kind === "start" ? raw : snapP(raw));
        afterChange({ record: false, rebuild: "props" });
      } else if (drag.mode === "erase") {
        eraseAt(raw);
      }
    }
    requestDraw();
  }

  function onUp(e: PointerEvent) {
    if (pan && e.pointerId === pan.id) { pan = null; setCursor(); return; }
    if (e.pointerType === "touch") {
      touches.delete(e.pointerId);
      if (touches.size < 2) gesture = null;
      if (touches.size === 0) touchSnap = null;
      if (gestureLock) { if (touches.size === 0) gestureLock = false; return; }
    }
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.mode === "twoPoint") {
      const { px, py } = localPt(e);
      if (Math.hypot(px - d.downPx.px, py - d.downPx.py) > 6) finishTwoPoint(snapP(rawPt(e)));
      // else: click-click mode, wait for the second click
    } else {
      commit();
    }
    requestDraw();
  }

  overlay.addEventListener("pointerdown", onDown);
  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onUp);
  overlay.addEventListener("pointercancel", onUp);
  overlay.addEventListener("pointerleave", () => { if (!drag) { hover = null; requestDraw(); } });
  overlay.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------------- keyboard

  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t && t.closest && t.closest("input, textarea, select")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (mod && k === "d") { e.preventDefault(); duplicateSelected(); return; }
    if (mod || e.altKey) return;
    if (e.key === " " && !(t && t.closest && t.closest("button"))) {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; setCursor(); }
      return;
    }
    const step = (snapOn ? snapStep : 10) * (e.shiftKey ? 5 : 1);
    switch (e.key) {
      case "+": case "=": e.preventDefault(); zoomTo(view.zoom * 1.5); return;
      case "-": case "_": e.preventDefault(); zoomTo(view.zoom / 1.5); return;
      case "0": e.preventDefault(); applyView(FIT_VIEW); return;
      case "ArrowLeft": e.preventDefault(); nudge(-step, 0); return;
      case "ArrowRight": e.preventDefault(); nudge(step, 0); return;
      case "ArrowUp": e.preventDefault(); nudge(0, step); return;
      case "ArrowDown": e.preventDefault(); nudge(0, -step); return;
      case "Delete": e.preventDefault(); deleteSelected(); return;
      case "Backspace":
        e.preventDefault();
        if (linePts.length) { linePts.pop(); requestDraw(); } else deleteSelected();
        return;
      case "Enter": if (linePts.length) { e.preventDefault(); finishLine(); } return;
      case "Escape":
        if (pending || linePts.length || drag) cancelInteraction();
        else select(null);
        return;
      case "[": rotateSelected(-15); return;
      case "]": rotateSelected(15); return;
    }
    const ti = TOOL_INFO.find((x) => x.key === k);
    if (ti && e.key.length === 1) setTool(ti.id);
  });

  root.addEventListener("keyup", (e) => { if (e.key === " " && spaceDown) { spaceDown = false; setCursor(); } });
  root.addEventListener("focusout", (e) => {
    if (spaceDown && !root.contains(e.relatedTarget as Node | null)) { spaceDown = false; setCursor(); }
  });

  // ---------------- header actions

  btnUndo.addEventListener("click", undo);
  btnRedo.addEventListener("click", redo);
  btnSnap.addEventListener("click", () => { snapOn = !snapOn; btnSnap.setAttribute("aria-pressed", String(snapOn)); selSnap.disabled = !snapOn; });
  selSnap.addEventListener("change", () => { snapStep = Number(selSnap.value) || 100; });
  btnTest.addEventListener("click", () => {
    if (linePts.length >= 2) finishLine();
    flushEmit();
    const errs = validateWorld(world).filter((i) => i.level === "error").length;
    if (errs) say(`Heads up: this level has ${errs} problem${errs > 1 ? "s" : ""} (see the list on the right).`);
    opts.onTest(clone(world));
  });
  btnNew.addEventListener("click", () => {
    if (!confirm("Start a new blank level? (You can undo this.)")) return;
    cancelInteraction();
    world = prepare(newBlankWorld());
    selectedId = null;
    applyView(FIT_VIEW);
    afterChange();
  });
  btnSave.addEventListener("click", () => {
    const blob = new Blob([levelFileText(world)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: (world.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "level") + LEVEL_EXTENSION });
    root.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  btnOpen.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    if (f.size > LIMITS.fileChars) { say("That file is too big to be a Robot Lab level."); return; }
    const text = await f.text();
    const r = parseLevelFile(text);
    if (!r.ok) { say(r.error); return; }
    cancelInteraction();
    world = r.world;
    selectedId = null;
    applyView(FIT_VIEW);
    afterChange();
    say(r.warnings.length ? `Opened "${world.name}" (${r.warnings.length} thing${r.warnings.length > 1 ? "s" : ""} fixed up).` : `Opened "${world.name}".`);
  });

  // ---------------- side panels

  function setTab(t: typeof tab) {
    tab = t;
    for (const k of Object.keys(panels) as (typeof tab)[]) {
      panels[k].style.display = k === t ? "" : "none";
      tabBtns[k].setAttribute("aria-selected", String(k === t));
    }
  }

  function field(label: string, control: HTMLElement): HTMLElement {
    const id = `le-f${Math.random().toString(36).slice(2, 9)}`;
    const c = control.matches("input, select, textarea") ? control : control.querySelector("input, select, textarea");
    if (c) c.id = id;
    return h("div", { class: "le-field" }, h("label", { for: id, text: label }), control);
  }

  /** Numeric input editing the world live; history entry on change (blur / Enter). */
  function numInput(value: number, apply: (w: World, v: number) => void, o: { step?: number; min?: number; max?: number } = {}): HTMLInputElement {
    const i = h("input", { type: "number", step: o.step ?? 10, min: o.min, max: o.max, value: Math.round(value * 100) / 100, inputmode: "decimal" });
    i.addEventListener("input", () => {
      let v = parseFloat(i.value);
      if (!Number.isFinite(v)) return;
      if (o.min !== undefined) v = Math.max(o.min, v);
      if (o.max !== undefined) v = Math.min(o.max, v);
      mutate((w) => apply(w, v), { record: false, rebuild: "none" });
    });
    i.addEventListener("change", commit);
    return i;
  }
  function textInput(value: string, max: number, apply: (w: World, v: string) => void, multiline = false, cls = ""): HTMLInputElement | HTMLTextAreaElement {
    const i = multiline ? h("textarea", { maxlength: max, class: cls, spellcheck: cls ? "false" : undefined }) : h("input", { type: "text", maxlength: max });
    i.value = value;
    i.addEventListener("input", () => mutate((w) => apply(w, i.value.slice(0, max)), { record: false, rebuild: "none" }));
    i.addEventListener("change", commit);
    return i;
  }
  function selectInput<T extends string>(options: [T, string][], value: T, apply: (v: T) => void): HTMLSelectElement {
    const s = h("select", {});
    for (const [v, l] of options) s.append(h("option", { value: v, text: l }));
    s.value = value;
    s.addEventListener("change", () => apply(s.value as T));
    return s;
  }
  const onItem = (fn: (w: World, r: ItemRef, v: number) => void) => (w: World, v: number) => {
    const r = findItem(w, selectedId);
    if (r) fn(w, r, v);
  };

  function renderPanels() {
    renderItemPanel();
    renderLevelPanel();
    renderGoalsPanel();
  }

  function renderItemPanel() {
    const P = panels.item;
    P.replaceChildren();
    const r = findItem(world, selectedId);
    if (!r) {
      P.append(h("h3", { text: "Nothing selected" }),
        h("p", { class: "le-empty", text: "Pick the Select tool and click a wall, paint, object, zone or the robot to edit it here." }));
      return;
    }
    const actions = h("div", { class: "le-row" });
    const addBtn = (label: string, fn: () => void, cls = "") => {
      const b = h("button", { class: `le-btn le-small ${cls}`, text: label });
      b.addEventListener("click", fn);
      actions.append(b);
    };
    const xy = (x: number, y: number, set: (w: World, r: ItemRef, k: "x" | "y", v: number) => void) => [
      field("X (mm)", numInput(x, onItem((w, q, v) => set(w, q, "x", v)))),
      field("Y (mm)", numInput(y, onItem((w, q, v) => set(w, q, "y", v)))),
    ];
    switch (r.kind) {
      case "start": {
        const s = world.start;
        P.append(h("h3", { text: "Robot start" }),
          ...xy(s.x, s.y, (w, _q, k, v) => { w.start[k] = v; }),
          field("Heading (°)", numInput(s.heading, (w, v) => { w.start.heading = normDeg(v); }, { step: 15 })));
        addBtn("↺ −15°", () => rotateSelected(-15));
        addBtn("↻ +15°", () => rotateSelected(15));
        P.append(actions, h("p", { class: "le-empty", text: "0° faces up, 90° faces right." }));
        return;
      }
      case "wall": {
        const wl = world.walls[r.index];
        P.append(h("h3", { text: `Wall · ${wl.id}` }),
          field("Start X", numInput(wl.a.x, onItem((w, q, v) => { w.walls[q.index].a.x = v; }))),
          field("Start Y", numInput(wl.a.y, onItem((w, q, v) => { w.walls[q.index].a.y = v; }))),
          field("End X", numInput(wl.b.x, onItem((w, q, v) => { w.walls[q.index].b.x = v; }))),
          field("End Y", numInput(wl.b.y, onItem((w, q, v) => { w.walls[q.index].b.y = v; }))),
          field("Thickness", numInput(wl.thickness, onItem((w, q, v) => { w.walls[q.index].thickness = v; }), { step: 5, min: 1, max: 500 })),
          h("p", { class: "le-empty", text: `Length ${Math.round(dist(wl.a, wl.b))} mm` }));
        break;
      }
      case "floor": {
        const f = world.floor[r.index];
        const kindName = f.kind === "rect" ? "Paint rectangle" : f.kind === "circle" ? "Paint circle" : "Tape line";
        P.append(h("h3", { text: `${kindName} · ${f.id}` }),
          field("Colour", colorControl(f.color, (c: ColorName) => mutate((w) => { const q = findItem(w, selectedId); if (q) w.floor[q.index].color = c; }, { rebuild: "none" }))));
        if (f.kind === "rect") {
          P.append(...xy(f.x, f.y, (w, q, k, v) => { const s = w.floor[q.index]; if (s.kind === "rect") s[k] = v; }),
            field("Width", numInput(f.w, onItem((w, q, v) => { const s = w.floor[q.index]; if (s.kind === "rect") s.w = v; }), { min: 1 })),
            field("Height", numInput(f.h, onItem((w, q, v) => { const s = w.floor[q.index]; if (s.kind === "rect") s.h = v; }), { min: 1 })));
        } else if (f.kind === "circle") {
          P.append(...xy(f.x, f.y, (w, q, k, v) => { const s = w.floor[q.index]; if (s.kind === "circle") s[k] = v; }),
            field("Radius", numInput(f.r, onItem((w, q, v) => { const s = w.floor[q.index]; if (s.kind === "circle") s.r = v; }), { min: 1 })));
        } else {
          P.append(field("Width", numInput(f.width, onItem((w, q, v) => { const s = w.floor[q.index]; if (s.kind === "line") s.width = v; }), { step: 5, min: 1, max: 500 })),
            h("p", { class: "le-empty", text: `${f.points.length} points — drag the dots on the canvas to reshape.` }));
        }
        break;
      }
      case "object": {
        const o = world.objects[r.index];
        P.append(h("h3", { text: `Object · ${o.id}` }),
          field("Shape", selectInput<WorldObject["shape"]>([["disk", "Disk"], ["box", "Box"]], o.shape, (v) => mutate((w) => {
            const q = findItem(w, selectedId); if (!q) return; const ob = w.objects[q.index]; ob.shape = v;
            if (v === "box") ob.rotation = ob.rotation ?? 0; else delete ob.rotation;
          }))),
          field("Colour", colorControl(o.color, (c: ColorName) => mutate((w) => { const q = findItem(w, selectedId); if (q) w.objects[q.index].color = c; }, { rebuild: "none" }))),
          ...xy(o.x, o.y, (w, q, k, v) => { w.objects[q.index][k] = v; }),
          field(o.shape === "disk" ? "Diameter" : "Side", numInput(o.size, onItem((w, q, v) => { w.objects[q.index].size = v; }), { min: 10, max: 1000 })));
        // arm: height above the floor (on a platform / stack) and the object's own height
        P.append(field("Raised (mm)", numInput(o.z ?? 0, onItem((w, q, v) => { const ob = w.objects[q.index]; if (v > 0) ob.z = v; else delete ob.z; }), { step: 10, min: 0, max: LIMITS.objectZMax })),
          field("Object height", numInput(o.height ?? (o.shape === "disk" ? 30 : o.size), onItem((w, q, v) => { w.objects[q.index].height = v; }), { step: 5, min: 5, max: 1000 })));
        if (o.shape === "box")
          P.append(field("Rotation (°)", numInput(o.rotation ?? 0, onItem((w, q, v) => { w.objects[q.index].rotation = normDeg(v); }), { step: 15 })));
        P.append(check("Movable (robot can push it)", o.movable, (v) => mutate((w) => {
          const q = findItem(w, selectedId); if (!q) return; const ob = w.objects[q.index]; ob.movable = v; if (!v) ob.pickable = false;
        })), check("Pickable (magnet can lift it)", o.pickable, (v) => mutate((w) => {
          const q = findItem(w, selectedId); if (!q) return; const ob = w.objects[q.index]; ob.pickable = v; if (v) ob.movable = true;
        })));
        if (o.shape === "box") { addBtn("↺ −15°", () => rotateSelected(-15)); addBtn("↻ +15°", () => rotateSelected(15)); }
        break;
      }
      case "platform": { // arm
        const p = world.platforms![r.index];
        const onP = (fn: (q: Platform, v: number) => void) => onItem((w, q, v) => fn(w.platforms![q.index], v));
        P.append(h("h3", { text: `Platform · ${p.id}` }),
          ...xy(p.x, p.y, (w, q, k, v) => { w.platforms![q.index][k] = v; }),
          field("Width", numInput(p.w, onP((q, v) => { q.w = v; }), { min: 40 })),
          field("Depth", numInput(p.h, onP((q, v) => { q.h = v; }), { min: 40 })),
          field("Height (mm)", numInput(p.height, onP((q, v) => { q.height = v; }), { step: 10, min: LIMITS.platformHeightMin, max: LIMITS.platformHeightMax })),
          field("Colour", colorControl(p.color ?? "YELLOW", (c: ColorName) => mutate((w) => { const q = findItem(w, selectedId); if (q) w.platforms![q.index].color = c; }, { rebuild: "none" }))));
        const used = world.goals.filter((g) => g.type === "objectsOnPlatform" && g.platform === p.id).length;
        P.append(h("p", { class: "le-empty", text: `Solid to the robot, like a wall. The arm can put objects on top. ${used ? `Used by ${used} goal${used > 1 ? "s" : ""}.` : ""}` }));
        break;
      }
      case "zone": {
        const z = world.zones[r.index];
        P.append(h("h3", { text: `Zone · ${z.id}` }),
          field("Label", textInput(z.label ?? "", LIMITS.label, (w, v) => { const q = findItem(w, selectedId); if (q) { const zz = w.zones[q.index]; if (v.trim()) zz.label = v; else delete zz.label; } })),
          field("Shape", selectInput<"rect" | "circle">([["rect", "Rectangle"], ["circle", "Circle"]], z.kind, (v) => mutate((w) => {
            const q = findItem(w, selectedId); if (!q) return; const zz = w.zones[q.index];
            if (v === zz.kind) return;
            w.zones[q.index] = v === "circle"
              ? { id: zz.id, kind: "circle", x: zz.x, y: zz.y, r: zz.kind === "rect" ? Math.round(Math.min(zz.w, zz.h) / 2) : zz.r, label: zz.label }
              : { id: zz.id, kind: "rect", x: zz.x, y: zz.y, w: zz.kind === "circle" ? zz.r * 2 : zz.w, h: zz.kind === "circle" ? zz.r * 2 : zz.h, label: zz.label };
            if (w.zones[q.index].label === undefined) delete w.zones[q.index].label;
          }))),
          ...xy(z.x, z.y, (w, q, k, v) => { w.zones[q.index][k] = v; }));
        if (z.kind === "rect") {
          P.append(field("Width", numInput(z.w, onItem((w, q, v) => { const s = w.zones[q.index]; if (s.kind === "rect") s.w = v; }), { min: 1 })),
            field("Height", numInput(z.h, onItem((w, q, v) => { const s = w.zones[q.index]; if (s.kind === "rect") s.h = v; }), { min: 1 })));
        } else {
          P.append(field("Radius", numInput(z.r, onItem((w, q, v) => { const s = w.zones[q.index]; if (s.kind === "circle") s.r = v; }), { min: 1 })));
        }
        const used = world.goals.filter((g) => ("zone" in g && g.zone === z.id) || (g.type === "visitInOrder" && g.zones.includes(z.id))).length;
        P.append(h("p", { class: "le-empty", text: used ? `Used by ${used} goal${used > 1 ? "s" : ""}.` : "Not used by any goal yet (see the Goals tab)." }));
        break;
      }
    }
    addBtn("Duplicate", duplicateSelected);
    addBtn("Delete", deleteSelected, "le-danger");
    P.append(actions);
  }

  function renderLevelPanel() {
    const P = panels.level;
    P.replaceChildren();
    const sizeKey = `${world.width}x${world.height}`;
    const sizeOpts: [string, string][] = SIZE_PRESETS.map((s) => [`${s.w}x${s.h}`, s.label]);
    if (!sizeOpts.some(([k]) => k === sizeKey)) sizeOpts.push([sizeKey, `${world.width} × ${world.height} (custom)`]);
    const gridSizes = [100, 200, 250, 300, 500];
    const g0 = world.gridSize ?? 200;
    if (!gridSizes.includes(g0)) gridSizes.push(g0);
    const gridOpts: [string, string][] = gridSizes.map((n) => [String(n), `${n} mm`]);
    P.append(h("h3", { text: "Level settings" }),
      field("Name", textInput(world.name, LIMITS.name, (w, v) => { w.name = v; })),
      field("Description", textInput(world.description ?? "", LIMITS.description, (w, v) => { w.description = v; }, true)),
      field("Field size", selectInput(sizeOpts, sizeKey, (v) => {
        const [wd, ht] = v.split("x").map(Number);
        mutate((w) => { w.width = wd; w.height = ht; });
      })),
      field("Floor", selectInput<NonNullable<World["background"]>>([["plain", "Plain"], ["grid", "Grid"], ["numberGrid", "Numbered grid"]],
        world.background ?? "grid", (v) => mutate((w) => { w.background = v; }))),
      field("Grid square", selectInput(gridOpts, String(world.gridSize ?? 200), (v) => mutate((w) => { w.gridSize = Number(v); }))),
      h("h3", { text: "Robot hardware" }),
      check("Pen (draws on the floor)", !!world.hardware?.pen, (v) => mutate((w) => { w.hardware = { ...w.hardware, pen: v }; })),
      check("Magnet (picks up objects)", !!world.hardware?.magnet, (v) => mutate((w) => { w.hardware = { ...w.hardware, magnet: v }; })),
      check("Arm and claw (lifts and stacks objects)", !!world.hardware?.arm, (v) => mutate((w) => { w.hardware = { ...w.hardware, arm: v }; if (!v) delete w.hardware.arm; }))); // arm
    renderRaceSettings(P); // race
    P.append(h("h3", { text: "Starter Python" }));
    const code = textInput(world.starter?.python ?? "", LIMITS.python, (w, v) => { w.starter = { ...w.starter, python: v }; }, true, "le-code");
    code.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Escape") { (code as HTMLTextAreaElement).blur(); root.focus({ preventScroll: true }); return; }
      if (ke.key !== "Tab" || ke.shiftKey) return;
      ke.preventDefault();
      const t = code as HTMLTextAreaElement;
      const s = t.selectionStart, en = t.selectionEnd;
      t.setRangeText("    ", s, en, "end");
      t.dispatchEvent(new Event("input"));
    });
    code.setAttribute("placeholder", "Optional code students start with");
    code.setAttribute("aria-label", "Starter Python");
    P.append(code, h("p", { class: "le-empty", text: "Tip: press Esc then Tab to move out of the code box." }));
  }

  // race: time-trial settings (finish zone, par, laps). Checkpoints = the zones of a "Visit zones in order" goal.
  function renderRaceSettings(P: HTMLElement) {
    P.append(h("h3", { text: "Race (time trial)" }));
    const r = world.race;
    const ensureFinishGoal = (w: World, zone: string) => {
      if (zone && !w.goals.some((g) => g.type === "reachZone" && g.zone === zone)) w.goals.push({ type: "reachZone", zone });
    };
    P.append(check("This level is a race (students see a race clock)", !!r, (v) => {
      if (v && world.zones.length === 0) { say("Draw a zone first (Zone tool) — it becomes the finish."); renderLevelPanel(); return; }
      mutate((w) => {
        if (!v) { delete w.race; return; }
        const fin = w.zones.find((z) => /finish/i.test(`${z.id} ${z.label ?? ""}`)) ?? w.zones[w.zones.length - 1];
        w.race = { finishZone: fin.id, laps: 1 };
        ensureFinishGoal(w, fin.id);
      });
    }));
    if (!r) {
      P.append(h("p", { class: "le-empty", text: "A race times the robot (robot time) from Run until it reaches the finish zone, and keeps each student's best time." }));
      return;
    }
    P.append(
      field("Finish zone", zonePicker(r.finishZone, (v) => mutate((w) => { if (w.race && v) { w.race.finishZone = v; ensureFinishGoal(w, v); } }))),
      field("Par time (s)", numInput(r.par ?? 0, (w, v) => { if (!w.race) return; if (v > 0) w.race.par = Math.round(v * 100) / 100; else delete w.race.par; }, { step: 1, min: 0, max: 3600 })),
      field("Laps", selectInput(["1", "2", "3", "4", "5"].map((n) => [n, n] as [string, string]), String(r.laps ?? 1),
        (v) => mutate((w) => { if (w.race) w.race.laps = Number(v); }))),
      h("p", { class: "le-empty", text: "Par: gold ≤ par, silver ≤ 1.25 × par, bronze slower (0 = no medals). " +
        "Checkpoints: add a \"Visit zones in order\" goal — each lap must pass them in that order before crossing the finish. " +
        "With laps, the robot must start outside the finish zone." }));
  }

  function zonePicker(value: string, set: (v: string) => void): HTMLSelectElement {
    const s = h("select", { "aria-label": "Zone" });
    s.append(h("option", { value: "", text: "— choose a zone —" }));
    for (const z of world.zones) s.append(h("option", { value: z.id, text: z.label ? `${z.label} (${z.id})` : z.id }));
    if (value && !world.zones.some((z) => z.id === value)) s.append(h("option", { value, text: `⚠ missing: ${value}` }));
    s.value = value;
    s.addEventListener("change", () => set(s.value));
    return s;
  }

  /** arm: choose a platform for a goal. */
  function platformPicker(value: string, set: (v: string) => void): HTMLSelectElement {
    const s = h("select", { "aria-label": "Platform" });
    s.append(h("option", { value: "", text: "— choose a platform —" }));
    for (const p of world.platforms ?? []) s.append(h("option", { value: p.id, text: `${p.id} (${p.height} mm)` }));
    if (value && !(world.platforms ?? []).some((p) => p.id === value)) s.append(h("option", { value, text: `⚠ missing: ${value}` }));
    s.value = value;
    s.addEventListener("change", () => set(s.value));
    return s;
  }

  /** data-fk of the ▲/▼ button to refocus after the Goals panel is rebuilt (keyboard reordering). */
  let goalFocus: string[] | null = null;

  /** A ▲ / ▼ reorder button. `keys` = data-fk to refocus after the move (first enabled wins). */
  function moveButton(dir: -1 | 1, enabled: boolean, label: string, fk: string, keys: string[], run: () => void): HTMLButtonElement {
    const b = h("button", { class: "le-btn le-move", title: label, "aria-label": label, "data-fk": fk, text: dir < 0 ? "▲" : "▼" });
    b.disabled = !enabled;
    b.addEventListener("click", () => { goalFocus = keys; run(); });
    return b;
  }

  function renderGoalsPanel() {
    const P = panels.goals;
    const restore = goalFocus;
    goalFocus = null;
    P.replaceChildren();
    P.append(h("h3", { text: "Goals — all must pass" }));
    const issues = validateWorld(world);
    if (world.goals.length === 0) P.append(h("p", { class: "le-empty", text: "No goals yet. Add one below. Most goals need a zone — draw one with the Zone tool first." }));
    const upd = (i: number, fn: (g: Goal, w: World) => void, rebuild: AfterOpts["rebuild"] = "all") =>
      mutate((w) => { const g = w.goals[i]; if (g) fn(g, w); }, { rebuild });
    world.goals.forEach((g, i) => {
      const bad = issues.some((q) => q.goal === i && q.level === "error");
      const card = h("div", { class: `le-goal${bad ? " le-bad" : ""}` });
      const typeSel = selectInput<Goal["type"]>((Object.keys(GOAL_LABELS) as Goal["type"][]).map((t) => [t, GOAL_LABELS[t]]), g.type, (t) =>
        mutate((w) => { const d = w.goals[i].description; const ng = defaultGoal(t, w); if (d) ng.description = d; w.goals[i] = ng; }));
      typeSel.setAttribute("aria-label", `Goal ${i + 1} type`);
      const rm = h("button", { class: "le-btn le-small le-danger", title: "Remove goal", "aria-label": `Remove goal ${i + 1}`, text: "✕" });
      rm.addEventListener("click", () => mutate((w) => { w.goals.splice(i, 1); }));
      const n = world.goals.length;
      const up = moveButton(-1, i > 0, `Move goal ${i + 1} up`, `g${i}u`, [`g${i - 1}u`, `g${i - 1}d`],
        () => mutate((w) => { moveGoal(w, i, -1); }));
      const down = moveButton(1, i < n - 1, `Move goal ${i + 1} down`, `g${i}d`, [`g${i + 1}d`, `g${i + 1}u`],
        () => mutate((w) => { moveGoal(w, i, 1); }));
      card.append(h("div", { class: "le-goal-head" }, h("b", { text: `#${i + 1}` }), up, down, h("span", { class: "le-spacer" }), rm), typeSel);
      switch (g.type) {
        case "reachZone":
          card.append(field("Zone", zonePicker(g.zone, (v) => upd(i, (q) => { if (q.type === "reachZone") q.zone = v; }))));
          break;
        case "objectsInZone":
          card.append(
            field("Zone", zonePicker(g.zone, (v) => upd(i, (q) => { if (q.type === "objectsInZone") q.zone = v; }))),
            field("How many", numInput(g.count, (w, v) => { const q = w.goals[i]; if (q?.type === "objectsInZone") q.count = Math.round(v); }, { step: 1, min: 1, max: LIMITS.objects })),
            field("Colour", colorControl(g.color, (c: ColorName | undefined) => upd(i, (q) => { if (q.type === "objectsInZone") { if (c) q.color = c; else delete q.color; } }, "none"), true)));
          break;
        case "visitInOrder": {
          g.zones.forEach((z, k) => {
            const x = h("button", { class: "le-btn le-small", "aria-label": `Remove stop ${k + 1} from goal ${i + 1}`, text: "✕" });
            x.addEventListener("click", () => upd(i, (q) => { if (q.type === "visitInOrder") q.zones.splice(k, 1); }));
            const up = moveButton(-1, k > 0, `Move stop ${k + 1} of goal ${i + 1} earlier`, `g${i}z${k}u`, [`g${i}z${k - 1}u`, `g${i}z${k - 1}d`],
              () => mutate((w) => { moveVisitZone(w, i, k, -1); }));
            const down = moveButton(1, k < g.zones.length - 1, `Move stop ${k + 1} of goal ${i + 1} later`, `g${i}z${k}d`, [`g${i}z${k + 1}d`, `g${i}z${k + 1}u`],
              () => mutate((w) => { moveVisitZone(w, i, k, 1); }));
            const pick = zonePicker(z, (v) => upd(i, (q) => { if (q.type === "visitInOrder") q.zones[k] = v; }));
            pick.setAttribute("aria-label", `Goal ${i + 1}, stop ${k + 1} zone`);
            const row = h("div", { class: "le-row le-zrow" }, h("span", { class: "le-lab", text: `${k + 1}.` }), pick, up, down, x);
            card.append(row);
          });
          const add = h("button", { class: "le-btn le-small", text: "+ Add zone" });
          add.addEventListener("click", () => upd(i, (q, w) => { if (q.type === "visitInOrder" && q.zones.length < LIMITS.visitZones) q.zones.push(w.zones[0]?.id ?? ""); }));
          card.append(add);
          break;
        }
        case "noWallHits":
          card.append(h("p", { class: "le-empty", text: "Passes if the robot never bumps a wall or the border." }));
          break;
        case "endFacing":
          card.append(
            field("Heading (°)", numInput(g.heading, (w, v) => { const q = w.goals[i]; if (q?.type === "endFacing") q.heading = normDeg(v); }, { step: 15 })),
            field("± tolerance", numInput(g.tolerance ?? 10, (w, v) => { const q = w.goals[i]; if (q?.type === "endFacing") q.tolerance = v; }, { step: 5, min: 0, max: 180 })));
          break;
        // arm
        case "objectsOnPlatform":
          card.append(
            field("Platform", platformPicker(g.platform, (v) => upd(i, (q) => { if (q.type === "objectsOnPlatform") q.platform = v; }))),
            field("How many", numInput(g.count, (w, v) => { const q = w.goals[i]; if (q?.type === "objectsOnPlatform") q.count = Math.round(v); }, { step: 1, min: 1, max: LIMITS.objects })),
            field("Colour", colorControl(g.color, (c: ColorName | undefined) => upd(i, (q) => { if (q.type === "objectsOnPlatform") { if (c) q.color = c; else delete q.color; } }, "none"), true)));
          break;
        case "stackHeight": {
          const zp = zonePicker(g.zone ?? "", (v) => upd(i, (q) => { if (q.type === "stackHeight") { if (v) q.zone = v; else delete q.zone; } }));
          (zp.options[0] as HTMLOptionElement).text = "Anywhere";
          card.append(
            field("Objects tall", numInput(g.count, (w, v) => { const q = w.goals[i]; if (q?.type === "stackHeight") q.count = Math.round(v); }, { step: 1, min: 2, max: LIMITS.stackCount })),
            field("In zone", zp));
          break;
        }
        case "maxTime":
          card.append(field("Seconds", numInput(g.seconds, (w, v) => { const q = w.goals[i]; if (q?.type === "maxTime") q.seconds = v; }, { step: 5, min: 1, max: 3600 })));
          break;
      }
      card.append(field("Shown as", textInput(g.description ?? "", LIMITS.goalDescription, (w, v) => {
        const q = w.goals[i]; if (!q) return; if (v.trim()) q.description = v; else delete q.description;
      })));
      P.append(card);
    });
    if (world.goals.length < LIMITS.goals) {
      let pick: Goal["type"] = "reachZone";
      const sel = selectInput<Goal["type"]>((Object.keys(GOAL_LABELS) as Goal["type"][]).map((t) => [t, GOAL_LABELS[t]]), pick, (v) => (pick = v));
      sel.setAttribute("aria-label", "New goal type");
      const add = h("button", { class: "le-btn le-small", text: "+ Add goal" });
      add.addEventListener("click", () => mutate((w) => { w.goals.push(defaultGoal(pick, w)); }));
      P.append(h("div", { class: "le-row" }, sel, add));
    }
    if (restore) {
      for (const k of restore) {
        const b = P.querySelector<HTMLButtonElement>(`[data-fk="${k}"]`);
        if (b && !b.disabled) { b.focus({ preventScroll: false }); break; }
      }
    }
  }

  function renderIssues() {
    const issues = validateWorld(world);
    const errs = issues.filter((i) => i.level === "error").length;
    goalsBadge.textContent = String(errs);
    if (errs) tabBtns.goals.append(goalsBadge); else goalsBadge.remove();
    issuesEl.replaceChildren();
    if (!issues.some((i) => i.level !== "info")) issuesEl.append(h("div", { class: "le-ok", text: "✓ Level looks good" }));
    const tag: Record<Issue["level"], string> = { error: "FIX", warn: "WARN", info: "TIP" };
    for (const q of issues.slice(0, 40)) {
      const target = q.id ? `item:${q.id}` : q.goal !== undefined ? `goal:${q.goal}` : undefined;
      const b = h("button", { class: `le-issue le-${q.level}`, "data-target": target }, h("span", { class: "le-dot", text: tag[q.level] }), h("span", { text: q.text }));
      if (target) b.addEventListener("click", () => {
        if (q.id) { setTool("select"); select(q.id); setTab("item"); } else setTab("goals");
      });
      else b.tabIndex = -1;
      issuesEl.append(b);
    }
  }

  // ---------------- drawing

  let raf = 0;
  const raf_ = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
  const caf_ = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
  function requestDraw() {
    if (raf || disposed) return;
    raf = raf_(() => { raf = 0; drawNow(); });
  }
  function drawNow() {
    if (disposed) return;
    renderer.draw(world, staticState(world), { showPath: false, showSensors: false, showZones: true, selectedId: selectedId === START_ID ? RENDER_START_ID : selectedId });
    drawOverlay();
  }

  let odpr = 1;
  function resizeOverlay() {
    odpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    overlay.width = Math.max(1, Math.round(stage.clientWidth * odpr));
    overlay.height = Math.max(1, Math.round(stage.clientHeight * odpr));
  }

  function drawOverlay() {
    const ctx = overlay.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(odpr, 0, 0, odpr, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const C = (p: Vec) => renderer.toCanvas(p.x, p.y);
    const k = 1 / mmPerPx();
    const ORANGE = "#FF6A1A", INK = "#0C0B0A";

    const sel = findItem(world, selectedId);
    if (sel) {
      // The renderer draws the selection outline itself (selectedId); the overlay adds drag handles.
      const showHandles = tool === "select" || (tool === "robot" && sel.kind === "start");
      if (sel.kind === "start") {
        const s = C(world.start), hd = C(handlesFor(world, sel)[0]);
        ctx.strokeStyle = ORANGE; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(hd.px, hd.py); ctx.stroke();
      }
      if (showHandles) {
        for (const hp of handlesFor(world, sel)) {
          const c2 = C(hp);
          ctx.beginPath(); ctx.arc(c2.px, c2.py, 8, 0, Math.PI * 2);
          ctx.fillStyle = sel.kind === "start" ? ORANGE : "#FFFDF9"; ctx.fill();
          ctx.lineWidth = 2.5; ctx.strokeStyle = sel.kind === "start" ? INK : ORANGE; ctx.stroke();
        }
      }
    }

    // previews
    ctx.strokeStyle = ORANGE; ctx.fillStyle = "rgba(255,106,26,0.18)"; ctx.lineWidth = 2;
    if (pending && hover) {
      const a = C(pending.a), b = C(hover);
      ctx.setLineDash([6, 4]);
      if (pending.mode === "wall") {
        ctx.setLineDash([]); ctx.lineCap = "round"; ctx.strokeStyle = "rgba(12,11,10,0.55)";
        ctx.lineWidth = Math.max(2, topts.wallThickness * k);
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
        ctx.lineCap = "butt";
        label(`${Math.round(dist(pending.a, hover))} mm`, b);
      } else if (pending.mode === "paintRect" || pending.mode === "zoneRect" || pending.mode === "platform") {
        if (pending.mode === "paintRect") ctx.fillStyle = hexA(COLOR_HEX[topts.paintColor], 0.6);
        if (pending.mode === "platform") ctx.fillStyle = hexA(COLOR_HEX[topts.platColor], 0.6); // arm
        ctx.beginPath(); ctx.rect(Math.min(a.px, b.px), Math.min(a.py, b.py), Math.abs(b.px - a.px), Math.abs(b.py - a.py)); ctx.fill(); ctx.stroke();
        label(`${Math.abs(hover.x - pending.a.x)} × ${Math.abs(hover.y - pending.a.y)}`, b);
      } else {
        if (pending.mode === "paintCircle") ctx.fillStyle = hexA(COLOR_HEX[topts.paintColor], 0.6);
        ctx.beginPath(); ctx.arc(a.px, a.py, Math.hypot(b.px - a.px, b.py - a.py), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        label(`r ${Math.round(dist(pending.a, hover))}`, b);
      }
      ctx.setLineDash([]);
    }
    if (linePts.length) {
      const pts = hover ? [...linePts, hover] : linePts;
      ctx.strokeStyle = hexA(COLOR_HEX[topts.paintColor], 0.7); ctx.lineWidth = Math.max(2, topts.lineWidth * k);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath(); pts.forEach((p, i) => { const c = C(p); if (i) ctx.lineTo(c.px, c.py); else ctx.moveTo(c.px, c.py); }); ctx.stroke();
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      for (const p of linePts) { const c = C(p); ctx.beginPath(); ctx.arc(c.px, c.py, 4, 0, Math.PI * 2); ctx.fillStyle = ORANGE; ctx.fill(); }
    }
    // snapped cursor
    if (hover && tool !== "select" && tool !== "erase") {
      const c = C(hover);
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(c.px - 7, c.py); ctx.lineTo(c.px + 7, c.py); ctx.moveTo(c.px, c.py - 7); ctx.lineTo(c.px, c.py + 7); ctx.stroke();
      if (tool === "object") {
        ctx.setLineDash([4, 3]); ctx.beginPath();
        const s = topts.objSize * k;
        if (topts.objShape === "disk") ctx.arc(c.px, c.py, s / 2, 0, Math.PI * 2); else ctx.rect(c.px - s / 2, c.py - s / 2, s, s);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (tool === "robot" && !drag) {
        const s = ROBOT_SIZE * k;
        ctx.save(); ctx.translate(c.px, c.py); ctx.rotate((world.start.heading * Math.PI) / 180);
        ctx.setLineDash([4, 3]); ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.setLineDash([]); ctx.restore();
      }
    }

    function label(t: string, at: { px: number; py: number }) {
      ctx!.font = "11px ui-monospace, Menlo, monospace";
      const w = ctx!.measureText(t).width + 8;
      ctx!.fillStyle = INK; ctx!.fillRect(at.px + 10, at.py + 8, w, 16);
      ctx!.fillStyle = "#FFFDF9"; ctx!.fillText(t, at.px + 14, at.py + 20);
      ctx!.fillStyle = "rgba(255,106,26,0.18)";
    }
  }

  function hexA(hex: string, a: number): string {
    if (!hex.startsWith("#") || hex.length !== 7) return `rgba(12,11,10,${a})`;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ---------------- sizing

  const onResize = () => {
    if (disposed) return;
    renderer.resize();
    resizeOverlay();
    drawNow();
  };
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(onResize);
    ro.observe(stage);
  } else if (typeof window !== "undefined") window.addEventListener("resize", onResize);

  // ---------------- initial render
  setTool("select");
  setTab("level");
  renderPanels();
  renderIssues();
  updateUndo();
  updateZoomUi();
  onResize();

  return {
    getWorld: () => clone(world),
    setWorld(w: World) {
      cancelInteraction();
      world = prepare(w);
      history.reset(world);
      selectedId = null;
      applyView(FIT_VIEW);
      afterChange({ record: false, emit: false });
      updateUndo();
    },
    dispose() {
      if (disposed) return;
      flushEmit();
      disposed = true;
      if (raf) caf_(raf);
      if (toastTimer) clearTimeout(toastTimer);
      ro?.disconnect();
      if (!ro && typeof window !== "undefined") window.removeEventListener("resize", onResize);
      root.remove();
    },
  };
}
