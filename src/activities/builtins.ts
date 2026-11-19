/** The built-in activity list (content lives in ./content, written separately). */
import type { Activity } from "../core/activity";
import { BUILT_IN_ACTIVITIES } from "./content";

export const BUILT_INS: Activity[] = BUILT_IN_ACTIVITIES;

export function getBuiltIn(id: string): Activity | undefined {
  return BUILT_INS.find((a) => a.id === id);
}
