import { describe, expect, it } from "vitest";
import type { Goal, Vec, Wall, World, Zone } from "../core/types";
import { COLOR_HEX } from "../core/types";
import { PLAYGROUNDS, getPlayground, ORIGINAL_TEMPLATE } from "./index";

const ROBOT = 140;
const HALF_DIAG = (ROBOT / 2) * Math.SQRT2; // ~99 mm: robot footprint radius at any heading

function segDist(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const wallClear = (p: Vec, w: Wall) => segDist(p, w.a, w.b) - w.thickness / 2;

function zoneBounds(z: Zone) {
  return z.kind === "rect"
    ? { x0: z.x - z.w / 2, x1: z.x + z.w / 2, y0: z.y - z.h / 2, y1: z.y + z.h / 2 }
    : { x0: z.x - z.r, x1: z.x + z.r, y0: z.y - z.r, y1: z.y + z.r };
}

function inField(w: World, x0: number, x1: number, y0: number, y1: number) {
  return x0 >= -w.width / 2 - 1e-6 && x1 <= w.width / 2 + 1e-6 && y0 >= -w.height / 2 - 1e-6 && y1 <= w.height / 2 + 1e-6;
}

function goalZones(g: Goal): string[] {
  if (g.type === "reachZone" || g.type === "objectsInZone") return [g.zone];
  if (g.type === "visitInOrder") return g.zones;
  if (g.type === "stackHeight" && g.zone) return [g.zone]; // arm
  return [];
}

/** Flood fill the robot centre over a 20 mm grid, keeping `clear` mm from walls and the border. */
function reachable(w: World, clear: number) {
  const step = 20;
  const nx = Math.floor(w.width / step) + 1;
  const ny = Math.floor(w.height / step) + 1;
  const cx = (i: number) => -w.width / 2 + i * step;
  const cy = (j: number) => -w.height / 2 + j * step;
  const free = (i: number, j: number) => {
    const p = { x: cx(i), y: cy(j) };
    if (Math.abs(p.x) > w.width / 2 - clear || Math.abs(p.y) > w.height / 2 - clear) return false;
    for (const wall of w.walls) if (wallClear(p, wall) < clear) return false;
    return true;
  };
  const seen = new Uint8Array(nx * ny);
  const si = Math.round((w.start.x + w.width / 2) / step);
  const sj = Math.round((w.start.y + w.height / 2) / step);
  const stack: number[] = [];
  if (free(si, sj)) { seen[sj * nx + si] = 1; stack.push(si, sj); }
  while (stack.length) {
    const j = stack.pop()!, i = stack.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || seen[b * nx + a]) continue;
      if (!free(a, b)) { seen[b * nx + a] = 2; continue; }
      seen[b * nx + a] = 1;
      stack.push(a, b);
    }
  }
  return (p: Vec) => {
    const i = Math.round((p.x + w.width / 2) / step), j = Math.round((p.y + w.height / 2) / step);
    // allow the nearest reachable cell within one robot radius (zone centres may sit by a wall)
    const r = Math.ceil(HALF_DIAG / step);
    for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) {
      if (a >= 0 && b >= 0 && a < nx && b < ny && seen[b * nx + a] === 1) return true;
    }
    return false;
  };
}

describe("PLAYGROUNDS", () => {
  it("has 10 playgrounds (6 + 3 races + Stack Shop) with unique ids and names", () => {
    expect(PLAYGROUNDS.length).toBe(10);
    expect(new Set(PLAYGROUNDS.map((w) => w.id)).size).toBe(PLAYGROUNDS.length);
    expect(new Set(PLAYGROUNDS.map((w) => w.name)).size).toBe(PLAYGROUNDS.length);
  });

  it("getPlayground finds each by id", () => {
    for (const w of PLAYGROUNDS) expect(getPlayground(w.id)).toBe(w);
    expect(getPlayground("nope")).toBeUndefined();
  });

  it("does not use other products' playground names", () => {
    const banned = /castle crasher|wall maze|disk mover|vex/i;
    for (const w of PLAYGROUNDS) {
      expect(w.name).not.toMatch(banned);
      expect(w.description ?? "").not.toMatch(banned);
    }
  });

  it("number-grid is exactly the original sim", () => {
    const w = getPlayground("number-grid")!;
    expect(w.width).toBe(2000);
    expect(w.height).toBe(2000);
    expect(w.background).toBe("numberGrid");
    expect(w.gridSize).toBe(200);
    expect(w.start).toEqual({ x: -900, y: -900, heading: 0 });
    expect(w.walls).toEqual([]);
    expect(w.objects).toEqual([]);
    expect(w.goals).toEqual([]);
    expect(w.hardware?.pen).toBe(true);
    expect(w.starter?.python).toBe(ORIGINAL_TEMPLATE);
    expect(ORIGINAL_TEMPLATE).toContain("start(main)");
  });

  for (const w of PLAYGROUNDS) {
    describe(w.id, () => {
      it("is a valid version-1 world", () => {
        expect(w.version).toBe(1);
        expect(w.id).toMatch(/^[a-z0-9-]+$/);
        expect(w.name.length).toBeGreaterThan(0);
        expect((w.description ?? "").length).toBeGreaterThan(20);
        expect(w.width).toBeGreaterThan(0);
        expect(w.height).toBeGreaterThan(0);
        expect(w.start.heading).toBeGreaterThanOrEqual(0);
        expect(w.start.heading).toBeLessThan(360);
        expect(w.starter?.python ?? "").toMatch(/start\(main\)\s*$/);
      });

      it("has unique ids for objects, zones, walls and floor shapes", () => {
        const ids = [
          ...w.objects.map((o) => o.id),
          ...w.zones.map((z) => z.id),
          ...w.walls.map((x) => x.id).filter(Boolean),
          ...w.floor.map((f) => f.id).filter(Boolean),
        ];
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("uses only known colours", () => {
        for (const o of w.objects) expect(COLOR_HEX[o.color]).toBeDefined();
        for (const f of w.floor) expect(COLOR_HEX[f.color]).toBeDefined();
      });

      it("keeps objects, zones, floor and walls inside the field", () => {
        for (const o of w.objects) {
          expect(inField(w, o.x - o.size / 2, o.x + o.size / 2, o.y - o.size / 2, o.y + o.size / 2), o.id).toBe(true);
          if (o.pickable) expect(o.movable, o.id).toBe(true);
        }
        for (const z of w.zones) {
          const b = zoneBounds(z);
          expect(inField(w, b.x0, b.x1, b.y0, b.y1), z.id).toBe(true);
        }
        for (const f of w.floor) {
          if (f.kind === "rect") expect(inField(w, f.x - f.w / 2, f.x + f.w / 2, f.y - f.h / 2, f.y + f.h / 2)).toBe(true);
          else if (f.kind === "circle") expect(inField(w, f.x - f.r, f.x + f.r, f.y - f.r, f.y + f.r)).toBe(true);
          else for (const p of f.points) expect(inField(w, p.x, p.x, p.y, p.y)).toBe(true);
        }
        for (const wall of w.walls) {
          expect(inField(w, wall.a.x, wall.a.x, wall.a.y, wall.a.y)).toBe(true);
          expect(inField(w, wall.b.x, wall.b.x, wall.b.y, wall.b.y)).toBe(true);
          expect(wall.thickness).toBeGreaterThan(0);
        }
      });

      it("does not list the outer border as a wall", () => {
        for (const wall of w.walls) {
          const onEdgeX = Math.abs(wall.a.x) === w.width / 2 && wall.a.x === wall.b.x;
          const onEdgeY = Math.abs(wall.a.y) === w.height / 2 && wall.a.y === wall.b.y;
          expect(onEdgeX || onEdgeY, wall.id).toBe(false);
        }
      });

      it("goal zone ids exist", () => {
        const zoneIds = new Set(w.zones.map((z) => z.id));
        for (const g of w.goals) for (const z of goalZones(g)) expect(zoneIds.has(z), z).toBe(true);
      });

      it("start pose is inside the field and not inside a wall or object", () => {
        const s = w.start;
        expect(Math.abs(s.x) + HALF_DIAG).toBeLessThanOrEqual(w.width / 2);
        expect(Math.abs(s.y) + HALF_DIAG).toBeLessThanOrEqual(w.height / 2);
        for (const wall of w.walls) expect(wallClear(s, wall), wall.id).toBeGreaterThan(HALF_DIAG);
        for (const o of w.objects) expect(Math.hypot(o.x - s.x, o.y - s.y) - o.size / Math.SQRT2, o.id).toBeGreaterThan(HALF_DIAG);
      });

      it("objects are not inside walls", () => {
        for (const o of w.objects) for (const wall of w.walls) {
          expect(wallClear(o, wall), `${o.id} vs ${wall.id}`).toBeGreaterThan(o.size / Math.SQRT2);
        }
      });

      it("every goal zone is reachable from the start (corridors wide enough for the robot)", () => {
        const canReach = reachable(w, ROBOT / 2 + 5);
        for (const g of w.goals) for (const id of goalZones(g)) {
          const z = w.zones.find((q) => q.id === id)!;
          expect(canReach(z), `${w.id}: ${id}`).toBe(true);
        }
        // every pickable/movable object can be approached too
        for (const o of w.objects) if (o.movable) expect(canReach(o), o.id).toBe(true);
      });

      it("corridors between walls are at least 300 mm wide", () => {
        // any two parallel axis-aligned walls that overlap must be 0 or >= 300 mm apart (clear gap)
        for (const p of w.walls) for (const q of w.walls) {
          if (p === q) continue;
          const pv = p.a.x === p.b.x, qv = q.a.x === q.b.x;
          const ph = p.a.y === p.b.y, qh = q.a.y === q.b.y;
          if (pv && qv) {
            const overlap = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) - Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
            const gap = Math.abs(p.a.x - q.a.x) - (p.thickness + q.thickness) / 2;
            if (overlap > 0 && gap > 0) expect(gap, `${p.id}/${q.id}`).toBeGreaterThanOrEqual(300);
          } else if (ph && qh) {
            const overlap = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
            const gap = Math.abs(p.a.y - q.a.y) - (p.thickness + q.thickness) / 2;
            if (overlap > 0 && gap > 0) expect(gap, `${p.id}/${q.id}`).toBeGreaterThanOrEqual(300);
          }
        }
      });

      it("the robot can leave the start spot", () => {
        // at least 200 mm of free travel in some direction from the start
        const canReach = reachable(w, ROBOT / 2 + 5);
        const dirs = [[0, 200], [200, 0], [0, -200], [-200, 0]];
        expect(dirs.some(([dx, dy]) => canReach({ x: w.start.x + dx, y: w.start.y + dy }))).toBe(true);
      });
    });
  }
});

describe("corridor-quest maze", () => {
  it("is a perfect 5x5 maze: 40 interior edges - 24 passages = 16 wall pieces of 400 mm", () => {
    const w = getPlayground("corridor-quest")!;
    const total = w.walls.reduce((n, x) => n + Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y), 0);
    expect(total).toBeCloseTo(16 * 400);
  });
});
