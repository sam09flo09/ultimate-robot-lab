import { describe, expect, it } from "vitest";
import type { World } from "../core/types";
import { hashWorld, loadRecord, raceKey, recordRun, resetBest, stableStringify, RACE_STORE_KEY, HISTORY_LEN } from "./storage";
import { getPlayground } from "../worlds";

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const throwing = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceeded"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

describe("best-time storage", () => {
  it("records runs, keeps the best and the last 5", () => {
    const s = memStore();
    let r = recordRun("w:x", 12.4, 1, s);
    expect(r.newBest).toBe(true);
    expect(r.previousBest).toBeNull();
    r = recordRun("w:x", 13, 2, s);
    expect(r.newBest).toBe(false);
    r = recordRun("w:x", 11.2, 3, s);
    expect(r.newBest).toBe(true);
    expect(r.previousBest).toBe(12.4);
    for (let i = 0; i < 6; i++) recordRun("w:x", 20 + i, 10 + i, s);
    const rec = loadRecord("w:x", s);
    expect(rec.best).toBe(11.2);
    expect(rec.runs.length).toBe(HISTORY_LEN);
    expect(rec.runs[HISTORY_LEN - 1]).toEqual({ t: 25, at: 15 });
    expect(loadRecord("w:other", s)).toEqual({ best: null, runs: [] });
  });

  it("a tie on the clock (same centiseconds) is not a new best", () => {
    const s = memStore();
    recordRun("k", 10.001, 1, s);
    expect(recordRun("k", 10.004, 2, s).newBest).toBe(false);
    expect(recordRun("k", 9.99, 3, s).newBest).toBe(true);
  });

  it("reset clears one world or all", () => {
    const s = memStore();
    recordRun("a", 5, 1, s); recordRun("b", 6, 1, s);
    resetBest("a", s);
    expect(loadRecord("a", s).best).toBeNull();
    expect(loadRecord("b", s).best).toBe(6);
    resetBest(undefined, s);
    expect(s.m.has(RACE_STORE_KEY)).toBe(false);
  });

  it("never throws when localStorage throws (or is missing)", () => {
    expect(() => loadRecord("a", throwing)).not.toThrow();
    expect(loadRecord("a", throwing)).toEqual({ best: null, runs: [] });
    const r = recordRun("a", 5, 1, throwing);
    expect(r.saved).toBe(false);
    expect(r.newBest).toBe(true);
    expect(resetBest("a", throwing)).toBe(false);
    expect(resetBest(undefined, throwing)).toBe(false);
    expect(loadRecord("a", null).best).toBeNull();
    expect(recordRun("a", 5, 1, null).saved).toBe(false);
  });

  it("ignores junk in storage", () => {
    const s = memStore();
    s.setItem(RACE_STORE_KEY, "not json");
    expect(loadRecord("a", s).best).toBeNull();
    s.setItem(RACE_STORE_KEY, JSON.stringify({ a: { best: "fast", runs: [{ t: -1, at: 1 }, { t: 3, at: 2 }, null] } }));
    expect(loadRecord("a", s)).toEqual({ best: null, runs: [{ t: 3, at: 2 }] });
    expect(recordRun("a", 4, 5, s).newBest).toBe(true);
  });
});

describe("world keys", () => {
  const base = getPlayground("zigzag-gates")!;
  const copy = (): World => JSON.parse(JSON.stringify(base));

  it("built-ins are keyed by id, custom worlds by a course hash", () => {
    expect(raceKey(base, base.id)).toBe("w:zigzag-gates");
    expect(raceKey(base, "custom")).toMatch(/^c:[0-9a-z]+$/);
  });

  it("the hash is stable: key order, name, text, starter, id and par don't matter", () => {
    const a = copy();
    const b = copy();
    b.name = "Renamed"; b.description = "x"; b.starter = { python: "pass" }; b.id = "custom"; b.race = { ...b.race!, par: 99 };
    // reorder keys
    const c = Object.fromEntries(Object.entries(copy()).reverse()) as unknown as World;
    expect(hashWorld(b)).toBe(hashWorld(a));
    expect(hashWorld(c)).toBe(hashWorld(a));
    expect(hashWorld(a)).toBe(hashWorld(base)); // same across calls
  });

  it("the hash changes when the course changes", () => {
    const a = copy();
    const moved = copy(); moved.walls[0].a.x += 10;
    const laps = copy(); laps.race = { ...laps.race!, laps: 2 };
    const start = copy(); start.start.heading = 0;
    expect(hashWorld(moved)).not.toBe(hashWorld(a));
    expect(hashWorld(laps)).not.toBe(hashWorld(a));
    expect(hashWorld(start)).not.toBe(hashWorld(a));
  });

  it("stableStringify sorts keys and drops undefined", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });
});

// builder: best times are kept per world + robot design
describe("best times per robot design", () => {
  it("default robot keeps the old key; other designs get their own; history stores the design", async () => {
    const { DEFAULT_ROBOT } = await import("../core/types");
    const w = getPlayground("gear-lab")!;
    expect(raceKey(w, "gear-lab", DEFAULT_ROBOT)).toBe("w:gear-lab");
    const geared = { ...DEFAULT_ROBOT, gearRatio: 0.5 };
    const k = raceKey(w, "gear-lab", geared);
    expect(k).toBe("w:gear-lab|s140w100g1-2m2");
    expect(raceKey(w, "gear-lab", { ...geared, sensorOffset: 20 })).toBe(k); // sensors don't change the race
    const s = memStore();
    recordRun(k, 2.1, 1, s, "140mm · gear 1:2");
    recordRun("w:gear-lab", 3.1, 2, s);
    expect(loadRecord(k, s)).toEqual({ best: 2.1, runs: [{ t: 2.1, at: 1, robot: "140mm · gear 1:2" }] });
    expect(loadRecord("w:gear-lab", s).best).toBe(3.1);
  });
});
