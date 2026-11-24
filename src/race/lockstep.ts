/**
 * Lock-step stepping for races: makes the finish time independent of the speed buttons and the
 * frame rate.
 *
 * Normally the app calls sim.step(realDt * speed): several 1/120 s substeps run in one call, and
 * when a drive_for ends in the middle of them, the student's next command only starts after the
 * call returns — so the idle gap (and the finish time) depends on dt. Here the app hands us a
 * time budget instead, and we run ONE substep at a time, letting the Python program react
 * (a task turn) between substeps. And while the program is busy computing (not waiting on the
 * robot), sim time does not pass at all — just like on a real robot whose code is fast.
 * The result: the same program gives the same finish time at 0.5x, 1x or 2.5x.
 *
 * Caveat: programs that busy-poll sensors while the robot drives continuously (drive() + a loop
 * with no waits) still depend on how fast Python runs; motion-command programs are exact.
 */
import type { RobotController, Sim } from "../core/types";
import { SUBSTEP } from "../sim";

const PROMISE_METHODS = new Set(["driveFor", "turnFor", "turnToHeading", "wait"]);

export interface TrackedController {
  controller: RobotController;
  /** Number of controller promises still pending (Python is waiting on the robot). */
  pending(): number;
}

/** Wrap a controller to count the motion/wait promises the program is waiting on. */
export function trackController(c: RobotController): TrackedController {
  let pending = 0;
  const dec = () => { pending--; };
  const cache = new Map<PropertyKey, unknown>();
  const controller = new Proxy(c, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      let f = cache.get(prop);
      if (!f) {
        f = PROMISE_METHODS.has(String(prop))
          ? (...args: unknown[]) => {
              const p = (v as (...a: unknown[]) => Promise<void>).apply(target, args);
              pending++;
              p.then(dec, dec);
              return p;
            }
          : (v as (...a: unknown[]) => unknown).bind(target);
        cache.set(prop, f);
      }
      return f;
    },
  });
  return { controller, pending: () => pending };
}

/** A task turn: lets promise chains and posted work (Python continuing) run. */
export function macrotask(): Promise<void> {
  const g = globalThis as { setImmediate?: (f: () => void) => void };
  if (typeof g.setImmediate === "function") return new Promise((r) => g.setImmediate!(r));
  if (typeof MessageChannel !== "undefined") {
    return new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((r) => setTimeout(r, 0));
}

export interface LockstepOptions {
  /** Run exactly one substep (sim.step(SUBSTEP)) and look at the result. */
  step: () => void;
  /** May sim time pass now? (the program is waiting on the robot, the robot is moving, or the program ended) */
  canAdvance: () => boolean;
  /** Turn given to the program between substeps. */
  yieldTask?: () => Promise<void>;
  /** Wait used while the program is computing (must let setTimeout(0) work run). */
  idleWait?: () => Promise<void>;
  /** After this much wall time of the program computing without touching the robot, let time pass anyway. */
  idleCapMs?: number;
  /** Most sim seconds of backlog kept when we fall behind (the rest is dropped, not run faster). */
  maxBacklog?: number;
  now?: () => number;
}

export interface Lockstep {
  /** Add sim time to run (realDt * speed). */
  advance(dt: number): void;
  /** Drop the backlog and stop after the current substep. */
  cancel(): void;
  /** Resolves when the current pump has run out of budget (or was cancelled). */
  drain(): Promise<void>;
  readonly busy: boolean;
}

export function createLockstep(o: LockstepOptions): Lockstep {
  const yieldTask = o.yieldTask ?? macrotask;
  const idleWait = o.idleWait ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const idleCapMs = o.idleCapMs ?? 60;
  const maxBacklog = o.maxBacklog ?? 0.25;
  const now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  let budget = 0;
  let gen = 0;
  let current: Promise<void> | null = null;

  async function pump(g: number): Promise<void> {
    let idleSince = -1;
    while (g === gen && budget >= SUBSTEP - 1e-9) {
      if (!o.canAdvance()) {
        const t = now();
        if (idleSince < 0) idleSince = t;
        if (t - idleSince < idleCapMs) { await idleWait(); continue; }
      }
      idleSince = -1;
      budget -= SUBSTEP;
      o.step();
      await yieldTask();
    }
  }

  function start(): void {
    if (current) return;
    const g = gen;
    current = pump(g).finally(() => { current = null; if (g === gen && budget >= SUBSTEP - 1e-9) start(); });
  }

  return {
    advance(dt) {
      if (!(dt > 0)) return;
      budget = Math.min(maxBacklog, budget + dt);
      start();
    },
    cancel() { gen++; budget = 0; },
    async drain() { while (current) await current; },
    get busy() { return current !== null; },
  };
}

/** Convenience for headless runs/tests: lock-step a sim with a tracked controller. */
export function simStepper(sim: Sim, after: () => void = () => {}): () => void {
  return () => { sim.step(SUBSTEP); after(); };
}
