/** Goal checking with student-readable explanations. */
import type { ColorName, Goal, GoalResult, SimState, World, Zone } from "../core/types";
import { pointInZone } from "./geometry";

export interface GoalContext {
  world: World;
  state: SimState;
  /** Every zone entry in order (not just first entries) — used by visitInOrder. */
  zoneEntries: readonly string[];
  /** Sim time at which the robot last finished doing something (motion or wait). */
  activeTime: number;
}

/** Goals that describe how the run ENDS (they pass trivially before the robot does anything). */
export function isEndStateGoal(g: Goal): boolean {
  return g.type === "noWallHits" || g.type === "endFacing" || g.type === "maxTime";
}

export function zoneName(z: Zone | undefined, id: string): string {
  const label = (z && z.label && z.label.trim()) || id;
  return /zone$/i.test(label) ? `the ${label}` : `the ${label} zone`;
}

function fmtDeg(d: number): string {
  const r = Math.round(d * 10) / 10;
  return `${r === 360 ? 0 : r}°`;
}

function fmtSec(s: number): string {
  return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function evaluateGoals(ctx: GoalContext): GoalResult[] {
  const { world, state } = ctx;
  const zones = new Map<string, Zone>();
  for (const z of world.zones) zones.set(z.id, z);
  const out: GoalResult[] = [];

  for (const goal of world.goals) {
    let passed = false;
    let detail = "";
    switch (goal.type) {
      case "reachZone": {
        const z = zones.get(goal.zone);
        if (!z) { detail = `Zone "${goal.zone}" is missing from this level`; break; }
        passed = state.visitedZones.includes(goal.zone);
        detail = passed ? `The robot reached ${zoneName(z, goal.zone)}` : `Drive the robot into ${zoneName(z, goal.zone)}`;
        break;
      }
      case "objectsInZone": {
        const z = zones.get(goal.zone);
        if (!z) { detail = `Zone "${goal.zone}" is missing from this level`; break; }
        let n = 0, disks = 0, boxes = 0;
        for (const o of state.objects) {
          if (goal.color && o.color !== goal.color) continue;
          if (o.shape === "disk") disks++; else boxes++;
          if (o.id !== state.carrying && pointInZone(z, o.x, o.y)) n++;
        }
        const need = Math.max(0, goal.count);
        passed = n >= need;
        const noun = boxes === 0 && disks > 0 ? plural(need, "disk", "disks")
          : disks === 0 && boxes > 0 ? plural(need, "box", "boxes")
          : plural(need, "object", "objects");
        const colour = goal.color ? colorWord(goal.color) + " " : "";
        const shown = Math.min(n, need);
        detail = `${shown} of ${need} ${colour}${noun} ${shown === 1 ? "is" : "are"} in ${zoneName(z, goal.zone)}`;
        break;
      }
      case "visitInOrder": {
        const list = goal.zones;
        let k = 0;
        for (let i = 0; i < ctx.zoneEntries.length && k < list.length; i++) {
          if (ctx.zoneEntries[i] === list[k]) k++;
        }
        passed = k === list.length;
        if (passed) detail = `Visited all ${list.length} ${plural(list.length, "zone", "zones")} in order`;
        else {
          const next = list[k];
          detail = `Visited ${k} of ${list.length} zones in order — next: ${zoneName(zones.get(next), next)}`;
        }
        break;
      }
      case "noWallHits": {
        const h = state.wallHits;
        passed = h === 0;
        detail = passed ? "No wall hits so far" : `The robot hit a wall ${h} ${plural(h, "time", "times")}`;
        break;
      }
      case "endFacing": {
        const tol = goal.tolerance ?? 5;
        const want = ((goal.heading % 360) + 360) % 360;
        const have = state.robot.heading;
        let diff = Math.abs(have - want) % 360;
        if (diff > 180) diff = 360 - diff;
        passed = diff <= tol + 1e-9;
        detail = passed ? `The robot is facing ${fmtDeg(want)}` : `The robot is facing ${fmtDeg(have)} but should face ${fmtDeg(want)}`;
        break;
      }
      case "maxTime": {
        const t = ctx.activeTime;
        passed = t <= goal.seconds + 1e-9;
        detail = passed ? `Time used: ${fmtSec(t)} of ${fmtSec(goal.seconds)}` : `Took ${fmtSec(t)} — the limit is ${fmtSec(goal.seconds)}`;
        break;
      }
      default: {
        const g = goal as { type: string };
        detail = `Unknown goal type "${g.type}"`;
      }
    }
    out.push({ goal, passed, detail });
  }
  return out;
}

function colorWord(c: ColorName): string {
  return c.toLowerCase();
}
