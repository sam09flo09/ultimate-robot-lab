/**
 * Test-only helper: run a Python program on the real simulator with the real Python runner,
 * stepping the sim at 60 Hz in sim time. Used by content.test.ts to prove every step is completable.
 * Not imported by the app.
 */
import type { World, Sim } from "../../core/types";
import type { RunResult } from "../../core/modules";
import { createSim } from "../../sim";
import { createPythonRunner } from "../../runtime";

export interface SolutionRun {
  result: RunResult | null;   // null = did not finish within the cap
  sim: Sim;
  log: string[];              // print() output and brain.screen.print text
  simSeconds: number;
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

export async function runSolution(world: World, source: string, maxSimSeconds = 240): Promise<SolutionRun> {
  const sim = createSim(world);
  const log: string[] = [];
  const runner = createPythonRunner({
    controller: sim.controller,
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
    sim.step(dt);
  }
  if (result === null) runner.stop();
  // let objects settle and end-state goals count (SETTLE_SECONDS in the engine)
  for (let i = 0; i < 40; i++) sim.step(dt);
  return { result, sim, log, simSeconds: sim.state.time };
}
