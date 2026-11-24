/** Race playgrounds: well-formed, reachable, and their starters really finish (slowly) on the real sim. */
import { beforeAll, describe, expect, it } from "vitest";
import type { Vec, Wall, World } from "../core/types";
import { RACE_PLAYGROUNDS, PLAYGROUNDS } from "./index";
import { getRace, medalFor } from "../race/race";
import { runRace } from "../race/runRace";
import { loadSkulpt } from "../runtime/testkit";
import { sanitizeWorld } from "../editor/levelFile";

beforeAll(() => loadSkulpt());

const CLEAR = 75; // robot half-size + 5

function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Flood fill of robot-centre positions (20 mm grid) from the start, CLEAR mm from walls/border. */
function reachableSet(w: World) {
  const step = 20, nx = Math.floor(w.width / step) + 1, ny = Math.floor(w.height / step) + 1;
  const free = (i: number, j: number) => {
    const p = { x: -w.width / 2 + i * step, y: -w.height / 2 + j * step };
    if (Math.abs(p.x) > w.width / 2 - CLEAR || Math.abs(p.y) > w.height / 2 - CLEAR) return false;
    return w.walls.every((wall: Wall) => segDist(p, wall.a, wall.b) - wall.thickness / 2 >= CLEAR);
  };
  const seen = new Uint8Array(nx * ny);
  const si = Math.round((w.start.x + w.width / 2) / step), sj = Math.round((w.start.y + w.height / 2) / step);
  const st = [si, sj]; seen[sj * nx + si] = 1;
  while (st.length) {
    const j = st.pop()!, i = st.pop()!;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= nx || b >= ny || seen[b * nx + a] || !free(a, b)) continue;
      seen[b * nx + a] = 1; st.push(a, b);
    }
  }
  return (p: Vec) => seen[Math.round((p.y + w.height / 2) / step) * nx + Math.round((p.x + w.width / 2) / step)] === 1;
}

/** Minimum clear gap between any two walls that are not joined (any orientation, sampled). */
function minWallGap(w: World): number {
  let min = Infinity;
  for (const p of w.walls) for (const q of w.walls) {
    if (p === q) continue;
    const joined = [p.a, p.b].some((e) => [q.a, q.b].some((f) => Math.hypot(e.x - f.x, e.y - f.y) < 1));
    if (joined) continue; // walls joined at a corner form one obstacle
    for (let k = 0; k <= 20; k++) {
      const s = { x: p.a.x + ((p.b.x - p.a.x) * k) / 20, y: p.a.y + ((p.b.y - p.a.y) * k) / 20 };
      const d = segDist(s, q.a, q.b) - (p.thickness + q.thickness) / 2;
      if (d > 1) min = Math.min(min, d); // touching/joined walls (d <= 1) form one obstacle
    }
  }
  return min;
}

describe("race playgrounds", () => {
  it("there are 3 race worlds, all in PLAYGROUNDS, with original names", () => {
    expect(RACE_PLAYGROUNDS.length).toBe(3);
    for (const w of RACE_PLAYGROUNDS) {
      expect(PLAYGROUNDS).toContain(w);
      expect(w.name).not.toMatch(/vex|castle crasher|wall maze|disk mover/i);
    }
  });

  for (const w of RACE_PLAYGROUNDS) {
    describe(w.id, () => {
      it("has a valid race: finish zone exists, par set, checkpoints from visitInOrder", () => {
        const r = getRace(w)!;
        expect(r).not.toBeNull();
        expect(w.zones.some((z) => z.id === r.finishZone)).toBe(true);
        expect(r.par).toBeGreaterThan(0);
        expect(r.checkpoints.length).toBeGreaterThanOrEqual(2);
        expect(w.goals.some((g) => g.type === "reachZone" && g.zone === r.finishZone)).toBe(true);
      });

      it("starts outside the finish zone", () => {
        const z = w.zones.find((q) => q.id === w.race!.finishZone)!;
        const inside = z.kind === "rect"
          ? Math.abs(w.start.x - z.x) <= z.w / 2 && Math.abs(w.start.y - z.y) <= z.h / 2
          : Math.hypot(w.start.x - z.x, w.start.y - z.y) <= z.r;
        expect(inside).toBe(false);
      });

      it("finish and every checkpoint are reachable by the robot", () => {
        const can = reachableSet(w);
        for (const z of w.zones) expect(can({ x: z.x, y: z.y }), z.id).toBe(true);
      });

      it("corridors between walls are at least 300 mm wide", () => {
        if (w.walls.length > 1) expect(minWallGap(w)).toBeGreaterThanOrEqual(300);
        for (const wall of w.walls) {
          // and against the border: a wall either touches it or leaves >= 300 mm
          for (const p of [wall.a, wall.b]) {
            const gx = w.width / 2 - Math.abs(p.x) - wall.thickness / 2, gy = w.height / 2 - Math.abs(p.y) - wall.thickness / 2;
            for (const g of [gx, gy]) if (g > 1) expect(g, wall.id).toBeGreaterThanOrEqual(300);
          }
        }
      });

      it("survives the level-file sanitiser (race kept)", () => {
        const s = sanitizeWorld(JSON.parse(JSON.stringify(w))).world;
        expect(s.race).toEqual({ finishZone: w.race!.finishZone, par: w.race!.par, laps: w.race!.laps ?? 1 });
      });

      it("the starter finishes the race, slower than par (room to optimise), same time at any speed/frame rate", async () => {
        const src = w.starter!.python!;
        const a = await runRace(w, src, [1 / 60]);                                   // 1x at 60 fps
        expect(a.finishTime, "starter should finish").not.toBeNull();
        expect(a.finishTime!).toBeGreaterThan(w.race!.par!);
        expect(medalFor(a.finishTime!, w.race!.par)).not.toBe("gold");
        const b = await runRace(w, src, [2.5 / 60]);                                 // 2.5x at 60 fps
        const c = await runRace(w, src, [0.013, 0.04, 0.007, 0.1, 0.021, 0.0333]);   // jittery frames
        const d = await runRace(w, src, [0.5 / 30]);                                 // 0.5x at 30 fps
        expect(b.finishTime).toBe(a.finishTime);
        expect(c.finishTime).toBe(a.finishTime);
        expect(d.finishTime).toBe(a.finishTime);
      }, 120_000);
    });
  }
});
