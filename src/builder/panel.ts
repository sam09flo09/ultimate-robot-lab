/**
 * builder: the Robot Builder panel. Students design their robot (size, wheels, gears, motors,
 * sensor position); live stats come from the same formulas the sim uses (sim/robotConfig.ts).
 * Apply hands the clamped design to the app (which calls sim.setConfig and saves it in the project).
 */
import { DEFAULT_ROBOT, type RobotConfig, type SimState, type World } from "../core/types";
import { createRenderer } from "../render";
import {
  GEAR_RATIOS, SIZE_MAX, SIZE_MIN, WHEEL_SIZES, clampConfig, effectiveConfig, gearLabel, isLocked, robotStats, sameConfig,
} from "../sim/robotConfig";
import { h, setText } from "../ui/dom";
import { BUILDER_CSS } from "./styles";

export interface RobotBuilderOptions {
  /** The current world (for robotRules). */
  getWorld(): World;
  /** The student's saved design (what Apply last set). */
  getConfig(): RobotConfig;
  /** True while a program runs (Apply is disabled then). */
  isRunning(): boolean;
  /** Apply a new design (already clamped to legal values). */
  onApply(config: RobotConfig): void;
}

export interface RobotBuilder {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const k of kids) e.append(k);
  return e;
}

/** A tiny gear-train picture: motor gear (orange) driving the wheel gear (grey). */
function gearIcon(g: number): SVGElement {
  const r1 = g >= 1 ? 5 : 5 / g, r2 = g >= 1 ? 5 * g : 5;
  const w = 2 * r1 + 2 * r2 + 6, hgt = 2 * Math.max(r1, r2) + 4;
  const cy = hgt / 2;
  const gear = (cx: number, r: number, fill: string) => svg("circle", {
    cx, cy, r, fill, stroke: "#0C0B0A", "stroke-width": 2.4, "stroke-dasharray": "2 1.6",
  });
  return svg("svg", { width: Math.round(w * 1.2), height: Math.round(hgt * 1.2), viewBox: `0 0 ${w} ${hgt}`, "aria-hidden": "true" },
    gear(2 + r1, r1, "#FF6A1A"), gear(4 + 2 * r1 + r2, r2, "#C9C2B8"));
}

function wheelIcon(d: number): SVGElement {
  const r = (d / 130) * 13;
  return svg("svg", { width: 30, height: 30, viewBox: "0 0 30 30", "aria-hidden": "true" },
    svg("circle", { cx: 15, cy: 15, r, fill: "#3A3631" }), svg("circle", { cx: 15, cy: 15, r: r * 0.4, fill: "#A7AFB8" }));
}

const GEAR_TEXT: Record<string, string> = { "3:1": "torque", "2:1": "torque", "1:1": "normal", "1:2": "speed", "1:3": "speed" };

/** Bar fill (0..1) on a log scale between lo and hi. */
function logPos(v: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(1, Math.log(v / lo) / Math.log(hi / lo)));
}

function previewState(c: RobotConfig): SimState {
  const from = { x: c.sensorOffset, y: c.size / 2 };
  return {
    time: 0, robot: { x: 0, y: -20, heading: 0 }, robotSize: c.size, objects: [], carrying: null,
    penDown: false, penColor: "BLACK", strokes: [], path: [], wallHits: 0, bumperPressed: false,
    distanceRay: { from: { x: from.x, y: from.y - 20 }, to: { x: from.x, y: 150 }, hit: false },
    visitedZones: [], config: c,
  };
}

const PREVIEW_WORLD: World = {
  id: "rb-preview", name: "preview", width: 300, height: 300, background: "grid", gridSize: 50,
  start: { x: 0, y: 0, heading: 0 }, walls: [], floor: [], objects: [], zones: [], goals: [], version: 1,
};

let cssInjected = false;

export function createRobotBuilder(opts: RobotBuilderOptions): RobotBuilder {
  if (!cssInjected) {
    cssInjected = true;
    document.head.append(h("style", { id: "rb-css" }, BUILDER_CSS));
  }
  let draft: RobotConfig = { ...DEFAULT_ROBOT };
  let back: HTMLElement | null = null;
  let prevFocus: HTMLElement | null = null;
  let refresh: () => void = () => undefined;

  function close(): void {
    if (!back) return;
    back.remove();
    back = null;
    document.removeEventListener("keydown", onKey, true);
    prevFocus?.focus();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }

  function open(): void {
    if (back) return;
    prevFocus = document.activeElement as HTMLElement | null;
    const world = opts.getWorld();
    const locked = isLocked(world);
    const maxSize = Math.min(SIZE_MAX, world.robotRules?.maxSize ?? SIZE_MAX);
    const saved = clampConfig(opts.getConfig());
    draft = locked ? effectiveConfig(world, saved) : clampConfig(saved, maxSize);
    if (saved.name) draft.name = saved.name;
    const running = opts.isRunning();

    // ---- preview + spec card
    const canvas = h("canvas", { "aria-hidden": "true" });
    const preview = h("div", { class: "rb-preview", role: "img", "aria-label": "Top view of your robot" },
      canvas, h("span", { class: "rb-scale" }, "grid = 50 mm"));
    const specName = h("h3", {});
    const specDl = h("dl", {});
    const card = h("div", { class: "rb-card", "aria-live": "polite" }, specName, specDl);
    const renderer = createRenderer(canvas);

    // ---- controls
    const disabled = locked || running;
    const nameIn = h("input", { type: "text", maxlength: 40, placeholder: "e.g. Torque Turtle", value: draft.name ?? "", disabled });
    nameIn.addEventListener("input", () => { const n = nameIn.value.trim(); if (n) draft.name = n; else delete draft.name; refresh(); });

    const range = (min: number, max: number, step: number, value: number, label: string, fmt: (v: number) => string, set: (v: number) => void) => {
      const inp = h("input", { type: "range", min, max, step, value, "aria-label": label, disabled }) as HTMLInputElement;
      const out = h("output", {}, fmt(value));
      inp.addEventListener("input", () => { set(Number(inp.value)); setText(out, fmt(Number(inp.value))); refresh(); });
      return { el: h("div", { class: "rb-range" }, inp, out), inp, out };
    };
    const sizeR = range(SIZE_MIN, maxSize, 5, draft.size, "Robot size", (v) => `${v} mm`, (v) => {
      draft.size = v;
      const lim = v / 2 - 10;
      if (Math.abs(draft.sensorOffset) > lim) draft.sensorOffset = Math.sign(draft.sensorOffset) * lim;
    });
    const sensR = range(-(SIZE_MAX / 2 - 10), SIZE_MAX / 2 - 10, 5, draft.sensorOffset, "Sensor position",
      (v) => (v === 0 ? "centre" : `${Math.abs(v)} mm ${v < 0 ? "left" : "right"}`), (v) => {
        const lim = draft.size / 2 - 10;
        draft.sensorOffset = Math.max(-lim, Math.min(lim, v));
      });

    const choiceGroup = <T extends number>(label: string, values: readonly T[], cur: () => T, set: (v: T) => void,
      content: (v: T) => (Node | string)[]) => {
      const btns = values.map((v) => {
        const b = h("button", { type: "button", class: "rb-choice", role: "radio", disabled }, ...content(v));
        b.addEventListener("click", () => { set(v); refresh(); });
        return { b, v };
      });
      const group = h("div", { class: "rb-choices", role: "radiogroup", "aria-label": label }, ...btns.map((x) => x.b));
      return { group, sync: () => { for (const x of btns) x.b.setAttribute("aria-checked", String(x.v === cur())); } };
    };
    const wheels = choiceGroup("Wheel size", WHEEL_SIZES, () => draft.wheelDiameter as (typeof WHEEL_SIZES)[number],
      (v) => { draft.wheelDiameter = v; }, (v) => [wheelIcon(v), h("small", {}, `${v} mm`)]);
    const gears = choiceGroup("Gear ratio", GEAR_RATIOS, () => draft.gearRatio as (typeof GEAR_RATIOS)[number],
      (v) => { draft.gearRatio = v; }, (v) => [gearIcon(v), `${gearLabel(v)}`, h("small", {}, GEAR_TEXT[gearLabel(v)])]);
    const motors = choiceGroup("Motors", [2, 4] as const, () => draft.motors, (v) => { draft.motors = v; },
      (v) => [`${v} motors`, h("small", {}, v === 2 ? "standard" : "2× push")]);

    // ---- stats
    const statRow = (label: string, title: string) => {
      const fill = h("i", {}), tick = h("b", {}), val = h("span", { class: "rb-v" });
      return {
        els: [h("span", { class: "rb-k", title }, label), h("div", { class: "rb-bar", title }, fill, tick), val],
        set(frac: number, dfltFrac: number, text: string) {
          fill.style.width = `${Math.round(frac * 100)}%`;
          tick.style.left = `calc(${(dfltFrac * 100).toFixed(1)}% - 1px)`;
          setText(val, text);
        },
      };
    };
    const sSpeed = statRow("Top speed", "Driving at 100% velocity. The black mark is the standard robot.");
    const sTurn = statRow("Turn speed", "Turning on the spot at 100% turn velocity.");
    const sPush = statRow("Push strength", "Objects heavier than this make the wheels spin (mass 1 = normal object).");
    const sGap = statRow("Fits through", "The narrowest gap it can drive straight through.");
    const tips = h("ul", { class: "rb-tips", "aria-live": "polite" });

    const status = h("span", { class: "rb-state", role: "status" });
    const applyBtn = h("button", { type: "button", class: "btn btn-primary" }, "Apply") as HTMLButtonElement;
    const resetBtn = h("button", { type: "button", class: "btn", disabled }, "Reset to default") as HTMLButtonElement;
    const closeBtn = h("button", { type: "button", class: "btn btn-sm rb-x", "aria-label": "Close robot builder" }, "✕");

    const row = (label: string, control: HTMLElement) => h("div", { class: "rb-row" }, h("span", { class: "rb-lbl" }, label), control);
    const right = h("div", { class: "rb-right" });
    if (locked) {
      right.append(h("div", { class: "rb-lock", role: "note" },
        h("b", {}, "🔒 This playground locks the robot. "),
        `Everyone uses the same robot here${world.race ? " so race times are fair" : ""}. Switch to another playground to build your own.`));
    } else if (running) {
      right.append(h("div", { class: "rb-lock", role: "note" }, h("b", {}, "Your program is running. "), "Stop it to change the robot."));
    } else if (maxSize < SIZE_MAX) {
      right.append(h("div", { class: "rb-lock", role: "note" }, `This playground allows robots up to ${maxSize} mm.`));
    }
    right.append(
      row("Name", nameIn),
      row("Size", sizeR.el),
      row("Wheels", wheels.group),
      row("Gear ratio", gears.group),
      row("Motors", motors.group),
      row("Sensor position", sensR.el),
      h("div", { class: "rb-stats", "aria-label": "What your design does" }, ...sSpeed.els, ...sTurn.els, ...sPush.els, ...sGap.els),
      tips,
    );

    const dlg = h("div", { class: "rb", role: "dialog", "aria-modal": "true", "aria-labelledby": "rbTitle" },
      h("div", { class: "rb-head" }, h("h2", { id: "rbTitle" }, "🔧 Robot Builder"),
        h("span", { class: "rb-sub" }, "Design your robot — every choice changes how it drives."), closeBtn),
      h("div", { class: "rb-body" }, h("div", { class: "rb-left" }, preview, card), right),
      h("div", { class: "rb-foot" }, status, resetBtn, applyBtn));
    back = h("div", { class: "rb-back" }, dlg);
    back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
    document.body.append(back);
    document.addEventListener("keydown", onKey, true);

    const D = robotStats(DEFAULT_ROBOT);
    refresh = () => {
      const c = clampConfig(draft, maxSize);
      const st = robotStats(c);
      wheels.sync(); gears.sync(); motors.sync();
      sizeR.inp.value = String(c.size); setText(sizeR.out, `${c.size} mm`);
      sensR.inp.value = String(c.sensorOffset);
      setText(sensR.out, c.sensorOffset === 0 ? "centre" : `${Math.abs(c.sensorOffset)} mm ${c.sensorOffset < 0 ? "left" : "right"}`);
      sSpeed.set(logPos(st.topSpeed, 160, 3120), logPos(D.topSpeed, 160, 3120), `${Math.round(st.topSpeed)} mm/s`);
      sTurn.set(logPos(st.turnSpeed, 48, 1685), logPos(D.turnSpeed, 48, 1685), `${Math.round(st.turnSpeed)} °/s`);
      sPush.set(logPos(st.pushStrength, 0.25, 10), logPos(1, 0.25, 10), `${fmtX(st.pushStrength)}`);
      sGap.set(1 - (c.size - 120) / 100, 1 - (140 - 120) / 100, `≥ ${st.gap} mm`);

      setText(specName, c.name ?? (sameConfig(c, DEFAULT_ROBOT) ? "Standard robot" : "My robot"));
      specDl.replaceChildren(
        h("dt", {}, "Size"), h("dd", {}, `${c.size} × ${c.size} mm`),
        h("dt", {}, "Wheels"), h("dd", {}, `${c.wheelDiameter} mm, track ${st.track} mm`),
        h("dt", {}, "Gears"), h("dd", {}, `${gearLabel(c.gearRatio)} (${GEAR_TEXT[gearLabel(c.gearRatio)]})`),
        h("dt", {}, "Motors"), h("dd", {}, `${c.motors}`),
        h("dt", {}, "Push"), h("dd", {}, `${fmtX(st.pushStrength)} a normal object`));

      tips.replaceChildren(...tipsFor(c, st).map((t) => h("li", {}, t)));

      const current = effectiveConfig(world, opts.getConfig());
      const changed = !sameConfig(c, current) || (c.name ?? "") !== (opts.getConfig().name ?? "");
      applyBtn.disabled = disabled || !changed;
      resetBtn.disabled = disabled || (sameConfig(c, DEFAULT_ROBOT));
      setText(status, locked ? "Locked by this playground." : running ? "Stop the program to apply changes."
        : changed ? "Not applied yet — press Apply to use this robot." : "This is the robot you're using.");

      renderer.resize();
      renderer.draw(PREVIEW_WORLD, previewState(c), { showPath: false, showSensors: true, showZones: false });
    };

    applyBtn.addEventListener("click", () => {
      const c = clampConfig(draft, maxSize);
      opts.onApply(c);
      refresh();
    });
    resetBtn.addEventListener("click", () => {
      const name = draft.name;
      draft = { ...DEFAULT_ROBOT };
      if (name) draft.name = name;
      refresh();
    });
    closeBtn.addEventListener("click", close);

    requestAnimationFrame(() => refresh());
    refresh();
    (disabled ? closeBtn : nameIn).focus();
  }

  return {
    open, close,
    get isOpen() { return back !== null; },
  };
}

function fmtX(v: number): string {
  return `${Math.round(v * 100) / 100}×`;
}

function tipsFor(c: RobotConfig, st: ReturnType<typeof robotStats>): string[] {
  const t: string[] = [];
  if (c.gearRatio > 1) t.push(`Gear ${gearLabel(c.gearRatio)}: the wheels turn ${c.gearRatio}× slower but push ${c.gearRatio}× harder — like low gear on a bike going uphill.`);
  else if (c.gearRatio < 1) t.push(`Gear ${gearLabel(c.gearRatio)}: the wheels spin ${Math.round(1 / c.gearRatio)}× faster but push ${Math.round(1 / c.gearRatio)}× weaker — like top gear on a flat road.`);
  else t.push("Bigger gear ratio = slower but stronger — like low gear on a bike.");
  if (c.wheelDiameter > 100) t.push("Big wheels go further each turn (faster) but need more force to push (weaker).");
  else if (c.wheelDiameter < 100) t.push("Small wheels are slower but give more pushing force.");
  if (c.motors === 4) t.push("4 motors share the load: twice the push, same top speed.");
  if (c.size > 140) t.push(`A bigger robot turns slower (wheels ${st.track} mm apart) and needs gaps of at least ${st.gap} mm.`);
  else if (c.size < 140) t.push(`A small robot turns quickly and fits through gaps from ${st.gap} mm.`);
  if (st.pushStrength < 1) t.push("Push strength is under 1×: this robot can't push even a normal object!");
  if (c.sensorOffset !== 0) t.push("The distance sensor and front eye now look ahead from the side of the front edge.");
  return t;
}
