import { describe, expect, it } from "vitest";
import type { World } from "../core/types";
import { LEVEL_FORMAT, LIMITS, levelFileText, newBlankWorld, parseLevelFile, sanitizeWorld, toLevelFile } from "./levelFile";

function richWorld(): World {
  const w = newBlankWorld();
  w.name = "Maze";
  w.description = "Line 1\nLine 2";
  w.width = 2400; w.height = 1200;
  w.background = "numberGrid";
  w.start = { x: -1000, y: -400, heading: 90 };
  w.walls.push({ id: "wall1", a: { x: 0, y: -600 }, b: { x: 0, y: 200 }, thickness: 30 });
  w.floor.push(
    { kind: "rect", id: "paint1", x: 100, y: 100, w: 200, h: 100, color: "BLUE" },
    { kind: "circle", id: "paint2", x: -300, y: 0, r: 80, color: "GREEN" },
    { kind: "line", id: "paint3", points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], width: 25, color: "BLACK" },
  );
  w.objects.push(
    { id: "obj1", shape: "disk", x: 500, y: 0, size: 100, color: "RED", movable: true, pickable: true },
    { id: "obj2", shape: "box", x: 600, y: 200, size: 120, color: "YELLOW", movable: false, pickable: false, rotation: 45 },
  );
  w.zones.push({ id: "zone1", kind: "rect", x: 900, y: 300, w: 300, h: 300, label: "A" }, { id: "zone2", kind: "circle", x: -800, y: 300, r: 150 });
  w.goals.push(
    { type: "reachZone", zone: "zone1", description: "Get to A" },
    { type: "objectsInZone", zone: "zone1", count: 1, color: "RED" },
    { type: "visitInOrder", zones: ["zone2", "zone1"] },
    { type: "noWallHits" },
    { type: "endFacing", heading: 180, tolerance: 15 },
    { type: "maxTime", seconds: 30 },
  );
  w.hardware = { pen: true, magnet: true };
  w.starter = { python: "def main():\n    pass\n\nstart(main)\n" };
  return w;
}

describe("level files", () => {
  it("round-trips a world with every feature", () => {
    const w = richWorld();
    const file = toLevelFile(w);
    expect(file.format).toBe(LEVEL_FORMAT);
    expect(file.version).toBe(1);
    const r = parseLevelFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world).toEqual(w);
    expect(r.warnings).toEqual([]);
    const r2 = parseLevelFile(levelFileText(w));
    expect(r2.ok && r2.world).toEqual(w);
  });

  it("toLevelFile does not share references with the input", () => {
    const w = richWorld();
    const f = toLevelFile(w);
    f.world.walls[0].a.x = 999;
    expect(w.walls[0].a.x).toBe(0);
  });

  it("newBlankWorld is valid and survives a round trip", () => {
    const w = newBlankWorld();
    const r = parseLevelFile(levelFileText(w));
    expect(r.ok && r.world).toEqual(w);
  });

  it.each([
    ["", "valid JSON"],
    ["not json", "valid JSON"],
    ["null", "isn't a Robot Lab level"],
    ["[]", "isn't a Robot Lab level"],
    ["42", "isn't a Robot Lab level"],
    ['{"format":"something-else","world":{}}', "isn't a Robot Lab level"],
    ['{"format":"robot-lab-level","version":2,"world":{}}', "newer version"],
    ['{"format":"robot-lab-level","version":"1","world":{}}', "unknown version"],
    ['{"format":"robot-lab-level","version":1}', "no world"],
    ['{"format":"robot-lab-level","version":1,"world":[1,2]}', "no world"],
    ['{"format":"robot-lab-level","version":1,"world":{"version":7}}', "newer version"],
    ['{"format":"robot-lab-project","version":1,"customWorld":null}', "no custom level"],
  ])("rejects %s", (text, msg) => {
    const r = parseLevelFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });

  it("rejects absurdly large input", () => {
    const r = parseLevelFile(" ".repeat(LIMITS.fileChars + 1));
    expect(r.ok).toBe(false);
  });

  it("rejects non-string input without throwing", () => {
    expect(parseLevelFile(undefined as unknown as string).ok).toBe(false);
  });

  it("fills defaults for a minimal / empty world", () => {
    const r = parseLevelFile('{"format":"robot-lab-level","version":1,"world":{}}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.world;
    expect(w.width).toBe(2000);
    expect(w.height).toBe(2000);
    expect(w.walls).toEqual([]);
    expect(w.goals).toEqual([]);
    expect(w.background).toBe("grid");
    expect(w.gridSize).toBe(200);
    expect(w.hardware).toEqual({ pen: false, magnet: false });
    expect(w.start).toEqual({ x: 0, y: 0, heading: 0 });
    expect(w.version).toBe(1);
    expect(w.name.length).toBeGreaterThan(0);
  });

  it("accepts a .robolab project with a custom world, and a bare world", () => {
    const w = richWorld();
    const proj = { format: "robot-lab-project", version: 1, customWorld: w, worldId: "custom" };
    const r = parseLevelFile(JSON.stringify(proj));
    expect(r.ok && r.world).toEqual(w);
    const r2 = parseLevelFile(JSON.stringify(w));
    expect(r2.ok && r2.world).toEqual(w);
  });

  it("sanitises hostile and malformed content", () => {
    const evilWorld = {
      id: "<script>alert(1)</script>",
      name: "  <img src=x onerror=alert(1)>\u0000\u0007" + "x".repeat(500),
      width: 1e12, height: -5,
      background: "javascript:alert(1)",
      gridSize: "200",
      start: { x: 1e9, y: "NaN", heading: -90 },
      walls: [
        { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, thickness: 10 },
        { a: { x: "1", y: 0 }, b: { x: 5, y: 5 } },
        { id: "w", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 1e9, extra: "drop me" },
        "nonsense", null, 5,
      ],
      floor: [
        { kind: "rect", x: 0, y: 0, w: -10, h: 10, color: "RED" },
        { kind: "circle", x: 0, y: 0, r: 50, color: "HOTPINK" },
        { kind: "line", points: [{ x: 0, y: 0 }], width: 10, color: "BLUE" },
        { kind: "triangle" },
      ],
      objects: [
        { id: "dup", shape: "sphere", x: 0, y: 0, size: 0.001, color: "RED", movable: false, pickable: true },
        { id: "dup", shape: "box", x: 10, y: 10, size: 50, color: "BLUE", movable: "yes", rotation: 725 },
        { id: "../../etc", x: 1, y: 1 },
        { id: "noPos" },
      ],
      zones: [
        { id: "z", kind: "rect", x: 0, y: 0, w: 100, h: 100, label: "A".repeat(200) },
        { id: "z2", kind: "circle", x: 0, y: 0, r: -1 },
      ],
      goals: [
        { type: "reachZone", zone: "z" },
        { type: "reachZone", zone: "missing" },
        { type: "objectsInZone", zone: "z", count: 1e9, color: "NONE" },
        { type: "visitInOrder", zones: ["z", "missing", 3] },
        { type: "visitInOrder", zones: "z" },
        { type: "endFacing", heading: 450 },
        { type: "maxTime", seconds: -1 },
        { type: "eval", code: "alert(1)" },
      ],
      hardware: { pen: "true", magnet: 1 },
      starter: { python: 42 },
    };
    // a literal "__proto__" key, as JSON.parse would produce from a hostile file
    const text = JSON.stringify({ format: "robot-lab-level", version: 1, world: evilWorld })
      .replace('"world":{', '"world":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},');
    const r = parseLevelFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.world;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((w as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(w.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(w.name.length).toBeLessThanOrEqual(LIMITS.name);
    expect(w.name).not.toMatch(/[\u0000-\u001f]/);
    expect(w.width).toBe(LIMITS.fieldMax);
    expect(w.height).toBe(LIMITS.fieldMin);
    expect(w.background).toBe("grid");
    expect(w.gridSize).toBe(200);
    expect(w.start.x).toBe(LIMITS.fieldMax / 2);
    expect(w.start.y).toBe(0);
    expect(w.start.heading).toBe(270);
    expect(w.walls).toHaveLength(1);
    expect(w.walls[0]).toEqual({ id: "w", a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 500 });
    expect(w.floor).toHaveLength(1);
    expect(w.floor[0]).toMatchObject({ kind: "circle", color: "BLACK" });
    expect(w.objects).toHaveLength(3);
    expect(w.objects[0]).toMatchObject({ id: "dup", shape: "disk", size: 10, movable: true, pickable: true });
    expect(w.objects[1].id).not.toBe("dup");
    expect(w.objects[1]).toMatchObject({ shape: "box", movable: true, pickable: false, rotation: 5 });
    expect(w.objects[2].id).toMatch(/^obj\d+$/);
    expect(w.zones).toHaveLength(1);
    expect(w.zones[0].label!.length).toBe(LIMITS.label);
    expect(w.goals.map((g) => g.type)).toEqual(["reachZone", "objectsInZone", "visitInOrder", "endFacing", "maxTime"]);
    expect(w.goals[1]).toEqual({ type: "objectsInZone", zone: "z", count: LIMITS.objects });
    expect(w.goals[2]).toEqual({ type: "visitInOrder", zones: ["z"] });
    expect(w.goals[3]).toEqual({ type: "endFacing", heading: 90 });
    expect(w.goals[4]).toEqual({ type: "maxTime", seconds: 1 });
    expect(w.hardware).toEqual({ pen: false, magnet: false });
    expect(w.starter).toEqual({ python: "" });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(Object.keys(w.walls[0])).not.toContain("extra");
  });

  it("caps huge arrays", () => {
    const w = newBlankWorld() as unknown as Record<string, unknown>;
    w.walls = Array.from({ length: LIMITS.walls + 50 }, (_, i) => ({ a: { x: i, y: 0 }, b: { x: i, y: 10 }, thickness: 5 }));
    const r = parseLevelFile(JSON.stringify({ format: LEVEL_FORMAT, version: 1, world: w }));
    expect(r.ok && r.world.walls.length).toBe(LIMITS.walls);
    expect(r.ok && r.warnings.some((m) => m.includes("Too many walls"))).toBe(true);
  });

  it("remaps goals when a duplicate zone id is renamed", () => {
    const { world } = sanitizeWorld({
      zones: [{ id: "obj1", kind: "rect", x: 0, y: 0, w: 10, h: 10 }],
      objects: [{ id: "obj1", x: 0, y: 0 }],
      goals: [{ type: "reachZone", zone: "obj1" }],
    });
    expect(world.zones[0].id).not.toBe("obj1");
    expect(world.goals[0]).toEqual({ type: "reachZone", zone: world.zones[0].id });
  });

  it("strips a BOM and accepts a missing top-level version", () => {
    const text = "﻿" + JSON.stringify({ format: LEVEL_FORMAT, world: newBlankWorld() });
    expect(parseLevelFile(text).ok).toBe(true);
  });
});

// race
describe("race settings", () => {
  const base = () => ({
    width: 2000, height: 2000, start: { x: 0, y: 0, heading: 0 },
    zones: [{ id: "fin", kind: "rect", x: 0, y: 500, w: 200, h: 200 }],
  });
  it("keeps a valid race, clamping laps and par", () => {
    const w = sanitizeWorld({ ...base(), race: { finishZone: "fin", laps: 42, par: 12.345, extra: 1 } }).world;
    expect(w.race).toEqual({ finishZone: "fin", laps: 10, par: 12.35 });
  });
  it("drops par <= 0 and defaults laps to 1", () => {
    expect(sanitizeWorld({ ...base(), race: { finishZone: "fin", par: -5 } }).world.race).toEqual({ finishZone: "fin", laps: 1 });
  });
  it("drops the race (with a warning) when the finish zone is missing", () => {
    const r = sanitizeWorld({ ...base(), race: { finishZone: "nope" } });
    expect(r.world.race).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/race/i);
  });
  it("no race key when not a race", () => {
    expect("race" in sanitizeWorld(base()).world).toBe(false);
  });
});

// builder: object mass and robot rules survive (clamped) round trips
describe("builder fields", () => {
  it("keeps mass (0.5..4, default 1 dropped) and robotRules (clamped)", () => {
    const w = newBlankWorld();
    const raw = {
      ...w,
      objects: [
        { id: "a", shape: "box", x: 0, y: 0, size: 100, color: "RED", movable: true, pickable: false, mass: 9 },
        { id: "b", shape: "disk", x: 300, y: 0, size: 80, color: "RED", movable: true, pickable: false, mass: 1 },
      ],
      robotRules: { locked: true, maxSize: 50, config: { size: 999, motors: 4 } },
    };
    const r = sanitizeWorld(JSON.parse(JSON.stringify(raw))).world;
    expect(r.objects[0].mass).toBe(4);
    expect(r.objects[1].mass).toBeUndefined();
    expect(r.robotRules).toEqual({ locked: true, maxSize: 120, config: { size: 200, wheelDiameter: 100, gearRatio: 1, motors: 4, sensorOffset: 0 } });
    expect(sanitizeWorld({ ...w, robotRules: { locked: "yes" } }).world.robotRules).toBeUndefined();
  });
});
