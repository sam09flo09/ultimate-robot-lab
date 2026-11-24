/**
 * Headless race run (tests and tools): the real sim + the real Python runner, stepped in lock-step
 * exactly like the app does for race worlds. `dts` gives the sequence of frame times (already
 * multiplied by the speed) and is repeated as needed. Not imported by the app.
 */
import type { World, Sim } from "../core/types";
import type { RunResult } from "../core/modules";
import { createSim } from "../sim";
import { createPythonRunner } from "../runtime";
import { createRaceTracker, getRace, type RaceTracker } from "./race";
import { createLockstep, macrotask, trackController } from "./lockstep";

export interface RaceRun {
  finishTime: number | null;
  result: RunResult | null;
  sim: Sim;
  tracker: RaceTracker;
  substeps: number;
}

export async function runRace(world: World, source: string, dts: number[] = [1 / 60], maxSimSeconds = 300): Promise<RaceRun> {
  const info = getRace(world);
  if (!info) throw new Error(`${world.id} is not a race world`);
  const sim = createSim(world);
  const tracked = trackController(sim.controller);
  const tracker = createRaceTracker(world, info);
  tracker.reset(sim.state);
  const runner = createPythonRunner({ controller: tracked.controller, onLine: () => {}, onLog: () => {}, onScreen: () => {} });
  let result: RunResult | null = null;
  let substeps = 0;
  const lock = createLockstep({
    step: () => {
      sim.step(1 / 120);
      substeps++;
      if (tracker.update(sim.state)) { runner.stop(); sim.abort(); }
    },
    canAdvance: () => result !== null || tracked.pending() > 0 || !sim.controller.isDone(),
    yieldTask: macrotask,
    idleWait: macrotask,
    idleCapMs: 2000,
    maxBacklog: 10,
  });
  runner.run(source).then((r) => { result = r; });
  let i = 0;
  while (!tracker.finished && result === null && sim.state.time < maxSimSeconds) {
    lock.advance(dts[i++ % dts.length]);
    await lock.drain();
  }
  lock.cancel();
  if (result === null) runner.stop();
  return { finishTime: tracker.finishTime, result, sim, tracker, substeps };
}
