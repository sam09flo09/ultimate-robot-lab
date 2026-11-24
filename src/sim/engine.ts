/**
 * The simulation core: robot motion, collisions, pushing, magnet, pen, path, zones.
 * Time advances only in step(); fixed substep of 1/120 s. Deterministic for a given dt sequence.
 */
import type { ColorName, GoalResult, SimEvent, SimState, World, WorldObject } from "../core/types";
import {
  type Body, type Hit, BOX, CIRCLE, clean, collide, makeBox, makeCircle, makeWallBody,
  normDeg, pointInZone, round6, setBoxAngle,
} from "./geometry";
import { castRay, DISTANCE_MAX, FRONT_RANGE, objectInFront } from "./sensors";
import { evaluateGoals, isEndStateGoal } from "./goals";

export const SUBSTEP = 1 / 120;
export const ROBOT_SIZE = 140;
export const DRIVE_MM_PER_S_AT_100 = 800;
export const TURN_DEG_PER_S_AT_100 = 360;
export const PEN_WIDTH = 6;
/** Driver control: distance between the two wheels (mm). Wheel rim speed at 100% = DRIVE_MM_PER_S_AT_100. */
export const TRACK_WIDTH = 120;
/** Wheel motion is split so no point of the robot moves more than this per collision pass (mm);
 *  the same as the fastest drive() step, so spinning at full speed can't tunnel through walls. */
const MAX_WHEEL_PIECE = 7;
const MAX_STEP_DT = 0.5;          // ignore huge frame gaps (tab was hidden etc.)
const PATH_SPACING = 10;
const PEN_SPACING = 2;
const MAX_PATH_POINTS = 20000;
const BLOCKED_SUBSTEPS = 3;       // consecutive near-zero-progress substeps before drive_for gives up
const SETTLE_SECONDS = 0.3;       // idle time needed before end-state goals count as complete
const ITERATIONS = 4;
const STATIC_ITERATIONS = 4;      // robot-vs-walls/border resolution passes per substep
const PENETRATION_SLOP = 0.01;    // mm of extra overlap tolerated before a move is undone

type Resolver = { resolve: () => void; reject: (e: Error) => void };

type Motion =
  | (Resolver & { kind: "driveFor"; sign: number; remaining: number; total: number; x0: number; y0: number; deflected: boolean; blocked: number })
  | (Resolver & { kind: "turnFor"; sign: number; remaining: number; total: number; h0: number; rot0: number; blocked: number })
  | { kind: "drive"; sign: number }
  | { kind: "turn"; sign: number }
  /** driver control: independent wheel speeds in percent (-100..100), runs until superseded */
  | { kind: "wheels"; left: number; right: number };

interface Waiter extends Resolver { until: number; }

export function stoppedError(): Error { return new Error("STOPPED"); }

function noop(): void { /* swallow */ }

function cloneObjects(objs: readonly WorldObject[]): WorldObject[] {
  return objs.map((o) => ({ ...o }));
}

function objectBody(o: WorldObject): Body {
  return o.shape === "box" ? makeBox(o.x, o.y, o.size / 2, o.size / 2, o.rotation ?? 0) : makeCircle(o.x, o.y, o.size / 2);
}

export class Engine {
  readonly world: World;
  readonly state: SimState;
  readonly half: number;          // robot half-size (half the side of its square footprint)
  readonly halfW: number;
  readonly halfH: number;
  readonly hasPen: boolean;
  readonly hasMagnet: boolean;

  /** walls + immovable objects */
  statics: Body[] = [];
  private wallBodies: Body[];
  /** one body per state.objects entry (same index) */
  objBodies: Body[] = [];
  private movable: boolean[] = [];
  private awake: Uint8Array = new Uint8Array(0);
  carryIndex = -1;
  private carryRel = 0;

  /** The robot's collision shape: an oriented square of side ROBOT_SIZE (= state.robotSize). */
  private robotBox: Body;
  /** Penetration into walls/border the robot was left with after the last substep (normally 0). */
  private residual = 0;
  private hit: Hit = { nx: 0, ny: 0, depth: 0 };

  motion: Motion | null = null;
  private waiters: Waiter[] = [];
  driveVel = 50;
  turnVel = 50;
  gyroOffset = 0;
  rotation = 0;
  timerStart = 0;

  private acc = 0;
  private touchingStatic = false;
  private zoneInside: boolean[] = [];
  zoneEntries: string[] = [];
  activeTime = 0;
  private idleSince = 0;
  hasActed = false;
  private goalsDone = false;
  private needsSettle: boolean;
  private listeners: Array<(e: SimEvent) => void> = [];
  private lastPathX = 0;
  private lastPathY = 0;

  constructor(world: World) {
    this.world = world;
    this.half = ROBOT_SIZE / 2;
    this.halfW = world.width / 2;
    this.halfH = world.height / 2;
    this.hasPen = !!world.hardware?.pen;
    this.hasMagnet = !!world.hardware?.magnet;
    this.needsSettle = world.goals.some(isEndStateGoal);
    this.wallBodies = world.walls.map((w) => makeWallBody(w.a, w.b, w.thickness));
    this.robotBox = makeBox(0, 0, this.half, this.half, 0);
    this.state = {
      time: 0,
      robot: { x: 0, y: 0, heading: 0 },
      robotSize: ROBOT_SIZE,
      objects: [],
      carrying: null,
      penDown: false,
      penColor: "BLACK",
      strokes: [],
      path: [],
      wallHits: 0,
      bumperPressed: false,
      distanceRay: null,
      visitedZones: [],
    };
    this.restore();
  }

  // ------------------------------------------------------------ lifecycle

  onEvent(cb: (e: SimEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(e: SimEvent): void {
    const ls = this.listeners.slice();
    for (let i = 0; i < ls.length; i++) {
      try { ls[i](e); } catch (err) { console.error(err); }
    }
  }

  abort(): void {
    const m = this.motion;
    this.motion = null;
    if (m && "reject" in m) m.reject(stoppedError());
    const ws = this.waiters;
    this.waiters = [];
    for (let i = 0; i < ws.length; i++) ws[i].reject(stoppedError());
  }

  reset(): void {
    this.abort();
    this.restore();
  }

  private restore(): void {
    const w = this.world, s = this.state;
    s.time = 0;
    s.robot = { x: w.start.x, y: w.start.y, heading: normDeg(w.start.heading) };
    s.objects = cloneObjects(w.objects);
    s.carrying = null;
    s.penDown = false;
    s.penColor = "BLACK";
    s.strokes = [];
    s.path = [{ x: s.robot.x, y: s.robot.y }];
    s.wallHits = 0;
    s.bumperPressed = false;
    s.distanceRay = null;
    s.visitedZones = [];

    this.objBodies = s.objects.map(objectBody);
    this.movable = s.objects.map((o) => o.movable || o.pickable);
    this.awake = new Uint8Array(s.objects.length);
    this.statics = this.wallBodies.slice();
    for (let i = 0; i < s.objects.length; i++) if (!this.movable[i]) this.statics.push(this.objBodies[i]);
    this.carryIndex = -1;

    this.motion = null;
    this.waiters = [];
    this.driveVel = 50;
    this.turnVel = 50;
    this.gyroOffset = 0;
    this.rotation = s.robot.heading;
    this.timerStart = 0;
    this.acc = 0;
    this.zoneEntries = [];
    this.activeTime = 0;
    this.idleSince = 0;
    this.hasActed = false;
    this.goalsDone = false;
    this.lastPathX = s.robot.x;
    this.lastPathY = s.robot.y;

    this.zoneInside = w.zones.map(() => false);
    this.updateRobotBodies();
    this.residual = this.measureStatics();
    this.touchingStatic = true; // starting against a wall is not a hit
    this.updateContacts();
    this.touchingStatic = this.contactNow;
    this.updateZones();
    this.updateDistanceRay();
  }

  // ------------------------------------------------------------ motion commands (used by controller)

  /** End the current motion (resolving its promise), if any. */
  endMotion(): void {
    const m = this.motion;
    if (!m) return;
    this.motion = null;
    this.finishMarks();
    if ("resolve" in m) m.resolve();
  }

  private track(p: Promise<void>): Promise<void> {
    p.catch(noop); // avoid unhandled-rejection noise when a caller ignores a STOPPED promise
    return p;
  }

  startDriveFor(sign: number, mm: number): Promise<void> {
    this.endMotion();
    this.hasActed = true;
    return this.track(new Promise<void>((resolve, reject) => {
      const r = this.state.robot;
      this.motion = { kind: "driveFor", sign, remaining: mm, total: mm, x0: r.x, y0: r.y, deflected: false, blocked: 0, resolve, reject };
    }));
  }

  startTurnFor(sign: number, deg: number): Promise<void> {
    this.endMotion();
    this.hasActed = true;
    return this.track(new Promise<void>((resolve, reject) => {
      this.motion = { kind: "turnFor", sign, remaining: deg, total: deg, h0: this.state.robot.heading, rot0: this.rotation, blocked: 0, resolve, reject };
    }));
  }

  startDrive(sign: number): void { this.endMotion(); this.hasActed = true; this.motion = { kind: "drive", sign }; }
  startTurn(sign: number): void { this.endMotion(); this.hasActed = true; this.motion = { kind: "turn", sign }; }

  /** Driver control: spin the wheels at these percents. 0,0 stops (like stop()). Updating an
   *  existing wheel motion keeps it (no path/pen point forced on every call of a driver loop). */
  setWheels(left: number, right: number): void {
    if (left === 0 && right === 0) { this.endMotion(); return; }
    const m = this.motion;
    if (m && m.kind === "wheels") { m.left = left; m.right = right; return; }
    this.endMotion();
    this.hasActed = true;
    this.motion = { kind: "wheels", left, right };
  }

  wait(seconds: number): Promise<void> {
    this.hasActed = true;
    const until = this.state.time + (seconds > 0 ? seconds : 0);
    return this.track(new Promise<void>((resolve, reject) => { this.waiters.push({ until, resolve, reject }); }));
  }

  // ------------------------------------------------------------ hardware

  setPenDown(down: boolean): void {
    const s = this.state;
    this.hasActed = true;
    if (down === s.penDown) return;
    s.penDown = down;
    if (down) this.newStroke();
    else this.penPoint(true);
  }

  setPenColor(c: ColorName): void {
    const s = this.state;
    if (c === s.penColor) return;
    s.penColor = c;
    if (s.penDown) this.newStroke();
  }

  private newStroke(): void {
    const s = this.state;
    s.strokes.push({ color: s.penColor, width: PEN_WIDTH, points: [{ x: s.robot.x, y: s.robot.y }] });
  }

  magnetOn(): void {
    this.hasActed = true;
    if (this.carryIndex >= 0) return;
    const s = this.state, r = s.robot;
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const i = objectInFrontIdx(this, ux, uy, true);
    if (i < 0) return;
    const o = s.objects[i];
    this.carryIndex = i;
    this.carryRel = (o.rotation ?? 0) - r.heading;
    s.carrying = o.id;
    this.updateCarried();
    this.emit({ type: "pickedUp", objectId: o.id, time: s.time });
  }

  magnetOff(): void {
    this.hasActed = true;
    const i = this.carryIndex;
    if (i < 0) return;
    const s = this.state;
    const o = s.objects[i];
    this.carryIndex = -1;
    s.carrying = null;
    if (o.shape === "box") o.rotation = normDeg(o.rotation ?? 0);
    o.x = round6(o.x); o.y = round6(o.y);
    this.objBodies[i].x = o.x; this.objBodies[i].y = o.y;
    this.awake[i] = 1;
    this.settleObjects();
    this.emit({ type: "dropped", objectId: o.id, time: s.time });
  }

  // ------------------------------------------------------------ stepping

  step(dt: number): void {
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_STEP_DT) dt = MAX_STEP_DT;
    this.acc += dt;
    while (this.acc >= SUBSTEP - 1e-9) {
      this.acc -= SUBSTEP;
      this.substep();
    }
    if (this.acc < 0) this.acc = 0;
    this.updateDistanceRay();
    this.checkGoals();
  }

  private busy(): boolean { return this.motion !== null || this.waiters.length > 0; }

  private substep(): void {
    const s = this.state, r = s.robot, dt = SUBSTEP;
    if (this.busy()) { this.activeTime = s.time + dt; this.idleSince = s.time + dt; }
    s.time += dt;

    const m = this.motion;
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const px = r.x, py = r.y, ph = r.heading, prot = this.rotation;
    let intended = 0, moved = 0; // moved = mm driven or degrees turned this substep

    let reverted = false;
    if (m && m.kind === "wheels") {
      this.wheelMotion(m.left, m.right);
    } else {
      if (m) {
        if (m.kind === "driveFor" || m.kind === "drive") {
          const v = (DRIVE_MM_PER_S_AT_100 * this.driveVel) / 100;
          let d = v * dt;
          if (m.kind === "driveFor" && d > m.remaining) d = m.remaining;
          if (d > 0) {
            r.x += ux * d * m.sign;
            r.y += uy * d * m.sign;
            intended = d;
            moved = d;
          }
          if (m.kind === "driveFor") {
            m.remaining -= d;
            if (v <= 0) m.remaining = 0; // 0% velocity: end instead of hanging
          }
        } else {
          const w = (TURN_DEG_PER_S_AT_100 * this.turnVel) / 100;
          let a = w * dt;
          if (m.kind === "turnFor") {
            if (a > m.remaining) a = m.remaining;
            m.remaining -= a;
            if (w <= 0) m.remaining = 0;
          }
          if (a > 0) {
            const h = r.heading + a * m.sign;
            r.heading = h >= 360 ? h - 360 : h < 0 ? h + 360 : h;
            this.rotation += a * m.sign;
            moved = a;
          }
        }
      }

      // Push the robot out of what it ran (or swung its corners) into. If it cannot get
      // clear -- a turn in a gap narrower than its diagonal, a wedge-shaped corner -- the
      // move is undone instead, so the square never ends up overlapping a wall.
      const residual = this.resolveCollisions();
      if (residual > this.residual + PENETRATION_SLOP) {
        r.x = px; r.y = py; r.heading = ph; this.rotation = prot;
        if (m && "remaining" in m) m.remaining += moved;
        this.updateRobotBodies();
        reverted = true;
      } else {
        this.residual = residual;
      }
    }
    this.updateCarried();
    this.updateContacts();

    if (m && m === this.motion) {
      if (m.kind === "driveFor") {
        if (intended > 0) {
          const prog = ((r.x - px) * ux + (r.y - py) * uy) * m.sign;
          if (Math.abs(prog - intended) > 1e-6 || Math.abs((r.x - px) * uy - (r.y - py) * ux) > 1e-6) m.deflected = true;
          m.blocked = prog < intended * 0.6 ? m.blocked + 1 : 0; // steep hits stop; grazing contacts slide
        }
        if (m.remaining <= 1e-9) {
          if (!m.deflected) {
            r.x = round6(m.x0 + ux * m.total * m.sign);
            r.y = round6(m.y0 + uy * m.total * m.sign);
            this.updateRobotBodies();
            this.updateCarried();
          }
          this.endMotion();
        } else if (m.blocked >= BLOCKED_SUBSTEPS) {
          r.x = round6(r.x); r.y = round6(r.y);
          this.endMotion();
        }
      } else if (m.kind === "turnFor") {
        if (moved > 0) m.blocked = reverted ? m.blocked + 1 : 0;
        if (m.remaining <= 1e-9) {
          r.heading = normDeg(m.h0 + m.total * m.sign);
          this.rotation = round6(m.rot0 + m.total * m.sign);
          this.updateRobotBodies();
          this.updateCarried();
          this.endMotion();
        } else if (m.blocked >= BLOCKED_SUBSTEPS) {
          // wedged: a blocked turn_for ends early, like a blocked drive_for
          r.heading = normDeg(r.heading);
          this.rotation = round6(this.rotation);
          r.x = round6(r.x); r.y = round6(r.y);
          this.updateRobotBodies();
          this.updateCarried();
          this.endMotion();
        }
      }
    }

    // waits
    if (this.waiters.length) {
      const t = s.time + 1e-9;
      for (let i = 0; i < this.waiters.length; i++) {
        const w = this.waiters[i];
        if (w.until <= t) { this.waiters.splice(i, 1); i--; w.resolve(); }
      }
    }

    this.penPoint(false);
    this.pathPoint(false);
    this.updateZones();
  }

  /**
   * Differential drive for one substep: exact arc integration (constant wheel speeds), split into
   * pieces short enough that collisions are resolved as finely as for drive()/turn(). Each piece is
   * pushed out of walls like any other move, and undone if it can't get clear.
   */
  private wheelMotion(leftPct: number, rightPct: number): void {
    const r = this.state.robot;
    const vl = (DRIVE_MM_PER_S_AT_100 * leftPct) / 100, vr = (DRIVE_MM_PER_S_AT_100 * rightPct) / 100;
    const v = (vl + vr) / 2;               // mm/s along the heading
    const w = (vl - vr) / TRACK_WIDTH;     // rad/s, clockwise positive (like heading)
    const sweep = (Math.abs(v) + Math.abs(w) * this.half * Math.SQRT2) * SUBSTEP; // fastest corner
    const n = Math.max(1, Math.ceil(sweep / MAX_WHEEL_PIECE - 1e-9));
    const dt = SUBSTEP / n;
    for (let i = 0; i < n; i++) {
      const px = r.x, py = r.y, ph = r.heading, prot = this.rotation;
      const h0 = (ph * Math.PI) / 180;
      const dth = w * dt;
      if (dth === 0) {
        const d = v * dt;
        r.x += clean(Math.sin(h0)) * d;
        r.y += clean(Math.cos(h0)) * d;
      } else {
        const R = v / w, h1 = h0 + dth;
        r.x += R * (Math.cos(h0) - Math.cos(h1));
        r.y += R * (Math.sin(h1) - Math.sin(h0));
        const dDeg = (dth * 180) / Math.PI;
        const h = ph + dDeg;
        r.heading = h >= 360 ? h - 360 : h < 0 ? h + 360 : h;
        this.rotation += dDeg;
      }
      const residual = this.resolveCollisions();
      if (residual > this.residual + PENETRATION_SLOP) {
        r.x = px; r.y = py; r.heading = ph; this.rotation = prot;
        this.updateRobotBodies();
      } else {
        this.residual = residual;
      }
    }
  }

  // ------------------------------------------------------------ collision handling

  updateRobotBodies(): void {
    const r = this.state.robot;
    this.robotBox.x = r.x; this.robotBox.y = r.y;
    setBoxAngle(this.robotBox, r.heading);
  }

  private moveObj(i: number, dx: number, dy: number): void {
    const b = this.objBodies[i], o = this.state.objects[i];
    b.x += dx; b.y += dy;
    o.x = b.x; o.y = b.y;
  }

  private clampToBorder(i: number): void {
    const b = this.objBodies[i];
    let ex: number, ey: number;
    if (b.kind === CIRCLE) { ex = b.r; ey = b.r; }
    else { ex = b.hx * Math.abs(b.c) + b.hy * Math.abs(b.s); ey = b.hx * Math.abs(b.s) + b.hy * Math.abs(b.c); }
    const lx = this.halfW - ex, ly = this.halfH - ey;
    let nx = b.x, ny = b.y;
    if (nx > lx) nx = lx; else if (nx < -lx) nx = -lx;
    if (ny > ly) ny = ly; else if (ny < -ly) ny = -ly;
    if (nx !== b.x || ny !== b.y) this.moveObj(i, nx - b.x, ny - b.y);
  }

  /** Resolve awake objects against statics, the border and each other. */
  private settleObjects(): void {
    const bodies = this.objBodies, n = bodies.length, hit = this.hit, statics = this.statics;
    for (let i = 0; i < n; i++) {
      if (!this.awake[i] || i === this.carryIndex || !this.movable[i]) continue;
      const bi = bodies[i];
      for (let k = 0; k < statics.length; k++) {
        if (collide(statics[k], bi, hit)) this.moveObj(i, hit.nx * hit.depth, hit.ny * hit.depth);
      }
      this.clampToBorder(i);
      for (let j = 0; j < n; j++) {
        if (j === i || j === this.carryIndex || !this.movable[j]) continue;
        if (collide(bi, bodies[j], hit)) {
          const h = hit.depth / 2;
          this.moveObj(i, -hit.nx * h, -hit.ny * h);
          this.moveObj(j, hit.nx * h, hit.ny * h);
          this.awake[j] = 1;
        }
      }
    }
  }

  /** Returns the robot's remaining penetration into walls/immovable objects/border (0 = clear). */
  private resolveCollisions(): number {
    const s = this.state, r = s.robot, hit = this.hit;
    const bodies = this.objBodies, n = bodies.length;
    this.updateRobotBodies();

    // robot pushes movable objects; objects resolve against the world
    if (n > 0) {
      for (let it = 0; it < ITERATIONS; it++) {
        let pushed = false;
        for (let i = 0; i < n; i++) {
          if (!this.movable[i] || i === this.carryIndex) continue;
          if (collide(this.robotBox, bodies[i], hit)) {
            const d = hit.depth + 1e-4;
            this.moveObj(i, hit.nx * d, hit.ny * d);
            this.awake[i] = 1;
            pushed = true;
          }
        }
        if (!pushed) break;
        this.settleObjects();
      }
      // anything still overlapping is stuck: it pushes the robot back
      for (let i = 0; i < n; i++) {
        if (!this.movable[i] || i === this.carryIndex) continue;
        if (collide(this.robotBox, bodies[i], hit)) {
          r.x -= hit.nx * hit.depth; r.y -= hit.ny * hit.depth;
          this.robotBox.x = r.x; this.robotBox.y = r.y;
        }
      }
      this.awake.fill(0);
    }

    // robot (oriented square) vs walls, immovable objects, border: minimal push-out
    const statics = this.statics, box = this.robotBox;
    box.x = r.x; box.y = r.y;
    const e = this.borderExtent();
    const lx = this.halfW - e, ly = this.halfH - e;
    for (let it = 0; it < STATIC_ITERATIONS; it++) {
      let moved = false;
      for (let k = 0; k < statics.length; k++) {
        if (collide(box, statics[k], hit)) {
          r.x -= hit.nx * hit.depth; r.y -= hit.ny * hit.depth;
          box.x = r.x; box.y = r.y;
          if (hit.depth > 1e-9) moved = true;
        }
      }
      if (r.x > lx) { r.x = lx; moved = true; } else if (r.x < -lx) { r.x = -lx; moved = true; }
      if (r.y > ly) { r.y = ly; moved = true; } else if (r.y < -ly) { r.y = -ly; moved = true; }
      box.x = r.x; box.y = r.y;
      if (!moved) return 0;
    }
    return this.measureStatics();
  }

  /** Half the robot's extent along x (= along y) at its current heading: 70 axis-aligned, ~99 at 45°. */
  private borderExtent(): number {
    const b = this.robotBox;
    return this.half * (Math.abs(b.c) + Math.abs(b.s));
  }

  /** Deepest current overlap of the robot with walls, immovable objects or the border (0 if none). */
  private measureStatics(): number {
    const r = this.state.robot, hit = this.hit, statics = this.statics, box = this.robotBox;
    let worst = 0;
    for (let k = 0; k < statics.length; k++) {
      if (collide(box, statics[k], hit) && hit.depth > worst) worst = hit.depth;
    }
    const e = this.borderExtent();
    const ox = Math.abs(r.x) + e - this.halfW, oy = Math.abs(r.y) + e - this.halfH;
    if (ox > worst) worst = ox;
    if (oy > worst) worst = oy;
    return worst;
  }

  private contactNow = false;

  /** Bumper + wall-hit bookkeeping. */
  private updateContacts(): void {
    const s = this.state, r = s.robot, hit = this.hit;
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const PAD = 2, FRONT = 0.5;
    let touchNow = false, still = false, bumper = false;
    const statics = this.statics, box = this.robotBox;
    for (let k = 0; k < statics.length; k++) {
      if (collide(box, statics[k], hit, PAD)) {
        still = true;
        if (hit.depth > PAD - 1) {
          touchNow = true;
          if (hit.nx * ux + hit.ny * uy > FRONT) bumper = true;
        }
      }
    }
    // border (outward normals +x, -x, +y, -y)
    const ext = this.borderExtent();
    const gx = this.halfW - ext, gy = this.halfH - ext;
    for (let k = 0; k < 4; k++) {
      const gap = k === 0 ? gx - r.x : k === 1 ? gx + r.x : k === 2 ? gy - r.y : gy + r.y;
      if (gap >= PAD) continue;
      still = true;
      if (gap < 1) {
        touchNow = true;
        const dot = k === 0 ? ux : k === 1 ? -ux : k === 2 ? uy : -uy;
        if (dot > FRONT) bumper = true;
      }
    }
    // movable objects touching the front of the robot also press the bumper
    if (!bumper) {
      const bodies = this.objBodies;
      for (let i = 0; i < bodies.length; i++) {
        if (!this.movable[i] || i === this.carryIndex) continue;
        if (collide(this.robotBox, bodies[i], hit, PAD) && hit.depth > PAD - 1 && hit.nx * ux + hit.ny * uy > FRONT) { bumper = true; break; }
      }
    }
    s.bumperPressed = bumper;
    this.contactNow = touchNow;
    if (!this.touchingStatic && touchNow) {
      s.wallHits++;
      this.emit({ type: "wallHit", time: s.time });
    }
    this.touchingStatic = this.touchingStatic ? still : touchNow;
  }

  private updateCarried(): void {
    const i = this.carryIndex;
    if (i < 0) return;
    const r = this.state.robot, o = this.state.objects[i], b = this.objBodies[i];
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const d = this.half + o.size / 2 + 1;
    b.x = o.x = r.x + ux * d;
    b.y = o.y = r.y + uy * d;
    if (b.kind === BOX) {
      o.rotation = r.heading + this.carryRel;
      setBoxAngle(b, o.rotation);
    }
  }

  // ------------------------------------------------------------ bookkeeping

  /** Called when a motion ends: exact end point on path and pen stroke. */
  private finishMarks(): void {
    this.penPoint(true);
    this.pathPoint(true);
  }

  private penPoint(force: boolean): void {
    const s = this.state;
    if (!s.penDown || !s.strokes.length) return;
    const pts = s.strokes[s.strokes.length - 1].points;
    const last = pts[pts.length - 1], r = s.robot;
    const dx = r.x - last.x, dy = r.y - last.y, d2 = dx * dx + dy * dy;
    if (d2 >= PEN_SPACING * PEN_SPACING || (force && d2 > 1e-4)) pts.push({ x: r.x, y: r.y });
  }

  private pathPoint(force: boolean): void {
    const s = this.state, r = s.robot;
    const dx = r.x - this.lastPathX, dy = r.y - this.lastPathY, d2 = dx * dx + dy * dy;
    if (d2 > PATH_SPACING * PATH_SPACING || (force && d2 > 1e-4)) {
      s.path.push({ x: r.x, y: r.y });
      this.lastPathX = r.x; this.lastPathY = r.y;
      if (s.path.length > MAX_PATH_POINTS) s.path.splice(0, s.path.length - MAX_PATH_POINTS);
    }
  }

  private updateZones(): void {
    const zones = this.world.zones, s = this.state, r = s.robot;
    for (let i = 0; i < zones.length; i++) {
      const inside = pointInZone(zones[i], r.x, r.y);
      if (inside && !this.zoneInside[i]) {
        const id = zones[i].id;
        this.zoneEntries.push(id);
        if (s.visitedZones.indexOf(id) < 0) {
          s.visitedZones.push(id);
          this.emit({ type: "zoneEntered", zoneId: id, time: s.time });
        }
      }
      this.zoneInside[i] = inside;
    }
  }

  /** Distance (mm) from the robot's front face to the first thing straight ahead, or Infinity. */
  rawDistance(): number {
    const r = this.state.robot;
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    return castRay(r.x + ux * this.half, r.y + uy * this.half, ux, uy, this.halfW, this.halfH, this.statics, this.objBodies, this.carryIndex);
  }

  private updateDistanceRay(): void {
    const s = this.state, r = s.robot;
    const t = this.rawDistance();
    if (!(t <= DISTANCE_MAX)) { s.distanceRay = null; return; }
    const rad = (r.heading * Math.PI) / 180;
    const ux = clean(Math.sin(rad)), uy = clean(Math.cos(rad));
    const fx = r.x + ux * this.half, fy = r.y + uy * this.half;
    let ray = s.distanceRay;
    if (!ray) ray = s.distanceRay = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, hit: true };
    ray.from.x = fx; ray.from.y = fy;
    ray.to.x = fx + ux * t; ray.to.y = fy + uy * t;
    ray.hit = true;
  }

  private checkGoals(): void {
    if (this.goalsDone || !this.world.goals.length || !this.hasActed) return;
    if (this.needsSettle && (this.busy() || this.state.time - this.idleSince < SETTLE_SECONDS - 1e-9)) return;
    const res = this.evaluateGoals();
    for (let i = 0; i < res.length; i++) if (!res[i].passed) return;
    this.goalsDone = true;
    this.emit({ type: "goalsComplete", time: this.state.time });
  }

  evaluateGoals(): GoalResult[] {
    return evaluateGoals({
      world: this.world,
      state: this.state,
      zoneEntries: this.zoneEntries,
      activeTime: this.busy() ? this.state.time : this.activeTime,
    });
  }
}

/** Index of the object in front (see sensors.objectInFront) for the engine's current pose. */
export function objectInFrontIdx(e: Engine, ux: number, uy: number, pickableOnly: boolean): number {
  const r = e.state.robot;
  return objectInFront(r.x, r.y, ux, uy, e.half, e.state.objects, e.carryIndex, FRONT_RANGE, pickableOnly);
}
