/**
 * builder: robot designs (RobotConfig) — clamping to legal values, world.robotRules, and the
 * derived physics numbers. Pure functions; shared by the sim, the Robot Builder UI and races.
 *
 * Formulas (see DEFAULT_ROBOT in core/types.ts):
 *   speedScale   = (wheelDiameter / 100) ÷ gearRatio          (1 for the default robot)
 *   top speed    = 800 mm/s × speedScale  (drive at 100%)
 *   track width  = size − 20 mm
 *   turn speed   = 360 °/s × speedScale × (120 / track)       (turn at 100%)
 *   pushStrength = (motors / 2) × gearRatio × (100 / wheelDiameter)
 */
import { DEFAULT_ROBOT, type RobotConfig, type World } from "../core/types";

export const SIZE_MIN = 120;
export const SIZE_MAX = 200;
export const WHEEL_SIZES = [60, 80, 100, 130] as const;
export const GEAR_RATIOS = [3, 2, 1, 1 / 2, 1 / 3] as const; // torque → speed
const BASE_DRIVE = 800;
const BASE_TURN = 360;
const BASE_TRACK = 120;

function snap(v: number, choices: readonly number[], dflt: number): number {
  if (typeof v !== "number" || !isFinite(v)) return dflt;
  let best = choices[0];
  for (const c of choices) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
  return best;
}

function num(v: unknown, dflt: number): number {
  return typeof v === "number" && isFinite(v) ? v : dflt;
}

/** Clamp any (partial, possibly junk) config to a legal RobotConfig. */
export function clampConfig(c: Partial<RobotConfig> | null | undefined, maxSize = SIZE_MAX): RobotConfig {
  const src = (c && typeof c === "object" ? c : {}) as Partial<RobotConfig>;
  const cap = Math.max(SIZE_MIN, Math.min(SIZE_MAX, num(maxSize, SIZE_MAX)));
  const size = Math.round(Math.max(SIZE_MIN, Math.min(cap, num(src.size, DEFAULT_ROBOT.size))));
  const wheelDiameter = snap(num(src.wheelDiameter, DEFAULT_ROBOT.wheelDiameter), WHEEL_SIZES, DEFAULT_ROBOT.wheelDiameter);
  const gearRatio = snapGear(num(src.gearRatio, DEFAULT_ROBOT.gearRatio));
  const motors: 2 | 4 = src.motors === 4 ? 4 : 2;
  const lim = size / 2 - 10;
  const sensorOffset = Math.round(Math.max(-lim, Math.min(lim, num(src.sensorOffset, 0))));
  const out: RobotConfig = { size, wheelDiameter, gearRatio, motors, sensorOffset };
  if (typeof src.name === "string" && src.name.trim()) out.name = src.name.trim().slice(0, 40);
  return out;
}

/** Gear ratios are snapped on a log scale (so 0.4 → 1/2, 1.6 → 2). */
function snapGear(g: number): number {
  if (!(g > 0)) return 1;
  const lg = Math.log(g);
  let best: number = GEAR_RATIOS[0];
  for (const c of GEAR_RATIOS) if (Math.abs(Math.log(c) - lg) < Math.abs(Math.log(best) - lg)) best = c;
  return best;
}

/** The config the sim really uses in `world`: rules applied (locked → default + rules.config; maxSize caps size). */
export function effectiveConfig(world: World | null | undefined, config?: Partial<RobotConfig> | null): RobotConfig {
  const rules = world?.robotRules;
  const max = rules && typeof rules.maxSize === "number" ? rules.maxSize : SIZE_MAX;
  if (rules?.locked) return clampConfig({ ...DEFAULT_ROBOT, ...(rules.config ?? {}) }, max);
  return clampConfig(config ?? DEFAULT_ROBOT, max);
}

export function isLocked(world: World | null | undefined): boolean {
  return !!world?.robotRules?.locked;
}

export interface RobotStats {
  speedScale: number;   // × default wheel speed
  topSpeed: number;     // mm/s at 100% drive
  turnSpeed: number;    // °/s at 100% turn
  track: number;        // mm wheel to wheel
  pushStrength: number; // × default robot (objects heavier than this stall it)
  gap: number;          // narrowest gap it drives straight through (mm, with ~10 mm to spare)
}

export function robotStats(c: RobotConfig): RobotStats {
  const speedScale = (c.wheelDiameter / 100) / c.gearRatio;
  const track = c.size - 20;
  return {
    speedScale,
    topSpeed: BASE_DRIVE * speedScale,
    turnSpeed: BASE_TURN * speedScale * (BASE_TRACK / track),
    track,
    pushStrength: (c.motors / 2) * c.gearRatio * (100 / c.wheelDiameter),
    gap: c.size + 10,
  };
}

/** "3:1", "1:1", "1:2"… (torque : speed). */
export function gearLabel(g: number): string {
  if (g >= 1) return `${Math.round(g)}:1`;
  return `1:${Math.round(1 / g)}`;
}

export function sameConfig(a: RobotConfig, b: RobotConfig): boolean {
  return a.size === b.size && a.wheelDiameter === b.wheelDiameter && a.gearRatio === b.gearRatio &&
    a.motors === b.motors && a.sensorOffset === b.sensorOffset;
}

export function isDefaultConfig(c: RobotConfig): boolean { return sameConfig(c, DEFAULT_ROBOT); }

/** Short summary for race history / best-time keys, e.g. "140mm · 100mm wheels · 1:1 · 2 motors". */
export function configSummary(c: RobotConfig): string {
  return `${c.size}mm · ${c.wheelDiameter}mm wheels · gear ${gearLabel(c.gearRatio)} · ${c.motors} motors`;
}

/** Compact key for storage, e.g. "s140w100g1m2". Sensor offset doesn't change race physics. */
export function configKey(c: RobotConfig): string {
  return `s${c.size}w${c.wheelDiameter}g${gearLabel(c.gearRatio).replace(":", "-")}m${c.motors}`;
}
