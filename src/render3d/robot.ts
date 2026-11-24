/**
 * The 3D robot: an original, simple model built from primitives.
 * Built at the nominal 140 mm size (scale the group for other sizes). Front = local -z, up = +y.
 */
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, Material, Mesh,
  MeshLambertMaterial, MeshPhongMaterial, Object3D, Shape,
} from "three";
import type { ColorName, RobotConfig } from "../core/types";
import { COLOR_HEX } from "../core/types";

export const ROBOT_NOMINAL = 140;
export const WHEEL_RADIUS = 27;
export const HALF_TRACK = 66;
export const EYE_HEIGHT = 60;
/** Height at which the magnet holds a carried object (its base). */
export const CARRY_HEIGHT = 18;

const BODY_W = 112;
const BODY_L = 136;
const BODY_Y0 = 14;
const BODY_TOP = 78;
const TOP_Y = BODY_TOP + 4; // top plate surface

function roundedRect(w: number, l: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2, y = -l / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + l - r);
  s.quadraticCurveTo(x + w, y + l, x + w - r, y + l);
  s.lineTo(x + r, y + l);
  s.quadraticCurveTo(x, y + l, x, y + l - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export interface RobotModel {
  group: Group;
  /** Wheel spin groups: [front-left, rear-left, front-right, rear-right]. */
  wheels: Object3D[];
  setBumper(on: boolean): void;
  setPen(fitted: boolean, down: boolean, color: ColorName): void;
  setMagnet(fitted: boolean, carrying: boolean): void;
  setWheelAngles(left: number, right: number): void;
  setCastShadow(on: boolean): void;
  /** builder: show the robot design (wheel size, 4 motor housings, gear cog, sensor mount) and
   *  spin the wheels in place while stalled. Call before setWheelAngles each frame. */
  setDesign(cfg: RobotConfig | undefined, stalled: boolean): void;
  dispose(): void;
}

export function buildRobot(high: boolean): RobotModel {
  const geoms: BufferGeometry[] = [];
  const mats: Material[] = [];
  const seg = high ? 20 : 10;
  const G = <T extends BufferGeometry>(g: T): T => { geoms.push(g); return g; };
  const M = <T extends Material>(m: T): T => { mats.push(m); return m; };

  const group = new Group();
  group.name = "robot";
  const meshes: Mesh[] = [];
  const add = (parent: Object3D, g: BufferGeometry, m: Material, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  const shell = M(new MeshPhongMaterial({ color: 0x1f1c19, shininess: 40, specular: 0x2a2724 }));
  const plate = M(new MeshPhongMaterial({ color: 0x34302b, shininess: 25, specular: 0x222222 }));
  const tyre = M(new MeshLambertMaterial({ color: 0x2b2724 }));
  const hub = M(new MeshLambertMaterial({ color: 0x8a8279 }));
  const orange = M(new MeshLambertMaterial({ color: 0xff6a1a, emissive: 0x5a1e00 }));
  const paper = M(new MeshLambertMaterial({ color: 0xfffdf9 }));
  const lens = M(new MeshPhongMaterial({ color: 0x14232e, shininess: 90, specular: 0x88aacc }));
  const bumperMat = M(new MeshLambertMaterial({ color: 0x4a443d }));
  const steel = M(new MeshPhongMaterial({ color: 0xa7afb8, shininess: 60, specular: 0x666666 }));
  const red = M(new MeshLambertMaterial({ color: 0xd63b2f }));
  const penBody = M(new MeshLambertMaterial({ color: 0x5a534b }));
  const penCap = M(new MeshLambertMaterial({ color: 0x8a8279 }));

  // body: rounded box, extruded upward
  const bevel = high ? 4 : 0;
  const body = G(new ExtrudeGeometry(roundedRect(BODY_W - 2 * bevel, BODY_L - 2 * bevel, 18), {
    depth: BODY_TOP - BODY_Y0 - 2 * bevel, bevelEnabled: high, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: high ? 6 : 3,
  }));
  body.rotateX(-Math.PI / 2);
  body.translate(0, BODY_Y0 + bevel, 0);
  add(group, body, shell, 0, 0, 0);

  // top plate
  const top = G(new ExtrudeGeometry(roundedRect(BODY_W - 22, BODY_L - 26, 12), { depth: 4, bevelEnabled: false, curveSegments: high ? 5 : 2 }));
  top.rotateX(-Math.PI / 2);
  add(group, top, plate, 0, BODY_TOP, 0);

  // orange front arrow on the top plate (points to the front, -z)
  const arrowShape = new Shape();
  arrowShape.moveTo(0, 50);
  arrowShape.lineTo(28, 6);
  arrowShape.lineTo(-28, 6);
  arrowShape.closePath();
  const arrow = G(new ExtrudeGeometry(arrowShape, { depth: 3, bevelEnabled: false }));
  arrow.rotateX(-Math.PI / 2);
  add(group, arrow, orange, 0, TOP_Y, 0);

  // eye on the front face
  const ringG = G(new CylinderGeometry(14, 14, 4, seg));
  ringG.rotateX(Math.PI / 2);
  const eyeRing = add(group, ringG, paper, 0, EYE_HEIGHT, -BODY_L / 2 - 1);
  const lensG = G(new CylinderGeometry(9, 9, 6, seg));
  lensG.rotateX(Math.PI / 2);
  const eyeLens = add(group, lensG, lens, 0, EYE_HEIGHT, -BODY_L / 2 - 2.5);

  // wheels: axis along x, spun by rotation.x
  const wheelG = G(new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 16, high ? 24 : 12));
  wheelG.rotateZ(Math.PI / 2);
  const hubG = G(new BoxGeometry(17, WHEEL_RADIUS * 1.5, 7));
  const wheels: Object3D[] = [];
  const wx = HALF_TRACK, wz = 42;
  const spots: [number, number][] = [[-wx, -wz], [-wx, wz], [wx, -wz], [wx, wz]];
  for (const [x, z] of spots) {
    const w = new Group();
    w.position.set(x, WHEEL_RADIUS, z);
    add(w, wheelG, tyre, 0, 0, 0);
    add(w, hubG, hub, 0, 0, 0);
    group.add(w);
    wheels.push(w);
  }

  // bumper bar on the front edge
  const bumperG = G(new BoxGeometry(100, 14, 10));
  add(group, bumperG, bumperMat, 0, 24, -BODY_L / 2 - 5);

  // magnet plate (front, between bumper and eye)
  const magnet = new Group();
  const magG = G(new BoxGeometry(36, 13, 9));
  const magPlate = add(magnet, magG, steel, 0, 0, 0);
  const poleG = G(new BoxGeometry(8, 13.5, 9.5));
  add(magnet, poleG, red, -14, 0, 0);
  add(magnet, poleG, red, 14, 0, 0);
  magnet.position.set(0, 39, -BODY_L / 2 - 6);
  group.add(magnet);

  // pen holder on the back half of the top
  const pen = new Group();
  const penG = G(new CylinderGeometry(9, 9, 30, seg));
  add(pen, penG, penBody, 0, 15, 0);
  const capG = G(new CylinderGeometry(11, 11, 8, seg));
  add(pen, capG, penCap, 0, 32, 0);
  pen.position.set(0, TOP_Y, 30);
  group.add(pen);

  // builder: motor housings (shown for 4-motor robots) and a gear cog on top (geared robots)
  const motorMat = M(new MeshLambertMaterial({ color: 0x6b635a }));
  const motorG = G(new BoxGeometry(22, 26, 30));
  const motors = new Group();
  for (const [x, z] of [[-40, -40], [-40, 40], [40, -40], [40, 40]] as const) add(motors, motorG, motorMat, x, BODY_TOP + 13, z);
  motors.visible = false;
  group.add(motors);
  const cogTorque = M(new MeshLambertMaterial({ color: 0xff6a1a }));
  const cogSpeed = M(new MeshLambertMaterial({ color: 0x2f6fd6 }));
  const cogG = G(new CylinderGeometry(15, 15, 6, 12));
  const cog = add(group, cogG, cogTorque, 0, TOP_Y + 3, 36);
  const toothG = G(new BoxGeometry(38, 6, 6));
  const teeth = [0, 1, 2].map((i) => { const t = add(cog, toothG, cogTorque, 0, 0, 0); t.rotation.y = (i * Math.PI) / 3; return t; });
  cog.visible = false;
  let spin = 0;

  const steelColor = new Color(0xa7afb8);
  const carryColor = new Color(0xff8a47);
  const bumperIdle = new Color(0x4a443d);
  const bumperOn = new Color(0xff6a1a);
  const black = new Color(0x000000);
  const bumperGlow = new Color(0xff6a1a).multiplyScalar(0.6);
  const capUp = new Color(0x8a8279);
  const penColors = new Map<ColorName, Color>();
  for (const k of Object.keys(COLOR_HEX) as ColorName[]) {
    penColors.set(k, k === "NONE" ? new Color(0x9a9186) : new Color(COLOR_HEX[k]));
  }

  let lastBumper: boolean | null = null;
  let lastCarry: boolean | null = null;
  let lastPenKey = "";

  return {
    group,
    wheels,
    setBumper(on) {
      if (on === lastBumper) return;
      lastBumper = on;
      bumperMat.color.copy(on ? bumperOn : bumperIdle);
      bumperMat.emissive.copy(on ? bumperGlow : black);
    },
    setPen(fitted, down, color) {
      pen.visible = fitted;
      if (!fitted) return;
      // cheap key without allocation: only rebuild material colour when it changes
      const key = down ? color : "UP";
      if (key === lastPenKey) return;
      lastPenKey = key;
      penCap.color.copy(down ? (penColors.get(color) as Color) : capUp);
      pen.position.y = down ? TOP_Y - 8 : TOP_Y;
    },
    setMagnet(fitted, carrying) {
      magnet.visible = fitted;
      if (!fitted || carrying === lastCarry) return;
      lastCarry = carrying;
      (magPlate.material as MeshPhongMaterial).color.copy(carrying ? carryColor : steelColor);
    },
    setWheelAngles(left, right) {
      // roll forward (toward -z) = negative rotation about +x
      wheels[0].rotation.x = -left - spin;
      wheels[1].rotation.x = -left - spin;
      wheels[2].rotation.x = -right - spin;
      wheels[3].rotation.x = -right - spin;
    },
    setDesign(cfg, stalled) {
      if (stalled) spin += 0.35; // builder: wheels slip against a too-heavy object
      const scale = cfg ? cfg.size / ROBOT_NOMINAL : 1;
      const k = cfg ? cfg.wheelDiameter / 100 : 1;
      for (const w of wheels) { w.scale.setScalar(k); w.position.y = WHEEL_RADIUS * k; }
      motors.visible = !!cfg && cfg.motors === 4;
      cog.visible = !!cfg && cfg.gearRatio !== 1;
      if (cfg && cfg.gearRatio !== 1) {
        const m = cfg.gearRatio > 1 ? cogTorque : cogSpeed;
        cog.material = m;
        for (const t of teeth) t.material = m;
      }
      const ex = cfg ? cfg.sensorOffset / scale : 0;
      eyeRing.position.x = ex;
      eyeLens.position.x = ex;
    },
    setCastShadow(on) {
      for (const m of meshes) m.castShadow = on;
    },
    dispose() {
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      group.removeFromParent();
    },
  };
}
