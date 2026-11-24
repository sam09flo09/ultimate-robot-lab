/**
 * arm: 3D platforms and the robot's arm + claw. Kept separate from robot.ts (the robot model) so the arm
 * is drawn in world millimetres whatever the robot's size: the claw height must match the sim exactly.
 * Frame: world (x, y) → three (x, 0, -y); robot heading h → rotation.y = -h (see math.headingToRotationY).
 * update() only sets positions/rotations/scales (no per-frame allocation).
 */
import {
  BoxGeometry, Color, Group, Mesh, MeshLambertMaterial, MeshPhongMaterial, type Object3D, type Scene,
} from "three";
import type { ArmState, Platform } from "../core/types";
import { COLOR_HEX } from "../core/types";
import { ARM_LIFT, CLAW_HOLD, JAW_BAND } from "../sim/arm";
import { DEG, headingToRotationY } from "./math";

const TOP = 82;          // robot top plate at the nominal size (robot.ts TOP_Y), scaled with the robot
const JAW_W = 8;

export class Arm3D {
  readonly group = new Group();
  private links: Mesh[] = [];
  private claw = new Group();
  private jaws: Mesh[] = [];
  private bar: Mesh;
  private tower: Mesh;
  private all: { dispose(): void }[] = [];
  private jawMat: MeshPhongMaterial;
  private open = new Color(0xa7afb8);
  private shut = new Color(0xff6a1a);
  private lastClosed: boolean | null = null;

  constructor(scene: Scene) {
    const T = <X extends { dispose(): void }>(x: X): X => { this.all.push(x); return x; };
    const unit = T(new BoxGeometry(1, 1, 1));
    const green = T(new MeshLambertMaterial({ color: 0x3f7f6a }));
    const dark = T(new MeshLambertMaterial({ color: 0x2b5c4c }));
    this.jawMat = T(new MeshPhongMaterial({ color: 0xa7afb8, shininess: 60, specular: 0x555555 }));
    this.group.name = "arm";
    this.tower = new Mesh(unit, dark);
    this.group.add(this.tower);
    for (let k = 0; k < 2; k++) {
      const l = new Mesh(unit, green);
      this.links.push(l);
      this.group.add(l);
    }
    this.bar = new Mesh(unit, dark);
    this.claw.add(this.bar);
    for (let k = 0; k < 2; k++) {
      const j = new Mesh(unit, this.jawMat);
      this.jaws.push(j);
      this.claw.add(j);
    }
    this.group.add(this.claw);
    this.group.visible = false;
    scene.add(this.group);
  }

  setCastShadow(on: boolean): void {
    this.group.traverse((o: Object3D) => { if ((o as Mesh).isMesh) (o as Mesh).castShadow = on; });
  }

  /** Pose the arm for a robot at (x, y, heading) of side `size`; hidden when not fitted. */
  update(fitted: boolean, x: number, y: number, heading: number, size: number, arm: ArmState | undefined): void {
    const g = this.group;
    g.visible = fitted;
    if (!fitted) return;
    const angle = arm ? arm.angle : 0;
    const closed = arm ? arm.clawClosed : false;
    const s = size / 140;
    g.position.set(x, 0, -y);
    g.rotation.set(0, headingToRotationY(heading), 0);
    const half = size / 2;
    // tower on the front half of the top plate; pivot at its top
    const tz = -half * 0.35, th = 46 * s, top = TOP * s;
    this.tower.scale.set(34 * s, th, 26 * s);
    this.tower.position.set(0, top + th / 2, tz);
    const py = top + th - 6 * s, pz = tz;
    // claw: jaws span the claw height .. + JAW_BAND, centred CLAW_HOLD in front of the front face
    const ch = ARM_LIFT * Math.sin(angle * DEG);
    const cz = -(half + CLAW_HOLD);
    const cy = ch + JAW_BAND + 6;           // top of the claw (where the links attach)
    this.claw.position.set(0, 0, cz);
    const gap = closed ? 26 : 40;
    this.bar.scale.set(2 * gap + JAW_W + 8, 10, 14);
    this.bar.position.set(0, cy - 5, 0);
    for (let k = 0; k < 2; k++) {
      const j = this.jaws[k];
      j.scale.set(JAW_W, JAW_BAND + 4, 34);
      j.position.set((k === 0 ? -1 : 1) * gap, ch + (JAW_BAND + 4) / 2, 0);
    }
    if (closed !== this.lastClosed) { this.lastClosed = closed; this.jawMat.color.copy(closed ? this.shut : this.open); }
    // two parallel links from the pivot to the claw bar
    const dy = cy - py, dz = cz - pz;
    const len = Math.sqrt(dy * dy + dz * dz);
    const tilt = Math.atan2(dy, -dz);         // rotation about x that lifts the -z axis toward +y
    for (let k = 0; k < 2; k++) {
      const l = this.links[k];
      l.scale.set(8 * s, 10 * s, len);
      l.position.set((k === 0 ? -1 : 1) * 14 * s, (py + cy) / 2, (pz + cz) / 2);
      l.rotation.set(tilt, 0, 0);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const x of this.all) x.dispose();
  }
}

/** Platforms as solid boxes standing on the floor, rebuilt only when the world changes. */
export class Platforms3D {
  private meshes: Mesh[] = [];
  private mats: MeshLambertMaterial[] = [];
  private geo = new BoxGeometry(1, 1, 1);
  private edgeMat = new MeshLambertMaterial({ color: 0x6f6458 });

  constructor(private scene: Scene) { this.geo.translate(0, 0.5, 0); }

  build(platforms: readonly Platform[] | undefined, shadows: boolean): void {
    this.clear();
    for (const p of platforms ?? []) {
      const col = !p.color || p.color === "NONE" ? 0xc9b79c : new Color(COLOR_HEX[p.color]);
      const mat = new MeshLambertMaterial({ color: col });
      this.mats.push(mat);
      const m = new Mesh(this.geo, mat);
      m.scale.set(p.w, p.height, p.h);
      m.position.set(p.x, 0, -p.y);
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      this.scene.add(m);
      this.meshes.push(m);
      // a darker base strip so the block reads as standing on the floor
      const b = new Mesh(this.geo, this.edgeMat);
      b.scale.set(p.w + 2, Math.min(12, p.height * 0.1), p.h + 2);
      b.position.set(p.x, 0, -p.y);
      this.scene.add(b);
      this.meshes.push(b);
    }
  }

  clear(): void {
    for (const m of this.meshes) m.removeFromParent();
    for (const m of this.mats) m.dispose();
    this.meshes = [];
    this.mats = [];
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
    this.edgeMat.dispose();
  }
}
