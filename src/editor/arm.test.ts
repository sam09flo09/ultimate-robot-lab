/** arm: platforms, object heights and the platform/stack goals in level files, validation and editor geometry. */
import { describe, expect, it } from "vitest";
import type { World } from "../core/types";
import { LIMITS, newBlankWorld, parseLevelFile, sanitizeWorld, levelFileText } from "./levelFile";
import { validateWorld } from "./validate";
import { findItem, handlesFor, dragHandle, hitTest, removeItem, translateItem } from "./geometry";
import { ensureIds } from "./ids";

function armWorld(): World {
  const w = newBlankWorld();
  w.hardware = { pen: false, magnet: false, arm: true };
  w.platforms = [{ id: "shelf", x: 500, y: 500, w: 300, h: 200, height: 150, color: "BLUE" }];
  w.objects.push(
    { id: "obj1", shape: "box", x: 0, y: 0, size: 50, color: "RED", movable: true, pickable: true, rotation: 0, height: 50 },
    { id: "obj2", shape: "box", x: 500, y: 500, size: 50, color: "RED", movable: true, pickable: true, rotation: 0, z: 150 },
  );
  w.zones.push({ id: "zone1", kind: "rect", x: -500, y: 0, w: 300, h: 300 });
  w.goals.push({ type: "objectsOnPlatform", platform: "shelf", count: 2, color: "RED" }, { type: "stackHeight", count: 2, zone: "zone1" }, { type: "stackHeight", count: 2 });
  return w;
}

describe("level files with platforms", () => {
  it("round-trip unchanged", () => {
    const w = armWorld();
    const r = parseLevelFile(levelFileText(w));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.world.platforms).toEqual(w.platforms);
    expect(r.world.hardware).toEqual({ pen: false, magnet: false, arm: true });
    expect(r.world.objects).toEqual(w.objects);
    expect(r.world.goals).toEqual(w.goals);
  });

  it("clamps and caps untrusted values", () => {
    const raw = {
      ...armWorld(),
      platforms: [
        { id: "a", x: 0, y: 0, w: 100, h: 100, height: 5000, color: "PINK" },
        { id: "b", x: 0, y: 0, w: -5, h: 100, height: 100 },
        { id: "<bad>", x: 1e9, y: 0, w: 1e9, h: 100, height: 1 },
        ...Array.from({ length: 80 }, (_, i) => ({ x: i, y: 0, w: 50, h: 50, height: 100 })),
      ],
      objects: [{ id: "o", shape: "disk", x: 0, y: 0, size: 50, color: "RED", pickable: true, z: 1e9, height: -3 }],
      goals: [
        { type: "objectsOnPlatform", platform: "gone", count: 1 },
        { type: "objectsOnPlatform", platform: "a", count: 1e6, color: "NOPE" },
        { type: "stackHeight", count: 999, zone: "missing" },
        { type: "stackHeight", count: 0 },
      ],
    };
    const { world, warnings } = sanitizeWorld(raw);
    expect(world.platforms!.length).toBe(LIMITS.platforms - 1); // one broken one skipped
    expect(world.platforms![0]).toEqual({ id: "a", x: 0, y: 0, w: 100, h: 100, height: 300 });
    expect(world.platforms![1].height).toBe(50);
    expect(world.platforms![1].id).toMatch(/^platform\d+$/);
    expect(world.objects[0].z).toBe(LIMITS.objectZMax);
    expect(world.objects[0].height).toBeUndefined();
    expect(world.goals).toEqual([
      { type: "objectsOnPlatform", platform: "a", count: LIMITS.objects },
      { type: "stackHeight", count: 2 },
    ]);
    expect(warnings.join(" ")).toMatch(/missing platform/);
    expect(warnings.join(" ")).toMatch(/Too many platforms/);
  });

  it("no platforms / no arm: world unchanged in shape", () => {
    const { world } = sanitizeWorld(newBlankWorld());
    expect(world.platforms).toBeUndefined();
    expect(world.hardware).toEqual({ pen: false, magnet: false });
  });
});

describe("validation", () => {
  it("a good arm level has no errors", () => {
    expect(validateWorld(armWorld()).filter((i) => i.level === "error")).toEqual([]);
  });
  it("flags a goal that uses a missing platform, too few objects and no arm", () => {
    const w = armWorld();
    w.platforms = [];
    w.hardware = {};
    w.goals = [{ type: "objectsOnPlatform", platform: "shelf", count: 5 }, { type: "stackHeight", count: 9, zone: "nope" }];
    const t = validateWorld(w).map((i) => i.text).join("\n");
    expect(t).toContain('uses platform "shelf", which no longer exists');
    expect(t).toContain("needs 5");
    expect(t).toContain("arm is not fitted");
    expect(t).toContain('zone "nope"');
    expect(t).toContain("stack of 9");
  });
  it("flags a platform outside the field or under the robot", () => {
    const w = armWorld();
    w.platforms!.push({ id: "out", x: 2000, y: 0, w: 100, h: 100, height: 100 }, { id: "under", x: w.start.x, y: w.start.y, w: 100, h: 100, height: 100 });
    const t = validateWorld(w).map((i) => i.text).join("\n");
    expect(t).toContain('Platform "out" is outside');
    expect(t).toContain('on top of platform "under"');
  });
});

describe("editor geometry for platforms", () => {
  it("find, hit, move, resize, remove", () => {
    const w = armWorld();
    w.objects = [];
    const r = findItem(w, "shelf")!;
    expect(r).toEqual({ kind: "platform", id: "shelf", index: 0 });
    expect(hitTest(w, { x: 450, y: 450 }, 5)?.id).toBe("shelf");
    translateItem(w, r, 100, 0);
    expect(w.platforms![0].x).toBe(600);
    const orig = JSON.parse(JSON.stringify(w)) as World;
    expect(handlesFor(w, r)).toEqual([{ x: 750, y: 600 }]);
    dragHandle(w, orig, r, 0, { x: 850, y: 700 });
    expect(w.platforms![0]).toMatchObject({ w: 400, h: 300 });
    expect(removeItem(w, r)).toBe(true);
    expect(w.platforms).toEqual([]);
  });
  it("ensureIds gives platforms unique ids", () => {
    const w = armWorld();
    w.platforms!.push({ id: "shelf", x: 0, y: 0, w: 50, h: 50, height: 50 });
    ensureIds(w);
    expect(w.platforms!.map((p) => p.id)).toEqual(["shelf", "platform1"]);
  });
});
