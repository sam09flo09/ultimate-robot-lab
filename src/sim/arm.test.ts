/** arm: arm motion, claw reach and height band, grab/release, stacking, platforms, goals, determinism. */
import { describe, expect, it } from "vitest";
import type { Goal, Platform, RobotController, Sim, World, WorldObject } from "../core/types";
import { createSim } from "./index";
import { clawHeight, objectHeight, stackLevels } from "./arm";

const box = (id: string, x: number, y: number, extra: Partial<WorldObject> = {}): WorldObject =>
  ({ id, shape: "box", x, y, size: 50, color: "BLUE", movable: true, pickable: true, rotation: 0, height: 50, ...extra });

const SHELF: Platform = { id: "shelf", x: 0, y: 0, w: 300, h: 200, height: 100, color: "YELLOW" };

function world(over: Partial<World> = {}): World {
  return {
    id: "arm-test", name: "Arm test", width: 2000, height: 2000, background: "grid",
    start: { x: 0, y: -600, heading: 0 },
    walls: [], floor: [], objects: [box("b1", 0, -470)], zones: [], goals: [],
    hardware: { arm: true }, platforms: [SHELF], version: 1,
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
const obj = (sim: Sim, id: string) => sim.state.objects.find((o) => o.id === id)!;

describe("arm motion", () => {
  it("starts down with the claw open; SimState.arm only in arm worlds", () => {
    const sim = createSim(world());
    expect(sim.state.arm).toEqual({ angle: 0, clawClosed: false, holding: null });
    expect(sim.controller.armAvailable()).toBe(true);
    const plain = createSim(world({ hardware: {} }));
    expect(plain.state.arm).toBeUndefined();
    expect(plain.controller.armAvailable()).toBe(false);
    expect(plain.controller.armAngle()).toBe(0);
  });

  it("spins to an angle at 60°/s (50%) and resolves there", async () => {
    const sim = createSim(world());
    await run(sim, (c) => c.armSpinTo(90));
    expect(sim.controller.armAngle()).toBe(90);
    expect(sim.state.time).toBeCloseTo(1.5, 1);
    await run(sim, async (c) => { c.setArmVelocity(100); await c.armSpinTo(30); });
    expect(sim.controller.armAngle()).toBe(30);
    expect(sim.state.time).toBeCloseTo(2.0, 1);
    expect(clawHeight(30)).toBeCloseTo(150, 6);
  });

  it("clamps targets to 0..90 and continuous spin stops at the end", async () => {
    const sim = createSim(world({ platforms: [] }));
    await run(sim, (c) => c.armSpinTo(200));
    expect(sim.controller.armAngle()).toBe(90);
    sim.controller.armSpin(-1);
    for (let i = 0; i < 200; i++) sim.step(1 / 60);
    expect(sim.controller.armAngle()).toBe(0);
    sim.controller.armSpin(1);
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    sim.controller.armSpin(0);
    const a = sim.controller.armAngle();
    expect(a).toBeGreaterThan(20);
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    expect(sim.controller.armAngle()).toBe(a);
  });

  it("abort rejects a pending arm motion with STOPPED", async () => {
    const sim = createSim(world());
    const p = sim.controller.armSpinTo(90);
    sim.step(0.1);
    sim.abort();
    await expect(p).rejects.toThrow("STOPPED");
  });
});

describe("claw", () => {
  it("grabs a floor object in reach only when the claw is low enough (height band)", async () => {
    const sim = createSim(world());
    await run(sim, async (c) => { await c.armSpinTo(90); await c.claw(true); });
    expect(sim.controller.clawHolding()).toBe(false);
    expect(sim.state.arm!.clawClosed).toBe(true);
    await run(sim, async (c) => { await c.claw(false); await c.armSpinTo(0); await c.claw(true); });
    expect(sim.controller.clawHolding()).toBe(true);
    expect(sim.state.arm!.holding).toBe("b1");
  });

  it("doesn't grab what is out of reach or off to the side", async () => {
    const far = createSim(world({ objects: [box("b1", 0, -400)] }));   // centre 130 mm ahead of the face
    await run(far, (c) => c.claw(true));
    expect(far.controller.clawHolding()).toBe(false);
    const side = createSim(world({ objects: [box("b1", 60, -480)] }));
    await run(side, (c) => c.claw(true));
    expect(side.controller.clawHolding()).toBe(false);
    const heavy = createSim(world({ objects: [box("b1", 0, -470, { pickable: false })] }));
    await run(heavy, (c) => c.claw(true));
    expect(heavy.controller.clawHolding()).toBe(false);
  });

  it("lifts the held object to the claw height, carries it, and drops it to the floor", async () => {
    const sim = createSim(world({ platforms: [] }));
    await run(sim, async (c) => { await c.claw(true); await c.armSpinTo(30); });
    expect(obj(sim, "b1").z).toBeCloseTo(150, 6);
    await run(sim, (c) => c.turnFor("RIGHT", 90));
    const b = obj(sim, "b1");
    expect(b.x).toBeCloseTo(70 + 60, 6);
    expect(b.y).toBeCloseTo(-600, 6);
    await run(sim, (c) => c.claw(false));
    expect(obj(sim, "b1").z).toBe(0);
    expect(sim.controller.clawHolding()).toBe(false);
  });

  it("emits pickedUp / dropped", async () => {
    const sim = createSim(world({ platforms: [] }));
    const ev: string[] = [];
    sim.onEvent((e) => { if (e.type === "pickedUp" || e.type === "dropped") ev.push(`${e.type}:${e.objectId}`); });
    await run(sim, async (c) => { await c.claw(true); await c.claw(false); });
    expect(ev).toEqual(["pickedUp:b1", "dropped:b1"]);
  });

  it("the held object is a ghost: the robot doesn't push it, the distance sensor ignores it", async () => {
    const sim = createSim(world({ platforms: [] }));
    await run(sim, (c) => c.claw(true));
    expect(sim.controller.distanceMM()).toBeGreaterThan(1000);
    await run(sim, (c) => c.driveFor("FORWARD", 300));
    expect(sim.state.robot.y).toBeCloseTo(-300, 6);
    expect(obj(sim, "b1").y).toBeCloseTo(-300 + 70 + 60, 6);
  });
});

describe("platforms", () => {
  it("are solid to the robot (drive_for ends early) and to pushed floor objects", async () => {
    const sim = createSim(world({ objects: [] }));
    await run(sim, (c) => c.driveFor("FORWARD", 1000));
    expect(sim.state.robot.y + 70).toBeLessThanOrEqual(-100 + 0.5);
    const push = createSim(world({ objects: [box("p1", 0, -470, { pickable: false })] }));
    await run(push, (c) => c.driveFor("FORWARD", 1000));
    expect(obj(push, "p1").y + 25).toBeLessThanOrEqual(-100 + 0.5);
  });

  it("place on a platform: lowering stops on the top, release rests there, goal passes", async () => {
    const goals: Goal[] = [{ type: "objectsOnPlatform", platform: "shelf", count: 1, color: "BLUE" }];
    const sim = createSim(world({ goals }));
    expect(sim.evaluateGoals()[0].passed).toBe(false);
    await run(sim, async (c) => {
      await c.claw(true);
      await c.armSpinTo(30);
      await c.driveFor("FORWARD", 400); // front face at y = -130; claw over the shelf edge (y = -100)
      await c.armSpinTo(0);             // blocked by the shelf top
    });
    const blocked = sim.controller.armAngle();
    expect(blocked).toBeCloseTo((Math.asin(100 / 300) * 180) / Math.PI, 1);
    expect(obj(sim, "b1").z).toBeCloseTo(100, 1);
    await run(sim, async (c) => { await c.claw(false); await c.armSpinTo(40); await c.driveFor("REVERSE", 300); });
    const b = obj(sim, "b1");
    expect(b.z).toBe(100);
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: true, detail: "1 of 1 blue object is on platform \"shelf\"" });
  });

  it("objects on a platform can't be reached by a lowered claw, but can at the platform height", async () => {
    const sim = createSim(world({ objects: [box("top", 0, -70, { z: 100 })], start: { x: 0, y: -200, heading: 0 } }));
    expect(obj(sim, "top").z).toBe(100);
    await run(sim, (c) => c.claw(true));
    expect(sim.controller.clawHolding()).toBe(false);
    await run(sim, async (c) => { await c.claw(false); await c.armSpinTo(25); await c.armSpinTo(0); await c.claw(true); });
    expect(sim.controller.clawHolding()).toBe(true);
  });

  it("an object let go below the platform top falls to the floor beside it", async () => {
    const sim = createSim(world());
    await run(sim, async (c) => { await c.claw(true); await c.driveFor("FORWARD", 400); await c.claw(false); });
    const b = obj(sim, "b1");
    expect(b.z).toBe(0);
    expect(b.y + 25).toBeLessThanOrEqual(-100 + 0.5); // pushed out of the platform
  });
});

describe("stacking", () => {
  const stackWorld = (over: Partial<World> = {}) => world({
    platforms: [],
    objects: [box("base", 0, 0, { color: "RED" }), box("b1", 0, -470)],
    zones: [{ id: "z", kind: "rect", x: 0, y: 0, w: 300, h: 300 }],
    goals: [{ type: "stackHeight", count: 2, zone: "z" }],
    ...over,
  });

  const placeOnBase = (c: RobotController) => (async () => {
    await c.claw(true);
    await c.armSpinTo(20);
    await c.driveFor("FORWARD", 470); // front face y = -60: held centre over the base (y = 0)
    await c.armSpinTo(0);             // stops on the base's top (50 mm)
    await c.claw(false);
    await c.armSpinTo(30);
  })();

  it("stacks one object on another and the goal counts it", async () => {
    const sim = createSim(stackWorld());
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: false, detail: "Tallest stack in the z zone: 1 of 2" });
    await run(sim, placeOnBase);
    expect(sim.controller.armAngle()).toBe(30);
    expect(obj(sim, "b1").z).toBe(50);
    expect(obj(sim, "b1").x).toBeCloseTo(0, 6);
    const lv = stackLevels(sim.state.objects, null);
    expect(lv.level).toEqual([1, 2]);
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: true });
  });

  it("riders move with what they rest on when the robot pushes the base", async () => {
    const sim = createSim(stackWorld());
    await run(sim, placeOnBase);
    await run(sim, (c) => c.driveFor("FORWARD", 300));
    const base = obj(sim, "base"), top = obj(sim, "b1");
    expect(base.y).toBeGreaterThan(100);
    expect(top.x).toBeCloseTo(base.x, 6);
    expect(top.y).toBeCloseTo(base.y, 6);
    expect(top.z).toBe(50);
  });

  it("grabbing the bottom of a stack carries the stack; releasing keeps it stacked", async () => {
    const sim = createSim(stackWorld());
    await run(sim, placeOnBase);
    await run(sim, async (c) => { await c.armSpinTo(0); await c.claw(true); });
    expect(sim.state.arm!.holding).toBe("base");
    await run(sim, (c) => c.armSpinTo(20));
    expect(obj(sim, "b1").z).toBeCloseTo(obj(sim, "base").z! + 50, 6);
    await run(sim, (c) => c.claw(false));
    expect(obj(sim, "base").z).toBe(0);
    expect(obj(sim, "b1").z).toBe(50);
  });

  it("is deterministic", async () => {
    const once = async () => {
      const sim = createSim(stackWorld());
      await run(sim, placeOnBase);
      await run(sim, (c) => c.driveFor("FORWARD", 300));
      return JSON.stringify([sim.state.objects, sim.state.robot, sim.state.arm, sim.state.time]);
    };
    expect(await once()).toBe(await once());
  });
});

describe("helpers", () => {
  it("objectHeight defaults: disk 30, box = side", () => {
    expect(objectHeight({ id: "d", shape: "disk", x: 0, y: 0, size: 80, color: "RED", movable: true, pickable: true })).toBe(30);
    expect(objectHeight({ id: "b", shape: "box", x: 0, y: 0, size: 60, color: "RED", movable: true, pickable: true })).toBe(60);
    expect(objectHeight(box("x", 0, 0, { height: 40 }))).toBe(40);
  });

  it("world objects given z settle onto what is under them", () => {
    const sim = createSim(world({ objects: [box("a", 0, 0, { z: 130 }), box("b", 600, 0, { z: 40 })] }));
    expect(obj(sim, "a").z).toBe(100); // the shelf top
    expect(obj(sim, "b").z).toBe(0);   // nothing under it: the floor
  });

  it("missing platform: goal fails with a clear message", () => {
    const sim = createSim(world({ goals: [{ type: "objectsOnPlatform", platform: "nope", count: 1 }] }));
    expect(sim.evaluateGoals()[0].detail).toMatch(/missing/);
  });
});
