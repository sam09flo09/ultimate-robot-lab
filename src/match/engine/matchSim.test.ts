import { describe, expect, it } from "vitest";
import type { MatchGame } from "../../core/match";
import type { Pose, WorldObject } from "../../core/types";
import { createMatchSim } from "./matchSim";
import { SILO_SPRINT, GAMES, getGame } from "./games";
import { collide, makeBox } from "../../sim/geometry";

/** A small empty test field (no disks unless given). */
function game(objects: WorldObject[] = [], a: Pose = { x: -400, y: 0, heading: 90 }, b: Pose = { x: 400, y: 0, heading: 270 }): MatchGame {
  return {
    ...SILO_SPRINT,
    world: { ...SILO_SPRINT.world, width: 2000, height: 1400, objects, platforms: [], start: a, zones: SILO_SPRINT.world.zones },
    startB: b,
  };
}
const disk = (id: string, x: number, y: number): WorldObject => ({ id, shape: "disk", x, y, size: 80, color: "YELLOW", movable: true, pickable: true });

function overlap(sim: ReturnType<typeof createMatchSim>): number {
  const ra = sim.robots.A.state, rb = sim.robots.B.state;
  const ba = makeBox(ra.robot.x, ra.robot.y, ra.robotSize / 2, ra.robotSize / 2, ra.robot.heading);
  const bb = makeBox(rb.robot.x, rb.robot.y, rb.robotSize / 2, rb.robotSize / 2, rb.robot.heading);
  const hit = { nx: 0, ny: 0, depth: 0 };
  return collide(ba, bb, hit) ? hit.depth : 0;
}

/** Step until promise settles (or cap). */
async function stepUntil(sim: ReturnType<typeof createMatchSim>, p: Promise<unknown> | null, seconds: number, each?: () => void) {
  let done = false;
  p?.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < seconds * 60 && !done; i++) {
    sim.step(1 / 60);
    each?.();
    await Promise.resolve();
  }
}

describe("Silo Sprint game data", () => {
  it("is listed, original, and self-consistent", () => {
    expect(GAMES.map((g) => g.id)).toContain("silo-sprint");
    expect(getGame("silo-sprint")).toBe(SILO_SPRINT);
    const g = SILO_SPRINT;
    expect(g.world.width).toBe(3600);
    expect(g.world.height).toBe(2400);
    expect(g.autonomousSeconds).toBe(15);
    expect(g.driverSeconds).toBe(60);
    expect(g.autonomousBonus).toBe(5);
    expect(g.world.hardware).toEqual({ magnet: true, arm: true });
    const zones = new Set(g.world.zones.map((z) => z.id));
    const plats = new Set((g.world.platforms ?? []).map((p) => p.id));
    for (const r of g.scoring) {
      if (r.kind === "objectsOnPlatform") expect(plats.has(r.platform), r.platform).toBe(true);
      else expect(zones.has(r.zone), r.zone).toBe(true);
    }
    // mirror-symmetric disks; all yellow and pickable
    const key = (o: WorldObject) => `${o.x},${o.y}`;
    const set = new Set(g.world.objects.map(key));
    for (const o of g.world.objects) {
      expect(set.has(`${-o.x},${o.y}`), key(o)).toBe(true);
      expect(o.color).toBe("YELLOW");
      expect(o.pickable).toBe(true);
    }
    expect(g.startB).toEqual({ x: -g.world.start.x, y: g.world.start.y, heading: 270 });
    expect(g.description.length).toBeGreaterThan(50);
  });

  it("starts with both robots home, sharing one set of objects", () => {
    const sim = createMatchSim(SILO_SPRINT);
    expect(sim.phase).toBe("idle");
    expect(sim.robots.A.state.robot).toEqual({ x: -1550, y: 0, heading: 90 });
    expect(sim.robots.B.state.robot).toEqual({ x: 1550, y: 0, heading: 270 });
    expect(sim.robots.B.state.objects).toBe(sim.robots.A.state.objects);
    expect(sim.robots.A.state.objects).toHaveLength(17);
    expect(sim.robots.A.state.arm).toBeDefined();
    expect(sim.robots.B.controller.armAvailable()).toBe(true);
  });
});

describe("robot ↔ robot collisions", () => {
  it("robots driving at each other stop face to face without overlapping", async () => {
    const sim = createMatchSim(game());
    const a = sim.robots.A.controller, b = sim.robots.B.controller;
    a.setDriveVelocity(100); b.setDriveVelocity(100);
    const pa = a.driveFor("FORWARD", 1000), pb = b.driveFor("FORWARD", 1000);
    let worst = 0;
    await stepUntil(sim, Promise.all([pa, pb]), 5, () => { worst = Math.max(worst, overlap(sim)); });
    expect(worst).toBeLessThan(0.05);
    const ax = sim.robots.A.state.robot.x, bx = sim.robots.B.state.robot.x;
    expect(bx - ax).toBeGreaterThan(139.9);
    expect(bx - ax).toBeLessThan(145);
    expect(Math.abs(ax + bx)).toBeLessThan(15); // met near the middle (fair alternation)
    expect(a.isDone() && b.isDone()).toBe(true); // blocked drive_for ends early, never hangs
    expect(sim.robots.A.state.bumperPressed).toBe(true);
    expect(sim.robots.B.state.bumperPressed).toBe(true);
    expect(sim.robots.A.state.wallHits).toBe(0);
  });

  it("a robot can't push the other: driving into a parked robot stops, both ways", async () => {
    for (const mover of ["A", "B"] as const) {
      const sim = createMatchSim(game());
      const still = mover === "A" ? "B" : "A";
      const before = { ...sim.robots[still].state.robot };
      const c = sim.robots[mover].controller;
      c.setDriveVelocity(100);
      await stepUntil(sim, c.driveFor("FORWARD", 1500), 5);
      expect(sim.robots[still].state.robot).toEqual(before);
      expect(Math.abs(sim.robots[mover].state.robot.x - before.x)).toBeCloseTo(140, 0);
      expect(overlap(sim)).toBeLessThan(0.05);
    }
  });

  it("no tunnelling at the fastest legal robot speed, with wheels and turns", async () => {
    const fast = { wheelDiameter: 130, gearRatio: 1 / 3, size: 120 };
    const sim = createMatchSim(game([], { x: -300, y: 0, heading: 90 }, { x: 300, y: 20, heading: 270 }), fast, fast);
    sim.robots.A.controller.setWheelVelocities(100, 90);
    sim.robots.B.controller.setWheelVelocities(100, 100);
    let worst = 0, touched = false;
    for (let i = 0; i < 180; i++) {
      sim.step(1 / 60);
      worst = Math.max(worst, overlap(sim));
      if (sim.robots.A.state.bumperPressed || sim.robots.B.state.bumperPressed) touched = true;
      if (i === 20) sim.robots.B.controller.setWheelVelocities(-100, 100); // spin in place against A
    }
    expect(touched).toBe(true);
    expect(worst).toBeLessThan(0.05); // they slide past each other at most, never through
  });

  it("the distance sensor sees the other robot", () => {
    const sim = createMatchSim(game([], { x: -500, y: 0, heading: 90 }, { x: 500, y: 0, heading: 270 }));
    sim.step(1 / 60);
    expect(sim.robots.A.controller.distanceMM()).toBeCloseTo(860, 0);
    expect(sim.robots.B.controller.distanceMM()).toBeCloseTo(860, 0);
  });
});

describe("shared objects", () => {
  it("both robots push the same disk", async () => {
    const sim = createMatchSim(game([disk("d", 0, 0)]));
    const d = () => sim.robots.A.state.objects[0];
    await stepUntil(sim, sim.robots.A.controller.driveFor("FORWARD", 300), 3);
    expect(d().x).toBeGreaterThan(5);            // A pushed it right
    await stepUntil(sim, sim.robots.A.controller.driveFor("REVERSE", 300), 3);
    const x1 = d().x;
    await stepUntil(sim, sim.robots.B.controller.driveFor("FORWARD", 350), 3);
    expect(d().x).toBeLessThan(x1 - 50);         // B pushed it back left
    expect(sim.robots.B.state.objects[0]).toBe(d());
  });

  it("a disk held by one robot's magnet can't be taken, grabbed or pushed by the other", async () => {
    const sim = createMatchSim(game([disk("d", 0, 0)], { x: -200, y: 0, heading: 90 }, { x: 60, y: 0, heading: 270 }));
    const A = sim.robots.A, B = sim.robots.B;
    const events: string[] = [];
    sim.onEvent((team, e) => events.push(`${team}:${e.type}`));
    expect(A.controller.magnet(true)).toBe(true);
    expect(A.state.carrying).toBe("d");
    sim.step(1 / 60);
    const held = { x: A.state.objects[0].x, y: A.state.objects[0].y };
    expect(held.x).toBeCloseTo(-89, 0);
    B.controller.magnet(true);
    expect(B.state.carrying).toBeNull();
    await stepUntil(sim, B.controller.claw(true), 1);
    expect(B.state.arm!.holding).toBeNull();
    await stepUntil(sim, B.controller.driveFor("FORWARD", 40), 1);
    expect(A.state.objects[0].x).toBeCloseTo(held.x, 6);
    expect(A.state.carrying).toBe("d");
    // once A lets go, B can have it
    A.controller.magnet(false);
    await stepUntil(sim, B.controller.claw(false), 1);
    B.controller.magnet(true);
    expect(B.state.carrying).toBe("d");
    expect(events).toEqual(["A:pickedUp", "A:dropped", "B:pickedUp"]);
  });

  it("a disk in one robot's claw is off limits to the other robot's magnet", async () => {
    const sim = createMatchSim(game([disk("d", 0, 0)], { x: -170, y: 0, heading: 90 }, { x: 100, y: 0, heading: 270 }));
    const A = sim.robots.A, B = sim.robots.B;
    await stepUntil(sim, A.controller.claw(true), 1);
    expect(A.state.arm!.holding).toBe("d");
    B.controller.magnet(true);
    expect(B.state.carrying).toBeNull();
    await stepUntil(sim, B.controller.claw(true), 1);
    expect(B.state.arm!.holding).toBeNull();
    await stepUntil(sim, A.controller.armSpinTo(40), 2);
    expect(A.state.objects[0].z).toBeGreaterThan(100);
  });

  it("each robot can still use its own hardware: B stacks a disk on its silo", async () => {
    // a disk just below B; B faces down, grabs it, lifts, drives until the silo (solid) stops it
    const g: MatchGame = { ...SILO_SPRINT, world: { ...SILO_SPRINT.world, objects: SILO_SPRINT.world.objects.map((o) => o.id === "disk-b1" ? { ...o, x: 1550, y: -130 } : o) } };
    const s2 = createMatchSim(g);
    const c = s2.robots.B.controller;
    await stepUntil(s2, c.turnFor("LEFT", 90), 2);       // 270 → 180 (facing down)
    await stepUntil(s2, c.claw(true), 1);
    expect(s2.robots.B.state.arm!.holding).toBe("disk-b1");
    await stepUntil(s2, c.armSpinTo(40), 2);
    await stepUntil(s2, c.driveFor("FORWARD", 800), 3);  // stops at the silo's edge, claw over its top
    expect(s2.robots.B.state.robot.y).toBeCloseTo(-630, 0);
    await stepUntil(s2, c.armSpinTo(0), 2);              // stops when the disk lands on the silo
    await stepUntil(s2, c.claw(false), 1);
    const sc = s2.score();
    const silo = sc.lines.find((l) => l.team === "B" && l.label === "Disks on the silo")!;
    expect(silo.count, JSON.stringify(s2.robots.B.state.objects.find((o) => o.id === "disk-b1"))).toBe(1);
    expect(sc.B).toBe(3);
  });
});

describe("scoring", () => {
  function placed() {
    const sim = createMatchSim(SILO_SPRINT);
    const objs = sim.robots.A.state.objects;
    const put = (id: string, x: number, y: number, z = 0) => { const o = objs.find((q) => q.id === id)!; o.x = x; o.y = y; o.z = z; };
    return { sim, put };
  }

  it("counts resting disks in bins and on silos per team", () => {
    const { sim, put } = placed();
    put("disk-a1", -1550, 800);
    put("disk-a2", -1700, 1100);
    put("disk-b1", 1550, 800);
    put("disk-c1", -1620, -820, 120); // on silo A
    const s = sim.score();
    expect(s.A).toBe(2 + 3);
    expect(s.B).toBe(1);
    expect(s.autonomousWinner).toBeNull();
    expect(s.lines.find((l) => l.team === "A" && l.label === "Disks in the bin")).toEqual({ team: "A", label: "Disks in the bin", points: 2, count: 2 });
    expect(s.lines.some((l) => /Parked/.test(l.label))).toBe(false); // only once the match has ended
  });

  it("a disk on the floor under the silo's footprint doesn't count; held disks never count", () => {
    const { sim, put } = placed();
    put("disk-c1", -1620, -820, 0);
    expect(sim.score().A).toBe(0);
    // carried by B's magnet while over A's bin: not resting
    const g: MatchGame = { ...SILO_SPRINT, world: { ...SILO_SPRINT.world, objects: [disk("d", -1250, 800)] }, startB: { x: -1100, y: 800, heading: 270 } };
    const s2 = createMatchSim(g);
    s2.robots.B.controller.magnet(true);
    expect(s2.robots.B.state.carrying).toBe("d");
    s2.robots.B.controller.setWheelVelocities(30, 30);
    for (let i = 0; i < 30; i++) s2.step(1 / 60);
    const d = s2.robots.A.state.objects[0];
    expect(d.x).toBeLessThan(-1300);
    expect(s2.score().A).toBe(0);
    s2.robots.B.controller.magnet(false);
    expect(s2.score().A).toBe(1);
  });

  it("parking counts only when the match has ended", () => {
    const sim = createMatchSim(SILO_SPRINT);
    sim.setPhase("autonomous"); sim.setPhase("driver");
    expect(sim.score().lines.some((l) => /Parked/.test(l.label))).toBe(false);
    sim.setPhase("ended");
    const s = sim.score();
    expect(s.lines.filter((l) => /Parked/.test(l.label)).map((l) => [l.team, l.points])).toEqual([["A", 2], ["B", 2]]);
  });

  it("the autonomous bonus goes to the leader when autonomous ends (tie = split)", () => {
    const { sim, put } = placed();
    sim.setPhase("autonomous");
    put("disk-a1", -1550, 800);
    expect(sim.score().autonomousWinner).toBeNull();
    sim.setPhase("driver");
    put("disk-b1", 1550, 800); put("disk-b2", 1550, 900); // B pulls ahead later: the bonus stays with A
    const s = sim.score();
    expect(s.autonomousWinner).toBe("A");
    expect(s.A).toBe(1 + 5);
    expect(s.B).toBe(2);

    const tie = createMatchSim(SILO_SPRINT);
    tie.setPhase("autonomous"); tie.setPhase("driver");
    const t = tie.score();
    expect(t.autonomousWinner).toBe("tie");
    expect([t.A, t.B]).toEqual([2.5, 2.5]);
    tie.reset();
    expect(tie.score().autonomousWinner).toBeNull();
    expect(tie.phase).toBe("idle");
  });

  it("ending the match stops both robots (pending motion rejects with STOPPED)", async () => {
    const sim = createMatchSim(game());
    const p = sim.robots.A.controller.driveFor("FORWARD", 2000);
    sim.setPhase("autonomous");
    sim.step(0.2);
    sim.setPhase("ended");
    await expect(p).rejects.toThrow("STOPPED");
    const x = sim.robots.A.state.robot.x;
    sim.step(0.5);
    expect(sim.robots.A.state.robot.x).toBe(x);
  });
});

describe("determinism and reset", () => {
  function scripted(): string {
    const sim = createMatchSim(SILO_SPRINT);
    const A = sim.robots.A.controller, B = sim.robots.B.controller;
    A.setWheelVelocities(80, 60);
    B.setWheelVelocities(70, 75);
    const dts = [1 / 60, 1 / 30, 0.004, 1 / 60, 0.05, 0.011];
    for (let i = 0; i < 400; i++) {
      sim.step(dts[i % dts.length]);
      if (i === 100) { A.magnet(true); B.setWheelVelocities(-50, 50); }
      if (i === 200) { A.setWheelVelocities(100, 100); B.setWheelVelocities(100, 100); }
      if (i === 300) A.magnet(false);
    }
    return JSON.stringify([sim.robots.A.state.robot, sim.robots.B.state.robot, sim.robots.A.state.objects, sim.time]);
  }

  it("the same commands and dt sequence give exactly the same match", () => {
    const a = scripted(), b = scripted();
    expect(a).toBe(b);
    expect(JSON.parse(a)[0]).not.toEqual({ x: -1550, y: 0, heading: 90 });
  });

  it("reset puts both robots and all objects back and keeps them shared", async () => {
    const sim = createMatchSim(SILO_SPRINT);
    sim.robots.A.controller.setWheelVelocities(100, 100);
    sim.robots.B.controller.setWheelVelocities(100, 100);
    for (let i = 0; i < 200; i++) sim.step(1 / 60);
    sim.setPhase("autonomous");
    sim.reset();
    expect(sim.time).toBe(0);
    expect(sim.robots.A.state.robot).toEqual(SILO_SPRINT.world.start);
    expect(sim.robots.B.state.robot).toEqual(SILO_SPRINT.startB);
    expect(sim.robots.B.state.objects).toBe(sim.robots.A.state.objects);
    expect(sim.robots.A.state.objects.map((o) => [o.x, o.y])).toEqual(SILO_SPRINT.world.objects.map((o) => [o.x, o.y]));
    // still linked after reset: B pushes what A sees
    const g = game([disk("d", 0, 0)], { x: -400, y: 300, heading: 90 }, { x: 300, y: 0, heading: 270 });
    const s2 = createMatchSim(g);
    s2.reset();
    await stepUntil(s2, s2.robots.B.controller.driveFor("FORWARD", 300), 3);
    expect(s2.robots.A.state.objects[0].x).toBeLessThan(-50);
  });

  it("abort rejects both robots' pending motion", async () => {
    const sim = createMatchSim(game());
    const pa = sim.robots.A.controller.driveFor("FORWARD", 100);
    const pb = sim.robots.B.controller.wait(5);
    sim.abort();
    await expect(pa).rejects.toThrow("STOPPED");
    await expect(pb).rejects.toThrow("STOPPED");
  });
});
