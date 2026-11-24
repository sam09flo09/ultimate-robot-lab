/**
 * Race / time-trial logic. Pure functions, no DOM.
 *
 * A race world has `world.race = { finishZone, par?, laps? }`. The checkpoints are the zones of the
 * world's first visitInOrder goal (minus the finish zone), in order. One lap = visit every checkpoint
 * in order, then ENTER the finish zone (edge-triggered: starting inside it does not count).
 * The finish time is the sim time of the substep in which the last lap ends.
 */
import type { Goal, SimState, World, Zone } from "../core/types";

export const MAX_LAPS = 10;

export interface RaceInfo {
  finishZone: string;
  par: number | null;
  laps: number;
  checkpoints: string[];
}

export type Medal = "gold" | "silver" | "bronze";

/** The race settings of a world, normalised; null when the world is not a (valid) race. */
export function getRace(world: World | null | undefined): RaceInfo | null {
  const r = world?.race;
  if (!r || typeof r.finishZone !== "string") return null;
  if (!world!.zones.some((z) => z.id === r.finishZone)) return null;
  const laps = Number.isFinite(r.laps) ? Math.max(1, Math.min(MAX_LAPS, Math.round(r.laps as number))) : 1;
  const par = typeof r.par === "number" && Number.isFinite(r.par) && r.par > 0 ? r.par : null;
  const order = world!.goals.find((g): g is Extract<Goal, { type: "visitInOrder" }> => g.type === "visitInOrder");
  const known = new Set(world!.zones.map((z) => z.id));
  const checkpoints = order ? order.zones.filter((z) => z !== r.finishZone && known.has(z)) : [];
  return { finishZone: r.finishZone, par, laps, checkpoints };
}

/** Goals a race implies: reaching the finish zone. Returns a copy of the goal list with it added if missing. */
export function withRaceGoals(world: World): Goal[] {
  const goals = world.goals.slice();
  const r = world.race;
  if (r && !goals.some((g) => g.type === "reachZone" && g.zone === r.finishZone)) {
    goals.push({ type: "reachZone", zone: r.finishZone });
  }
  return goals;
}

function inZone(z: Zone, x: number, y: number): boolean {
  if (z.kind === "rect") return Math.abs(x - z.x) <= z.w / 2 && Math.abs(y - z.y) <= z.h / 2;
  const dx = x - z.x, dy = y - z.y;
  return dx * dx + dy * dy <= z.r * z.r;
}

export interface RaceTracker {
  readonly info: RaceInfo;
  /** Laps completed so far. */
  readonly lap: number;
  /** Index into info.checkpoints of the next checkpoint this lap (== length: head for the finish). */
  readonly next: number;
  readonly finished: boolean;
  /** Sim time of the finish, or null. */
  readonly finishTime: number | null;
  /** Forget progress and take the robot's current position as the start. */
  reset(state: SimState): void;
  /** Look at the robot after a sim step. Returns true exactly once: on the step the race is finished. */
  update(state: SimState): boolean;
}

export function createRaceTracker(world: World, info: RaceInfo): RaceTracker {
  const zone = new Map(world.zones.map((z) => [z.id, z] as const));
  const finish = zone.get(info.finishZone)!;
  const cps = info.checkpoints.map((id) => zone.get(id)!);
  let lap = 0, next = 0, finishTime: number | null = null;
  let inFinish = false;
  let inCp: boolean[] = cps.map(() => false);

  const t: RaceTracker = {
    info,
    get lap() { return lap; },
    get next() { return next; },
    get finished() { return finishTime !== null; },
    get finishTime() { return finishTime; },
    reset(state) {
      lap = 0; next = 0; finishTime = null;
      const { x, y } = state.robot;
      inFinish = inZone(finish, x, y);
      inCp = cps.map((z) => inZone(z, x, y));
    },
    update(state) {
      if (finishTime !== null) return false;
      const { x, y } = state.robot;
      for (let i = 0; i < cps.length; i++) {
        const now = inZone(cps[i], x, y);
        if (now && !inCp[i] && i === next) next++;
        inCp[i] = now;
      }
      const f = inZone(finish, x, y);
      const entered = f && !inFinish;
      inFinish = f;
      if (entered && next >= cps.length) {
        lap++;
        next = 0;
        if (lap >= info.laps) { finishTime = state.time; return true; }
      }
      return false;
    },
  };
  return t;
}

/** Centiseconds, rounded — the unit every comparison and display uses. */
export function toCs(seconds: number): number {
  return Math.max(0, Math.round(seconds * 100));
}

/** "mm:ss.cc" */
export function formatRaceTime(seconds: number): string {
  const cs = toCs(Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Gold <= par, silver <= 1.25 x par, bronze otherwise. null without a par. */
export function medalFor(seconds: number, par: number | null | undefined): Medal | null {
  if (!(typeof par === "number" && par > 0)) return null;
  const t = toCs(seconds);
  if (t <= toCs(par)) return "gold";
  if (t <= Math.round(par * 125)) return "silver";
  return "bronze";
}

export const MEDAL_TEXT: Record<Medal, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
