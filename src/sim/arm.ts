/**
 * arm: the 1-DOF lifting arm + claw, raised platforms and stacked objects.
 *
 * Model (see core/types.ts ArmState):
 *  - Arm angle 0 (down) .. 90 (straight up), moved at the arm velocity (100% = 120°/s, 50% = 60°/s).
 *  - The claw sits CLAW_HOLD mm in front of the robot's front face (a parallel lift: the reach does not
 *    change with the angle). Claw height = ARM_LIFT × sin(angle) mm = the bottom of what it holds.
 *  - claw(true) grabs the best pickable object whose centre is in the claw zone (0..CLAW_REACH mm ahead
 *    of the front face, within ±CLAW_HALF_W sideways) and whose height range overlaps the jaws' height
 *    band [clawH − 5, clawH + JAW_BAND]. Objects resting on it come along.
 *  - claw(false) releases: the object drops onto the highest surface under its centre that is not above
 *    its bottom (a platform top or another object's top), else to the floor. No tipping physics.
 *  - Lowering stops (blocked) when the claw — or the bottom of what it holds — reaches a surface under it.
 *  - Objects above the floor (z > 0) and the held object are "ghosts" for 2D collisions: the robot body
 *    and floor objects pass under/over them. Platforms are solid to the robot and floor objects.
 *
 * Deterministic and allocation-free per substep (arrays are rebuilt only when a stack changes).
 */
import type { ArmState, Platform, World, WorldObject } from "../core/types";
import { type Body, BOX, clean, makeBox, round6, setBoxAngle } from "./geometry";
import type { Engine } from "./engine";

export const ARM_LIFT = 300;              // mm of claw height at 90°
export const ARM_DEG_PER_S_AT_100 = 120;  // 50% = 60°/s
export const CLAW_REACH = 110;            // claw zone depth in front of the front face, mm
export const CLAW_HALF_W = 40;            // claw zone half-width, mm
export const CLAW_HOLD = 60;              // held object's centre, mm in front of the front face
export const JAW_BAND = 40;               // how far above the claw height the jaws reach, mm
export const CLAW_SECONDS = 0.3;          // claw open/close time
const REST_TOL = 2;                       // mm: a surface this far above an object's bottom still holds it
const DEG = Math.PI / 180;

const FLOOR = -1;
const HELD = -2;
const PLATFORM0 = -10;                     // support = PLATFORM0 - k  →  platform k

/** Object height in mm (contract default: disk 30, box = side). */
export function objectHeight(o: WorldObject): number {
  return typeof o.height === "number" && o.height > 0 ? o.height : o.shape === "disk" ? 30 : o.size;
}
export const zOf = (o: WorldObject): number => (typeof o.z === "number" && o.z > 0 ? o.z : 0);

/** Claw height (mm) at an arm angle. */
export function clawHeight(angle: number): number {
  return round6(ARM_LIFT * Math.sin(angle * DEG));
}

/** Is point (x,y) on the object's footprint (disk or rotated box)? */
export function onFootprint(o: WorldObject, x: number, y: number): boolean {
  const dx = x - o.x, dy = y - o.y;
  if (o.shape === "disk") return dx * dx + dy * dy <= (o.size / 2) * (o.size / 2) + 1e-6;
  const r = ((o.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const h = o.size / 2 + 1e-6;
  return Math.abs(lx) <= h && Math.abs(ly) <= h;
}

export function onPlatform(p: Platform, x: number, y: number): boolean {
  return Math.abs(x - p.x) <= p.w / 2 + 1e-6 && Math.abs(y - p.y) <= p.h / 2 + 1e-6;
}

/**
 * Stack levels by geometry (used by goals and renderers): level 1 = resting on the floor or a platform,
 * level n = on top of a level n−1 object. `skip` (held object id) counts as nothing. Returns per-object
 * level and the index of the object at the bottom of its stack.
 */
export function stackLevels(objects: readonly WorldObject[], skip: string | null): { level: number[]; base: number[] } {
  const n = objects.length;
  const level = new Array<number>(n).fill(0);
  const base = new Array<number>(n).fill(-1);
  const under = (i: number): number => {
    const b = objects[i], bz = zOf(b);
    if (bz <= 0) return -1;
    let best = -1, bestTop = -Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || objects[j].id === skip) continue;
      const a = objects[j], top = zOf(a) + objectHeight(a);
      if (Math.abs(top - bz) < 1 && top > bestTop && onFootprint(a, b.x, b.y)) { best = j; bestTop = top; }
    }
    return best;
  };
  const visit = (i: number, depth: number): void => {
    if (level[i] || depth > n) return;
    const j = objects[i].id === skip ? -1 : under(i);
    if (j < 0) { level[i] = 1; base[i] = i; return; }
    visit(j, depth + 1);
    level[i] = (level[j] || 1) + 1;
    base[i] = base[j] < 0 ? j : base[j];
  };
  for (let i = 0; i < n; i++) visit(i, 0);
  return { level, base };
}

type Resolver = { resolve: () => void; reject: (e: Error) => void };

export class ArmSystem {
  readonly fitted: boolean;
  readonly platforms: Platform[];
  readonly platformBodies: Body[];
  /** index of the object in the claw, or -1 */
  heldIndex = -1;
  velocity = 50;
  private e: Engine;
  /** Stack bookkeeping. match: kept in one object so two robots' arms can share the same objects' stacks. */
  private st: { support: Int32Array; relX: Float64Array; relY: Float64Array; order: number[] } =
    { support: new Int32Array(0), relX: new Float64Array(0), relY: new Float64Array(0), order: [] };
  private get support(): Int32Array { return this.st.support; }
  private set support(v: Int32Array) { this.st.support = v; }
  private get relX(): Float64Array { return this.st.relX; }
  private set relX(v: Float64Array) { this.st.relX = v; }
  private get relY(): Float64Array { return this.st.relY; }
  private set relY(v: Float64Array) { this.st.relY = v; }
  /** riders (objects resting on other objects), in the order they must be updated */
  private get order(): number[] { return this.st.order; }
  private set order(v: number[]) { this.st.order = v; }
  private holdOffset = 0;   // held object's bottom minus the claw height
  private holdRot = 0;      // held box rotation minus robot heading
  private motion: (Resolver & { target: number }) | null = null;
  private spinDir: -1 | 0 | 1 = 0;
  /** true if anything in this world can be elevated (keeps the hot path free for plain worlds) */
  private active: boolean;

  constructor(e: Engine, world: World) {
    this.e = e;
    this.fitted = !!world.hardware?.arm;
    this.platforms = (world.platforms ?? []).slice();
    this.platformBodies = this.platforms.map((p) => makeBox(p.x, p.y, p.w / 2, p.h / 2, 0));
    this.active = this.fitted || this.platforms.length > 0 || world.objects.some((o) => zOf(o) > 0);
  }

  private get arm(): ArmState | undefined { return this.e.state.arm; }

  /** match: use `other`'s stack bookkeeping (same shared objects), or a private copy again (null). */
  shareStack(other: ArmSystem | null): void {
    this.st = other ? other.st : { support: new Int32Array(0), relX: new Float64Array(0), relY: new Float64Array(0), order: [] };
  }

  /** match: is object i in a claw, or resting (directly or through a stack) on an object in a claw? */
  restsOnHeld(i: number): boolean {
    let k = i, guard = 0;
    while (k >= 0 && guard++ <= this.support.length) {
      const s = this.support[k];
      if (s === HELD) return true;
      k = s;
    }
    return false;
  }

  // ------------------------------------------------------------ lifecycle

  /** Called by Engine.restore() after objects/statics are rebuilt. */
  restore(): void {
    const e = this.e, s = e.state;
    if (this.fitted) s.arm = { angle: 0, clawClosed: false, holding: null };
    else if (s.arm) delete s.arm;
    this.heldIndex = -1;
    this.motion = null;
    this.spinDir = 0;
    this.velocity = 50;
    const n = s.objects.length;
    this.support = new Int32Array(n).fill(FLOOR);
    this.relX = new Float64Array(n);
    this.relY = new Float64Array(n);
    this.order = [];
    if (!this.active) return;
    for (let k = 0; k < this.platformBodies.length; k++) e.statics.push(this.platformBodies[k]);
    // settle elevated objects onto what is under them, lowest first
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (zOf(s.objects[i]) > 0) idx.push(i);
    idx.sort((a, b) => zOf(s.objects[a]) - zOf(s.objects[b]) || a - b);
    for (const i of idx) {
      const st = e.statics.indexOf(e.objBodies[i]);
      if (st >= 0) e.statics.splice(st, 1);
      this.rest(i, false);
    }
    this.rebuildOrder();
  }

  abort(): void {
    const m = this.motion;
    this.motion = null;
    this.spinDir = 0;
    if (m) m.reject(new Error("STOPPED"));
  }

  busy(): boolean { return this.motion !== null || this.spinDir !== 0; }

  // ------------------------------------------------------------ commands

  spinTo(deg: number): Promise<void> {
    const e = this.e;
    e.hasActed = true;
    this.endMotion();
    this.spinDir = 0;
    const target = deg < 0 ? 0 : deg > 90 ? 90 : deg;
    const p = new Promise<void>((resolve, reject) => {
      const a = this.arm;
      if (!a || Math.abs(a.angle - target) < 1e-9 || this.velocity <= 0) { resolve(); return; }
      this.motion = { target, resolve, reject };
    });
    p.catch(() => { /* STOPPED is handled by the caller */ });
    return p;
  }

  spin(dir: -1 | 0 | 1): void {
    this.e.hasActed = true;
    this.endMotion();
    this.spinDir = dir;
  }

  private endMotion(): void {
    const m = this.motion;
    this.motion = null;
    if (m) m.resolve();
  }

  claw(closed: boolean): Promise<void> {
    const e = this.e, a = this.arm;
    e.hasActed = true;
    if (a) {
      a.clawClosed = closed;
      if (closed) { if (this.heldIndex < 0) this.grab(); }
      else if (this.heldIndex >= 0) this.release();
    }
    return e.wait(CLAW_SECONDS);
  }

  // ------------------------------------------------------------ stepping

  /** One substep: arm motion, the held object, objects riding on others. */
  substep(dt: number): void {
    if (!this.active) return;
    const e = this.e;
    // the magnet took something that was up on a stack or in the claw: it's on the magnet now
    const ci = e.carryIndex;
    if (ci >= 0 && this.support[ci] !== FLOOR) {
      if (ci === this.heldIndex) { this.heldIndex = -1; if (this.arm) this.arm.holding = null; }
      this.support[ci] = FLOOR;
      e.state.objects[ci].z = 0;
      e.movable[ci] = true;
      this.rebuildOrder();
    }
    const a = this.arm;
    if (a && (this.motion || this.spinDir !== 0)) this.moveArm(a, dt);
    if (this.heldIndex >= 0) this.updateHeld();
    const ord = this.order;
    if (ord.length) {
      const objs = e.state.objects, bodies = e.objBodies;
      for (let k = 0; k < ord.length; k++) {
        const i = ord[k], j = this.support[i];
        if (j < 0) continue;
        const o = objs[i], b = objs[j], body = bodies[i];
        body.x = o.x = b.x + this.relX[i];
        body.y = o.y = b.y + this.relY[i];
        o.z = round6(zOf(b) + objectHeight(b));
      }
    }
  }

  private moveArm(a: ArmState, dt: number): void {
    const m = this.motion;
    const dir = m ? (m.target > a.angle ? 1 : -1) : this.spinDir;
    const step = (ARM_DEG_PER_S_AT_100 * this.velocity) / 100 * dt;
    if (step <= 0) { if (m) this.endMotion(); else this.spinDir = 0; return; }
    let next = a.angle + dir * step;
    let done = false;
    if (m && (dir > 0 ? next >= m.target : next <= m.target)) { next = m.target; done = true; }
    if (next >= 90) { next = 90; if (!m) done = true; }
    if (next <= 0) { next = 0; if (!m) done = true; }
    if (dir < 0) {
      const min = this.minAngle();
      if (next < min) { next = a.angle < min ? a.angle : min; done = true; } // blocked: rest on the surface
    }
    a.angle = round6(next);
    if (done) {
      if (m) this.endMotion(); else this.spinDir = 0;
    }
  }

  /** Lowest angle the arm can reach right now (what is under the claw). */
  private minAngle(): number {
    const s = this.e.state, r = s.robot;
    const rad = r.heading * DEG;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const half = s.robotSize / 2;
    let need = 0;
    const hi = this.heldIndex;
    let cx: number, cy: number, offset = 0;
    if (hi >= 0) {
      const o = s.objects[hi];
      cx = o.x; cy = o.y; offset = this.holdOffset;
    } else {
      cx = r.x + ux * (half + CLAW_HOLD); cy = r.y + uy * (half + CLAW_HOLD);
    }
    const ps = this.platforms;
    for (let k = 0; k < ps.length; k++) if (ps[k].height > need && onPlatform(ps[k], cx, cy)) need = ps[k].height;
    if (hi >= 0) {
      const bottom = zOf(s.objects[hi]);
      const objs = s.objects;
      for (let j = 0; j < objs.length; j++) {
        if (j === hi || this.ridesOn(j, hi)) continue;
        const top = zOf(objs[j]) + objectHeight(objs[j]);
        if (top > need && top <= bottom + REST_TOL && onFootprint(objs[j], cx, cy)) need = top;
      }
    }
    const h = need - offset;
    if (h <= 0) return 0;
    if (h >= ARM_LIFT) return 90;
    return Math.asin(h / ARM_LIFT) / DEG;
  }

  /** Does object j rest (directly or indirectly) on object i? */
  private ridesOn(j: number, i: number): boolean {
    let k = this.support[j], guard = 0;
    while (k >= 0 && guard++ < this.support.length) {
      if (k === i) return true;
      k = this.support[k];
    }
    return false;
  }

  private holdDist(o: WorldObject): number {
    return Math.max(CLAW_HOLD, o.size / 2 + 4);
  }

  private updateHeld(): void {
    const e = this.e, s = e.state, i = this.heldIndex, a = this.arm;
    const o = s.objects[i], b = e.objBodies[i], r = s.robot;
    const rad = r.heading * DEG;
    const d = s.robotSize / 2 + this.holdDist(o);
    b.x = o.x = r.x + clean(Math.sin(rad)) * d;
    b.y = o.y = r.y + clean(Math.cos(rad)) * d;
    o.z = round6(Math.max(0, clawHeight(a ? a.angle : 0) + this.holdOffset));
    if (b.kind === BOX) {
      o.rotation = r.heading + this.holdRot;
      setBoxAngle(b, o.rotation);
    }
  }

  // ------------------------------------------------------------ grab / release

  private grab(): void {
    const e = this.e, s = e.state, a = this.arm;
    if (!a) return;
    const half = s.robotSize / 2;
    const r = s.robot;
    const rad = r.heading * DEG;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const fx = r.x + ux * half, fy = r.y + uy * half; // centre of the front face
    const ch = clawHeight(a.angle);
    let best = -1, bestScore = Infinity;
    const objs = s.objects;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (!o.pickable || i === e.carryIndex || e.isForeign(i)) continue; // match: not from the other robot
      const dx = o.x - fx, dy = o.y - fy;
      const f = dx * ux + dy * uy;
      const l = -dx * uy + dy * ux;
      if (f < 0 || f > CLAW_REACH || Math.abs(l) > CLAW_HALF_W) continue;
      const z = zOf(o), h = objectHeight(o);
      if (!(z < ch + JAW_BAND && z + h > ch - 5)) continue;
      const score = Math.abs(z - ch) * 1000 + f;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return;
    const o = objs[best];
    this.heldIndex = best;
    this.support[best] = HELD;
    this.holdOffset = Math.max(-objectHeight(o) + 5, Math.min(JAW_BAND, zOf(o) - ch));
    this.holdRot = (o.rotation ?? 0) - r.heading;
    e.movable[best] = false;
    const st = e.statics.indexOf(e.objBodies[best]);
    if (st >= 0) e.statics.splice(st, 1);
    a.holding = o.id;
    this.updateHeld();
    this.rebuildOrder();
    e.emit({ type: "pickedUp", objectId: o.id, time: s.time });
  }

  private release(): void {
    const e = this.e, s = e.state, i = this.heldIndex;
    this.heldIndex = -1;
    if (this.arm) this.arm.holding = null;
    const o = s.objects[i];
    if (o.shape === "box") { o.rotation = ((o.rotation ?? 0) % 360 + 360) % 360; setBoxAngle(e.objBodies[i], o.rotation); }
    o.x = round6(o.x); o.y = round6(o.y);
    e.objBodies[i].x = o.x; e.objBodies[i].y = o.y;
    this.rest(i, true);
    this.rebuildOrder();
    // riders keep riding: put them on their new heights straight away
    this.substepRiders();
    e.emit({ type: "dropped", objectId: o.id, time: s.time });
  }

  private substepRiders(): void {
    const objs = this.e.state.objects;
    for (const i of this.order) {
      const j = this.support[i];
      if (j >= 0) objs[i].z = round6(zOf(objs[j]) + objectHeight(objs[j]));
    }
  }

  /**
   * Put object i on the highest surface under its centre that is not above its bottom
   * (+ REST_TOL): a platform, another object's top, or the floor.
   */
  private rest(i: number, settle: boolean): void {
    const e = this.e, s = e.state, o = s.objects[i];
    const bottom = zOf(o);
    let surface = 0, sup = FLOOR;
    const ps = this.platforms;
    for (let k = 0; k < ps.length; k++) {
      const h = ps[k].height;
      if (h > surface && h <= bottom + REST_TOL && onPlatform(ps[k], o.x, o.y)) { surface = h; sup = PLATFORM0 - k; }
    }
    const objs = s.objects;
    for (let j = 0; j < objs.length; j++) {
      if (j === i || this.support[j] === HELD || j === e.carryIndex || e.isForeign(j) || this.ridesOn(j, i)) continue; // match
      const top = zOf(objs[j]) + objectHeight(objs[j]);
      if (top > surface && top <= bottom + REST_TOL && onFootprint(objs[j], o.x, o.y)) { surface = top; sup = j; }
    }
    this.support[i] = sup;
    if (sup === FLOOR) {
      o.z = 0;
      e.movable[i] = o.movable || o.pickable;
      if (!e.movable[i]) { if (e.statics.indexOf(e.objBodies[i]) < 0) e.statics.push(e.objBodies[i]); }
      else if (settle) { e.awake[i] = 1; e.settleObjects(); }
    } else {
      o.z = round6(surface);
      e.movable[i] = false;
      if (sup >= 0) { this.relX[i] = o.x - objs[sup].x; this.relY[i] = o.y - objs[sup].y; }
    }
  }

  /** Riders sorted so each one is updated after what it rests on. */
  private rebuildOrder(): void {
    const n = this.support.length;
    const depth = new Int32Array(n);
    const d = (i: number): number => {
      let k = this.support[i], c = 0;
      while (k >= 0 && c <= n) { c++; k = this.support[k]; }
      return c;
    };
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (this.support[i] >= 0) { depth[i] = d(i); out.push(i); }
    out.sort((a, b) => depth[a] - depth[b] || a - b);
    this.order = out;
  }
}
