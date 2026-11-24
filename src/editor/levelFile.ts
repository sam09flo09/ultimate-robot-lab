/**
 * `.robolab-level` files: serialise, parse and sanitise.
 *
 * Files come from students and teachers via Google Drive, so NOTHING in them is trusted:
 * every field is type-checked, clamped and whitelisted, unknown keys are dropped, sizes are capped,
 * and anything unusable is replaced by a safe default (with a warning) rather than crashing.
 * Pure functions, no DOM.
 */
import type { ColorName, FloorShape, Goal, Platform, Pose, Vec, Wall, World, WorldObject, Zone } from "../core/types";
import type { LevelFile } from "../core/modules";
import { COLOR_HEX } from "../core/types";
import { ID_PREFIX, ID_RE, nextId } from "./ids";

export const LEVEL_FORMAT = "robot-lab-level";
export const LEVEL_EXTENSION = ".robolab-level";

export const LIMITS = {
  fileChars: 5_000_000,
  walls: 1000,
  floor: 1000,
  objects: 300,
  zones: 100,
  goals: 50,
  linePoints: 2000,
  visitZones: 50,
  name: 80,
  description: 2000,
  label: 40,
  goalDescription: 200,
  python: 50_000,
  coord: 20_000, // |x|,|y| clamp, mm
  fieldMin: 500,
  fieldMax: 10_000,
  // arm
  platforms: 50,
  platformHeightMin: 50,
  platformHeightMax: 300,
  objectZMax: 1000,
  stackCount: 20,
} as const;

export const SIZE_PRESETS: { w: number; h: number; label: string }[] = [
  { w: 2000, h: 2000, label: "2000 × 2000 (square)" },
  { w: 2400, h: 1200, label: "2400 × 1200 (wide)" },
  { w: 3000, h: 3000, label: "3000 × 3000 (large)" },
];

export const COLOR_NAMES = Object.keys(COLOR_HEX) as ColorName[];

/** A fresh, empty, valid world. */
export function newBlankWorld(): World {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: "My challenge",
    description: "",
    width: 2000,
    height: 2000,
    background: "grid",
    gridSize: 200,
    start: { x: 0, y: -700, heading: 0 },
    walls: [],
    floor: [],
    objects: [],
    zones: [],
    goals: [],
    hardware: { pen: false, magnet: false },
    starter: { python: "" },
    version: 1,
  };
}

/** Wrap a world for sharing. The world is deep-copied and sanitised so the file is always valid. */
export function toLevelFile(world: World): LevelFile {
  const r = sanitizeWorld(JSON.parse(JSON.stringify(world)));
  return { format: LEVEL_FORMAT, version: 1, world: r.world };
}

/** Pretty JSON text of a level file, ready to save. */
export function levelFileText(world: World): string {
  return JSON.stringify(toLevelFile(world), null, 2);
}

export type ParseResult = { ok: true; world: World; warnings: string[] } | { ok: false; error: string };

/** Parse the text of a `.robolab-level` file (also accepts a `.robolab` project with a custom world, or a bare world). */
export function parseLevelFile(text: string): ParseResult {
  if (typeof text !== "string") return { ok: false, error: "The file could not be read." };
  if (text.length > LIMITS.fileChars) return { ok: false, error: "This file is too big to be a Robot Lab level." };
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "This file isn't a Robot Lab level (it isn't valid JSON)." };
  }
  if (!isObj(data)) return { ok: false, error: "This file isn't a Robot Lab level." };

  const warnings: string[] = [];
  let rawWorld: unknown;
  if (data.format === LEVEL_FORMAT) {
    const v = data.version;
    if (v !== undefined && v !== 1) {
      if (typeof v === "number" && v > 1)
        return { ok: false, error: "This level was made with a newer version of Robot Lab. Please update the app." };
      return { ok: false, error: "This level file has an unknown version." };
    }
    rawWorld = data.world;
  } else if (data.format === "robot-lab-project") {
    if (!isObj(data.customWorld)) return { ok: false, error: "This is a Robot Lab project, but it has no custom level inside." };
    rawWorld = data.customWorld;
    warnings.push("Loaded the custom level from a Robot Lab project file.");
  } else if (data.format === undefined && ("walls" in data || "width" in data) && "start" in data) {
    rawWorld = data;
    warnings.push("Loaded a bare world (no level-file header).");
  } else {
    return { ok: false, error: "This file isn't a Robot Lab level." };
  }
  if (!isObj(rawWorld)) return { ok: false, error: "This level file has no world inside." };
  if (rawWorld.version !== undefined && rawWorld.version !== 1) {
    if (typeof rawWorld.version === "number" && rawWorld.version > 1)
      return { ok: false, error: "This level was made with a newer version of Robot Lab. Please update the app." };
    return { ok: false, error: "This level file has an unknown world version." };
  }
  const r = sanitizeWorld(rawWorld);
  return { ok: true, world: r.world, warnings: warnings.concat(r.warnings) };
}

// ------------------------------------------------------------------ sanitiser

/** Build a valid World from untrusted data. Never throws. */
export function sanitizeWorld(raw: unknown): { world: World; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (warnings.length < 50 && !warnings.includes(m)) warnings.push(m);
  };
  const src: Record<string, unknown> = isObj(raw) ? raw : {};
  const base = newBlankWorld();

  const width = clampNum(src.width, LIMITS.fieldMin, LIMITS.fieldMax, base.width, true);
  const height = clampNum(src.height, LIMITS.fieldMin, LIMITS.fieldMax, base.height, true);
  const used = new Set<string>();

  // walls
  const walls: Wall[] = [];
  for (const w of list(src.walls, LIMITS.walls, "walls", warn)) {
    if (!isObj(w)) continue;
    const a = vec(w.a), b = vec(w.b);
    if (!a || !b || (a.x === b.x && a.y === b.y)) {
      warn("Skipped a broken wall.");
      continue;
    }
    walls.push({ id: takeId(w.id, ID_PREFIX.wall, used), a, b, thickness: clampNum(w.thickness, 1, 500, 20) });
  }

  // floor paint
  const floor: FloorShape[] = [];
  for (const f of list(src.floor, LIMITS.floor, "floor shapes", warn)) {
    if (!isObj(f)) continue;
    const color = colorOf(f.color, "BLACK");
    if (f.kind === "rect") {
      const x = num(f.x), y = num(f.y), w = num(f.w), h = num(f.h);
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) { warn("Skipped a broken floor shape."); continue; }
      floor.push({ kind: "rect", id: takeId(f.id, ID_PREFIX.floor, used), x: coord(x), y: coord(y), w: size(w), h: size(h), color });
    } else if (f.kind === "circle") {
      const x = num(f.x), y = num(f.y), r = num(f.r);
      if (x === null || y === null || r === null || r <= 0) { warn("Skipped a broken floor shape."); continue; }
      floor.push({ kind: "circle", id: takeId(f.id, ID_PREFIX.floor, used), x: coord(x), y: coord(y), r: size(r), color });
    } else if (f.kind === "line") {
      const pts: Vec[] = [];
      if (Array.isArray(f.points)) {
        for (const p of f.points.slice(0, LIMITS.linePoints)) {
          const v = vec(p);
          if (v) pts.push(v);
        }
        if (f.points.length > LIMITS.linePoints) warn("A tape line had too many points; extra points were dropped.");
      }
      if (pts.length < 2) { warn("Skipped a broken tape line."); continue; }
      floor.push({ kind: "line", id: takeId(f.id, ID_PREFIX.floor, used), points: pts, width: clampNum(f.width, 1, 500, 25), color });
    } else warn("Skipped an unknown floor shape.");
  }

  // objects
  const objects: WorldObject[] = [];
  for (const o of list(src.objects, LIMITS.objects, "objects", warn)) {
    if (!isObj(o)) continue;
    const x = num(o.x), y = num(o.y);
    if (x === null || y === null) { warn("Skipped an object with no position."); continue; }
    const shape = o.shape === "box" ? "box" : "disk";
    const pickable = o.pickable === true;
    const obj: WorldObject = {
      id: takeId(o.id, ID_PREFIX.object, used),
      shape,
      x: coord(x),
      y: coord(y),
      size: clampNum(o.size, 10, 1000, 100),
      color: colorOf(o.color, "RED"),
      movable: pickable || o.movable !== false,
      pickable,
    };
    if (shape === "box") obj.rotation = normDeg(num(o.rotation) ?? 0);
    // arm: height above the floor and object height (optional)
    const oz = num(o.z);
    if (oz !== null && oz > 0) obj.z = Math.min(LIMITS.objectZMax, oz);
    const oh = num(o.height);
    if (oh !== null && oh > 0) obj.height = Math.min(1000, Math.max(5, oh));
    objects.push(obj);
  }

  // zones (remember raw-id -> final-id for goals)
  const zones: Zone[] = [];
  const zoneMap = new Map<string, string>();
  for (const z of list(src.zones, LIMITS.zones, "zones", warn)) {
    if (!isObj(z)) continue;
    const x = num(z.x), y = num(z.y);
    if (x === null || y === null) { warn("Skipped a zone with no position."); continue; }
    const label = text(z.label, LIMITS.label);
    let zone: Zone;
    const id = takeId(z.id, ID_PREFIX.zone, used);
    if (z.kind === "circle") {
      const r = num(z.r);
      if (r === null || r <= 0) { warn("Skipped a broken zone."); used.delete(id); continue; }
      zone = { id, kind: "circle", x: coord(x), y: coord(y), r: size(r) };
    } else {
      const w = num(z.w), h = num(z.h);
      if (w === null || h === null || w <= 0 || h <= 0) { warn("Skipped a broken zone."); used.delete(id); continue; }
      zone = { id, kind: "rect", x: coord(x), y: coord(y), w: size(w), h: size(h) };
    }
    if (label) zone.label = label;
    zones.push(zone);
    if (typeof z.id === "string" && !zoneMap.has(z.id)) zoneMap.set(z.id, id);
  }
  const zoneRef = (v: unknown): string | null => (typeof v === "string" && zoneMap.has(v) ? zoneMap.get(v)! : null);

  // arm: platforms (raised blocks); raw-id -> final-id for goals
  const platforms: Platform[] = [];
  const platMap = new Map<string, string>();
  for (const p of list(src.platforms, LIMITS.platforms, "platforms", warn)) {
    if (!isObj(p)) continue;
    const x = num(p.x), y = num(p.y), w = num(p.w), h = num(p.h);
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) { warn("Skipped a broken platform."); continue; }
    const id = takeId(p.id, ID_PREFIX.platform, used);
    const plat: Platform = {
      id, x: coord(x), y: coord(y), w: size(w), h: size(h),
      height: clampNum(p.height, LIMITS.platformHeightMin, LIMITS.platformHeightMax, 100),
    };
    if (isColor(p.color) && p.color !== "NONE") plat.color = p.color;
    platforms.push(plat);
    if (typeof p.id === "string" && !platMap.has(p.id)) platMap.set(p.id, id);
  }

  // goals
  const goals: Goal[] = [];
  for (const g of list(src.goals, LIMITS.goals, "goals", warn)) {
    if (!isObj(g)) continue;
    const description = text(g.description, LIMITS.goalDescription) || undefined;
    let goal: Goal | null = null;
    switch (g.type) {
      case "reachZone": {
        const zone = zoneRef(g.zone);
        if (zone) goal = { type: "reachZone", zone };
        break;
      }
      case "objectsInZone": {
        const zone = zoneRef(g.zone);
        if (zone) {
          goal = { type: "objectsInZone", zone, count: clampNum(g.count, 1, LIMITS.objects, 1, true) };
          if (typeof g.color === "string" && isColor(g.color) && g.color !== "NONE") goal.color = g.color;
        }
        break;
      }
      case "visitInOrder": {
        const zs = Array.isArray(g.zones)
          ? g.zones.slice(0, LIMITS.visitZones).map(zoneRef).filter((z): z is string => z !== null)
          : [];
        if (zs.length > 0) goal = { type: "visitInOrder", zones: zs };
        break;
      }
      case "noWallHits":
        goal = { type: "noWallHits" };
        break;
      case "endFacing": {
        goal = { type: "endFacing", heading: normDeg(num(g.heading) ?? 0) };
        if (g.tolerance !== undefined) goal.tolerance = clampNum(g.tolerance, 0, 180, 10);
        break;
      }
      case "maxTime":
        goal = { type: "maxTime", seconds: clampNum(g.seconds, 1, 3600, 60) };
        break;
      // arm
      case "objectsOnPlatform": {
        const platform = typeof g.platform === "string" ? platMap.get(g.platform) : undefined;
        if (platform) {
          goal = { type: "objectsOnPlatform", platform, count: clampNum(g.count, 1, LIMITS.objects, 1, true) };
          if (typeof g.color === "string" && isColor(g.color) && g.color !== "NONE") goal.color = g.color;
        } else { warn("Skipped a goal that pointed at a missing platform."); continue; }
        break;
      }
      case "stackHeight": {
        goal = { type: "stackHeight", count: clampNum(g.count, 2, LIMITS.stackCount, 2, true) };
        if (g.zone !== undefined && g.zone !== "") {
          const zone = zoneRef(g.zone);
          if (zone) goal.zone = zone; else { warn("Skipped a goal that pointed at a missing zone."); continue; }
        }
        break;
      }
      default:
        warn("Skipped a goal of an unknown type.");
        continue;
    }
    if (!goal) {
      warn("Skipped a goal that pointed at a missing zone.");
      continue;
    }
    if (description) goal.description = description;
    goals.push(goal);
  }

  // race (time trial) settings — optional; dropped if the finish zone is missing
  let race: World["race"];
  if (isObj(src.race)) {
    const finishZone = zoneRef(src.race.finishZone);
    if (finishZone) {
      race = { finishZone, laps: clampNum(src.race.laps, 1, 10, 1, true) };
      const par = num(src.race.par);
      if (par !== null && par > 0) race.par = Math.min(3600, Math.max(0.5, Math.round(par * 100) / 100));
    } else warn("The race settings pointed at a missing finish zone, so this level is not a race any more.");
  }

  // start pose: inside the field
  const s = isObj(src.start) ? src.start : {};
  const start: Pose = {
    x: clampNum(s.x, -width / 2, width / 2, 0),
    y: clampNum(s.y, -height / 2, height / 2, 0),
    heading: normDeg(num(s.heading) ?? 0),
  };
  if (!isObj(src.start)) warn("The level had no robot start; using the centre.");

  const bg = src.background;
  const hw = isObj(src.hardware) ? src.hardware : {};
  const starter = isObj(src.starter) ? src.starter : {};
  const idRaw = typeof src.id === "string" ? src.id.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, "") : "";

  const world: World = {
    id: idRaw || base.id,
    name: text(src.name, LIMITS.name) || "Untitled challenge",
    description: text(src.description, LIMITS.description, true),
    width,
    height,
    background: bg === "plain" || bg === "grid" || bg === "numberGrid" ? bg : "grid",
    gridSize: clampNum(src.gridSize, 25, 2000, 200),
    start,
    walls,
    floor,
    objects,
    zones,
    goals,
    hardware: { pen: hw.pen === true, magnet: hw.magnet === true },
    starter: { python: text(starter.python, LIMITS.python, true) },
    version: 1,
  };
  if (race) world.race = race; // race
  if (hw.arm === true) world.hardware!.arm = true; // arm
  if (platforms.length) world.platforms = platforms; // arm
  return { world, warnings };
}

// ------------------------------------------------------------------ small helpers

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function clampNum(v: unknown, min: number, max: number, dflt: number, round = false): number {
  const n = num(v);
  if (n === null) return dflt;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : c;
}
function coord(n: number): number {
  return Math.min(LIMITS.coord, Math.max(-LIMITS.coord, n));
}
function size(n: number): number {
  return Math.min(LIMITS.coord, Math.max(1, n));
}
function vec(v: unknown): Vec | null {
  if (!isObj(v)) return null;
  const x = num(v.x), y = num(v.y);
  return x === null || y === null ? null : { x: coord(x), y: coord(y) };
}
export function isColor(v: unknown): v is ColorName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COLOR_HEX, v);
}
function colorOf(v: unknown, dflt: ColorName): ColorName {
  return isColor(v) ? v : dflt;
}
export function normDeg(d: number): number {
  const r = ((d % 360) + 360) % 360;
  return r === 360 ? 0 : r;
}
/** Plain text: strip control characters (keep \n and \t when multiline), cap length. */
function text(v: unknown, max: number, multiline = false): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const re = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  let s = v.replace(/\r\n?/g, "\n").replace(re, "");
  if (!multiline) s = s.trim();
  return s.slice(0, max);
}
function list(v: unknown, max: number, what: string, warn: (m: string) => void): unknown[] {
  if (!Array.isArray(v)) return [];
  if (v.length > max) warn(`Too many ${what}; only the first ${max} were kept.`);
  return v.slice(0, max);
}
function takeId(v: unknown, prefix: string, used: Set<string>): string {
  if (typeof v === "string" && ID_RE.test(v) && !used.has(v)) {
    used.add(v);
    return v;
  }
  return nextId(used, prefix);
}
