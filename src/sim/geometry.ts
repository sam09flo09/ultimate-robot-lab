/**
 * Allocation-free 2D collision helpers.
 *
 * Every solid thing is a Body: either a circle or an oriented box (OBB).
 * Walls become OBBs (segment length + square caps of half the thickness).
 * Functions write results into caller-owned scratch objects instead of allocating.
 */
import type { Vec, Zone } from "../core/types";

export const CIRCLE = 0;
export const BOX = 1;
export type Kind = typeof CIRCLE | typeof BOX;

export interface Body {
  kind: Kind;
  x: number; y: number;
  /** circle radius (also used for circles only) */
  r: number;
  /** box half extents along its local axes */
  hx: number; hy: number;
  /** box local x-axis = (c, s); local y-axis = (-s, c) */
  c: number; s: number;
  /** bounding radius, for cheap broad-phase rejection */
  br: number;
}

export interface Hit { nx: number; ny: number; depth: number; }

export function makeCircle(x: number, y: number, r: number): Body {
  return { kind: CIRCLE, x, y, r, hx: r, hy: r, c: 1, s: 0, br: r };
}

/** angleDeg is clockwise (same convention as heading), so local x-axis = (cos, -sin). */
export function makeBox(x: number, y: number, hx: number, hy: number, angleDeg: number): Body {
  const b: Body = { kind: BOX, x, y, r: 0, hx, hy, c: 1, s: 0, br: 0 };
  setBoxAngle(b, angleDeg);
  return b;
}

export function setBoxAngle(b: Body, angleDeg: number): void {
  const a = (angleDeg * Math.PI) / 180;
  b.c = clean(Math.cos(a));
  b.s = clean(-Math.sin(a));
  b.br = Math.sqrt(b.hx * b.hx + b.hy * b.hy);
}

/** Wall segment of given thickness as a box with square end caps. */
export function makeWallBody(a: Vec, b: Vec, thickness: number): Body {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const t = Math.max(thickness, 1) / 2;
  const body: Body = { kind: BOX, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 0, hx: len / 2 + t, hy: t, c: 1, s: 0, br: 0 };
  if (len > 1e-9) { body.c = dx / len; body.s = dy / len; }
  body.br = Math.sqrt(body.hx * body.hx + body.hy * body.hy);
  return body;
}

export function clean(v: number): number {
  if (Math.abs(v) < 1e-12) return 0;
  if (Math.abs(v - 1) < 1e-12) return 1;
  if (Math.abs(v + 1) < 1e-12) return -1;
  return v;
}

/** Normalise to [0,360), rounded to 1e-6 like the original sim. */
export function normDeg(h: number): number {
  h = h % 360;
  if (h < 0) h += 360;
  h = Math.round(h * 1e6) / 1e6;
  if (h >= 360) h -= 360;
  return h === 0 ? 0 : h; // no -0
}

export function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** Circle (cx,cy,r) vs box. Writes normal pointing FROM box TO circle. */
function circleBox(cx: number, cy: number, r: number, b: Body, out: Hit): boolean {
  const dx = cx - b.x, dy = cy - b.y;
  const lx = dx * b.c + dy * b.s;
  const ly = -dx * b.s + dy * b.c;
  const qx = lx < -b.hx ? -b.hx : lx > b.hx ? b.hx : lx;
  const qy = ly < -b.hy ? -b.hy : ly > b.hy ? b.hy : ly;
  const ex = lx - qx, ey = ly - qy;
  const d2 = ex * ex + ey * ey;
  let nlx: number, nly: number, depth: number;
  if (d2 > 1e-18) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nlx = ex / d; nly = ey / d; depth = r - d;
  } else {
    // centre inside the box: exit along the shallowest axis
    const px = b.hx - Math.abs(lx), py = b.hy - Math.abs(ly);
    if (px < py) { nlx = lx >= 0 ? 1 : -1; nly = 0; depth = px + r; }
    else { nlx = 0; nly = ly >= 0 ? 1 : -1; depth = py + r; }
  }
  out.nx = nlx * b.c - nly * b.s;
  out.ny = nlx * b.s + nly * b.c;
  out.depth = depth;
  return true;
}

function projRadius(b: Body, nx: number, ny: number): number {
  return b.hx * Math.abs(b.c * nx + b.s * ny) + b.hy * Math.abs(-b.s * nx + b.c * ny);
}

/**
 * SAT for two boxes; normal from a to b. `pad` is added to the overlap on every
 * axis, so a hit with pad means "the face-axis gap is smaller than pad".
 */
function boxBox(a: Body, b: Body, out: Hit, pad: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  let best = Infinity, bnx = 0, bny = 0;
  for (let i = 0; i < 4; i++) {
    let nx: number, ny: number;
    if (i === 0) { nx = a.c; ny = a.s; }
    else if (i === 1) { nx = -a.s; ny = a.c; }
    else if (i === 2) { nx = b.c; ny = b.s; }
    else { nx = -b.s; ny = b.c; }
    const dist = dx * nx + dy * ny;
    const ov = projRadius(a, nx, ny) + projRadius(b, nx, ny) + pad - Math.abs(dist);
    if (ov <= 0) return false;
    if (ov < best) {
      best = ov;
      if (dist < 0) { bnx = -nx; bny = -ny; } else { bnx = nx; bny = ny; }
    }
  }
  out.nx = bnx; out.ny = bny; out.depth = best;
  return true;
}

/**
 * Overlap test between two bodies. On overlap writes the separation normal
 * (unit, pointing FROM a TO b) and penetration depth. `pad` is a contact margin:
 * with pad > 0 a hit means "closer than pad" and depth = pad - gap.
 */
export function collide(a: Body, b: Body, out: Hit, pad = 0): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const reach = a.br + b.br + pad;
  if (dx * dx + dy * dy >= reach * reach) return false;
  if (a.kind === CIRCLE) {
    if (b.kind === CIRCLE) {
      const r = a.r + pad + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) return false;
      const d = Math.sqrt(d2);
      if (d > 1e-9) { out.nx = dx / d; out.ny = dy / d; } else { out.nx = 0; out.ny = 1; }
      out.depth = r - d;
      return true;
    }
    if (!circleBox(a.x, a.y, a.r + pad, b, out)) return false;
    out.nx = -out.nx; out.ny = -out.ny; // box->circle  =>  a(circle)->b(box)
    return true;
  }
  if (b.kind === CIRCLE) return circleBox(b.x, b.y, b.r + pad, a, out);
  return boxBox(a, b, out, pad);
}

/** Ray (ox,oy)+t(dx,dy), |d|=1, against a body. Returns t >= 0 of first hit, or Infinity. */
export function rayBody(ox: number, oy: number, dx: number, dy: number, b: Body): number {
  if (b.kind === CIRCLE) return rayCircle(ox, oy, dx, dy, b.x, b.y, b.r);
  const rx = ox - b.x, ry = oy - b.y;
  const lox = rx * b.c + ry * b.s, loy = -rx * b.s + ry * b.c;
  const ldx = dx * b.c + dy * b.s, ldy = -dx * b.s + dy * b.c;
  let tmin = 0, tmax = Infinity;
  // x slab
  if (Math.abs(ldx) < 1e-12) { if (lox < -b.hx || lox > b.hx) return Infinity; }
  else {
    let t1 = (-b.hx - lox) / ldx, t2 = (b.hx - lox) / ldx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(ldy) < 1e-12) { if (loy < -b.hy || loy > b.hy) return Infinity; }
  else {
    let t1 = (-b.hy - loy) / ldy, t2 = (b.hy - loy) / ldy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = ox - cx, fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // origin inside
  const bq = fx * dx + fy * dy;
  if (bq > 0) return Infinity; // pointing away
  const disc = bq * bq - c;
  if (disc < 0) return Infinity;
  return -bq - Math.sqrt(disc);
}

/** Ray from inside the field rectangle to its inner border. */
export function rayBorder(ox: number, oy: number, dx: number, dy: number, halfW: number, halfH: number): number {
  let t = Infinity;
  if (dx > 1e-12) t = Math.min(t, (halfW - ox) / dx);
  else if (dx < -1e-12) t = Math.min(t, (-halfW - ox) / dx);
  if (dy > 1e-12) t = Math.min(t, (halfH - oy) / dy);
  else if (dy < -1e-12) t = Math.min(t, (-halfH - oy) / dy);
  return t < 0 ? 0 : t;
}

export function pointInZone(z: Zone, x: number, y: number): boolean {
  if (z.kind === "rect") return Math.abs(x - z.x) <= z.w / 2 && Math.abs(y - z.y) <= z.h / 2;
  const dx = x - z.x, dy = y - z.y;
  return dx * dx + dy * dy <= z.r * z.r;
}

/** Squared distance from point to segment. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + vx * t - px, ey = ay + vy * t - py;
  return ex * ex + ey * ey;
}
