// STUB — replaced by the match-engine branch
// A tiny stand-in so the Match screen (src/match/ui) can run before the real engine is merged:
//  - createMatchSim: two independent createSim() robots (no robot-robot collisions, B's objects are not
//    shared), simple scoring from GAMES[i].scoring;
//  - createIsolatedRunner: the normal Python runtime loaded into a hidden same-origin iframe (dev server
//    only), with competition(a, d) shimmed: a() in autonomous, d() after nextPeriod();
//  - one game and two practice bots.
import type { RobotConfig, SimEvent, World, Zone } from "../../core/types";
import type { IsolatedRunner, IsolatedRunnerOptions, MatchGame, MatchPhase, MatchScore, MatchSim, ScoreLine, Team } from "../../core/match";
import type { PythonRunner, RunResult } from "../../core/modules";
import { createSim } from "../../sim";

const field: World = {
  id: "match-stub", name: "Disk Dash", version: 1, width: 2000, height: 1600, background: "grid", gridSize: 200,
  start: { x: -700, y: 0, heading: 90 }, walls: [],
  floor: [
    { kind: "rect", id: "goalA", x: 800, y: 0, w: 300, h: 500, color: "RED" },
    { kind: "rect", id: "goalB", x: -800, y: 0, w: 300, h: 500, color: "BLUE" },
  ],
  objects: [-400, -200, 0, 200, 400].map((y, i) => ({ id: `disk${i + 1}`, shape: "disk" as const, x: 0, y, size: 80, color: "YELLOW" as const, movable: true, pickable: false })),
  zones: [
    { id: "goalA", kind: "rect", x: 800, y: 0, w: 300, h: 500, label: "Red goal" },
    { id: "goalB", kind: "rect", x: -800, y: 0, w: 300, h: 500, label: "Blue goal" },
  ],
  goals: [],
};

export const GAMES: MatchGame[] = [{
  id: "disk-dash", name: "Disk Dash", world: field, startB: { x: 700, y: 0, heading: 270 },
  description: "Push the yellow disks into your goal: Red pushes to the right, Blue to the left. Each disk in your goal scores 5. Park in the middle at the end for 3 more.",
  autonomousSeconds: 15, driverSeconds: 60, autonomousBonus: 4,
  scoring: [
    { kind: "objectsInZone", team: "A", zone: "goalA", points: 5, label: "Disks in the red goal" },
    { kind: "objectsInZone", team: "B", zone: "goalB", points: 5, label: "Disks in the blue goal" },
  ],
}];

export const PRACTICE_BOTS: Record<"easy" | "medium", string> = {
  easy: `def autonomous():
    drivetrain.drive_for(FORWARD, 400, MM)

def driver_control():
    while True:
        drivetrain.turn_for(RIGHT, 30, DEGREES)
        drivetrain.drive_for(FORWARD, 150, MM)

competition(autonomous, driver_control)
`,
  medium: `def autonomous():
    drivetrain.set_drive_velocity(80, PERCENT)
    drivetrain.drive_for(FORWARD, 1300, MM)
    drivetrain.drive_for(REVERSE, 500, MM)

def driver_control():
    while True:
        drivetrain.turn_for(LEFT, 90, DEGREES)
        drivetrain.drive_for(FORWARD, 300, MM)
        drivetrain.turn_for(RIGHT, 90, DEGREES)
        drivetrain.drive_for(FORWARD, 900, MM)
        drivetrain.drive_for(REVERSE, 900, MM)

competition(autonomous, driver_control)
`,
};

const inZone = (z: Zone, x: number, y: number) => z.kind === "rect"
  ? Math.abs(x - z.x) <= z.w / 2 && Math.abs(y - z.y) <= z.h / 2
  : Math.hypot(x - z.x, y - z.y) <= z.r;

export function createMatchSim(game: MatchGame, robots: { A?: RobotConfig; B?: RobotConfig } = {}): MatchSim {
  const a = createSim(game.world, robots.A);
  const b = createSim({ ...game.world, start: game.startB }, robots.B);
  let phase: MatchPhase = "idle";
  let time = 0;
  let autoWinner: Team | "tie" | null = null;
  const subs = new Set<(t: Team, e: SimEvent) => void>();
  a.onEvent((e) => subs.forEach((f) => f("A", e)));
  b.onEvent((e) => subs.forEach((f) => f("B", e)));
  const score = (): MatchScore => {
    const lines: ScoreLine[] = [];
    const tot = { A: 0, B: 0 };
    for (const r of game.scoring) {
      const z = game.world.zones.find((q) => q.id === (r as { zone?: string }).zone);
      if (!z) continue;
      if (r.kind === "objectsInZone") {
        const n = a.state.objects.filter((o) => (!r.color || o.color === r.color) && inZone(z, o.x, o.y)).length;
        lines.push({ team: r.team, label: r.label, points: n * r.points, count: n });
        tot[r.team] += n * r.points;
      }
    }
    if (autoWinner && game.autonomousBonus) {
      const give = (t: Team, p: number) => { lines.push({ team: t, label: "Autonomous bonus", points: p }); tot[t] += p; };
      if (autoWinner === "tie") { give("A", game.autonomousBonus / 2); give("B", game.autonomousBonus / 2); } else give(autoWinner, game.autonomousBonus);
    }
    return { A: tot.A, B: tot.B, lines, autonomousWinner: autoWinner };
  };
  const sim: MatchSim = {
    game,
    robots: { A: { team: "A", state: a.state, controller: a.controller }, B: { team: "B", state: b.state, controller: b.controller } },
    get phase() { return phase; },
    get time() { return time; },
    step(dt) { a.step(dt); b.step(dt); time += dt; },
    setPhase(p) {
      if (phase === "autonomous" && p !== "autonomous") { const s = score(); autoWinner = s.A > s.B ? "A" : s.B > s.A ? "B" : "tie"; }
      phase = p;
    },
    reset() { a.reset(); b.reset(); time = 0; phase = "idle"; autoWinner = null; (sim.robots.A as { state: unknown }).state = a.state; (sim.robots.B as { state: unknown }).state = b.state; },
    abort() { a.abort(); b.abort(); },
    score,
    onEvent(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
  return sim;
}

// ---------------------------------------------------------------- isolated runner (iframe)

type RuntimeModule = { createPythonRunner: (o: unknown) => PythonRunner };

function loadFrame(host: HTMLElement): Promise<{ frame: HTMLIFrameElement; mod: RuntimeModule }> {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.srcdoc = `<!doctype html><script src="${location.origin}/vendor/skulpt.bundle.js"></script>` +
    `<script src="${location.origin}/vendor/skulpt-stdlib.js"></script>` +
    `<script type="module">import * as m from "${location.origin}/src/runtime/index.ts"; window.__rl = m;</script>`;
  host.append(frame);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      const m = (frame.contentWindow as unknown as { __rl?: RuntimeModule } | null)?.__rl;
      if (m) resolve({ frame, mod: m });
      else if (Date.now() - t0 > 15000) reject(new Error("The match runner couldn't start."));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

const SHIM = `__rl_p = "auto"; competition = lambda a, d: start(a if __rl_p == "auto" else d)\n`;

export function createIsolatedRunner(opts: IsolatedRunnerOptions): IsolatedRunner {
  const ready = loadFrame(opts.frameHost ?? document.body);
  let inner: PythonRunner | null = null;
  let source = "";
  let running = false;
  let finish: ((r: RunResult) => void) | null = null;
  let period: "auto" | "driver" = "auto";
  let autoDone: RunResult | null = null;
  let current: Promise<RunResult> | null = null;
  const usesCompetition = () => /^\s*competition\s*\(/m.test(source);
  const off = (n: number) => Math.max(0, n - 1);
  ready.then(({ mod }) => {
    inner = mod.createPythonRunner({
      controller: opts.controller, input: opts.input, onControllerUsed: opts.onControllerUsed,
      onLine: (l: number) => opts.onLine(off(l)),
      onLog: (e: { line: number; text: string; kind: "step" | "print" | "warn" }) => opts.onLog({ ...e, line: off(e.line) }),
      onScreen: opts.onScreen, onPause: opts.onPause,
    });
  }).catch(() => undefined);

  async function runPeriod(): Promise<void> {
    const { mod } = await ready;
    void mod;
    if (!inner || !running) return;
    const p = period;
    const cur = inner.run(SHIM.replace('"auto"', `"${p}"`) + source);
    current = cur;
    const r = await cur;
    if (!running || period !== p) return;      // superseded by nextPeriod / stop
    if (p === "auto" && usesCompetition() && r.status === "finished") { autoDone = r; return; } // wait for driver period
    end(r);
  }
  function end(r: RunResult) { running = false; const f = finish; finish = null; f?.(r); }

  const runner: IsolatedRunner = {
    run(src) {
      source = src; period = "auto"; autoDone = null; running = true;
      const p = new Promise<RunResult>((res) => { finish = res; });
      ready.then(() => runPeriod()).catch((e) => end({ status: "error", error: { line: 0, type: "Error", html: String(e?.message ?? e), raw: String(e) } }));
      return p;
    },
    stop() { inner?.stop(); if (running) end({ status: "stopped" }); },
    get running() { return running; },
    pause() { inner?.pause(); },
    resume() { inner?.resume(); },
    step() { inner?.step(); },
    get paused() { return !!inner?.paused; },
    variables() { return inner?.variables() ?? []; },
    nextPeriod() {
      if (!running || period !== "auto" || !usesCompetition()) return;
      period = "driver";
      void autoDone;
      const prev = current;
      inner?.stop();
      opts.controller.stop();
      void (prev ?? Promise.resolve()).then(() => runPeriod());
    },
    dispose() { runner.stop(); ready.then(({ frame }) => frame.remove()).catch(() => undefined); },
  };
  return runner;
}
