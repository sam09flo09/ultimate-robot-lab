// builder: robot designs change how the simulated robot behaves.
import { describe, expect, it } from "vitest";
import { DEFAULT_ROBOT, type RobotConfig, type RobotController, type Sim, type World, type WorldObject } from "../core/types";
import { clampConfig, configKey, createSim, effectiveConfig, robotStats } from "./index";

function makeWorld(over: Partial<World> = {}): World {
  return {
    id: "test", name: "Test", width: 2000, height: 2000, background: "grid", gridSize: 200,
    start: { x: 0, y: -900, heading: 0 },
    walls: [], floor: [], objects: [], zones: [], goals: [], version: 1,
    ...over,
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function run(sim: Sim, prog: (c: RobotController) => Promise<void>, maxSeconds = 60, dt = 1 / 60): Promise<void> {
  let done = false, err: unknown = null;
  prog(sim.controller).then(() => { done = true; }, (e) => { err = e; done = true; });
  await flush();
  for (let i = 0; i < maxSeconds / dt && !done; i++) { sim.step(dt); await flush(); }
  if (err) throw err;
  if (!done) throw new Error("program did not finish (hang)");
}
const cfg = (c: Partial<RobotConfig>): RobotConfig => ({ ...DEFAULT_ROBOT, ...c });
const heavyBox = (y: number, mass = 2): WorldObject =>
  ({ id: "h", shape: "box", x: 0, y, size: 100, color: "ORANGE", movable: true, pickable: false, mass });

async function timeDrive(config: Partial<RobotConfig> | undefined, mm: number) {
  const sim = createSim(makeWorld({ height: 4000, start: { x: 0, y: -1900, heading: 0 } }), config);
  sim.controller.setDriveVelocity(100);
  await run(sim, (c) => c.driveFor("FORWARD", mm));
  return sim;
}

describe("robot builder: config", () => {
  it("SimState.config is always set; default robot = DEFAULT_ROBOT", () => {
    const sim = createSim(makeWorld());
    expect(sim.state.config).toEqual(DEFAULT_ROBOT);
    expect(sim.state.robotSize).toBe(140);
  });

  it("clamps and snaps to legal values", () => {
    expect(clampConfig({ size: 500, wheelDiameter: 95, gearRatio: 0.45, motors: 3 as 2, sensorOffset: 999 }))
      .toEqual({ size: 200, wheelDiameter: 100, gearRatio: 0.5, motors: 2, sensorOffset: 90 });
    expect(clampConfig({ size: 10, wheelDiameter: 140, gearRatio: 2.8, motors: 4, sensorOffset: -999 }))
      .toEqual({ size: 120, wheelDiameter: 130, gearRatio: 3, motors: 4, sensorOffset: -50 });
    expect(clampConfig({ gearRatio: 0.3 }).gearRatio).toBeCloseTo(1 / 3, 9);
    expect(clampConfig(null)).toEqual(DEFAULT_ROBOT);
    expect(clampConfig({ size: NaN, wheelDiameter: Infinity } as Partial<RobotConfig>)).toEqual(DEFAULT_ROBOT);
  });

  it("stats follow the formulas", () => {
    expect(robotStats(DEFAULT_ROBOT)).toMatchObject({ topSpeed: 800, turnSpeed: 360, track: 120, pushStrength: 1 });
    const s = robotStats(cfg({ wheelDiameter: 130, gearRatio: 2, motors: 4, size: 200 }));
    expect(s.topSpeed).toBeCloseTo(800 * 1.3 / 2, 9);
    expect(s.pushStrength).toBeCloseTo(2 * 2 * 100 / 130, 9);
    expect(s.track).toBe(180);
    expect(configKey(DEFAULT_ROBOT)).toBe("s140w100g1-1m2");
  });

  it("locked rules force the default (+ rules.config); maxSize caps size", () => {
    const locked = makeWorld({ robotRules: { locked: true, config: { motors: 4 } } });
    const sim = createSim(locked, cfg({ size: 200, gearRatio: 3 }));
    expect(sim.state.config).toEqual(cfg({ motors: 4 }));
    sim.setConfig(cfg({ wheelDiameter: 130 }));
    expect(sim.state.config).toEqual(cfg({ motors: 4 }));
    const capped = createSim(makeWorld({ robotRules: { maxSize: 160 } }), cfg({ size: 200, sensorOffset: 90 }));
    expect(capped.state.config).toEqual(cfg({ size: 160, sensorOffset: 70 }));
    expect(capped.state.robotSize).toBe(160);
    expect(effectiveConfig(makeWorld(), cfg({ gearRatio: 2 })).gearRatio).toBe(2);
  });

  it("setConfig resets the sim and applies the new design", async () => {
    const sim = createSim(makeWorld());
    await run(sim, (c) => c.driveFor("FORWARD", 200));
    sim.setConfig(cfg({ size: 180 }));
    expect(sim.state.robot.y).toBe(-900);
    expect(sim.state.time).toBe(0);
    expect(sim.state.robotSize).toBe(180);
    expect(sim.state.config?.size).toBe(180);
  });
});

describe("robot builder: speed and turning", () => {
  it("drive_for 1000 mm takes 1.25 s at 100% with the default robot", async () => {
    const sim = await timeDrive(undefined, 1000);
    expect(sim.state.time).toBeCloseTo(1.25, 1);
    expect(sim.state.robot.y).toBe(-900);
  });

  it("130 mm wheels are 1.3x faster; gear 3 is 3x slower; distances stay exact", async () => {
    const big = await timeDrive({ wheelDiameter: 130 }, 1000);
    expect(big.state.time).toBeCloseTo(1.25 / 1.3, 1);
    expect(big.state.robot.y).toBe(-900);
    const geared = await timeDrive({ gearRatio: 3 }, 1000);
    expect(geared.state.time).toBeCloseTo(3.75, 1);
    expect(geared.state.robot.y).toBe(-900);
    const fast = await timeDrive({ gearRatio: 1 / 3 }, 1200);
    expect(fast.state.time).toBeCloseTo(1200 / 2400, 1);
    expect(fast.state.robot.y).toBe(-700);
  });

  it("a bigger robot turns slower (longer track), angles exact", async () => {
    const turnTime = async (c?: Partial<RobotConfig>) => {
      const sim = createSim(makeWorld({ start: { x: 0, y: 0, heading: 0 } }), c);
      sim.controller.setTurnVelocity(100);
      await run(sim, (k) => k.turnFor("RIGHT", 360));
      expect(sim.state.robot.heading).toBe(0);
      expect(sim.controller.rotation()).toBe(360);
      return sim.state.time;
    };
    expect(await turnTime()).toBeCloseTo(1, 1);
    expect(await turnTime({ size: 200 })).toBeCloseTo(180 / 120, 1);
    expect(await turnTime({ size: 120 })).toBeCloseTo(100 / 120, 1);
  });

  it("wheel velocities scale with wheel speed and track width", async () => {
    const sim = createSim(makeWorld({ start: { x: 0, y: 0, heading: 0 } }), cfg({ wheelDiameter: 130, size: 200 }));
    sim.controller.setWheelVelocities(50, -50);
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    const expected = ((2 * 400 * 1.3) / 180) * (180 / Math.PI) * 0.5;
    expect(sim.controller.rotation()).toBeCloseTo(expected, 3);
    const s2 = createSim(makeWorld({ start: { x: 0, y: 0, heading: 0 } }), cfg({ gearRatio: 2 }));
    s2.controller.setWheelVelocities(100, 100);
    for (let i = 0; i < 60; i++) s2.step(1 / 60);
    expect(s2.state.robot.y).toBeCloseTo(400, 6);
  });
});

describe("robot builder: pushing and stalling", () => {
  it("a mass-2 box stalls the default robot (no wall hit, bumper pressed)", async () => {
    const sim = createSim(makeWorld({ objects: [heavyBox(-700)] }));
    let stalledSeen = false;
    await run(sim, async (c) => {
      const p = c.driveFor("FORWARD", 400);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await p;
    });
    sim.controller.drive("FORWARD");
    for (let i = 0; i < 10; i++) { sim.step(1 / 60); stalledSeen = stalledSeen || !!sim.state.stalled; }
    sim.controller.stop();
    expect(sim.state.objects[0].y).toBe(-700);
    expect(sim.state.robot.y).toBeCloseTo(-700 - 50 - 70, 0);
    expect(sim.state.time).toBeLessThan(1);  // drive_for ended early
    expect(sim.state.wallHits).toBe(0);
    expect(sim.state.bumperPressed).toBe(true);
    expect(stalledSeen).toBe(true);
  });

  it("a 4-motor robot or a geared-2 robot pushes it", async () => {
    for (const c of [cfg({ motors: 4 }), cfg({ gearRatio: 2 })]) {
      const sim = createSim(makeWorld({ objects: [heavyBox(-700)] }), c);
      await run(sim, (k) => k.driveFor("FORWARD", 400));
      expect(sim.state.robot.y).toBe(-500);
      expect(sim.state.objects[0].y).toBeGreaterThan(-700 + 300);
      expect(sim.state.stalled).toBe(false);
    }
  });

  it("objects without mass (mass 1) are still pushed by the default robot; 130 mm wheels can't push mass 1", async () => {
    const light = { ...heavyBox(-700), mass: undefined };
    const sim = createSim(makeWorld({ objects: [light] }));
    await run(sim, (k) => k.driveFor("FORWARD", 200));
    expect(sim.state.robot.y).toBe(-700);
    const weak = createSim(makeWorld({ objects: [light] }), cfg({ wheelDiameter: 130 }));
    await run(weak, (k) => k.driveFor("FORWARD", 200));
    expect(weak.state.objects[0].y).toBe(-700);
  });
});

describe("robot builder: size and sensors", () => {
  // two walls with a 190 mm gap centred on x = 0 at y = 0 (ends at ±100, 5 mm square caps)
  const gapWorld = makeWorld({
    walls: [
      { a: { x: -1000, y: 0 }, b: { x: -100, y: 0 }, thickness: 10 },
      { a: { x: 100, y: 0 }, b: { x: 1000, y: 0 }, thickness: 10 },
    ],
  });
  it("size 140 passes a 190 mm gap; size 200 can't", async () => {
    const small = createSim(gapWorld);
    await run(small, (c) => c.driveFor("FORWARD", 1200));
    expect(small.state.robot.y).toBe(300);
    expect(small.state.wallHits).toBe(0);
    const big = createSim(gapWorld, cfg({ size: 200 }));
    await run(big, (c) => c.driveFor("FORWARD", 1200));
    expect(big.state.robot.y).toBeLessThan(0);
    expect(big.state.wallHits).toBe(1);
  });

  it("the collision box follows size (stops 100 mm from the border)", async () => {
    const sim = createSim(makeWorld(), cfg({ size: 200 }));
    await run(sim, (c) => c.driveFor("FORWARD", 3000));
    expect(sim.state.robot.y).toBeCloseTo(900, 3);
  });

  it("sensor offset moves the distance ray and front eye along the front edge", () => {
    const world = makeWorld({
      start: { x: 0, y: 0, heading: 0 },
      objects: [{ id: "p", shape: "box", x: 60, y: 200, size: 40, color: "BLUE", movable: false, pickable: false }],
    });
    const centre = createSim(world);
    centre.step(1 / 60);
    expect(centre.controller.distanceMM()).toBe(930); // misses the post, sees the border
    const right = createSim(world, cfg({ sensorOffset: 60 }));
    right.step(1 / 60);
    expect(right.controller.distanceMM()).toBe(110);
    expect(right.state.distanceRay?.from).toEqual({ x: 60, y: 70 });
    // rotate: heading 90 → offset +60 is "right" of the robot = −y
    const turned = createSim({ ...world, objects: [], start: { x: 0, y: 0, heading: 90 } }, cfg({ sensorOffset: 60 }));
    turned.step(1 / 60);
    expect(turned.state.distanceRay?.from.x).toBeCloseTo(70, 9);
    expect(turned.state.distanceRay?.from.y).toBeCloseTo(-60, 9);
    // front eye: a disk off to the left is seen only with a left-mounted eye
    const eyeWorld = makeWorld({
      start: { x: 0, y: 0, heading: 0 },
      objects: [{ id: "d", shape: "disk", x: -100, y: 140, size: 40, color: "GREEN", movable: true, pickable: false }],
    });
    expect(createSim(eyeWorld).controller.frontColor()).toBe("NONE");
    expect(createSim(eyeWorld, cfg({ sensorOffset: -60 })).controller.frontColor()).toBe("GREEN");
  });

  it("is deterministic for the same config and dt sequence", async () => {
    const prog = async (c: RobotController) => {
      c.setDriveVelocity(80);
      await c.driveFor("FORWARD", 500);
      await c.turnFor("LEFT", 30);
      c.setWheelVelocities(70, 40);
      await c.wait(1);
      c.stop();
      await c.driveFor("FORWARD", 700);
    };
    const config = cfg({ size: 170, wheelDiameter: 80, gearRatio: 0.5, motors: 4, sensorOffset: 20 });
    const world = makeWorld({ objects: [heavyBox(-200, 1.5)] });
    const a = createSim(world, config), b = createSim(world, config);
    await run(a, prog, 60, 0.0173); await run(b, prog, 60, 0.0173);
    expect(a.state).toEqual(b.state);
  });
});
