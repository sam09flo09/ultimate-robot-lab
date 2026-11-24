/**
 * Test-only helper: run a Python program on the real simulator with the real Python runner,
 * stepping the sim at 60 Hz in sim time. Used by content.test.ts to prove every step is completable.
 * Not imported by the app.
 */
import type { World, Sim } from "../../core/types";
import type { RunResult, AxisName, ButtonName, ControllerInput, ControllerState } from "../../core/modules";
import { AXIS_NAMES, BUTTON_NAMES } from "../../core/modules";
import { createSim } from "../../sim";
import { createPythonRunner } from "../../runtime";

export interface SolutionRun {
  result: RunResult | null;   // null = did not finish within the cap
  sim: Sim;
  log: string[];              // print() output and brain.screen.print text
  simSeconds: number;
}

/** One moment of a scripted driver: from sim time `t` (seconds) until the next frame, the controller
 *  is in exactly this state. Axes not listed are 0; buttons not listed are released. */
export interface ScriptFrame {
  t: number;
  axes?: Partial<Record<AxisName, number>>;
  buttons?: Partial<Record<ButtonName, boolean>>;
}
/** A scripted "person at the controller", for testing driver-control solutions headless. */
export interface DriveScript {
  /** Frames in time order. Before the first frame the controller is untouched. */
  timeline: ScriptFrame[];
  /** Press Stop at this sim time (driver programs loop forever). */
  stopAt: number;
}
export interface RunOptions {
  maxSimSeconds?: number;
  script?: DriveScript;
}

function untouched(): ControllerState {
  const axes = {} as Record<AxisName, number>;
  const buttons = {} as Record<ButtonName, boolean>;
  for (const a of AXIS_NAMES) axes[a] = 0;
  for (const b of BUTTON_NAMES) buttons[b] = false;
  return { axes, buttons };
}

/** A ControllerInput that replays `timeline` by the sim's clock. */
export function scriptedInput(timeline: ScriptFrame[], now: () => number): ControllerInput {
  const frames = [...timeline].sort((a, b) => a.t - b.t);
  return {
    read() {
      const st = untouched();
      const t = now();
      let cur: ScriptFrame | undefined;
      for (const f of frames) if (f.t <= t + 1e-9) cur = f;
      if (cur) {
        for (const a of AXIS_NAMES) {
          const v = cur.axes?.[a];
          if (typeof v === "number") st.axes[a] = Math.max(-100, Math.min(100, Math.round(v)));
        }
        for (const b of BUTTON_NAMES) if (cur.buttons?.[b]) st.buttons[b] = true;
      }
      return st;
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** The original sim's squareAt(): 1..100, 1 in the bottom-left, 10 per row. */
export function squareAt(world: World, x: number, y: number): number {
  const SQ = world.gridSize ?? 200;
  const HALF = world.width / 2;
  let c = Math.floor((x + HALF) / SQ), r = Math.floor((y + HALF) / SQ);
  c = Math.max(0, Math.min(9, c)); r = Math.max(0, Math.min(9, r));
  return r * 10 + c + 1;
}

/**
 * `opts` may be a number (maxSimSeconds, as before) or options. With `script`, the controller follows
 * the script and Stop is pressed at `script.stopAt` (result status "stopped", like a student pressing
 * Stop after driving), then motion is halted as the app does.
 */
export async function runSolution(world: World, source: string, opts: number | RunOptions = 240): Promise<SolutionRun> {
  const o: RunOptions = typeof opts === "number" ? { maxSimSeconds: opts } : opts;
  const script = o.script;
  const maxSimSeconds = o.maxSimSeconds ?? (script ? script.stopAt + 5 : 240);
  const sim = createSim(world);
  const log: string[] = [];
  const runner = createPythonRunner({
    controller: sim.controller,
    input: scriptedInput(script?.timeline ?? [], () => sim.state.time),
    onLine: () => {},
    onLog: (e) => { if (e.kind === "print") log.push(e.text); },
    onScreen: (op) => { if (op.kind === "print") log.push(op.text); },
  });
  let result: RunResult | null = null;
  runner.run(source).then((r) => { result = r; });
  const dt = 1 / 60;
  const maxSteps = Math.ceil(maxSimSeconds / dt);
  for (let i = 0; i < maxSteps && result === null; i++) {
    await tick();
    if (result !== null) break;
    if (script && sim.state.time >= script.stopAt - 1e-9) break;
    sim.step(dt);
  }
  if (result === null) runner.stop();
  if (script) {
    // like the app: wait for the run to wind up, then nothing keeps moving
    for (let i = 0; i < 200 && result === null; i++) await tick();
    sim.abort();
  }
  // let objects settle and end-state goals count (SETTLE_SECONDS in the engine)
  for (let i = 0; i < 40; i++) sim.step(dt);
  return { result, sim, log, simSeconds: sim.state.time };
}
