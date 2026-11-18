/** Small geometry helpers used to build the built-in playgrounds. Pure functions, no DOM. */
import type { Vec, Wall } from "../core/types";

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Build maze walls for a grid of square cells.
 * - cols x rows cells of `cell` mm, bottom-left corner of the grid at (x0, y0).
 * - `passages` lists open connections between neighbouring cells as [c1, r1, c2, r2]
 *   (column, row; row 0 is the bottom row).
 * - Every other interior cell boundary becomes a wall. The outer boundary is NOT included
 *   (the field border is implicit), so the grid should normally cover the whole field.
 * Collinear neighbouring wall pieces are merged into one longer wall.
 */
export function mazeWalls(
  cols: number,
  rows: number,
  cell: number,
  x0: number,
  y0: number,
  passages: [number, number, number, number][],
  thickness: number,
  idPrefix = "wall",
): Wall[] {
  const open = new Set<string>();
  for (const [c1, rr1, c2, rr2] of passages) {
    open.add(`${c1},${rr1}|${c2},${rr2}`);
    open.add(`${c2},${rr2}|${c1},${rr1}`);
  }
  // vertical pieces keyed by x, horizontal by y: list of [from, to]
  const vert = new Map<number, [number, number][]>();
  const horz = new Map<number, [number, number][]>();
  const push = (m: Map<number, [number, number][]>, k: number, a: number, b: number) => {
    const list = m.get(k) ?? [];
    list.push([a, b]);
    m.set(k, list);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !open.has(`${c},${r}|${c + 1},${r}`)) {
        push(vert, x0 + (c + 1) * cell, y0 + r * cell, y0 + (r + 1) * cell);
      }
      if (r + 1 < rows && !open.has(`${c},${r}|${c},${r + 1}`)) {
        push(horz, y0 + (r + 1) * cell, x0 + c * cell, x0 + (c + 1) * cell);
      }
    }
  }
  const walls: Wall[] = [];
  let n = 1;
  const emit = (m: Map<number, [number, number][]>, vertical: boolean) => {
    const keys = [...m.keys()].sort((a, b) => a - b);
    for (const k of keys) {
      const segs = m.get(k)!.sort((a, b) => a[0] - b[0]);
      let cur: [number, number] | null = null;
      const flush = () => {
        if (!cur) return;
        const [a, b] = cur;
        walls.push({
          id: `${idPrefix}-${n++}`,
          a: vertical ? { x: k, y: a } : { x: a, y: k },
          b: vertical ? { x: k, y: b } : { x: b, y: k },
          thickness,
        });
      };
      for (const s of segs) {
        if (cur && Math.abs(cur[1] - s[0]) < 1e-6) cur = [cur[0], s[1]];
        else {
          flush();
          cur = [s[0], s[1]];
        }
      }
      flush();
    }
  };
  emit(horz, false);
  emit(vert, true);
  return walls;
}

/** Points along a circular arc (math angles in radians, counter-clockwise positive, y up). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, step = 40): Vec[] {
  const len = Math.abs(a1 - a0) * r;
  const n = Math.max(2, Math.ceil(len / step));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: r1(cx + r * Math.cos(a)), y: r1(cy + r * Math.sin(a)) });
  }
  return out;
}

/** Sample a parametric curve f(t), t in [0,1], into about `n` + 1 points. */
export function curve(f: (t: number) => Vec, n: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const p = f(i / n);
    out.push({ x: r1(p.x), y: r1(p.y) });
  }
  return out;
}

/** Concatenate point runs, dropping duplicated join points. */
export function joinRuns(...runs: Vec[][]): Vec[] {
  const out: Vec[] = [];
  for (const run of runs) {
    for (const p of run) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
      out.push(p);
    }
  }
  return out;
}
