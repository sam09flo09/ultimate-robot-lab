/** Sensor queries. Pure functions over the current physics state; no allocation in the hot path. */
import type { ColorName, FloorShape, WorldObject } from "../core/types";
import { type Body, distSqToSegment, rayBody, rayBorder } from "./geometry";

export const DISTANCE_MAX = 3000;
export const DISTANCE_FOUND = 1000;
export const FRONT_RANGE = 100;

/** Perceived brightness (0..100) of each named colour. */
export const BRIGHTNESS: Record<ColorName, number> = {
  WHITE: 100,
  YELLOW: 85,
  ORANGE: 62,
  GREEN: 45,
  RED: 38,
  BLUE: 30,
  PURPLE: 25,
  BLACK: 5,
  NONE: 0,
};

/**
 * Cast the distance ray. Returns the distance (mm) from the ray origin to the
 * first wall / border / object, or Infinity.
 * `skip` is the index of an object body to ignore (the carried one), or -1.
 */
export function castRay(
  ox: number, oy: number, dx: number, dy: number,
  halfW: number, halfH: number,
  statics: readonly Body[], objects: readonly Body[], skip: number,
): number {
  let t = rayBorder(ox, oy, dx, dy, halfW, halfH);
  for (let i = 0; i < statics.length; i++) {
    const ti = rayBody(ox, oy, dx, dy, statics[i]);
    if (ti < t) t = ti;
  }
  for (let i = 0; i < objects.length; i++) {
    if (i === skip) continue;
    const ti = rayBody(ox, oy, dx, dy, objects[i]);
    if (ti < t) t = ti;
  }
  return t;
}

/**
 * Index of the nearest object whose centre is in front of the robot (within the
 * robot's width) and whose near edge is within `range` mm of the front face. -1 if none.
 */
export function objectInFront(
  rx: number, ry: number, ux: number, uy: number, half: number,
  objects: readonly WorldObject[], skip: number, range: number, pickableOnly: boolean,
): number {
  let best = -1, bestGap = Infinity;
  for (let i = 0; i < objects.length; i++) {
    if (i === skip) continue;
    const o = objects[i];
    if (pickableOnly && !o.pickable) continue;
    const ddx = o.x - rx, ddy = o.y - ry;
    const f = ddx * ux + ddy * uy;            // forward distance of centre
    if (f <= 0) continue;
    const l = -ddx * uy + ddy * ux;           // lateral offset
    if (Math.abs(l) > half) continue;
    const gap = f - half - o.size / 2;
    if (gap > range || gap < -o.size) continue;
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  return best;
}

/** Topmost floor colour at (x,y); later shapes are on top. WHITE if bare. */
export function floorColorAt(floor: readonly FloorShape[], x: number, y: number): ColorName {
  for (let i = floor.length - 1; i >= 0; i--) {
    const f = floor[i];
    if (f.color === "NONE") continue;
    if (f.kind === "rect") {
      if (Math.abs(x - f.x) <= f.w / 2 && Math.abs(y - f.y) <= f.h / 2) return f.color;
    } else if (f.kind === "circle") {
      const dx = x - f.x, dy = y - f.y;
      if (dx * dx + dy * dy <= f.r * f.r) return f.color;
    } else {
      const pts = f.points, hw = f.width / 2, hw2 = hw * hw;
      if (pts.length === 1) {
        const dx = x - pts[0].x, dy = y - pts[0].y;
        if (dx * dx + dy * dy <= hw2) return f.color;
      }
      for (let j = 1; j < pts.length; j++) {
        if (distSqToSegment(x, y, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) <= hw2) return f.color;
      }
    }
  }
  return "WHITE";
}
