import { describe, expect, it } from "vitest";
import type { SimState, World } from "../core/types";
import { createRaceTracker, formatRaceTime, getRace, medalFor, withRaceGoals, toCs } from "./race";

function world(over: Partial<World> = {}): World {
  return {
    id: "t", name: "T", width: 2000, height: 2000, start: { x: 0, y: -800, heading: 0 },
    walls: [], floor: [], objects: [],
    zones: [
      { id: "a", kind: "circle", x: -500, y: 0, r: 100 },
      { id: "b", kind: "circle", x: 500, y: 0, r: 100 },
      { id: "fin", kind: "rect", x: 0, y: -800, w: 400, h: 100 },
    ],
    goals: [{ type: "visitInOrder", zones: ["a", "b", "fin"] }],
    race: { finishZone: "fin" },
    version: 1,
    ...over,
  };
}

function st(x: number, y: number, time: number): SimState {
  return { time, robot: { x, y, heading: 0 } } as SimState;
}

/** Feed a list of [x, y] positions, one per 0.1 s; returns the finish time. */
function drive(w: World, pts: [number, number][]): { time: number | null; laps: number } {
  const t = createRaceTracker(w, getRace(w)!);
  t.reset(st(w.start.x, w.start.y, 0));
  let n = 0;
  for (const [x, y] of pts) { n++; if (t.update(st(x, y, n / 10))) break; }
  return { time: t.finishTime, laps: t.lap };
}

const A: [number, number] = [-500, 0], B: [number, number] = [500, 0], OUT: [number, number] = [0, 0], FIN: [number, number] = [0, -800];

describe("getRace", () => {
  it("normalises laps/par and takes checkpoints from visitInOrder minus the finish", () => {
    const r = getRace(world({ race: { finishZone: "fin", laps: 2.6, par: -3 } }))!;
    expect(r).toEqual({ finishZone: "fin", laps: 3, par: null, checkpoints: ["a", "b"] });
    expect(getRace(world({ race: { finishZone: "fin", laps: 99 } }))!.laps).toBe(10);
  });
  it("is null without race or with a missing finish zone", () => {
    expect(getRace(world({ race: undefined }))).toBeNull();
    expect(getRace(world({ race: { finishZone: "nope" } }))).toBeNull();
  });
  it("no visitInOrder goal = no checkpoints", () => {
    expect(getRace(world({ goals: [] }))!.checkpoints).toEqual([]);
  });
  it("withRaceGoals adds reachZone on the finish once", () => {
    const w = world();
    const g = withRaceGoals(w);
    expect(g).toContainEqual({ type: "reachZone", zone: "fin" });
    expect(withRaceGoals({ ...w, goals: g }).length).toBe(g.length);
  });
});

describe("race tracker", () => {
  it("finishes on entering the finish after the checkpoints in order", () => {
    expect(drive(world(), [OUT, A, OUT, B, OUT, FIN]).time).toBeCloseTo(0.6);
  });
  it("starting inside the finish does not count; leaving and re-entering early does not either", () => {
    expect(drive(world(), [FIN, OUT, FIN, OUT]).time).toBeNull();
  });
  it("checkpoints out of order do not count", () => {
    expect(drive(world(), [B, OUT, A, OUT, FIN]).time).toBeNull();
    // B then A then B: only A->B counts, so this does finish
    expect(drive(world(), [B, OUT, A, OUT, B, OUT, FIN]).time).toBeCloseTo(0.7);
  });
  it("staying inside a checkpoint counts once (edge-triggered)", () => {
    const r = drive(world({ race: { finishZone: "fin", laps: 2 } }), [A, A, A, B, FIN, OUT, FIN]);
    expect(r.time).toBeNull();
    expect(r.laps).toBe(1);
  });
  it("counts laps: each lap needs all checkpoints again", () => {
    const w = world({ race: { finishZone: "fin", laps: 2 } });
    const lap: [number, number][] = [OUT, A, OUT, B, OUT, FIN];
    const r = drive(w, [...lap, ...lap]);
    expect(r.laps).toBe(2);
    expect(r.time).toBeCloseTo(1.2);
  });
  it("without checkpoints, entering the finish is enough", () => {
    expect(drive(world({ goals: [] }), [OUT, FIN]).time).toBeCloseTo(0.2);
  });
  it("reports the finish exactly once", () => {
    const w = world({ goals: [] });
    const t = createRaceTracker(w, getRace(w)!);
    t.reset(st(0, 0, 0));
    expect(t.update(st(0, -800, 1))).toBe(true);
    expect(t.update(st(0, 0, 2))).toBe(false);
    expect(t.update(st(0, -800, 3))).toBe(false);
    expect(t.finishTime).toBe(1);
  });
});

describe("times and medals", () => {
  it("formats mm:ss.cc", () => {
    expect(formatRaceTime(0)).toBe("00:00.00");
    expect(formatRaceTime(12.4)).toBe("00:12.40");
    expect(formatRaceTime(51.49999999999772)).toBe("00:51.50");
    expect(formatRaceTime(61.005)).toBe("01:01.01");
    expect(formatRaceTime(NaN)).toBe("00:00.00");
    expect(toCs(-1)).toBe(0);
  });
  it("gold <= par, silver <= 1.25 par, bronze otherwise, none without par", () => {
    expect(medalFor(10, 10)).toBe("gold");
    expect(medalFor(10.004, 10)).toBe("gold"); // same on the clock
    expect(medalFor(10.01, 10)).toBe("silver");
    expect(medalFor(12.5, 10)).toBe("silver");
    expect(medalFor(12.51, 10)).toBe("bronze");
    expect(medalFor(99, 10)).toBe("bronze");
    expect(medalFor(5, null)).toBeNull();
    expect(medalFor(5, 0)).toBeNull();
  });
});
