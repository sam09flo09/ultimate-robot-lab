/**
 * Pure geometry for the level editor: hit-testing, moving, handles. All in world millimetres
 * (+y up, heading 0 = +y, clockwise). No DOM.
 */
import type { FloorShape, Vec, World, WorldObject, Zone } from "../core/types";
import { normDeg } from "./levelFile";

export const START_ID = "@start";
export const ROBOT_SIZE = 140;

export type ItemKind = "start" | "wall" | "floor" | "object" | "zone" | "platform"; // arm: platform
export interface ItemRef { kind: ItemKind; id: string; index: number }

// ------------------------------------------------------------------ basics

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Point inside an axis-aligned rect given by centre + size, optionally rotated (degrees clockwise). */
export function pointInRect(p: Vec, cx: number, cy: number, w: number, h: number, rotationDeg = 0, pad = 0): boolean {
  let dx = p.x - cx, dy = p.y - cy;
  if (rotationDeg) {
    // undo a clockwise rotation (clockwise in a +y-up frame = negative math angle)
    const r = (rotationDeg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    dx = lx; dy = ly;
  }
  return Math.abs(dx) <= w / 2 + pad && Math.abs(dy) <= h / 2 + pad;
}

/** Heading (0 = +y, clockwise) of a direction vector. */
export function headingFromVector(dx: number, dy: number): number {
  return normDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}
export function headingVector(heading: number): Vec {
  const r = (heading * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) };
}

export function snapValue(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}
export function snapPoint(p: Vec, step: number): Vec {
  return { x: snapValue(p.x, step), y: snapValue(p.y, step) };
}
export function snapHeading(h: number, step = 15): number {
  return normDeg(Math.round(h / step) * step);
}

// ------------------------------------------------------------------ lookup

export function findItem(w: World, id: string | null | undefined): ItemRef | null {
  if (!id) return null;
  if (id === START_ID) return { kind: "start", id, index: -1 };
  let i = w.walls.findIndex((x) => x.id === id);
  if (i >= 0) return { kind: "wall", id, index: i };
  i = w.floor.findIndex((x) => x.id === id);
  if (i >= 0) return { kind: "floor", id, index: i };
  i = w.objects.findIndex((x) => x.id === id);
  if (i >= 0) return { kind: "object", id, index: i };
  i = w.zones.findIndex((x) => x.id === id);
  if (i >= 0) return { kind: "zone", id, index: i };
  i = (w.platforms ?? []).findIndex((x) => x.id === id); // arm
  if (i >= 0) return { kind: "platform", id, index: i };
  return null;
}

function areaOf(s: FloorShape | Zone): number {
  if (s.kind === "rect") return s.w * s.h;
  if (s.kind === "circle") return Math.PI * s.r * s.r;
  return 0; // lines are thin: always win over areas under them
}

function hitFloorOrZone(s: FloorShape | Zone, p: Vec, tol: number): boolean {
  if (s.kind === "rect") return pointInRect(p, s.x, s.y, s.w, s.h, 0, tol);
  if (s.kind === "circle") return dist(p, s) <= s.r + tol;
  for (let i = 1; i < s.points.length; i++) {
    if (distToSegment(p, s.points[i - 1], s.points[i]) <= s.width / 2 + tol) return true;
  }
  return false;
}

export function hitObject(o: WorldObject, p: Vec, tol: number): boolean {
  if (o.shape === "disk") return dist(p, o) <= o.size / 2 + tol;
  return pointInRect(p, o.x, o.y, o.size, o.size, o.rotation ?? 0, tol);
}

/**
 * What is under point `p` (world mm)? `tol` is the pick tolerance in mm (a few screen pixels).
 * Priority: robot start > objects > walls > (smallest of zones / floor paint). Later-drawn items win ties.
 */
export function hitTest(w: World, p: Vec, tol: number): ItemRef | null {
  if (pointInRect(p, w.start.x, w.start.y, ROBOT_SIZE, ROBOT_SIZE, w.start.heading, tol))
    return { kind: "start", id: START_ID, index: -1 };
  for (let i = w.objects.length - 1; i >= 0; i--) {
    if (hitObject(w.objects[i], p, tol)) return { kind: "object", id: w.objects[i].id, index: i };
  }
  for (let i = w.walls.length - 1; i >= 0; i--) {
    const wl = w.walls[i];
    if (distToSegment(p, wl.a, wl.b) <= wl.thickness / 2 + tol) return { kind: "wall", id: wl.id ?? "", index: i };
  }
  const ps = w.platforms ?? []; // arm
  for (let i = ps.length - 1; i >= 0; i--) {
    if (pointInRect(p, ps[i].x, ps[i].y, ps[i].w, ps[i].h, 0, tol)) return { kind: "platform", id: ps[i].id, index: i };
  }
  let best: ItemRef | null = null;
  let bestArea = Infinity;
  for (let i = w.zones.length - 1; i >= 0; i--) {
    const z = w.zones[i];
    const a = areaOf(z);
    if (a < bestArea && hitFloorOrZone(z, p, tol)) { best = { kind: "zone", id: z.id, index: i }; bestArea = a; }
  }
  for (let i = w.floor.length - 1; i >= 0; i--) {
    const f = w.floor[i];
    const a = areaOf(f);
    if (a < bestArea && hitFloorOrZone(f, p, tol)) { best = { kind: "floor", id: f.id ?? "", index: i }; bestArea = a; }
  }
  return best;
}

// ------------------------------------------------------------------ editing

/** A reference point used for snapping when an item is dragged. */
export function itemAnchor(w: World, r: ItemRef): Vec {
  switch (r.kind) {
    case "start": return { x: w.start.x, y: w.start.y };
    case "wall": return { ...w.walls[r.index].a };
    case "object": return { x: w.objects[r.index].x, y: w.objects[r.index].y };
    case "zone": return { x: w.zones[r.index].x, y: w.zones[r.index].y };
    case "platform": return { x: w.platforms![r.index].x, y: w.platforms![r.index].y };
    case "floor": {
      const f = w.floor[r.index];
      return f.kind === "line" ? { ...f.points[0] } : { x: f.x, y: f.y };
    }
  }
}

export function translateItem(w: World, r: ItemRef, dx: number, dy: number): void {
  switch (r.kind) {
    case "start": w.start.x += dx; w.start.y += dy; return;
    case "wall": {
      const wl = w.walls[r.index];
      wl.a = { x: wl.a.x + dx, y: wl.a.y + dy };
      wl.b = { x: wl.b.x + dx, y: wl.b.y + dy };
      return;
    }
    case "object": w.objects[r.index].x += dx; w.objects[r.index].y += dy; return;
    case "zone": w.zones[r.index].x += dx; w.zones[r.index].y += dy; return;
    case "platform": w.platforms![r.index].x += dx; w.platforms![r.index].y += dy; return;
    case "floor": {
      const f = w.floor[r.index];
      if (f.kind === "line") f.points = f.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      else { f.x += dx; f.y += dy; }
    }
  }
}

/** Remove an item. The robot start cannot be removed (returns false). */
export function removeItem(w: World, r: ItemRef): boolean {
  switch (r.kind) {
    case "start": return false;
    case "wall": w.walls.splice(r.index, 1); return true;
    case "floor": w.floor.splice(r.index, 1); return true;
    case "object": w.objects.splice(r.index, 1); return true;
    case "zone": w.zones.splice(r.index, 1); return true;
    case "platform": w.platforms!.splice(r.index, 1); return true;
  }
}

export const START_HANDLE_DIST = 230;

/** Drag handles (world mm) for the selected item. */
export function handlesFor(w: World, r: ItemRef): Vec[] {
  switch (r.kind) {
    case "start": {
      const v = headingVector(w.start.heading);
      return [{ x: w.start.x + v.x * START_HANDLE_DIST, y: w.start.y + v.y * START_HANDLE_DIST }];
    }
    case "wall": return [{ ...w.walls[r.index].a }, { ...w.walls[r.index].b }];
    case "object": return [];
    case "platform": { const p = w.platforms![r.index]; return [{ x: p.x + p.w / 2, y: p.y + p.h / 2 }]; }
    case "zone":
    case "floor": {
      const s = r.kind === "zone" ? w.zones[r.index] : w.floor[r.index];
      if (s.kind === "rect") return [{ x: s.x + s.w / 2, y: s.y + s.h / 2 }];
      if (s.kind === "circle") return [{ x: s.x + s.r, y: s.y }];
      return s.points.map((p) => ({ ...p }));
    }
  }
}

/**
 * Move handle `i` of item `r` to `p` (already snapped by the caller if wanted). Mutates `w`.
 * `orig` is the world at drag start (so rect resizing keeps the opposite corner fixed).
 */
export function dragHandle(w: World, orig: World, r: ItemRef, i: number, p: Vec): void {
  switch (r.kind) {
    case "start":
      w.start.heading = snapHeading(headingFromVector(p.x - w.start.x, p.y - w.start.y));
      return;
    case "wall":
      if (i === 0) w.walls[r.index].a = { ...p }; else w.walls[r.index].b = { ...p };
      return;
    case "object": return;
    case "platform": {
      const s = w.platforms![r.index], o = orig.platforms![r.index];
      const rr = rectFromCorners({ x: o.x - o.w / 2, y: o.y - o.h / 2 }, p);
      s.x = rr.x; s.y = rr.y; s.w = Math.max(40, rr.w); s.h = Math.max(40, rr.h);
      return;
    }
    case "zone":
    case "floor": {
      const s = r.kind === "zone" ? w.zones[r.index] : w.floor[r.index];
      const o = r.kind === "zone" ? orig.zones[r.index] : orig.floor[r.index];
      if (s.kind === "rect" && o.kind === "rect") {
        const fx = o.x - o.w / 2, fy = o.y - o.h / 2; // fixed bottom-left corner
        const rr = rectFromCorners({ x: fx, y: fy }, p);
        s.x = rr.x; s.y = rr.y; s.w = Math.max(10, rr.w); s.h = Math.max(10, rr.h);
      } else if (s.kind === "circle") {
        s.r = Math.max(5, dist(p, s));
      } else if (s.kind === "line" && i < s.points.length) {
        s.points = s.points.map((q, k) => (k === i ? { ...p } : q));
      }
    }
  }
}

export function rectFromCorners(a: Vec, b: Vec): { x: number; y: number; w: number; h: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Axis-aligned bounds of an item (for selection outlines). */
export function itemBounds(w: World, r: ItemRef): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts: Vec[] = [];
  let pad = 0;
  switch (r.kind) {
    case "start": pad = ROBOT_SIZE * 0.71; pts.push(w.start); break;
    case "wall": pad = w.walls[r.index].thickness / 2; pts.push(w.walls[r.index].a, w.walls[r.index].b); break;
    case "object": { const o = w.objects[r.index]; pad = o.size * (o.shape === "box" ? 0.71 : 0.5); pts.push(o); break; }
    case "platform": { const p = w.platforms![r.index]; pts.push({ x: p.x - p.w / 2, y: p.y - p.h / 2 }, { x: p.x + p.w / 2, y: p.y + p.h / 2 }); break; }
    case "zone":
    case "floor": {
      const s = r.kind === "zone" ? w.zones[r.index] : w.floor[r.index];
      if (s.kind === "rect") pts.push({ x: s.x - s.w / 2, y: s.y - s.h / 2 }, { x: s.x + s.w / 2, y: s.y + s.h / 2 });
      else if (s.kind === "circle") { pts.push(s); pad = s.r; }
      else { pts.push(...s.points); pad = s.width / 2; }
    }
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}
