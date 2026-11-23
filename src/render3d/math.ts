/**
 * Pure math for the 3D renderer (no DOM, no three.js) — unit-tested in math.test.ts.
 *
 * Scene scale: 1 three.js unit = 1 mm.
 * World (x, y) mm on the floor plane maps to three (x, 0, -y); height is three +y.
 * Headings are degrees clockwise from +y; a model whose front is local -z gets rotation.y = -heading (rad).
 */

export const DEG = Math.PI / 180;

/** World mm → three-space x / z (y is height). */
export function worldToThreeX(x: number): number { return x; }
export function worldToThreeZ(y: number): number { return -y; }
/** Three-space x / z → world mm. */
export function threeToWorldX(tx: number): number { return tx; }
export function threeToWorldY(tz: number): number { return -tz; }

/** Robot heading (deg, clockwise from +y) → Object3D.rotation.y (rad) for a model facing local -z. */
export function headingToRotationY(headingDeg: number): number { return -headingDeg * DEG; }

/** Unit forward vector of a heading in three space: { x: sin h, z: -cos h }. Written into `out`. */
export function headingForward(headingDeg: number, out: { x: number; z: number }): { x: number; z: number } {
  const h = headingDeg * DEG;
  out.x = Math.sin(h);
  out.z = -Math.cos(h);
  return out;
}

/** Shortest signed difference b - a between two angles in degrees, in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Shortest signed difference b - a between two angles in radians, in (-π, π]. */
export function angleDiffRad(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

// ---------------------------------------------------------------- wheel odometry

/**
 * Tracks per-frame robot motion and accumulates wheel roll angles (radians, + = rolling forward).
 * Differential drive: a clockwise turn (heading increases) rolls the LEFT wheels forward.
 * A jump larger than `maxStep` mm or 120° in one update (reset / teleport) does not spin the wheels.
 */
export class WheelOdometry {
  left = 0;
  right = 0;
  private x = 0;
  private y = 0;
  private h = 0;
  private has = false;
  constructor(public radius: number, public halfTrack: number, public maxStep = 400) {}

  reset(): void { this.has = false; }

  update(x: number, y: number, headingDeg: number): void {
    if (!this.has) { this.x = x; this.y = y; this.h = headingDeg; this.has = true; return; }
    const dx = x - this.x;
    const dy = y - this.y;
    const dh = angleDiffDeg(this.h, headingDeg);
    this.x = x; this.y = y; this.h = headingDeg;
    if (dx * dx + dy * dy > this.maxStep * this.maxStep || Math.abs(dh) > 120) return;
    // forward distance = displacement projected on the (mid) heading
    const hm = (headingDeg - dh / 2) * DEG;
    const fwd = dx * Math.sin(hm) + dy * Math.cos(hm);
    const arc = dh * DEG * this.halfTrack; // clockwise (+) → left wheel forward
    this.left += (fwd + arc) / this.radius;
    this.right += (fwd - arc) / this.radius;
    // keep the numbers small; the visual result is identical
    const TAU = Math.PI * 2;
    if (this.left > 1e4 || this.left < -1e4) this.left %= TAU;
    if (this.right > 1e4 || this.right < -1e4) this.right %= TAU;
  }
}

// ---------------------------------------------------------------- frame timing

/** Rolling average of intervals between calls. Gaps above `maxGap` ms (hidden tab) are ignored. */
export class FrameTimer {
  private buf: Float64Array;
  private i = 0;
  private n = 0;
  private sum = 0;
  private last = -1;
  /** Seconds since the previous tick (clamped to 0.1), for smoothing. */
  dt = 1 / 60;
  constructor(size = 60, private maxGap = 500) { this.buf = new Float64Array(size); }

  tick(now: number): void {
    if (this.last >= 0) {
      const d = now - this.last;
      if (d >= 0 && d <= this.maxGap) {
        if (this.n === this.buf.length) this.sum -= this.buf[this.i];
        else this.n++;
        this.buf[this.i] = d;
        this.sum += d;
        this.i = (this.i + 1) % this.buf.length;
      }
      this.dt = Math.min(0.1, Math.max(0, d / 1000));
    }
    this.last = now;
  }

  average(): number { return this.n ? this.sum / this.n : 0; }
  resetLast(): void { this.last = -1; }
}

// ---------------------------------------------------------------- orbit camera

export interface OrbitState {
  tx: number; tz: number;     // target on the floor (three x / z)
  radius: number;             // mm from target
  theta: number;              // azimuth, rad; 0 = camera on +z side (looking toward world +y)
  phi: number;                // polar angle from straight up, rad
}
export interface OrbitLimits {
  minRadius: number; maxRadius: number;
  minPhi: number; maxPhi: number;
  halfW: number; halfH: number; // target is kept inside the field (world half sizes)
}

export const MIN_PHI = 0.02;
export const MAX_PHI = 1.45; // ~83°: camera always stays above the floor

export function orbitLimits(fieldW: number, fieldH: number): OrbitLimits {
  const diag = Math.hypot(fieldW, fieldH);
  return { minRadius: 200, maxRadius: diag * 2.5, minPhi: MIN_PHI, maxPhi: MAX_PHI, halfW: fieldW / 2, halfH: fieldH / 2 };
}

/** Clamp an orbit state in place so the camera never goes under the floor or too far away. */
export function clampOrbit(s: OrbitState, L: OrbitLimits): OrbitState {
  if (!Number.isFinite(s.radius)) s.radius = L.maxRadius;
  s.radius = Math.min(L.maxRadius, Math.max(L.minRadius, s.radius));
  if (!Number.isFinite(s.phi)) s.phi = L.minPhi;
  s.phi = Math.min(L.maxPhi, Math.max(L.minPhi, s.phi));
  if (!Number.isFinite(s.theta)) s.theta = 0;
  const TAU = Math.PI * 2;
  s.theta = ((s.theta % TAU) + TAU + Math.PI) % TAU - Math.PI; // (-π, π]
  if (!Number.isFinite(s.tx)) s.tx = 0;
  if (!Number.isFinite(s.tz)) s.tz = 0;
  s.tx = Math.min(L.halfW, Math.max(-L.halfW, s.tx));
  s.tz = Math.min(L.halfH, Math.max(-L.halfH, s.tz));
  return s;
}

/** Camera position for an orbit state (three space). */
export function orbitPosition(s: OrbitState, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const sp = Math.sin(s.phi);
  out.x = s.tx + s.radius * sp * Math.sin(s.theta);
  out.y = s.radius * Math.cos(s.phi);
  out.z = s.tz + s.radius * sp * Math.cos(s.theta);
  return out;
}

/**
 * Distance at which a perspective camera (vertical fov in degrees, aspect w/h) sees a
 * w×h rectangle lying flat and facing it, with a margin factor (1 = tight).
 */
export function fitDistance(fovDeg: number, aspect: number, w: number, h: number, margin = 1.08): number {
  const tv = Math.tan((fovDeg * DEG) / 2);
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const th = tv * a;
  return Math.max((h / 2) / tv, (w / 2) / th) * margin;
}

/**
 * Orbit radius that frames a whole field from a polar angle phi: fits the bounding sphere
 * (half-diagonal) inside the narrower field of view.
 */
export function fitSphereDistance(fovDeg: number, aspect: number, fieldW: number, fieldH: number, margin = 0.9): number {
  const r = Math.hypot(fieldW, fieldH) / 2;
  const half = (fovDeg * DEG) / 2;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const hHalf = Math.atan(Math.tan(half) * a);
  return (r / Math.sin(Math.min(half, hHalf))) * margin;
}

/** Frame-rate independent exponential smoothing factor. */
export function smoothing(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

// ---------------------------------------------------------------- floor texture layout

export interface TexLayout {
  width: number; height: number; // canvas pixels
  ppm: number;                    // pixels per mm
}

/** Size the floor canvas: longest side = maxPx (≤ field mm × 2), keeping the field's aspect. */
export function floorTextureLayout(fieldW: number, fieldH: number, maxPx: number): TexLayout {
  const fw = fieldW > 0 ? fieldW : 2000;
  const fh = fieldH > 0 ? fieldH : 2000;
  const ppm = Math.min(maxPx / Math.max(fw, fh), 2);
  return { width: Math.max(1, Math.round(fw * ppm)), height: Math.max(1, Math.round(fh * ppm)), ppm };
}

/** World mm → floor canvas px (origin top-left, y down; canvas top = world +y). */
export function worldToTex(L: TexLayout, fieldW: number, fieldH: number, x: number, y: number): { px: number; py: number } {
  return { px: (x + fieldW / 2) * L.ppm, py: (fieldH / 2 - y) * L.ppm };
}

/** Number shown in a numberGrid square: 1 at bottom-left, row-major, rows counted upward. */
export function gridSquareNumber(row: number, col: number, cols: number): number {
  return row * cols + col + 1;
}

// ---------------------------------------------------------------- ribbons (pen strokes / path)

/** Floats per vertex position, vertices per segment (two triangles, non-indexed). */
export const RIBBON_VERTS_PER_SEG = 6;

/**
 * Write one ribbon segment (a flat quad on the floor at height `y`) from world a to world b into
 * `pos` at vertex index `v`. `ext` extends both ends (square caps hide joint gaps).
 * A zero-length segment becomes a square dot of side 2·halfWidth.
 */
export function writeRibbonSegment(
  pos: Float32Array, v: number,
  ax: number, ay: number, bx: number, by: number,
  halfWidth: number, ext: number, y: number,
): void {
  let dx = bx - ax;
  let dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) { dx = 1; dy = 0; ext = Math.max(ext, halfWidth); }
  else { dx /= len; dy /= len; }
  // normal (left of direction)
  const nx = -dy * halfWidth;
  const ny = dx * halfWidth;
  const sx = ax - dx * ext, sy = ay - dy * ext;
  const ex = bx + dx * ext, ey = by + dy * ext;
  // corners in world xy, written as three (x, y, -worldY)
  const p0x = sx + nx, p0y = sy + ny;
  const p1x = sx - nx, p1y = sy - ny;
  const p2x = ex + nx, p2y = ey + ny;
  const p3x = ex - nx, p3y = ey - ny;
  let o = v * 3;
  // triangle 1: p0, p1, p2 ; triangle 2: p2, p1, p3 — counter-clockwise seen from above (+y)
  pos[o++] = p0x; pos[o++] = y; pos[o++] = -p0y;
  pos[o++] = p1x; pos[o++] = y; pos[o++] = -p1y;
  pos[o++] = p2x; pos[o++] = y; pos[o++] = -p2y;
  pos[o++] = p2x; pos[o++] = y; pos[o++] = -p2y;
  pos[o++] = p1x; pos[o++] = y; pos[o++] = -p1y;
  pos[o++] = p3x; pos[o++] = y; pos[o++] = -p3y;
}

/** Next capacity (in segments) able to hold `need`: doubles from `cur`, at least 256. */
export function growCapacity(cur: number, need: number): number {
  let c = Math.max(256, cur);
  while (c < need) c *= 2;
  return c;
}

/**
 * Given the previously consumed point array state and the current array, work out how to update
 * incrementally. Handles plain appends and front-trimming (the sim splices old path points).
 *   - "same": nothing new
 *   - "append": add points from index `from` (segments from[from-1] → [from]...), drop `dropped` old
 *     points from the front
 *   - "rebuild": start over
 */
export type PointsDelta =
  | { kind: "same" }
  | { kind: "append"; from: number; dropped: number }
  | { kind: "rebuild" };

export function pointsDelta<T>(prevArr: T[] | null, prevLen: number, prevLast: T | null, arr: T[], out: { kind: string; from: number; dropped: number }): typeof out {
  out.from = 0; out.dropped = 0;
  if (arr !== prevArr || prevLen === 0 || prevLast === null) { out.kind = "rebuild"; return out; }
  const n = arr.length;
  if (n === prevLen && arr[n - 1] === prevLast) { out.kind = "same"; return out; }
  // find where the previously last point is now (it may have shifted toward the front)
  let idx = -1;
  const stop = Math.max(0, Math.min(n, prevLen) - 1 - 4096);
  for (let i = Math.min(n, prevLen) - 1; i >= stop; i--) { if (arr[i] === prevLast) { idx = i; break; } }
  if (idx < 0) { out.kind = "rebuild"; return out; }
  out.kind = idx === n - 1 && prevLen - 1 === idx ? "same" : "append";
  out.from = idx + 1;
  out.dropped = prevLen - 1 - idx;
  return out;
}
