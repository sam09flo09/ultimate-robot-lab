/**
 * Robot Lab 3D renderer (three.js). Public entry: createRenderer3D(canvas, opts), webglSupported().
 *
 * A 3D VIEW of the same World + SimState the 2D renderer draws; the simulation stays 2D.
 * Scene scale: 1 unit = 1 mm. World (x, y) → three (x, 0, -y); robot heading h → rotation.y = -h.
 *
 * Static per world (rebuilt only when the world object identity changes, showZones changes,
 * invalidate() or setQuality()):
 *   - floor: paint, grid / numbered squares and zones in ONE CanvasTexture on a plane
 *   - walls (incl. the implicit, lower border) in one InstancedMesh
 * Dynamic, reused between frames:
 *   - object meshes by id, robot model, distance ray, pen strokes + path as ribbon meshes that are
 *     appended incrementally (partial buffer uploads).
 * The app drives frames by calling draw(); there is no internal animation loop.
 */
import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
  DirectionalLight, DynamicDrawUsage, Euler, HemisphereLight, InstancedMesh, Line, LineBasicMaterial,
  LinearMipmapLinearFilter, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry, Quaternion, Raycaster, Scene, SphereGeometry,
  SRGBColorSpace, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer,
} from "three";
import type { CameraMode, Quality, RenderOptions, Renderer3D, Renderer3DOptions } from "../core/modules";
import type { ColorName, PenStroke, SimState, Vec, World, WorldObject } from "../core/types";
import { COLOR_HEX } from "../core/types";
import { paintFloor } from "./floorTexture";
import {
  DEG, FrameTimer, RIBBON_VERTS_PER_SEG, WheelOdometry, angleDiffRad, clampOrbit, fitDistance,
  fitSphereDistance, floorTextureLayout, growCapacity, headingToRotationY, orbitLimits, orbitPosition,
  pointsDelta, smoothing, writeRibbonSegment, type OrbitLimits, type OrbitState,
} from "./math";
import { Arm3D, Platforms3D } from "./arm"; // arm
import { objectHeight } from "../sim/arm"; // arm
import { CARRY_HEIGHT, EYE_HEIGHT, HALF_TRACK, ROBOT_NOMINAL, WHEEL_RADIUS, buildRobot, type RobotModel } from "./robot";

const CREAM = 0xfdf9f2;
const TABLE = 0xf6efe3;
const WALL = 0x3a3530;
const DEFAULT_ROBOT = 140;
const WALL_HEIGHT = 120;
const BORDER_HEIGHT = 80;
const BORDER_T = 30;
const PATH_Y = 1.2;
const PEN_Y = 2.2;
const ORBIT_FOV = 45;
const OVERHEAD_FOV = 30;
const DEFAULT_PHI = 0.86; // ~49° from vertical

/** True when this browser can create a WebGL2 context (three.js ≥ r163 needs WebGL2). Never throws. */
export function webglSupported(): boolean {
  try {
    if (typeof document === "undefined") return false;
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (gl) {
      try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
      return true;
    }
    // A WebGL1-only device cannot run three.js r187; report unsupported so the app stays in 2D.
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- ribbons (pen strokes, path)

class Ribbon {
  mesh: Mesh;
  private pos = new Float32Array(0);
  private col: Float32Array | null = null;
  private cap = 0;      // segments
  start = 0;            // first visible segment
  count = 0;            // segments written (absolute end)
  private dirtyFrom = -1;

  constructor(private material: Material, private colored: boolean, private y: number) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 1;
    this.alloc(256, 0);
  }

  private alloc(cap: number, keepFrom: number) {
    const keep = this.count - keepFrom;
    const pos = new Float32Array(cap * RIBBON_VERTS_PER_SEG * 3);
    const col = this.colored ? new Float32Array(cap * RIBBON_VERTS_PER_SEG * 3) : null;
    if (keep > 0) {
      const a = keepFrom * RIBBON_VERTS_PER_SEG * 3, b = this.count * RIBBON_VERTS_PER_SEG * 3;
      pos.set(this.pos.subarray(a, b));
      if (col && this.col) col.set(this.col.subarray(a, b));
    }
    this.pos = pos;
    this.col = col;
    this.cap = cap;
    this.count = Math.max(0, keep);
    this.start = 0;
    const g = new BufferGeometry();
    const pa = new BufferAttribute(pos, 3);
    pa.setUsage(DynamicDrawUsage);
    g.setAttribute("position", pa);
    if (col) {
      const ca = new BufferAttribute(col, 3);
      ca.setUsage(DynamicDrawUsage);
      g.setAttribute("color", ca);
    }
    const old = this.mesh.geometry;
    this.mesh.geometry = g;
    old.dispose();
    this.dirtyFrom = -1;
    this.updateRange();
  }

  clear() { this.start = 0; this.count = 0; this.dirtyFrom = -1; this.updateRange(); }

  /** Drop `n` segments from the front (cheap: moves the draw range). */
  dropFront(n: number) { this.start = Math.min(this.count, this.start + n); this.updateRange(); }

  reserve(extra: number) {
    if (this.count + extra <= this.cap) return;
    const live = this.count - this.start;
    if (live + extra <= this.cap && this.start > this.cap / 2) this.alloc(this.cap, this.start); // compact
    else this.alloc(growCapacity(this.cap, live + extra), this.start);
    this.dirtyFrom = 0; // whole new buffer uploads anyway
  }

  add(ax: number, ay: number, bx: number, by: number, halfW: number, ext: number, c: Color | null) {
    if (this.count >= this.cap) this.reserve(1);
    const v = this.count * RIBBON_VERTS_PER_SEG;
    writeRibbonSegment(this.pos, v, ax, ay, bx, by, halfW, ext, this.y);
    if (c && this.col) {
      let o = v * 3;
      for (let i = 0; i < RIBBON_VERTS_PER_SEG; i++) { this.col[o++] = c.r; this.col[o++] = c.g; this.col[o++] = c.b; }
    }
    if (this.dirtyFrom < 0) this.dirtyFrom = this.count;
    this.count++;
  }

  /** Upload what changed since the last commit (partial buffer update) and set the draw range. */
  commit() {
    if (this.dirtyFrom >= 0) {
      const g = this.mesh.geometry;
      const pa = g.getAttribute("position") as BufferAttribute;
      const from = this.dirtyFrom * RIBBON_VERTS_PER_SEG * 3;
      const n = (this.count - this.dirtyFrom) * RIBBON_VERTS_PER_SEG * 3;
      pa.clearUpdateRanges();
      pa.addUpdateRange(from, n);
      pa.needsUpdate = true;
      const ca = g.getAttribute("color") as BufferAttribute | undefined;
      if (ca) { ca.clearUpdateRanges(); ca.addUpdateRange(from, n); ca.needsUpdate = true; }
      this.dirtyFrom = -1;
    }
    this.updateRange();
  }

  private updateRange() {
    this.mesh.geometry.setDrawRange(this.start * RIBBON_VERTS_PER_SEG, (this.count - this.start) * RIBBON_VERTS_PER_SEG);
    this.mesh.visible = this.count > this.start;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.removeFromParent(); }
}

// ---------------------------------------------------------------- objects

interface ObjEntry {
  mesh: Mesh;
  shape: WorldObject["shape"];
  size: number;
  color: ColorName;
  pickable: boolean;
  height: number;
  stamp: number;
}

// ---------------------------------------------------------------- per-quality kit

interface Kit {
  high: boolean;
  robot: RobotModel;
  unitBox: BoxGeometry;     // base at y=0
  unitDisk: CylinderGeometry; // base at y=0, radius 0.5, height 1
  dotG: SphereGeometry;
  colorMats: Map<ColorName, MeshLambertMaterial>;
  steel: MeshLambertMaterial;
  wallMat: MeshLambertMaterial;
  floorMat: MeshLambertMaterial;
  tableMat: MeshLambertMaterial;
  penMat: MeshLambertMaterial;
  pathMat: MeshBasicMaterial;
  rayMat: LineBasicMaterial;
  dotHitMat: MeshBasicMaterial;
  dotMissMat: MeshBasicMaterial;
  blobMat: MeshBasicMaterial;
  blobTex: CanvasTexture | null;
  all: { dispose(): void }[];
}

function buildKit(high: boolean): Kit {
  const all: { dispose(): void }[] = [];
  const T = <X extends { dispose(): void }>(x: X): X => { all.push(x); return x; };
  const seg = high ? 28 : 14;
  const unitBox = T(new BoxGeometry(1, 1, 1));
  unitBox.translate(0, 0.5, 0);
  const unitDisk = T(new CylinderGeometry(0.5, 0.5, 1, seg));
  unitDisk.translate(0, 0.5, 0);
  const colorMats = new Map<ColorName, MeshLambertMaterial>();
  for (const k of Object.keys(COLOR_HEX) as ColorName[]) {
    colorMats.set(k, T(new MeshLambertMaterial({ color: k === "NONE" ? 0xc9c0b3 : new Color(COLOR_HEX[k]) })));
  }
  const polyOff = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  // soft blob shadow for low quality (no shadow maps)
  let blobTex: CanvasTexture | null = null;
  if (!high) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grd = g.createRadialGradient(32, 32, 6, 32, 32, 32);
      grd.addColorStop(0, "rgba(12,11,10,0.55)");
      grd.addColorStop(1, "rgba(12,11,10,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    blobTex = T(new CanvasTexture(c));
  }
  return {
    high,
    robot: buildRobot(high),
    unitBox,
    unitDisk,
    dotG: T(new SphereGeometry(1, 12, 8)),
    colorMats,
    steel: T(new MeshLambertMaterial({ color: 0xa7afb8 })),
    wallMat: T(new MeshLambertMaterial({ color: WALL })),
    floorMat: T(new MeshLambertMaterial({ color: 0xffffff })),
    tableMat: T(new MeshLambertMaterial({ color: TABLE })),
    penMat: T(new MeshLambertMaterial({ vertexColors: true, ...polyOff })),
    pathMat: T(new MeshBasicMaterial({ color: 0xd6540e, transparent: true, opacity: 0.6, depthWrite: false, ...polyOff })),
    rayMat: T(new LineBasicMaterial({ color: 0x2f6fd6, transparent: true, opacity: 0.75 })),
    dotHitMat: T(new MeshBasicMaterial({ color: 0x2f6fd6 })),
    dotMissMat: T(new MeshBasicMaterial({ color: 0x8fb0e6 })),
    blobMat: T(new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: blobTex ? 1 : 0, ...polyOff })),
    blobTex,
    all,
  };
}

function disposeKit(k: Kit) {
  k.robot.dispose();
  for (const x of k.all) x.dispose();
}

// ---------------------------------------------------------------- the renderer

/**
 * One WebGLRenderer per canvas, reused across create → dispose → create cycles (the app toggles
 * 2D/3D). three.js keeps private shadow-depth materials and other per-renderer GL objects that
 * renderer.dispose() does not free, so a fresh renderer per cycle leaks a few programs and
 * textures each time; reusing it keeps GPU memory flat and makes re-entering 3D instant.
 * Everything the 3D view itself allocates is still freed on dispose().
 */
const rendererCache = new WeakMap<HTMLCanvasElement, { r: WebGLRenderer; inUse: boolean }>();

function acquireRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const c = rendererCache.get(canvas);
  if (c && !c.inUse) {
    // reuse even if the context is currently lost: three.js restores it on webglcontextrestored
    c.inUse = true;
    try { if (!c.r.getContext().isContextLost()) c.r.resetState(); } catch { /* ignore */ }
    return c.r;
  }
  let r: WebGLRenderer;
  try {
    r = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "default" });
  } catch (e) {
    throw new Error("Robot Lab 3D: could not create a WebGL2 context (" + String((e as Error)?.message ?? e) + ")");
  }
  if (!c) rendererCache.set(canvas, { r, inUse: true });
  return r;
}

function releaseRenderer(canvas: HTMLCanvasElement, r: WebGLRenderer) {
  const c = rendererCache.get(canvas);
  if (c && c.r === r) {
    c.inUse = false;
    r.renderLists.dispose();
    try { r.resetState(); } catch { /* lost context */ }
  } else {
    try { r.resetState(); } catch { /* lost context */ }
    r.dispose();
  }
}

export interface Renderer3DDebug {
  /** three.js renderer.info snapshot (for leak checks). */
  debugInfo(): { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  /** The live orbit camera state (target, radius, angles) — for previews / tests. Clamped on next input. */
  debugOrbit(): OrbitState;
}

export function createRenderer3D(canvas: HTMLCanvasElement, opts: Renderer3DOptions = {}): Renderer3D & Renderer3DDebug {
  let quality: Quality = opts.quality === "low" ? "low" : "high";
  let mode: CameraMode = "orbit";
  let disposed = false;

  const renderer = acquireRenderer(canvas);
  let lost = renderer.getContext().isContextLost();
  renderer.setAnimationLoop(null);
  renderer.setClearColor(CREAM, 1);
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(CREAM);
  const camera = new PerspectiveCamera(ORBIT_FOV, 1, 10, 40000);

  // lights
  const hemi = new HemisphereLight(0xfffdf9, 0xcfc2b0, 1.55);
  scene.add(hemi);
  const ambient = new AmbientLight(0xffffff, 0.15);
  scene.add(ambient);
  const sun = new DirectionalLight(0xfff6ea, 1.35);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.5;
  scene.add(sun);
  scene.add(sun.target);

  // ---- state
  let kit = buildKit(quality === "high");
  let cssW = 1, cssH = 1;
  let fieldW = 2000, fieldH = 2000;
  let limits: OrbitLimits = orbitLimits(fieldW, fieldH);
  let cacheWorld: World | null = null;
  let cacheZones = false;
  let dirty = true;
  let frameStamp = 0;

  // floor
  const floorCanvas = document.createElement("canvas");
  const floorCtx = floorCanvas.getContext("2d") as CanvasRenderingContext2D;
  let floorTex: CanvasTexture | null = null;
  const planeG = new PlaneGeometry(1, 1);
  planeG.rotateX(-Math.PI / 2);
  const floor = new Mesh(planeG, kit.floorMat);
  floor.receiveShadow = true;
  floor.renderOrder = 0;
  scene.add(floor);
  const table = new Mesh(planeG, kit.tableMat);
  table.position.y = -2;
  table.receiveShadow = true;
  scene.add(table);

  // walls
  let walls: InstancedMesh | null = null;

  // objects
  const objs = new Map<string, ObjEntry>();

  // robot
  let robot = kit.robot;
  scene.add(robot.group);
  const odo = new WheelOdometry(WHEEL_RADIUS, HALF_TRACK);
  const arm3d = new Arm3D(scene);            // arm
  const platforms3d = new Platforms3D(scene); // arm
  const blob = new Mesh(planeG, kit.blobMat);
  blob.renderOrder = 1;
  scene.add(blob);

  // ribbons
  let pathRibbon = new Ribbon(kit.pathMat, false, PATH_Y);
  let penRibbon = new Ribbon(kit.penMat, true, PEN_Y);
  scene.add(pathRibbon.mesh, penRibbon.mesh);
  const pathTrack = { arr: null as Vec[] | null, len: 0, last: null as Vec | null };
  const penTrack = { arr: null as PenStroke[] | null, strokes: 0, points: 0 };
  const delta = { kind: "", from: 0, dropped: 0 };
  const penColors = new Map<ColorName, Color>();
  for (const k of Object.keys(COLOR_HEX) as ColorName[]) penColors.set(k, new Color(k === "NONE" ? 0x9a9186 : COLOR_HEX[k]));

  // distance ray
  const rayPos = new Float32Array(6);
  const rayGeom = new BufferGeometry();
  const rayAttr = new BufferAttribute(rayPos, 3);
  rayAttr.setUsage(DynamicDrawUsage);
  rayGeom.setAttribute("position", rayAttr);
  const ray = new Line(rayGeom, kit.rayMat);
  ray.frustumCulled = false;
  ray.visible = false;
  scene.add(ray);
  const dot = new Mesh(kit.dotG, kit.dotHitMat);
  dot.visible = false;
  scene.add(dot);

  // camera state
  const orbit: OrbitState = { tx: 0, tz: 0, radius: 3000, theta: 0, phi: DEFAULT_PHI };
  const follow = { pos: new Vector3(), look: new Vector3(), yaw: 0, snap: true };
  const tmpV = new Vector3();
  const tmpO = { x: 0, y: 0, z: 0 };
  let robotX = 0, robotY = 0, robotH = 0, robotScale = 1;

  // scratch
  const m4 = new Matrix4();
  const q = new Quaternion();
  const eul = new Euler();
  const vPos = new Vector3();
  const vScl = new Vector3();
  const timer = new FrameTimer(60);
  const raycaster = new Raycaster();
  const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  const ndc = new Vector2();

  // ------------------------------------------------------------ quality

  function applyQuality() {
    const high = quality === "high";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    renderer.setSize(cssW, cssH, false);
    renderer.shadowMap.enabled = high;
    sun.castShadow = high;
    robot.setCastShadow(high);
    arm3d.setCastShadow(high); // arm
    blob.visible = !high;
    for (const x of extraSlots) { x.model.setCastShadow(high); x.arm.setCastShadow(high); } // match
  }

  // ------------------------------------------------------------ match: extra robots (team colours)
  // One slot per extra robot, built on first use and reused every frame (no per-frame allocation).
  interface TeamLabel { sprite: Sprite; tex: CanvasTexture; mat: SpriteMaterial; cnv: HTMLCanvasElement; key: string; }
  interface ExtraSlot { model: RobotModel; arm: Arm3D; odo: WheelOdometry; blob: Mesh; label: TeamLabel; }
  const extraSlots: ExtraSlot[] = [];
  let mainLabel: TeamLabel | null = null;

  function makeLabel(): TeamLabel {
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = 64;
    const tex = new CanvasTexture(cnv);
    tex.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    const sprite = new Sprite(mat);
    sprite.renderOrder = 10;
    sprite.visible = false;
    scene.add(sprite);
    return { sprite, tex, mat, cnv, key: "" };
  }
  function paintLabel(l: TeamLabel, text: string, color: string): void {
    const key = text + color;
    if (l.key === key) return;
    l.key = key;
    const g = l.cnv.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 64, 64);
    g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fillStyle = color; g.fill();
    g.lineWidth = 5; g.strokeStyle = "#FFFDF9"; g.stroke();
    g.fillStyle = "#FFFDF9";
    g.font = "700 34px ui-monospace, Menlo, Consolas, monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text.slice(0, 2), 32, 34);
    l.tex.needsUpdate = true;
  }
  function placeLabel(l: TeamLabel, x: number, y: number, size: number): void {
    l.sprite.visible = true;
    l.sprite.position.set(x, size * 1.45 + 40, -y);
    const k = Math.max(70, size * 0.55);
    l.sprite.scale.set(k, k, 1);
  }
  function disposeLabel(l: TeamLabel): void { l.sprite.removeFromParent(); l.mat.dispose(); l.tex.dispose(); }

  function makeSlot(): ExtraSlot {
    const high = quality === "high";
    const model = buildRobot(high);
    model.setCastShadow(high);
    scene.add(model.group);
    const arm = new Arm3D(scene);
    arm.setCastShadow(high);
    const b = new Mesh(planeG, kit.blobMat);
    b.renderOrder = 1;
    scene.add(b);
    return { model, arm, odo: new WheelOdometry(WHEEL_RADIUS, HALF_TRACK), blob: b, label: makeLabel() };
  }
  function disposeSlot(x: ExtraSlot): void {
    x.model.dispose(); x.arm.dispose(); x.blob.removeFromParent(); disposeLabel(x.label);
  }
  /** Quality changed: the robot models depend on it. */
  function rebuildExtras(): void {
    const n = extraSlots.length;
    for (const x of extraSlots) disposeSlot(x);
    extraSlots.length = 0;
    for (let i = 0; i < n; i++) extraSlots.push(makeSlot());
  }

  function drawExtras(world: World, o: RenderOptions, objects: WorldObject[]): void {
    const extras = o.extraRobots;
    const n = extras ? extras.length : 0;
    while (extraSlots.length < n) extraSlots.push(makeSlot());
    const hw = world.hardware;
    const high = quality === "high";
    for (let i = 0; i < extraSlots.length; i++) {
      const slot = extraSlots[i];
      const ex = i < n ? extras![i] : null;
      slot.model.group.visible = !!ex;
      slot.blob.visible = !!ex && !high;
      slot.label.sprite.visible = !!ex;
      if (!ex) { slot.arm.update(false, 0, 0, 0, 140, undefined); slot.odo.reset(); continue; }
      const st = ex.state;
      const p = st.robot;
      const size = st.robotSize > 0 ? st.robotSize : DEFAULT_ROBOT;
      const g = slot.model.group;
      g.position.set(p.x, 0, -p.y);
      g.rotation.set(0, headingToRotationY(p.heading), 0);
      g.scale.setScalar(size / ROBOT_NOMINAL);
      slot.odo.update(p.x, p.y, p.heading);
      slot.model.setTint(ex.color);
      slot.model.setDesign(st.config, !!st.stalled);
      slot.model.setWheelAngles(slot.odo.left, slot.odo.right);
      slot.model.setBumper(st.bumperPressed);
      slot.model.setPen(!!(hw && hw.pen), st.penDown, st.penColor);
      slot.model.setMagnet(!!(hw && hw.magnet), st.carrying !== null);
      slot.arm.update(!!(hw && hw.arm), p.x, p.y, p.heading, size, st.arm);
      if (slot.blob.visible) { slot.blob.position.set(p.x, 0.6, -p.y); slot.blob.scale.set(size * 1.6, 1, size * 1.6); }
      paintLabel(slot.label, ex.label, ex.color);
      placeLabel(slot.label, p.x, p.y, size);
      // what its magnet carries rides at its front (the shared objects are synced from the main state)
      if (st.carrying !== null) {
        const e = objs.get(st.carrying);
        const ob = e ? findObj(objects, st.carrying) : null;
        if (e && ob) {
          const d = size / 2 + ob.size / 2 + size * 0.06;
          const hr = p.heading * DEG;
          e.mesh.position.set(p.x + Math.sin(hr) * d, CARRY_HEIGHT * (size / ROBOT_NOMINAL), -(p.y + Math.cos(hr) * d));
          e.mesh.rotation.set(0, headingToRotationY(p.heading), 0);
        }
      }
    }
  }
  function findObj(objects: WorldObject[], id: string): WorldObject | null {
    for (let i = 0; i < objects.length; i++) if (objects[i].id === id) return objects[i];
    return null;
  }

  function rebuildKit() {
    // dispose world-dependent meshes that reference kit materials
    clearObjects();
    scene.remove(robot.group);
    pathRibbon.dispose();
    penRibbon.dispose();
    disposeKit(kit);
    kit = buildKit(quality === "high");
    robot = kit.robot;
    scene.add(robot.group);
    rebuildExtras(); // match
    floor.material = kit.floorMat;
    table.material = kit.tableMat;
    blob.material = kit.blobMat;
    ray.material = kit.rayMat;
    dot.geometry = kit.dotG;
    dot.material = kit.dotHitMat;
    if (walls) { walls.geometry = kit.unitBox; walls.material = kit.wallMat; }
    pathRibbon = new Ribbon(kit.pathMat, false, PATH_Y);
    penRibbon = new Ribbon(kit.penMat, true, PEN_Y);
    scene.add(pathRibbon.mesh, penRibbon.mesh);
    pathTrack.arr = null;
    penTrack.arr = null;
    odo.reset();
    dirty = true;
  }

  // ------------------------------------------------------------ static world

  function buildFloor(world: World, showZones: boolean) {
    const maxTex = Math.min(renderer.capabilities.maxTextureSize || 2048, quality === "high" ? 2048 : 1024);
    const L = floorTextureLayout(fieldW, fieldH, maxTex);
    const resized = floorCanvas.width !== L.width || floorCanvas.height !== L.height;
    if (resized) { floorCanvas.width = L.width; floorCanvas.height = L.height; }
    paintFloor(floorCtx, L, world, fieldW, fieldH, { showZones, wallShadows: quality !== "high" });
    if (!floorTex || resized) {
      floorTex?.dispose();
      floorTex = new CanvasTexture(floorCanvas);
      floorTex.colorSpace = SRGBColorSpace;
      floorTex.minFilter = LinearMipmapLinearFilter;
      floorTex.generateMipmaps = true;
    }
    floorTex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), quality === "high" ? 8 : 2);
    floorTex.needsUpdate = true;
    if (kit.floorMat.map !== floorTex) { kit.floorMat.map = floorTex; kit.floorMat.needsUpdate = true; }
    floor.scale.set(fieldW, 1, fieldH);
    floor.updateMatrix();
    const big = Math.max(fieldW, fieldH) * 8;
    table.scale.set(big, 1, big);
  }

  function buildWalls(world: World) {
    const n = world.walls.length + 4;
    if (!walls || walls.instanceMatrix.count < n) {
      if (walls) { walls.removeFromParent(); walls.dispose(); }
      walls = new InstancedMesh(kit.unitBox, kit.wallMat, Math.max(8, n));
      scene.add(walls);
    }
    walls.geometry = kit.unitBox;
    walls.material = kit.wallMat;
    walls.castShadow = quality === "high";
    walls.receiveShadow = false;
    let i = 0;
    const put = (cx: number, cy: number, len: number, t: number, h: number, angle: number) => {
      eul.set(0, angle, 0);
      q.setFromEuler(eul);
      vPos.set(cx, 0, -cy);
      vScl.set(Math.max(1, len), h, Math.max(1, t));
      m4.compose(vPos, q, vScl);
      (walls as InstancedMesh).setMatrixAt(i++, m4);
    };
    for (const w of world.walls) {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      const len = Math.hypot(dx, dy);
      const t = Math.max(1, w.thickness);
      // square caps like the 2D renderer: extend by thickness/2 at each end
      put((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2, len + t, t, WALL_HEIGHT, Math.atan2(dy, dx));
    }
    const hw = fieldW / 2, hh = fieldH / 2;
    put(0, hh + BORDER_T / 2, fieldW + 2 * BORDER_T, BORDER_T, BORDER_HEIGHT, 0);
    put(0, -hh - BORDER_T / 2, fieldW + 2 * BORDER_T, BORDER_T, BORDER_HEIGHT, 0);
    put(hw + BORDER_T / 2, 0, fieldH, BORDER_T, BORDER_HEIGHT, Math.PI / 2);
    put(-hw - BORDER_T / 2, 0, fieldH, BORDER_T, BORDER_HEIGHT, Math.PI / 2);
    walls.count = i;
    walls.instanceMatrix.needsUpdate = true;
    walls.computeBoundingSphere();
  }

  function setupLight() {
    const ext = Math.max(fieldW, fieldH) / 2 + 300;
    sun.position.set(-0.45 * ext * 2, ext * 2.4, 0.6 * ext * 2);
    sun.target.position.set(0, 0, 0);
    const cam = sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 10;
    cam.far = ext * 8;
    cam.updateProjectionMatrix();
  }

  function rebuildWorld(world: World, showZones: boolean) {
    const fw = world.width > 0 ? world.width : 2000;
    const fh = world.height > 0 ? world.height : 2000;
    const sizeChanged = fw !== fieldW || fh !== fieldH || cacheWorld === null;
    fieldW = fw; fieldH = fh;
    limits = orbitLimits(fieldW, fieldH);
    camera.far = limits.maxRadius * 1.5 + Math.hypot(fieldW, fieldH);
    camera.updateProjectionMatrix();
    buildFloor(world, showZones);
    buildWalls(world);
    platforms3d.build(world.platforms, quality === "high"); // arm
    setupLight();
    if (world !== cacheWorld) {
      clearObjects();
      pathRibbon.clear(); penRibbon.clear();
      pathTrack.arr = null; penTrack.arr = null;
      odo.reset();
      follow.snap = true;
    }
    if (sizeChanged) resetCameraInternal();
    cacheWorld = world;
    cacheZones = showZones;
    dirty = false;
  }

  // ------------------------------------------------------------ objects

  function clearObjects() {
    for (const e of objs.values()) disposeObj(e);
    objs.clear();
  }
  function disposeObj(e: ObjEntry) {
    e.mesh.removeFromParent();
    // geometries / materials belong to the kit; children share them too
  }

  function makeObj(o: WorldObject): ObjEntry {
    const mat = kit.colorMats.get(o.color) as MeshLambertMaterial;
    const high = quality === "high";
    let mesh: Mesh;
    let height: number;
    if (o.shape === "disk") {
      height = objectHeight(o); // arm: same height the sim stacks with
      mesh = new Mesh(kit.unitDisk, mat);
      mesh.scale.set(o.size, height, o.size);
      if (o.pickable) {
        const cap = new Mesh(kit.unitDisk, kit.steel);
        cap.scale.set(0.4, 0.08, 0.4);
        cap.position.y = 1;
        mesh.add(cap);
      }
    } else {
      height = objectHeight(o); // arm
      mesh = new Mesh(kit.unitBox, mat);
      mesh.scale.set(o.size, height, o.size);
      if (o.pickable) {
        const cap = new Mesh(kit.unitBox, kit.steel);
        cap.scale.set(0.4, 0.03, 0.4);
        cap.position.y = 1;
        mesh.add(cap);
      }
    }
    mesh.castShadow = high;
    mesh.receiveShadow = high;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, shape: o.shape, size: o.size, color: o.color, pickable: o.pickable, height, stamp: 0 };
  }

  function syncObjects(objects: WorldObject[], carryingId: string | null, rx: number, ry: number, rh: number, rsize: number) {
    const stamp = ++frameStamp;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      let e = objs.get(o.id);
      if (e && (e.shape !== o.shape || e.size !== o.size || e.color !== o.color || e.pickable !== o.pickable || e.height !== objectHeight(o) /* arm */)) {
        disposeObj(e);
        objs.delete(o.id);
        e = undefined;
      }
      if (!e) { e = makeObj(o); objs.set(o.id, e); }
      e.stamp = stamp;
      const m = e.mesh;
      m.visible = true;
      if (carryingId !== null && o.id === carryingId) {
        // held at the robot's front, lifted off the floor
        const d = rsize / 2 + o.size / 2 + rsize * 0.06;
        const h = rh * DEG;
        m.position.set(rx + Math.sin(h) * d, CARRY_HEIGHT * (rsize / ROBOT_NOMINAL), -(ry + Math.cos(h) * d));
        m.rotation.set(0, headingToRotationY(rh), 0);
      } else {
        m.position.set(o.x, o.z && o.z > 0 ? o.z : 0, -o.y); // arm: up on a platform / stack / in the claw
        m.rotation.set(0, o.shape === "box" && o.rotation ? -o.rotation * DEG : 0, 0);
      }
    }
    if (objs.size > objects.length) {
      for (const e of objs.values()) if (e.stamp !== stamp) e.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------ ribbons

  function syncPath(path: Vec[] | null, show: boolean) {
    pathRibbon.mesh.visible = false;
    if (!show || !path || !path.length) {
      if (!path || !path.length) { if (pathTrack.arr) { pathRibbon.clear(); pathTrack.arr = null; } }
      return;
    }
    const w = Math.max(fieldW, fieldH) / 220;
    pointsDelta(pathTrack.arr, pathTrack.len, pathTrack.last, path, delta);
    if (delta.kind === "rebuild") {
      pathRibbon.clear();
      pathRibbon.reserve(path.length);
      for (let i = 1; i < path.length; i++) pathRibbon.add(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y, w / 2, 0, null);
    } else if (delta.kind === "append") {
      if (delta.dropped) pathRibbon.dropFront(delta.dropped);
      pathRibbon.reserve(path.length - delta.from);
      for (let i = Math.max(1, delta.from); i < path.length; i++) pathRibbon.add(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y, w / 2, 0, null);
    }
    pathRibbon.commit();
    pathTrack.arr = path;
    pathTrack.len = path.length;
    pathTrack.last = path[path.length - 1];
  }

  function addStrokeSegments(st: PenStroke, from: number) {
    const pts = st.points;
    const col = penColors.get(st.color) as Color;
    const hw = (st.width > 0 ? st.width : 8) / 2;
    if (from === 0 && pts.length === 1) { penRibbon.add(pts[0].x, pts[0].y, pts[0].x, pts[0].y, hw, hw, col); return; }
    for (let j = Math.max(1, from); j < pts.length; j++) penRibbon.add(pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y, hw, hw, col);
  }

  function syncPen(strokes: PenStroke[] | null) {
    if (!strokes || !strokes.length) {
      if (penTrack.arr) { penRibbon.clear(); penTrack.arr = null; }
      if (strokes) { penTrack.arr = strokes; penTrack.strokes = 0; penTrack.points = 0; }
      return;
    }
    let rebuild = strokes !== penTrack.arr || strokes.length < penTrack.strokes;
    if (!rebuild && penTrack.strokes > 0) {
      const lastPts = strokes[penTrack.strokes - 1].points.length;
      if (lastPts < penTrack.points) rebuild = true;
    }
    if (rebuild) {
      penRibbon.clear();
      penTrack.arr = strokes; penTrack.strokes = 0; penTrack.points = 0;
    }
    // continue the last partially consumed stroke, then any new strokes
    let si = Math.max(0, penTrack.strokes - 1);
    for (; si < strokes.length; si++) {
      const st = strokes[si];
      const from = si === penTrack.strokes - 1 ? penTrack.points : 0;
      if (st.color === "NONE" || st.points.length === from) continue;
      penRibbon.reserve(st.points.length - from + 1);
      addStrokeSegments(st, from);
    }
    penTrack.strokes = strokes.length;
    penTrack.points = strokes[strokes.length - 1].points.length;
    penRibbon.commit();
  }

  // ------------------------------------------------------------ camera

  function resetCameraInternal() {
    orbit.tx = 0; orbit.tz = 0;
    orbit.theta = 0;
    orbit.phi = DEFAULT_PHI;
    orbit.radius = fitSphereDistance(ORBIT_FOV, cssW / cssH, fieldW + 2 * BORDER_T, fieldH + 2 * BORDER_T, 0.82);
    clampOrbit(orbit, limits);
    follow.snap = true;
  }

  function setFov(f: number) {
    const a = cssW / cssH;
    if (camera.fov !== f || camera.aspect !== a) { camera.fov = f; camera.aspect = a; camera.updateProjectionMatrix(); }
  }

  function updateCamera(dt: number) {
    if (mode === "overhead") {
      setFov(OVERHEAD_FOV);
      const d = fitDistance(OVERHEAD_FOV, cssW / cssH, fieldW + 2 * BORDER_T, fieldH + 2 * BORDER_T, 1.04);
      camera.position.set(0, d + BORDER_HEIGHT, 0);
      camera.rotation.set(-Math.PI / 2, 0, 0);
    } else if (mode === "orbit") {
      setFov(ORBIT_FOV);
      orbitPosition(orbit, tmpO);
      camera.position.set(tmpO.x, tmpO.y, tmpO.z);
      camera.lookAt(orbit.tx, 0, orbit.tz);
    } else {
      setFov(ORBIT_FOV);
      const s = robotScale;
      const yaw = robotH * DEG;
      if (follow.snap) follow.yaw = yaw;
      else follow.yaw += angleDiffRad(follow.yaw, yaw) * smoothing(4, dt);
      const fx = Math.sin(follow.yaw), fz = -Math.cos(follow.yaw);
      const rx = robotX, rz = -robotY;
      const back = 560 * s, up = 400 * s, ahead = 260 * s;
      tmpV.set(rx - fx * back, up, rz - fz * back);
      const k = follow.snap ? 1 : smoothing(6, dt);
      follow.pos.lerp(tmpV, k);
      tmpV.set(rx + fx * ahead, 20 * s, rz + fz * ahead);
      follow.look.lerp(tmpV, follow.snap ? 1 : smoothing(10, dt));
      follow.snap = false;
      camera.position.copy(follow.pos);
      camera.lookAt(follow.look);
    }
    camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------ orbit input

  const pointers = new Map<number, { x: number; y: number }>();
  let dragButton = 0;
  let pinchDist = 0;
  let pinchMx = 0, pinchMy = 0;

  function rotateBy(dx: number, dy: number) {
    orbit.theta -= (dx / Math.max(1, cssH)) * Math.PI * 1.2;
    orbit.phi -= (dy / Math.max(1, cssH)) * Math.PI * 0.9;
    clampOrbit(orbit, limits);
  }
  function panBy(dx: number, dy: number) {
    const k = (2 * orbit.radius * Math.tan((ORBIT_FOV * DEG) / 2)) / Math.max(1, cssH);
    const ct = Math.cos(orbit.theta), st = Math.sin(orbit.theta);
    // right = (cos θ, 0, -sin θ); ground-forward (away from camera) = (-sin θ, 0, -cos θ)
    orbit.tx -= ct * dx * k;
    orbit.tz -= -st * dx * k;
    const kf = k / Math.max(0.35, Math.cos(orbit.phi));
    orbit.tx += -st * dy * kf;
    orbit.tz += -ct * dy * kf;
    clampOrbit(orbit, limits);
  }
  function zoomBy(f: number) {
    orbit.radius *= f;
    clampOrbit(orbit, limits);
  }
  function twoPointerMetrics(): { d: number; mx: number; my: number } {
    let ax = 0, ay = 0, bx = 0, by = 0, i = 0;
    for (const p of pointers.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx = p.x; by = p.y; }
      i++;
    }
    return { d: Math.hypot(bx - ax, by - ay), mx: (ax + bx) / 2, my: (ay + by) / 2 };
  }

  const onPointerDown = (e: PointerEvent) => {
    if (mode !== "orbit" || disposed) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) dragButton = e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey) ? 2 : e.button;
    if (pointers.size === 2) { const m = twoPointerMetrics(); pinchDist = m.d; pinchMx = m.mx; pinchMy = m.my; }
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p || mode !== "orbit") return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      if (dragButton === 1 || dragButton === 2) panBy(dx, dy);
      else rotateBy(dx, dy);
    } else if (pointers.size === 2) {
      const m = twoPointerMetrics();
      if (pinchDist > 0 && m.d > 0) zoomBy(pinchDist / m.d);
      panBy(m.mx - pinchMx, m.my - pinchMy);
      pinchDist = m.d; pinchMx = m.mx; pinchMy = m.my;
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 2) { const m = twoPointerMetrics(); pinchDist = m.d; pinchMx = m.mx; pinchMy = m.my; }
  };
  const onWheel = (e: WheelEvent) => {
    if (mode !== "orbit" || disposed) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    zoomBy(Math.exp(Math.max(-200, Math.min(200, e.deltaY * unit)) * 0.0015));
  };
  const onContextMenu = (e: Event) => { if (mode === "orbit") e.preventDefault(); };
  const onLost = (e: Event) => { e.preventDefault(); lost = true; };
  const onRestored = () => {
    lost = false;
    dirty = true; // repaint + re-upload the floor texture
    pathTrack.arr = null; penTrack.arr = null;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const prevTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  // ------------------------------------------------------------ public

  function resize() {
    if (disposed) return;
    cssW = Math.max(1, canvas.clientWidth || canvas.width || 1);
    cssH = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const pr = Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  let sized = false;

  function draw(world: World, state: SimState | null, o: RenderOptions) {
    if (disposed) return;
    timer.tick(performance.now());
    if (!sized) { resize(); applyQuality(); sized = true; }
    if (lost) return;
    const showZones = !!o.showZones;
    if (dirty || world !== cacheWorld || showZones !== cacheZones) rebuildWorld(world, showZones);

    const pose = state ? state.robot : world.start;
    const size = state && state.robotSize > 0 ? state.robotSize : DEFAULT_ROBOT;
    const hw = world.hardware;
    robotX = pose.x; robotY = pose.y; robotH = pose.heading;
    robotScale = size / ROBOT_NOMINAL;

    // robot
    const g = robot.group;
    g.position.set(pose.x, 0, -pose.y);
    g.rotation.set(0, headingToRotationY(pose.heading), 0);
    g.scale.setScalar(robotScale);
    if (state) odo.update(pose.x, pose.y, pose.heading); else odo.reset();
    const tintMain = o.extraRobots && o.extraRobots.length && o.mainRobotColor ? o.mainRobotColor : null; // match
    robot.setTint(tintMain); // match
    if (tintMain) { mainLabel ??= makeLabel(); paintLabel(mainLabel, "A", tintMain); placeLabel(mainLabel, pose.x, pose.y, size); }
    else if (mainLabel) mainLabel.sprite.visible = false;
    robot.setDesign(state?.config, !!state?.stalled); // builder
    robot.setWheelAngles(odo.left, odo.right);
    robot.setBumper(!!(state && state.bumperPressed));
    robot.setPen(!!(hw && hw.pen), !!(state && state.penDown), state ? state.penColor : "BLACK");
    robot.setMagnet(!!(hw && hw.magnet), !!(state && state.carrying !== null));
    arm3d.update(!!(hw && hw.arm), pose.x, pose.y, pose.heading, size, state ? state.arm : undefined); // arm
    if (blob.visible) {
      blob.position.set(pose.x, 0.6, -pose.y);
      blob.scale.set(size * 1.6, 1, size * 1.6);
    }

    // objects
    syncObjects(state ? state.objects : world.objects, state ? state.carrying : null, pose.x, pose.y, pose.heading, size);
    if (o.extraRobots || extraSlots.length) drawExtras(world, o, state ? state.objects : world.objects); // match

    // overlays
    syncPath(state ? state.path : null, !!o.showPath);
    syncPen(state ? state.strokes : null);

    // distance ray
    const r = o.showSensors && state ? state.distanceRay : null;
    if (r) {
      const y = EYE_HEIGHT * robotScale;
      rayPos[0] = r.from.x; rayPos[1] = y; rayPos[2] = -r.from.y;
      rayPos[3] = r.to.x; rayPos[4] = y; rayPos[5] = -r.to.y;
      rayAttr.needsUpdate = true;
      ray.visible = true;
      dot.visible = true;
      dot.position.set(r.to.x, y, -r.to.y);
      dot.scale.setScalar(r.hit ? 9 : 6);
      dot.material = r.hit ? kit.dotHitMat : kit.dotMissMat;
    } else {
      ray.visible = false;
      dot.visible = false;
    }

    updateCamera(timer.dt);
    renderer.render(scene, camera);
  }

  function ensureCamera() {
    if (!sized) { resize(); applyQuality(); sized = true; }
    updateCamera(0);
  }

  return {
    draw,
    resize,
    invalidate() { dirty = true; pathTrack.arr = null; penTrack.arr = null; },
    get camera() { return mode; },
    setCamera(m: CameraMode) {
      if (m !== "overhead" && m !== "follow" && m !== "orbit") return;
      mode = m;
      pointers.clear();
      if (m === "follow") follow.snap = true;
    },
    setQuality(qq: Quality) {
      const next: Quality = qq === "low" ? "low" : "high";
      if (next === quality || disposed) return;
      quality = next;
      rebuildKit();
      if (sized) applyQuality();
    },
    frameMs() { return timer.average(); },
    resetCamera() { resetCameraInternal(); },
    toWorld(px: number, py: number) {
      ensureCamera();
      ndc.set((px / cssW) * 2 - 1, -(py / cssH) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(floorPlane, vPos);
      if (!hit) {
        // above the horizon: use a far point along the ray, projected onto the floor
        raycaster.ray.at(camera.far, vPos);
      }
      return { x: vPos.x, y: -vPos.z };
    },
    toCanvas(x: number, y: number) {
      ensureCamera();
      vPos.set(x, 0, -y).project(camera);
      return { px: ((vPos.x + 1) / 2) * cssW, py: ((1 - vPos.y) / 2) * cssH };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      canvas.style.touchAction = prevTouchAction;
      pointers.clear();
      clearObjects();
      arm3d.dispose(); platforms3d.dispose(); // arm
      for (const x of extraSlots) disposeSlot(x); // match
      extraSlots.length = 0;
      if (mainLabel) { disposeLabel(mainLabel); mainLabel = null; }
      pathRibbon.dispose();
      penRibbon.dispose();
      rayGeom.dispose();
      planeG.dispose();
      if (walls) { walls.removeFromParent(); walls.dispose(); walls = null; }
      floorTex?.dispose();
      floorTex = null;
      disposeKit(kit);
      sun.shadow.map?.depthTexture?.dispose();
      sun.dispose();
      scene.clear();
      releaseRenderer(canvas, renderer);
      floorCanvas.width = floorCanvas.height = 1;
    },
    debugOrbit() { return orbit; },
    debugInfo() {
      const i = renderer.info;
      return {
        geometries: i.memory.geometries, textures: i.memory.textures,
        programs: i.programs ? i.programs.length : 0, calls: i.render.calls, triangles: i.render.triangles,
      };
    },
  };
}
