import { describe, expect, it } from "vitest";
import type { Goal, RobotController, Sim, SimEvent, World, WorldObject } from "../core/types";
import { createSim } from "./index";

function makeWorld(over: Partial<World> = {}): World {
  return {
    id: "test", name: "Test", width: 2000, height: 2000, background: "numberGrid", gridSize: 200,
    start: { x: -900, y: -900, heading: 0 },
    walls: [], floor: [], objects: [], zones: [], goals: [], version: 1,
    ...over,
  };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** Run an async program against the sim, stepping at 60 Hz until it finishes. */
async function run(sim: Sim, prog: (c: RobotController) => Promise<void>, maxSeconds = 60, dt = 1 / 60): Promise<void> {
  let done = false, err: unknown = null;
  prog(sim.controller).then(() => { done = true; }, (e) => { err = e; done = true; });
  await flush();
  for (let i = 0; i < maxSeconds / dt && !done; i++) {
    sim.step(dt);
    await flush();
  }
  if (err) throw err;
  if (!done) throw new Error("program did not finish (hang)");
}

async function steps(sim: Sim, seconds: number, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) { sim.step(dt); await flush(); }
}

const disk = (id: string, x: number, y: number, extra: Partial<WorldObject> = {}): WorldObject =>
  ({ id, shape: "disk", x, y, size: 80, color: "RED", movable: true, pickable: false, ...extra });

describe("curriculum motion (numberGrid)", () => {
  it("drive 200 forward lands exactly at y=-700", async () => {
    const sim = createSim(makeWorld());
    await run(sim, (c) => c.driveFor("FORWARD", 200));
    expect(sim.state.robot.x).toBe(-900);
    expect(sim.state.robot.y).toBe(-700);
    expect(sim.state.time).toBeCloseTo(0.5, 1); // 50% = 400 mm/s
  });

  it("square of 4 x (drive 200, turn right 90) returns exactly to start", async () => {
    const sim = createSim(makeWorld());
    await run(sim, async (c) => {
      for (let i = 0; i < 4; i++) { await c.driveFor("FORWARD", 200); await c.turnFor("RIGHT", 90); }
    });
    expect(sim.state.robot).toEqual({ x: -900, y: -900, heading: 0 });
    expect(sim.controller.rotation()).toBe(360);
    expect(sim.state.wallHits).toBe(0);
  });

  it("long grid program lands on grid centres with odd dt", async () => {
    const sim = createSim(makeWorld());
    await run(sim, async (c) => {
      await c.driveFor("FORWARD", 600);
      await c.turnFor("RIGHT", 90);
      await c.driveFor("FORWARD", 400);
      await c.turnFor("LEFT", 45);
      await c.turnFor("LEFT", 45);
      await c.driveFor("REVERSE", 200);
    }, 60, 0.0173);
    expect(sim.state.robot).toEqual({ x: -500, y: -500, heading: 0 });
  });

  it("drives at 800 mm/s at 100%", async () => {
    const sim = createSim(makeWorld());
    sim.controller.setDriveVelocity(100);
    await run(sim, (c) => c.driveFor("FORWARD", 800));
    expect(sim.state.time).toBeCloseTo(1, 1);
    expect(sim.state.robot.y).toBe(-100);
  });

  it("turnToHeading takes the shortest way; setHeading only re-zeroes gyro", async () => {
    const sim = createSim(makeWorld());
    const c = sim.controller;
    await run(sim, () => c.turnToHeading(270));
    expect(sim.state.robot.heading).toBe(270);
    expect(c.rotation()).toBe(-90);
    c.setHeading(0);
    expect(c.heading()).toBe(0);
    expect(sim.state.robot.heading).toBe(270);
    await run(sim, () => c.turnToHeading(90));
    expect(c.heading()).toBe(90);
    expect(sim.state.robot.heading).toBe(0);
    expect(c.rotation()).toBe(0);
  });

  it("continuous drive + stop, isDone, path points", async () => {
    const sim = createSim(makeWorld());
    const c = sim.controller;
    c.drive("FORWARD");
    expect(c.isDone()).toBe(false);
    await steps(sim, 0.5);
    c.stop();
    expect(c.isDone()).toBe(true);
    expect(sim.state.robot.y).toBeGreaterThan(-720);
    expect(sim.state.path.length).toBeGreaterThan(10);
    const last = sim.state.path[sim.state.path.length - 1];
    expect(last.y).toBe(sim.state.robot.y);
  });

  it("wait resolves in sim time and timer works", async () => {
    const sim = createSim(makeWorld());
    await run(sim, (c) => c.wait(1.5));
    expect(sim.state.time).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(sim.state.time).toBeLessThan(1.6);
    expect(sim.controller.timer()).toBeCloseTo(sim.state.time, 6);
    sim.controller.resetTimer();
    expect(sim.controller.timer()).toBe(0);
  });
});

describe("walls and blocking", () => {
  it("drive_for into the border ends early, does not hang, counts one hit", async () => {
    const sim = createSim(makeWorld());
    const events: SimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    await run(sim, async (c) => { await c.turnFor("LEFT", 90); await c.driveFor("FORWARD", 500); });
    expect(sim.state.robot.x).toBeCloseTo(-930, 3);
    expect(sim.state.wallHits).toBe(1);
    expect(events.filter((e) => e.type === "wallHit")).toHaveLength(1);
    expect(sim.state.bumperPressed).toBe(true);
    expect(sim.state.time).toBeLessThan(1.5);
    // a second distinct contact counts again
    await run(sim, async (c) => { await c.driveFor("REVERSE", 100); await c.driveFor("FORWARD", 200); });
    expect(sim.state.wallHits).toBe(2);
    expect(sim.state.bumperPressed).toBe(true);
    await run(sim, (c) => c.driveFor("REVERSE", 100));
    expect(sim.state.bumperPressed).toBe(false);
  });

  it("diagonal drive into a corner ends and never hangs", async () => {
    const sim = createSim(makeWorld({ start: { x: 800, y: 800, heading: 45 } }));
    await run(sim, (c) => c.driveFor("FORWARD", 2000));
    expect(sim.state.robot.x).toBeLessThanOrEqual(930 + 1e-6);
    expect(sim.state.robot.y).toBeLessThanOrEqual(930 + 1e-6);
    expect(sim.state.wallHits).toBe(1);
    expect(sim.controller.isDone()).toBe(true);
  });

  it("robot never passes through a thin wall", async () => {
    const sim = createSim(makeWorld({ walls: [{ a: { x: -1000, y: -500 }, b: { x: 0, y: -500 }, thickness: 10 }] }));
    sim.controller.setDriveVelocity(100);
    await run(sim, (c) => c.driveFor("FORWARD", 1000));
    expect(sim.state.robot.y).toBeCloseTo(-505 - 70, 3);
    expect(sim.state.wallHits).toBe(1);
  });

  it("immovable objects behave like walls", async () => {
    const sim = createSim(makeWorld({ objects: [disk("rock", -900, -500, { movable: false })] }));
    await run(sim, (c) => c.driveFor("FORWARD", 1000));
    expect(sim.state.robot.y).toBeCloseTo(-500 - 40 - 70, 3);
    expect(sim.state.objects[0].y).toBe(-500);
    expect(sim.state.wallHits).toBe(1);
  });
});

describe("objects", () => {
  it("pushes a movable disk, which then stops at the wall", async () => {
    const sim = createSim(makeWorld({ objects: [disk("d", -900, -600)] }));
    await run(sim, (c) => c.driveFor("FORWARD", 300));
    const d = sim.state.objects[0];
    expect(d.x).toBeCloseTo(-900, 3);
    expect(d.y).toBeCloseTo(-490, 1); // pushed ahead of the robot's front face
    expect(d.y - sim.state.robot.y).toBeGreaterThanOrEqual(110 - 0.01);
    expect(sim.state.wallHits).toBe(0);
    // push it all the way into the top border: robot stops, disk stays inside
    await run(sim, (c) => c.driveFor("FORWARD", 3000));
    expect(sim.state.objects[0].y).toBeLessThanOrEqual(1000 - 40 + 1e-6);
    expect(sim.state.robot.y).toBeCloseTo(1000 - 80 - 70, 0);
    expect(sim.state.bumperPressed).toBe(true);
    expect(sim.state.wallHits).toBe(0);
  });

  it("does not modify the world's objects; reset restores them", async () => {
    const world = makeWorld({ objects: [disk("d", -900, -600)] });
    const sim = createSim(world);
    await run(sim, (c) => c.driveFor("FORWARD", 300));
    expect(world.objects[0].y).toBe(-600);
    sim.reset();
    expect(sim.state.objects[0].y).toBe(-600);
    expect(sim.state.robot).toEqual({ x: -900, y: -900, heading: 0 });
    expect(sim.state.path).toHaveLength(1);
    expect(sim.state.time).toBe(0);
  });

  it("pushed boxes collide with each other", async () => {
    const box = (id: string, y: number): WorldObject => ({ id, shape: "box", x: -900, y, size: 100, color: "BLUE", movable: true, pickable: false });
    const sim = createSim(makeWorld({ objects: [box("a", -700), box("b", -560)] }));
    await run(sim, (c) => c.driveFor("FORWARD", 300));
    const [a, b] = sim.state.objects;
    expect(b.y - a.y).toBeGreaterThanOrEqual(100 - 0.5);
    expect(a.y - sim.state.robot.y).toBeGreaterThanOrEqual(120 - 0.5);
  });
});

describe("magnet", () => {
  it("picks up the object in front, carries it, drops it", async () => {
    const events: string[] = [];
    const sim = createSim(makeWorld({ hardware: { magnet: true }, objects: [disk("d", -900, -760, { pickable: true })] }));
    sim.onEvent((e) => events.push(e.type));
    const c = sim.controller;
    expect(c.magnet(true)).toBe(true);
    expect(sim.state.carrying).toBe("d");
    await run(sim, async () => { await c.turnFor("RIGHT", 90); await c.driveFor("FORWARD", 400); });
    const d = sim.state.objects[0];
    expect(d.x).toBeCloseTo(-500 + 70 + 40 + 1, 3);
    expect(d.y).toBeCloseTo(-900, 3);
    expect(c.magnet(false)).toBe(true);
    expect(sim.state.carrying).toBe(null);
    await run(sim, () => c.driveFor("REVERSE", 200));
    expect(sim.state.objects[0].x).toBeCloseTo(-389, 3);
    expect(events).toEqual(["pickedUp", "dropped"]);
  });

  it("ignores objects out of range or not pickable; false without hardware", () => {
    const sim = createSim(makeWorld({ hardware: { magnet: true }, objects: [disk("far", -900, -600, { pickable: true }), disk("np", -900, -780)] }));
    sim.controller.magnet(true);
    expect(sim.state.carrying).toBe(null);
    const sim2 = createSim(makeWorld({ objects: [disk("d", -900, -760, { pickable: true })] }));
    expect(sim2.controller.magnet(true)).toBe(false);
    expect(sim2.state.carrying).toBe(null);
  });
});

describe("pen", () => {
  it("draws strokes while down, new stroke on colour change", async () => {
    const sim = createSim(makeWorld({ hardware: { pen: true } }));
    const c = sim.controller;
    expect(c.penDown(true)).toBe(true);
    await run(sim, () => c.driveFor("FORWARD", 200));
    expect(c.setPenColor("RED")).toBe(true);
    await run(sim, async () => { await c.turnFor("RIGHT", 90); await c.driveFor("FORWARD", 200); });
    c.penDown(false);
    await run(sim, () => c.driveFor("FORWARD", 200));
    const st = sim.state.strokes;
    expect(st).toHaveLength(2);
    expect(st[0].color).toBe("BLACK");
    expect(st[1].color).toBe("RED");
    expect(st[0].points[0]).toEqual({ x: -900, y: -900 });
    expect(st[0].points[st[0].points.length - 1]).toEqual({ x: -900, y: -700 });
    expect(st[1].points[st[1].points.length - 1]).toEqual({ x: -700, y: -700 });
    for (const s of st) for (let i = 1; i < s.points.length - 1; i++) {
      const p = s.points[i], q = s.points[i - 1];
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(2 - 1e-9);
    }
  });

  it("returns false without pen hardware", () => {
    const sim = createSim(makeWorld());
    expect(sim.controller.penDown(true)).toBe(false);
    expect(sim.state.penDown).toBe(false);
  });
});

describe("sensors", () => {
  it("distance to border and to objects; ray is populated", async () => {
    const sim = createSim(makeWorld());
    const c = sim.controller;
    sim.step(1 / 60);
    expect(c.distanceMM()).toBe(1830);
    expect(c.distanceFound()).toBe(false);
    expect(sim.state.distanceRay).toEqual({ from: { x: -900, y: -830 }, to: { x: -900, y: 1000 }, hit: true });
    const sim2 = createSim(makeWorld({
      objects: [disk("d", -900, 0)],
      walls: [{ a: { x: -1000, y: 500 }, b: { x: 1000, y: 500 }, thickness: 20 }],
    }));
    expect(sim2.controller.distanceMM()).toBe(790);
    expect(sim2.controller.distanceFound()).toBe(true);
    const sim3 = createSim(makeWorld({ walls: [{ a: { x: -1000, y: 500 }, b: { x: 1000, y: 500 }, thickness: 20 }] }));
    expect(sim3.controller.distanceMM()).toBe(1320);
  });

  it("distance is capped at 3000 on a big field", () => {
    const sim = createSim(makeWorld({ width: 8000, height: 8000, start: { x: 0, y: -3900, heading: 0 } }));
    expect(sim.controller.distanceMM()).toBe(3000);
    sim.step(1 / 60);
    expect(sim.state.distanceRay).toBe(null);
  });

  it("front eye sees object colour and brightness within 100 mm", () => {
    const sim = createSim(makeWorld({ objects: [disk("y", -900, -740, { color: "YELLOW" })] }));
    const c = sim.controller;
    expect(c.frontNear()).toBe(true);
    expect(c.frontColor()).toBe("YELLOW");
    expect(c.frontBrightness()).toBeGreaterThan(50);
    const sim2 = createSim(makeWorld({ objects: [disk("y", -900, -600, { color: "YELLOW" })] }));
    expect(sim2.controller.frontNear()).toBe(false);
    expect(sim2.controller.frontColor()).toBe("NONE");
    expect(sim2.controller.frontBrightness()).toBe(0);
  });

  it("down eye reads topmost floor shape, lines with width, WHITE when bare", async () => {
    const sim = createSim(makeWorld({
      floor: [
        { kind: "rect", x: -900, y: -900, w: 200, h: 200, color: "BLUE" },
        { kind: "circle", x: -900, y: -900, r: 50, color: "GREEN" },
        { kind: "line", points: [{ x: -1000, y: -700 }, { x: 0, y: -700 }], width: 20, color: "BLACK" },
      ],
    }));
    const c = sim.controller;
    expect(c.downColor()).toBe("GREEN");
    await run(sim, () => c.driveFor("FORWARD", 60));
    expect(c.downColor()).toBe("BLUE");
    await run(sim, () => c.driveFor("FORWARD", 140));
    expect(c.downColor()).toBe("BLACK");
    expect(c.downBrightness()).toBe(5);
    await run(sim, () => c.driveFor("FORWARD", 100));
    expect(c.downColor()).toBe("WHITE");
    expect(c.downBrightness()).toBe(100);
  });

  it("position sensors", () => {
    const sim = createSim(makeWorld());
    expect(sim.controller.positionX()).toBe(-900);
    expect(sim.controller.positionY()).toBe(-900);
  });
});

describe("goals", () => {
  const zones: World["zones"] = [
    { id: "A", kind: "rect", x: -900, y: -500, w: 200, h: 200, label: "Goal" },
    { id: "B", kind: "circle", x: -500, y: -500, r: 100 },
  ];

  it("reachZone + zone events + goalsComplete", async () => {
    const sim = createSim(makeWorld({ zones, goals: [{ type: "reachZone", zone: "A" }] }));
    const ev: SimEvent[] = [];
    sim.onEvent((e) => ev.push(e));
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: false, detail: "Drive the robot into the Goal zone" });
    await run(sim, (c) => c.driveFor("FORWARD", 400));
    expect(sim.state.visitedZones).toEqual(["A"]);
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: true, detail: "The robot reached the Goal zone" });
    await steps(sim, 0.1);
    expect(ev.filter((e) => e.type === "goalsComplete")).toHaveLength(1);
    expect(ev.find((e) => e.type === "zoneEntered")).toMatchObject({ zoneId: "A" });
  });

  it("objectsInZone with colour", async () => {
    const goals: Goal[] = [{ type: "objectsInZone", zone: "A", count: 3, color: "RED" }];
    const sim = createSim(makeWorld({
      zones, goals,
      objects: [disk("r1", -900, -500), disk("r2", -880, -480), disk("r3", 500, 500), disk("b", -900, -500, { color: "BLUE" })],
    }));
    const r = sim.evaluateGoals()[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toBe("2 of 3 red disks are in the Goal zone");
    sim.state.objects[2].x = -900; sim.state.objects[2].y = -550;
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: true, detail: "3 of 3 red disks are in the Goal zone" });
  });

  it("visitInOrder", async () => {
    const sim = createSim(makeWorld({ zones, goals: [{ type: "visitInOrder", zones: ["A", "B"] }] }));
    expect(sim.evaluateGoals()[0].detail).toBe("Visited 0 of 2 zones in order — next: the Goal zone");
    await run(sim, async (c) => { await c.driveFor("FORWARD", 400); await c.turnFor("RIGHT", 90); await c.driveFor("FORWARD", 400); });
    expect(sim.state.visitedZones).toEqual(["A", "B"]);
    expect(sim.evaluateGoals()[0]).toMatchObject({ passed: true, detail: "Visited all 2 zones in order" });
  });

  it("noWallHits, endFacing, maxTime", async () => {
    const sim = createSim(makeWorld({
      goals: [{ type: "noWallHits" }, { type: "endFacing", heading: 90 }, { type: "maxTime", seconds: 1 }],
    }));
    const ev: string[] = [];
    sim.onEvent((e) => ev.push(e.type));
    let res = sim.evaluateGoals();
    expect(res.map((r) => r.passed)).toEqual([true, false, true]);
    expect(res[1].detail).toBe("The robot is facing 0° but should face 90°");
    await run(sim, (c) => c.turnFor("RIGHT", 90));
    await steps(sim, 2); // idle time after the program must not count against maxTime
    res = sim.evaluateGoals();
    expect(res.map((r) => r.passed)).toEqual([true, true, true]);
    expect(res[2].detail).toMatch(/^Time used: 0\.5 s of 1\.0 s$/);
    expect(ev.filter((t) => t === "goalsComplete")).toHaveLength(1);
    await run(sim, async (c) => { await c.turnFor("RIGHT", 90); await c.driveFor("FORWARD", 2000); });
    res = sim.evaluateGoals();
    expect(res.map((r) => r.passed)).toEqual([false, false, false]);
    expect(res[0].detail).toBe("The robot hit a wall 1 time");
  });

  it("goals do not complete before the program does anything", async () => {
    const sim = createSim(makeWorld({ goals: [{ type: "noWallHits" }] }));
    const ev: string[] = [];
    sim.onEvent((e) => ev.push(e.type));
    await steps(sim, 1);
    expect(ev).toEqual([]);
  });
});

describe("abort / reset / determinism", () => {
  it("abort rejects pending motion and waits with STOPPED", async () => {
    const sim = createSim(makeWorld());
    const p1 = sim.controller.driveFor("FORWARD", 1000);
    const p2 = sim.controller.wait(5);
    await steps(sim, 0.2);
    sim.abort();
    await expect(p1).rejects.toThrow("STOPPED");
    await expect(p2).rejects.toThrow("STOPPED");
    const y = sim.state.robot.y;
    await steps(sim, 0.5);
    expect(sim.state.robot.y).toBe(y);
    expect(sim.controller.isDone()).toBe(true);
  });

  it("reset rejects pending, restores, clears gyro offset", async () => {
    const sim = createSim(makeWorld({ hardware: { pen: true } }));
    const c = sim.controller;
    c.penDown(true);
    c.setHeading(123);
    const p = c.driveFor("FORWARD", 500);
    await steps(sim, 0.3);
    sim.reset();
    await expect(p).rejects.toThrow("STOPPED");
    expect(sim.state.strokes).toEqual([]);
    expect(sim.state.penDown).toBe(false);
    expect(c.heading()).toBe(0);
    expect(c.timer()).toBe(0);
    expect(sim.state.robot.y).toBe(-900);
  });

  it("same dt sequence gives identical state", async () => {
    const world = makeWorld({
      hardware: { pen: true, magnet: true },
      objects: [disk("a", -800, -600), disk("b", -700, -500, { shape: "box", rotation: 20 }), disk("c", -900, -300, { pickable: true })],
      walls: [{ a: { x: -400, y: -1000 }, b: { x: -400, y: 0 }, thickness: 20 }],
    });
    const prog = async (c: RobotController) => {
      c.penDown(true);
      await c.turnFor("RIGHT", 17);
      await c.driveFor("FORWARD", 700);
      await c.turnToHeading(300);
      c.setDriveVelocity(90);
      await c.driveFor("FORWARD", 400);
      c.magnet(true);
      await c.turnFor("LEFT", 200);
      c.magnet(false);
      await c.driveFor("REVERSE", 300);
    };
    const dts = Array.from({ length: 2000 }, (_, i) => 0.005 + ((i * 7919) % 13) / 600);
    const go = async () => {
      const sim = createSim(world);
      let i = 0, done = false;
      prog(sim.controller).then(() => { done = true; });
      await flush();
      while (!done && i < dts.length) { sim.step(dts[i++]); await flush(); }
      return JSON.stringify(sim.state);
    };
    const a = await go();
    const b = await go();
    expect(a).toBe(b);
  });

  it("steps a busy world quickly (60 walls, 30 objects)", () => {
    const walls = Array.from({ length: 60 }, (_, i) => ({ a: { x: -950 + (i % 10) * 190, y: -950 + Math.floor(i / 10) * 300 }, b: { x: -900 + (i % 10) * 190, y: -880 + Math.floor(i / 10) * 300 }, thickness: 10 }));
    const objects = Array.from({ length: 30 }, (_, i) => disk("o" + i, -800 + (i % 6) * 300, -700 + Math.floor(i / 6) * 300));
    const sim = createSim(makeWorld({ walls, objects, start: { x: 0, y: 0, heading: 45 } }));
    sim.controller.drive("FORWARD");
    const t0 = performance.now();
    for (let i = 0; i < 1200; i++) sim.step(1 / 120); // 10 s of sim time
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(500);
  });
});
