/** Built-in playgrounds. Each world lives in its own file; this module only lists them. */
import type { World } from "../core/types";
import { numberGrid } from "./numberGrid";
import { corridorQuest } from "./corridorQuest";
import { tapeTrail } from "./tapeTrail";
import { colorDepot } from "./colorDepot";
import { sketchPad } from "./sketchPad";
import { ringSweep } from "./ringSweep";
// race worlds (time trials)
import { ovalSpeedway } from "./ovalSpeedway";
import { zigzagGates } from "./zigzagGates";
import { tapeDash } from "./tapeDash";

/** In menu order. The first one is the default playground. Treat these as read-only (deep-copy before editing). */
export const PLAYGROUNDS: World[] = [numberGrid, corridorQuest, tapeTrail, colorDepot, sketchPad, ringSweep, ovalSpeedway, zigzagGates, tapeDash];

/** The race (time-trial) playgrounds, also listed in PLAYGROUNDS. */
export const RACE_PLAYGROUNDS: World[] = [ovalSpeedway, zigzagGates, tapeDash];

export function getPlayground(id: string): World | undefined {
  return PLAYGROUNDS.find((w) => w.id === id);
}

export { ORIGINAL_TEMPLATE } from "./numberGrid";
