import { describe, expect, it } from "vitest";
import {
  FrameTimer, MAX_PHI, MIN_PHI, RIBBON_VERTS_PER_SEG, WheelOdometry, angleDiffDeg, clampOrbit, fitDistance,
  fitSphereDistance, floorTextureLayout, gridSquareNumber, growCapacity, headingForward, headingToRotationY,
  orbitLimits, orbitPosition, pointsDelta, threeToWorldX, threeToWorldY, worldToTex, worldToThreeX,
  worldToThreeZ, writeRibbonSegment, type OrbitState,
} from "./math";

/** Apply three.js Ry(θ) to a vector (x, z): x' = x cos θ + z sin θ, z' = -x sin θ + z cos θ. */
function rotY(theta: number, x: number, z: number) {
  return { x: x * Math.cos(theta) + z * Math.sin(theta), z: -x * Math.sin(theta) + z * Math.cos(theta) };
}

describe("coordinate mapping", () => {
  it("maps world (x, y) to three (x, -y) and back", () => {
    for (const [x, y] of [[0, 0], [100, 200], [-1500, 1200], [3.5, -7.25]]) {
      expect(worldToThreeX(x)).toBe(x);
      expect(worldToThreeZ(y)).toBe(-y);
      expect(threeToWorldX(worldToThreeX(x))).toBe(x);
      expect(threeToWorldY(worldToThreeZ(y))).toBe(y);
    }
  });

  it("world +y (up on screen) is three -z, i.e. away from the default camera", () => {
    expect(worldToThreeZ(1000)).toBeLessThan(0);
  });
});

describe("heading → rotation", () => {
  const cases = [0, 45, 90, 180, 270, 359];
  it("the model front (local -z) ends up pointing along the world heading", () => {
    for (const h of cases) {
      const f = rotY(headingToRotationY(h), 0, -1); // local front
      // world forward for heading h is (sin h, cos h); in three that is (sin h, -cos h)
      const rad = (h * Math.PI) / 180;
      expect(f.x).toBeCloseTo(Math.sin(rad), 9);
      expect(f.z).toBeCloseTo(-Math.cos(rad), 9);
      const out = headingForward(h, { x: 0, z: 0 });
      expect(out.x).toBeCloseTo(f.x, 9);
      expect(out.z).toBeCloseTo(f.z, 9);
    }
  });

  it("heading 90 faces world +x (right); increasing heading turns clockwise seen from above", () => {
    const f90 = rotY(headingToRotationY(90), 0, -1);
    expect(f90.x).toBeCloseTo(1, 9);
    expect(f90.z).toBeCloseTo(0, 9);
    // seen from above (+y) with world +y = up on screen: clockwise = from up (+y) to right (+x)
    const f10 = rotY(headingToRotationY(10), 0, -1);
    expect(f10.x).toBeGreaterThan(0);
  });

  it("angleDiffDeg is shortest signed", () => {
    expect(angleDiffDeg(350, 10)).toBeCloseTo(20);
    expect(angleDiffDeg(10, 350)).toBeCloseTo(-20);
    expect(angleDiffDeg(0, 180)).toBeCloseTo(180);
  });
});

describe("WheelOdometry", () => {
  it("rolls both wheels forward equally when driving straight", () => {
    const o = new WheelOdometry(27, 66);
    o.update(0, 0, 0);
    o.update(0, 100, 0); // forward along +y at heading 0
    expect(o.left).toBeCloseTo(100 / 27, 6);
    expect(o.right).toBeCloseTo(100 / 27, 6);
  });

  it("rolls backward when reversing, at any heading", () => {
    const o = new WheelOdometry(27, 66);
    o.update(0, 0, 90);
    o.update(-50, 0, 90); // heading 90 faces +x; moving -x is reverse
    expect(o.left).toBeCloseTo(-50 / 27, 6);
    expect(o.right).toBeCloseTo(-50 / 27, 6);
  });

  it("turning clockwise (right) spins left wheels forward and right wheels back", () => {
    const o = new WheelOdometry(27, 66);
    o.update(0, 0, 350);
    o.update(0, 0, 10); // +20° clockwise across the 0/360 wrap
    const arc = (20 * Math.PI / 180) * 66;
    expect(o.left).toBeCloseTo(arc / 27, 6);
    expect(o.right).toBeCloseTo(-arc / 27, 6);
  });

  it("accumulates over many small steps", () => {
    const o = new WheelOdometry(25, 60);
    o.update(0, 0, 0);
    for (let i = 1; i <= 100; i++) o.update(0, i * 5, 0);
    expect(o.left).toBeCloseTo(500 / 25, 6);
  });

  it("ignores teleports (reset) and the first update", () => {
    const o = new WheelOdometry(27, 66);
    o.update(500, 500, 0);
    expect(o.left).toBe(0);
    o.update(-900, -900, 0);
    expect(o.left).toBe(0);
    o.reset();
    o.update(0, 0, 180);
    expect(o.right).toBe(0);
  });
});

describe("FrameTimer", () => {
  it("averages intervals between ticks and ignores long gaps", () => {
    const t = new FrameTimer(4, 500);
    expect(t.average()).toBe(0);
    t.tick(0); t.tick(10); t.tick(30);
    expect(t.average()).toBeCloseTo(15);
    t.tick(2000); // hidden tab: ignored
    expect(t.average()).toBeCloseTo(15);
    t.tick(2016); t.tick(2032); t.tick(2048); t.tick(2064);
    expect(t.average()).toBeCloseTo(16); // window of 4
  });
});

describe("orbit camera math", () => {
  const L = orbitLimits(2000, 2000);

  it("clamps polar angle so the camera never goes under the floor", () => {
    const s: OrbitState = { tx: 0, tz: 0, radius: 3000, theta: 0, phi: 3 };
    clampOrbit(s, L);
    expect(s.phi).toBe(MAX_PHI);
    const p = orbitPosition(s, { x: 0, y: 0, z: 0 });
    expect(p.y).toBeGreaterThan(0);
    s.phi = -1;
    clampOrbit(s, L);
    expect(s.phi).toBe(MIN_PHI);
  });

  it("clamps radius and target, and fixes non-finite input", () => {
    const s: OrbitState = { tx: 99999, tz: -99999, radius: 1e9, theta: NaN, phi: NaN };
    clampOrbit(s, L);
    expect(s.radius).toBe(L.maxRadius);
    expect(s.tx).toBe(1000);
    expect(s.tz).toBe(-1000);
    expect(Number.isFinite(s.theta)).toBe(true);
    expect(Number.isFinite(s.phi)).toBe(true);
    s.radius = 1;
    clampOrbit(s, L);
    expect(s.radius).toBe(L.minRadius);
  });

  it("wraps theta into (-π, π]", () => {
    const s: OrbitState = { tx: 0, tz: 0, radius: 3000, theta: 7, phi: 1 };
    clampOrbit(s, L);
    expect(s.theta).toBeCloseTo(7 - 2 * Math.PI);
  });

  it("theta 0 puts the camera on the +z side (behind the field's bottom edge)", () => {
    const p = orbitPosition({ tx: 0, tz: 0, radius: 1000, theta: 0, phi: Math.PI / 4 }, { x: 0, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(1000 * Math.SQRT1_2);
    expect(p.y).toBeCloseTo(1000 * Math.SQRT1_2);
  });

  it("fit distances grow with field size and shrink with wider fov", () => {
    expect(fitDistance(30, 1, 2000, 2000)).toBeGreaterThan(fitDistance(30, 1, 1000, 1000));
    expect(fitDistance(45, 1, 2000, 2000)).toBeLessThan(fitDistance(30, 1, 2000, 2000));
    // wide canvas: height is the limit; tall canvas: width is the limit
    const wide = fitDistance(30, 2, 2000, 2000, 1);
    expect(wide).toBeCloseTo(1000 / Math.tan((15 * Math.PI) / 180));
    expect(fitDistance(30, 0.5, 2000, 2000, 1)).toBeGreaterThan(wide);
    expect(fitSphereDistance(45, 1.7, 3000, 3000)).toBeGreaterThan(fitSphereDistance(45, 1.7, 2000, 2000));
  });
});

describe("floor texture layout", () => {
  it("fits the longest side into maxPx and keeps aspect", () => {
    const L = floorTextureLayout(2000, 2000, 2048);
    expect(L.width).toBe(2048);
    expect(L.height).toBe(2048);
    const R = floorTextureLayout(3000, 1500, 2048);
    expect(R.width).toBe(2048);
    expect(R.height).toBe(1024);
  });

  it("never upsamples more than 2 px/mm and handles bad sizes", () => {
    expect(floorTextureLayout(200, 200, 2048).width).toBe(400);
    expect(floorTextureLayout(0, -5, 1024).width).toBe(1024);
  });

  it("maps world corners to canvas corners (canvas top = world +y)", () => {
    const L = floorTextureLayout(2400, 2400, 2048);
    const tl = worldToTex(L, 2400, 2400, -1200, 1200);
    const br = worldToTex(L, 2400, 2400, 1200, -1200);
    expect(tl.px).toBeCloseTo(0);
    expect(tl.py).toBeCloseTo(0);
    expect(br.px).toBeCloseTo(L.width);
    expect(br.py).toBeCloseTo(L.height);
  });

  it("numbers grid squares 1..100 from the bottom-left, row by row", () => {
    expect(gridSquareNumber(0, 0, 10)).toBe(1);   // bottom-left
    expect(gridSquareNumber(0, 9, 10)).toBe(10);  // bottom-right
    expect(gridSquareNumber(9, 0, 10)).toBe(91);  // top-left
    expect(gridSquareNumber(9, 9, 10)).toBe(100); // top-right
  });
});

describe("ribbons", () => {
  it("writes a flat quad of the right width around the segment", () => {
    const pos = new Float32Array(RIBBON_VERTS_PER_SEG * 3);
    writeRibbonSegment(pos, 0, 0, 0, 100, 0, 5, 0, 2);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < RIBBON_VERTS_PER_SEG; i++) { xs.push(pos[i * 3]); ys.push(pos[i * 3 + 1]); zs.push(pos[i * 3 + 2]); }
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(100);
    expect(Math.min(...zs)).toBeCloseTo(-5);
    expect(Math.max(...zs)).toBeCloseTo(5);
    for (const y of ys) expect(y).toBe(2);
  });

  it("triangles face up (+y) so they are visible from above", () => {
    const pos = new Float32Array(RIBBON_VERTS_PER_SEG * 3);
    writeRibbonSegment(pos, 0, 10, 20, 50, 80, 4, 2, 1);
    for (let t = 0; t < 2; t++) {
      const o = t * 9;
      const ax = pos[o + 3] - pos[o], az = pos[o + 5] - pos[o + 2];
      const bx = pos[o + 6] - pos[o], bz = pos[o + 8] - pos[o + 2];
      const ny = az * bx - ax * bz; // y of cross(a, b)
      expect(ny).toBeGreaterThan(0);
    }
  });

  it("makes a dot for a zero-length segment and extends caps", () => {
    const pos = new Float32Array(RIBBON_VERTS_PER_SEG * 3);
    writeRibbonSegment(pos, 0, 5, 5, 5, 5, 3, 0, 0);
    const xs: number[] = [];
    for (let i = 0; i < RIBBON_VERTS_PER_SEG; i++) xs.push(pos[i * 3]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6);
  });

  it("grows capacity by doubling", () => {
    expect(growCapacity(0, 10)).toBe(256);
    expect(growCapacity(256, 257)).toBe(512);
    expect(growCapacity(512, 3000)).toBe(4096);
  });

  it("detects appends, front-trims and rebuilds of point arrays", () => {
    const out = { kind: "", from: 0, dropped: 0 };
    const a = [{ x: 0 }, { x: 1 }, { x: 2 }];
    expect(pointsDelta(null, 0, null, a, out).kind).toBe("rebuild");
    expect(pointsDelta(a, 3, a[2], a, out).kind).toBe("same");
    a.push({ x: 3 }, { x: 4 });
    pointsDelta(a, 3, a[2], a, out);
    expect(out).toEqual({ kind: "append", from: 3, dropped: 0 });
    // sim trims the front when the path is too long
    const last = a[4];
    a.push({ x: 5 });
    a.splice(0, 2);
    pointsDelta(a, 5, last, a, out);
    expect(out).toEqual({ kind: "append", from: 3, dropped: 2 });
    // new array (reset) → rebuild
    expect(pointsDelta(a, 4, a[3], [{ x: 0 }], out).kind).toBe("rebuild");
  });
});
