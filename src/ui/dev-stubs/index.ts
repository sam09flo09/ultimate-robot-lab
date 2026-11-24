/**
 * DEV STUBS — thin, typed stand-ins for the real subsystems so the app shell can be
 * developed and tested before src/sim, src/render, src/worlds, src/runtime, src/blocks
 * and src/editor exist. They implement the contracts in src/core loosely and are NOT used
 * by the shipped app (see src/ui/modules.ts). Do not import them anywhere else.
 */
import type {
  World, Sim, SimState, RobotController, GoalResult, SimEvent, DriveDir, TurnDir, ColorName, Vec,
} from "../../core/types";
import { COLOR_HEX } from "../../core/types";
import type {
  Renderer, RenderOptions, PythonRunner, RunnerOptions, RunResult,
  BlocksEditor, BlocksOptions, LevelEditor, LevelEditorOptions,
} from "../../core/modules";

// ---------------------------------------------------------------- worlds

const numberGrid: World = {
  id: "number-grid", name: "Number Grid", version: 1,
  description: "A 10 × 10 grid of numbered squares. Each square is 200 mm.",
  width: 2000, height: 2000, background: "numberGrid", gridSize: 200,
  start: { x: -900, y: -900, heading: 0 },
  walls: [], floor: [], objects: [], zones: [], goals: [],
};
const smallMaze: World = {
  id: "stub-maze", name: "Stub Maze", version: 1,
  description: "Drive to the green square without touching the walls.",
  width: 2000, height: 2000, background: "grid", gridSize: 200,
  start: { x: -800, y: -800, heading: 0 },
  walls: [{ a: { x: -400, y: -1000 }, b: { x: -400, y: 400 }, thickness: 20 }],
  floor: [{ kind: "rect", x: 700, y: 700, w: 300, h: 300, color: "GREEN" }],
  objects: [{ id: "d1", shape: "disk", x: 0, y: 0, size: 100, color: "RED", movable: true, pickable: true }],
  zones: [{ id: "goal", kind: "rect", x: 700, y: 700, w: 300, h: 300, label: "Finish" }],
  goals: [{ type: "reachZone", zone: "goal", description: "Reach the green square" }, { type: "noWallHits" }],
  hardware: { pen: true, magnet: true },
  starter: { python: "def main():\n    drivetrain.drive_for(FORWARD, 1500, MM)\n    drivetrain.turn_for(RIGHT, 90, DEGREES)\n    drivetrain.drive_for(FORWARD, 1500, MM)\n\nstart(main)\n" },
};
export const PLAYGROUNDS: World[] = [numberGrid, smallMaze];
export function getPlayground(id: string): World | undefined { return PLAYGROUNDS.find((w) => w.id === id); }

// ---------------------------------------------------------------- sim

const norm = (h: number) => ((h % 360) + 360) % 360;

export function createSim(world: World): Sim {
  type Pending = { kind: "drive" | "turn" | "wait"; left: number; sign: number; resolve: () => void; reject: (e: Error) => void };
  let pending: Pending[] = [];
  let driveVel = 50, turnVel = 50, timer0 = 0, gyroOff = 0, rot = 0, continuous: Pending | null = null;
  const listeners = new Set<(e: SimEvent) => void>();
  const emit = (e: SimEvent) => listeners.forEach((l) => l(e));
  let completeSent = false;
  const fresh = (): SimState => ({
    time: 0, robot: { ...world.start }, robotSize: 140, objects: world.objects.map((o) => ({ ...o })),
    carrying: null, penDown: false, penColor: "BLACK", strokes: [], path: [{ x: world.start.x, y: world.start.y }],
    wallHits: 0, bumperPressed: false, distanceRay: null, visitedZones: [],
  });
  const state: SimState = fresh();
  const inZone = (zid: string) => {
    const z = world.zones.find((q) => q.id === zid); if (!z) return false;
    const { x, y } = state.robot;
    return z.kind === "rect" ? Math.abs(x - z.x) <= z.w / 2 && Math.abs(y - z.y) <= z.h / 2 : Math.hypot(x - z.x, y - z.y) <= z.r;
  };
  const promise = (kind: Pending["kind"], left: number, sign: number) => new Promise<void>((resolve, reject) => {
    pending.push({ kind, left: Math.abs(left), sign, resolve, reject });
  });
  const ctl: RobotController = {
    driveFor: (d: DriveDir, mm: number) => promise("drive", mm, (d === "REVERSE" ? -1 : 1) * Math.sign(mm || 1)),
    turnFor: (d: TurnDir, deg: number) => promise("turn", deg, (d === "LEFT" ? -1 : 1) * Math.sign(deg || 1)),
    turnToHeading: (deg: number) => { let diff = norm(deg - ctl.heading()); if (diff > 180) diff -= 360; return promise("turn", diff, Math.sign(diff || 1)); },
    drive: (d) => { continuous = { kind: "drive", left: Infinity, sign: d === "REVERSE" ? -1 : 1, resolve() {}, reject() {} }; },
    turn: (d) => { continuous = { kind: "turn", left: Infinity, sign: d === "LEFT" ? -1 : 1, resolve() {}, reject() {} }; },
    stop: () => { continuous = null; },
    setDriveVelocity: (p) => { driveVel = Math.max(1, Math.min(100, p)); },
    setTurnVelocity: (p) => { turnVel = Math.max(1, Math.min(100, p)); },
    setHeading: (deg) => { gyroOff = norm(state.robot.heading - deg); },
    heading: () => norm(state.robot.heading - gyroOff),
    rotation: () => rot,
    isDone: () => !continuous && !pending.some((p) => p.kind !== "wait"),
    wait: (s) => promise("wait", s, 1),
    distanceMM: () => {
      const r = (state.robot.heading * Math.PI) / 180, dx = Math.sin(r), dy = Math.cos(r);
      const tx = dx > 0 ? (world.width / 2 - state.robot.x) / dx : dx < 0 ? (-world.width / 2 - state.robot.x) / dx : Infinity;
      const ty = dy > 0 ? (world.height / 2 - state.robot.y) / dy : dy < 0 ? (-world.height / 2 - state.robot.y) / dy : Infinity;
      const d = Math.min(tx, ty) - 70; return d > 3000 ? 3000 : Math.max(0, d);
    },
    distanceFound: () => ctl.distanceMM() < 1000,
    frontColor: () => "NONE", frontNear: () => false, frontBrightness: () => 0,
    downColor: () => {
      for (const f of world.floor) if (f.kind === "rect" && Math.abs(state.robot.x - f.x) <= f.w / 2 && Math.abs(state.robot.y - f.y) <= f.h / 2) return f.color;
      return "WHITE";
    },
    downBrightness: () => 90,
    bumperPressed: () => state.bumperPressed,
    positionX: () => state.robot.x, positionY: () => state.robot.y,
    timer: () => state.time - timer0, resetTimer: () => { timer0 = state.time; },
    penDown: (d) => { if (!world.hardware?.pen) return false; state.penDown = d; if (d) state.strokes.push({ color: state.penColor, width: 6, points: [{ x: state.robot.x, y: state.robot.y }] }); return true; },
    setPenColor: (c: ColorName) => { if (!world.hardware?.pen) return false; state.penColor = c; return true; },
    magnet: () => !!world.hardware?.magnet,
    setWheelVelocities: () => undefined,
    armAvailable: () => false,
    armSpinTo: () => Promise.resolve(),
    armSpin: () => undefined,
    setArmVelocity: () => undefined,
    armAngle: () => 0,
    claw: () => Promise.resolve(),
    clawHolding: () => false,

  };
  const sim: Sim = {
    world, state, controller: ctl,
    step(dt) {
      state.time += dt;
      const lim = world.width / 2 - 70;
      const motions: Pending[] = [];
      const firstMove = pending.find((p) => p.kind !== "wait");
      if (firstMove) motions.push(firstMove); else if (continuous) motions.push(continuous);
      for (const w of pending) if (w.kind === "wait") motions.push(w);
      for (const m of motions) {
        if (m.kind === "wait") { m.left -= dt; }
        else if (m.kind === "drive") {
          const amt = Math.min(m.left, 800 * (driveVel / 100) * dt); m.left -= amt;
          const r = (state.robot.heading * Math.PI) / 180;
          let nx = state.robot.x + Math.sin(r) * amt * m.sign, ny = state.robot.y + Math.cos(r) * amt * m.sign;
          const hitWall = Math.abs(nx) > lim || Math.abs(ny) > lim;
          nx = Math.max(-lim, Math.min(lim, nx)); ny = Math.max(-lim, Math.min(lim, ny));
          state.robot.x = nx; state.robot.y = ny; state.bumperPressed = hitWall;
          if (hitWall) { m.left = 0; state.wallHits++; emit({ type: "wallHit", time: state.time }); }
          const last = state.path[state.path.length - 1];
          if (!last || Math.hypot(last.x - nx, last.y - ny) > 10) state.path.push({ x: nx, y: ny });
          if (state.penDown && state.strokes.length) state.strokes[state.strokes.length - 1].points.push({ x: nx, y: ny });
        } else {
          const amt = Math.min(m.left, 360 * (turnVel / 100) * dt); m.left -= amt;
          state.robot.heading = norm(state.robot.heading + amt * m.sign); rot += amt * m.sign;
        }
        if (m.left <= 1e-9) { pending = pending.filter((p) => p !== m); m.resolve(); }
      }
      for (const z of world.zones) if (!state.visitedZones.includes(z.id) && inZone(z.id)) {
        state.visitedZones.push(z.id); emit({ type: "zoneEntered", zoneId: z.id, time: state.time });
      }
      if (!completeSent && world.goals.length && sim.evaluateGoals().every((g) => g.passed)) {
        completeSent = true; emit({ type: "goalsComplete", time: state.time });
      }
    },
    reset() { sim.abort(); Object.assign(state, fresh()); driveVel = 50; turnVel = 50; gyroOff = 0; rot = 0; timer0 = 0; completeSent = false; },
    abort() { const p = pending; pending = []; continuous = null; p.forEach((q) => q.reject(new Error("STOPPED"))); },
    evaluateGoals(): GoalResult[] {
      return world.goals.map((g) => {
        if (g.type === "reachZone") { const ok = state.visitedZones.includes(g.zone); return { goal: g, passed: ok, detail: ok ? "Reached" : "Not yet" }; }
        if (g.type === "noWallHits") return { goal: g, passed: state.wallHits === 0, detail: `${state.wallHits} wall hits` };
        return { goal: g, passed: false, detail: "stub" };
      });
    },
    setConfig() { /* stub */ },
    onEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return sim;
}

// ---------------------------------------------------------------- renderer

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d")!;
  let world: World | null = null;
  const scale = () => canvas.width / (world?.width ?? 2000);
  const r: Renderer = {
    draw(w: World, st: SimState | null, opts: RenderOptions) {
      world = w;
      const s = scale(), W = canvas.width, H = canvas.height;
      const P = (v: Vec) => [(v.x + w.width / 2) * s, (w.height / 2 - v.y) * s] as const;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
      const g = (w.gridSize ?? 200) * s;
      if (w.background !== "plain") {
        ctx.strokeStyle = "#D9CFBF"; ctx.lineWidth = 1;
        for (let x = 0; x <= W + 1; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y <= H + 1; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }
      if (w.background === "numberGrid") {
        ctx.fillStyle = "#9A9186"; ctx.font = `${W / 42}px sans-serif`; ctx.textBaseline = "top";
        const cols = Math.round(w.width / (w.gridSize ?? 200));
        for (let rr = 0; rr < cols; rr++) for (let c = 0; c < cols; c++) ctx.fillText(String(rr * cols + c + 1), c * g + 4, H - (rr + 1) * g + 4);
      }
      for (const f of w.floor) if (f.kind === "rect") { const [x, y] = P({ x: f.x - f.w / 2, y: f.y + f.h / 2 }); ctx.fillStyle = COLOR_HEX[f.color]; ctx.fillRect(x, y, f.w * s, f.h * s); }
      ctx.strokeStyle = "#0C0B0A";
      for (const wl of w.walls) { const a = P(wl.a), b = P(wl.b); ctx.lineWidth = wl.thickness * s; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
      if (!st) return;
      for (const o of st.objects) { const [x, y] = P(o); ctx.fillStyle = COLOR_HEX[o.color]; ctx.beginPath(); ctx.arc(x, y, (o.size / 2) * s, 0, 7); ctx.fill(); }
      if (opts.showPath && st.path.length > 1) {
        ctx.strokeStyle = "rgba(214,84,14,.75)"; ctx.lineWidth = W / 220; ctx.beginPath();
        st.path.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        const [ex, ey] = P(st.robot); ctx.lineTo(ex, ey); ctx.stroke();
      }
      const [rx, ry] = P(st.robot), size = st.robotSize * s;
      ctx.save(); ctx.translate(rx, ry); ctx.rotate((st.robot.heading * Math.PI) / 180);
      ctx.fillStyle = "#0C0B0A"; ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = "#FF6A1A"; ctx.beginPath(); ctx.moveTo(0, -size * 0.4); ctx.lineTo(size * 0.24, 0); ctx.lineTo(-size * 0.24, 0); ctx.fill();
      ctx.restore();
    },
    toWorld(px, py) { const s = canvas.clientWidth / (world?.width ?? 2000); return { x: px / s - (world?.width ?? 2000) / 2, y: (world?.height ?? 2000) / 2 - py / s }; },
    toCanvas(x, y) { const s = canvas.clientWidth / (world?.width ?? 2000); return { px: (x + (world?.width ?? 2000) / 2) * s, py: ((world?.height ?? 2000) / 2 - y) * s }; },
    invalidate() {},
    resize() { const d = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(canvas.clientWidth * d)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * d)); },
  };
  return r;
}

// ---------------------------------------------------------------- runtime (a toy line interpreter)

export function createPythonRunner(opts: RunnerOptions): PythonRunner {
  let stopFlag = false, running = false;
  const c = opts.controller;
  return {
    get running() { return running; },
    stop() { stopFlag = true; },
    // debugger: the stub runtime can't pause
    pause() {}, resume() {}, step() {}, get paused() { return false; }, variables: () => [],
    async run(source: string): Promise<RunResult> {
      running = true; stopFlag = false;
      let steps = 0, startCalled = false;
      const lines = source.split("\n");
      try {
        for (let i = 0; i < lines.length; i++) {
          if (stopFlag) return { status: "stopped" };
          const ln = i + 1, t = lines[i].trim();
          if (!t || t.startsWith("#") || t.startsWith("def ") || t === "pass") continue;
          opts.onLine(ln);
          let m: RegExpMatchArray | null;
          if (/^start\(main\)$/.test(t)) { startCalled = true; continue; }
          if ((m = t.match(/^drivetrain\.drive_for\((FORWARD|REVERSE),\s*(-?[\d.]+),\s*MM\)$/))) { await c.driveFor(m[1] as DriveDir, +m[2]); steps++; opts.onLog({ line: ln, text: `drive_for(${m[1]}, ${m[2]}, MM)`, kind: "step" }); continue; }
          if ((m = t.match(/^drivetrain\.turn_for\((LEFT|RIGHT),\s*(-?[\d.]+),\s*DEGREES\)$/))) { await c.turnFor(m[1] as TurnDir, +m[2]); steps++; opts.onLog({ line: ln, text: `turn_for(${m[1]}, ${m[2]}, DEGREES)`, kind: "step" }); continue; }
          if ((m = t.match(/^wait\(([\d.]+)(?:,\s*SECONDS)?\)$/))) { await c.wait(+m[1]); steps++; opts.onLog({ line: ln, text: `wait(${m[1]}, SECONDS)`, kind: "step" }); continue; }
          if ((m = t.match(/^print\((.*)\)$/))) { opts.onLog({ line: ln, text: m[1].replace(/^["']|["']$/g, ""), kind: "print" }); continue; }
          if ((m = t.match(/^brain\.screen\.print\((.*)\)$/))) { opts.onScreen?.({ kind: "print", text: m[1].replace(/^["']|["']$/g, "") }); continue; }
          if (t === "brain.screen.clear_screen()") { opts.onScreen?.({ kind: "clear" }); continue; }
          if (t === "brain.screen.new_line()") { opts.onScreen?.({ kind: "newline" }); continue; }
          const name = t.split(/[.(\s]/)[0];
          return { status: "error", error: { line: ln, type: "NameError", raw: `name '${name}' is not defined`, html: `<b>Line ${ln}: NameError</b><br>Python doesn't know the name <code>${name.replace(/[<>&]/g, "")}</code>. (stub runtime)` } };
        }
        return { status: "finished", startCalled, steps };
      } catch (e) {
        if (e instanceof Error && e.message === "STOPPED") return { status: "stopped" };
        throw e;
      } finally { running = false; }
    },
  };
}

// ---------------------------------------------------------------- blocks (a list of command rows)

export function createBlocksEditor(host: HTMLElement, opts: BlocksOptions): BlocksEditor {
  type Cmd = { op: "drive" | "turn"; dir: string; n: number };
  let cmds: Cmd[] = [{ op: "drive", dir: "FORWARD", n: 200 }];
  let ro = false, hl = 0;
  host.innerHTML = "";
  const root = document.createElement("div");
  root.style.cssText = "padding:12px;font:14px monospace;height:100%;overflow:auto;background:#F6F1E8";
  host.appendChild(root);
  const render = () => {
    root.innerHTML = `<p style="margin:0 0 8px;color:#6B6459">STUB blocks editor (real Blockly lives in src/blocks)</p>`;
    cmds.forEach((c, i) => {
      const row = document.createElement("div");
      row.style.cssText = `padding:8px;margin:4px 0;border-radius:6px;background:${hl === i + 2 ? "#FFE1C9" : c.op === "drive" ? "#cfe3ff" : "#ffe3c4"}`;
      row.textContent = c.op === "drive" ? `drive ${c.dir} ${c.n} mm` : `turn ${c.dir} ${c.n}°`;
      const del = document.createElement("button"); del.textContent = "×"; del.disabled = ro; del.style.marginLeft = "8px";
      del.onclick = () => { cmds.splice(i, 1); render(); opts.onChange(); };
      row.appendChild(del); root.appendChild(row);
    });
    for (const [label, cmd] of [["+ drive 200", { op: "drive", dir: "FORWARD", n: 200 }], ["+ turn right 90", { op: "turn", dir: "RIGHT", n: 90 }]] as const) {
      const b = document.createElement("button"); b.textContent = label; b.disabled = ro; b.style.margin = "8px 8px 0 0";
      b.onclick = () => { cmds.push({ ...cmd }); render(); opts.onChange(); };
      root.appendChild(b);
    }
  };
  render();
  return {
    getPython() {
      const body = cmds.map((c) => c.op === "drive" ? `    drivetrain.drive_for(${c.dir}, ${c.n}, MM)` : `    drivetrain.turn_for(${c.dir}, ${c.n}, DEGREES)`);
      return ["def main():", ...(body.length ? body : ["    pass"]), "", "start(main)", ""].join("\n");
    },
    getState() { return { cmds: cmds.map((c) => ({ ...c })) }; },
    setState(s) { const v = (s as { cmds?: Cmd[] } | null)?.cmds; cmds = Array.isArray(v) ? v.filter((c) => c && (c.op === "drive" || c.op === "turn")).map((c) => ({ op: c.op, dir: String(c.dir), n: Number(c.n) || 0 })) : []; render(); },
    highlightLine(l) { hl = l; render(); },
    setHardware() {}, setReadOnly(v) { ro = v; render(); }, resize() {}, dispose() { host.innerHTML = ""; },
  };
}

// ---------------------------------------------------------------- level editor

export function createLevelEditor(host: HTMLElement, opts: LevelEditorOptions): LevelEditor {
  let world: World = JSON.parse(JSON.stringify(opts.world));
  host.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText = "padding:24px;font:15px sans-serif;display:grid;gap:10px;max-width:520px";
  host.appendChild(box);
  const render = () => {
    box.innerHTML = "<p><b>STUB level editor</b> (real one lives in src/editor)</p>";
    const field = (label: string, val: string, set: (v: string) => void, area = false) => {
      const l = document.createElement("label"); l.textContent = label; l.style.display = "grid";
      const i = document.createElement(area ? "textarea" : "input") as HTMLInputElement; i.value = val;
      i.oninput = () => { set(i.value); opts.onChange(world); };
      l.appendChild(i); box.appendChild(l);
    };
    field("Name", world.name, (v) => { world.name = v; });
    field("Description", world.description ?? "", (v) => { world.description = v; });
    field("Start x (mm)", String(world.start.x), (v) => { world.start.x = Number(v) || 0; });
    field("Starter Python", world.starter?.python ?? "", (v) => { world.starter = { python: v }; }, true);
    const t = document.createElement("button"); t.textContent = "Test (stub)"; t.onclick = () => opts.onTest(JSON.parse(JSON.stringify(world)));
    box.appendChild(t);
  };
  render();
  return { getWorld: () => JSON.parse(JSON.stringify(world)), setWorld(w) { world = JSON.parse(JSON.stringify(w)); render(); }, dispose() { host.innerHTML = ""; } };
}

// ---------------------------------------------------------------- level-file helpers (editor/levelFile.ts)

export function newBlankWorld(): World {
  return { id: "custom", name: "My challenge", description: "", width: 2000, height: 2000, background: "grid", gridSize: 200,
    start: { x: 0, y: -700, heading: 0 }, walls: [], floor: [], objects: [], zones: [], goals: [], hardware: { pen: false, magnet: false }, version: 1 };
}
/** Stub: trusts the input shape (the real one validates everything). */
export function sanitizeWorld(raw: unknown): { world: World; warnings: string[] } {
  return { world: { ...newBlankWorld(), ...(raw as Partial<World>) }, warnings: [] };
}
export function levelFileText(world: World): string {
  return JSON.stringify({ format: "robot-lab-level", version: 1, world }, null, 2);
}
