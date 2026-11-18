/** Pure helpers to reorder goals and the zones of a visitInOrder goal (mutate in place). */
import type { World } from "../core/types";

/** Move arr[from] by `delta` places. Returns false (and leaves arr alone) if it can't move. */
export function moveInArray<T>(arr: T[], from: number, delta: number): boolean {
  const to = from + delta;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= arr.length || to < 0 || to >= arr.length || to === from) return false;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  return true;
}

export function moveGoal(w: World, index: number, delta: number): boolean {
  return moveInArray(w.goals, index, delta);
}

export function moveVisitZone(w: World, goalIndex: number, zoneIndex: number, delta: number): boolean {
  const g = w.goals[goalIndex];
  if (!g || g.type !== "visitInOrder") return false;
  return moveInArray(g.zones, zoneIndex, delta);
}
