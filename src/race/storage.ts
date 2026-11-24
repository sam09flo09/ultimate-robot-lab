/**
 * Best race times + the last few runs, per world, in localStorage. Never throws: storage may be
 * missing, full, blocked or hold junk (it is per-browser and students can edit it).
 * Built-in worlds are keyed by id; custom worlds by a stable hash of the course.
 */
import type { RobotConfig, World } from "../core/types";
import { configKey, isDefaultConfig } from "../sim/robotConfig"; // builder

export const RACE_STORE_KEY = "robot-lab-race-v1";
export const HISTORY_LEN = 5;
const MAX_WORLDS = 200;

export interface RunEntry { t: number; at: number; robot?: string } // time (sim s), date (ms since epoch), builder: robot design summary
export interface RaceRecord { best: number | null; runs: RunEntry[] }
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Db = Record<string, RaceRecord & { touched: number }>;

function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** JSON with object keys sorted, so equal worlds always give equal text. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/** cyrb53: small, fast, well-mixed 53-bit string hash. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Hash of the course: everything that changes the race, not its name, text, starter code, id or par. */
export function hashWorld(w: World): string {
  const course = {
    width: w.width, height: w.height, start: w.start, walls: w.walls, floor: w.floor, objects: w.objects,
    zones: w.zones, goals: w.goals, hardware: w.hardware ?? {},
    race: w.race ? { finishZone: w.race.finishZone, laps: w.race.laps ?? 1 } : null,
  };
  return hash53(stableStringify(course));
}

/** Storage key for a world: built-ins by id, custom worlds (id "custom") by course hash. */
export function raceKey(world: World, worldId: string, robot?: RobotConfig): string {
  const base = worldId === "custom" || !worldId ? "c:" + hashWorld(world) : "w:" + worldId;
  // builder: a non-default robot design keeps its own best time (the default keeps the old key)
  return robot && !isDefaultConfig(robot) ? base + "|" + configKey(robot) : base;
}

function goodTime(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e6;
}

function readDb(store: Store | null): Db {
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(RACE_STORE_KEY) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Db = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const runs = Array.isArray(r.runs)
        ? r.runs.filter((e): e is RunEntry => !!e && goodTime((e as RunEntry).t) && typeof (e as RunEntry).at === "number").slice(-HISTORY_LEN)
          .map((e) => (typeof e.robot === "string" ? { t: e.t, at: e.at, robot: e.robot.slice(0, 80) } : { t: e.t, at: e.at }))
        : [];
      out[k] = { best: goodTime(r.best) ? r.best : null, runs, touched: typeof r.touched === "number" ? r.touched : 0 };
    }
    return out;
  } catch { return {}; }
}

function writeDb(store: Store | null, db: Db): boolean {
  if (!store) return false;
  const keys = Object.keys(db);
  if (keys.length > MAX_WORLDS) {
    keys.sort((a, b) => db[a].touched - db[b].touched);
    for (const k of keys.slice(0, keys.length - MAX_WORLDS)) delete db[k];
  }
  try { store.setItem(RACE_STORE_KEY, JSON.stringify(db)); return true; } catch { return false; }
}

export function loadRecord(key: string, store: Store | null = defaultStore()): RaceRecord {
  const r = readDb(store)[key];
  return r ? { best: r.best, runs: r.runs } : { best: null, runs: [] };
}

export interface RecordResult { record: RaceRecord; newBest: boolean; previousBest: number | null; saved: boolean }

/** Add a finished run. "New best" compares in centiseconds (what the clock shows). */
export function recordRun(key: string, time: number, now = Date.now(), store: Store | null = defaultStore(), robot?: string): RecordResult {
  const db = readDb(store);
  const cur = db[key] ?? { best: null, runs: [], touched: 0 };
  const previousBest = cur.best;
  const newBest = goodTime(time) && (previousBest === null || Math.round(time * 100) < Math.round(previousBest * 100));
  if (goodTime(time)) {
    if (newBest) cur.best = time;
    cur.runs = cur.runs.concat(robot ? { t: time, at: now, robot } : { t: time, at: now }).slice(-HISTORY_LEN); // builder: robot
  }
  cur.touched = now;
  db[key] = cur;
  const saved = writeDb(store, db);
  return { record: { best: cur.best, runs: cur.runs }, newBest, previousBest, saved };
}

/** Forget best times and history: one world (key) or every world (no key). */
export function resetBest(key?: string, store: Store | null = defaultStore()): boolean {
  if (!store) return false;
  if (key === undefined) {
    try { store.removeItem(RACE_STORE_KEY); return true; } catch { return false; }
  }
  const db = readDb(store);
  delete db[key];
  return writeDb(store, db);
}
