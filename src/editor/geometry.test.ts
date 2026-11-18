import { describe, expect, it } from "vitest";
import type { World } from "../core/types";
import {
  distToSegment, dragHandle, findItem, handlesFor, headingFromVector, hitTest, pointInRect, removeItem,
  snapHeading, snapPoint, START_ID, translateItem,
} from "./geometry";
import { newBlankWorld } from "./levelFile";

function w(): World {
  const x = newBlankWorld();
  x.start = { x: -800, y: -800, heading: 0 };
  x.walls.push({ id: "wall1", a: { x: -500, y: 0 }, b: { x: 500, y: 0 }, thickness: 40 });
  x.floor.push(
    { kind: "rect", id: "big", x: 0, y: 500, w: 1000, h: 600, color: "BLUE" },
    { kind: "circle", id: "dot", x: 300, y: 500, r: 60, color: "RED" },
    { kind: "line", id: "tape", points: [{ x: -900, y: 300 }, { x: -900, y: 900 }], width: 20, color: "BLACK" },
  );
  x.objects.push({ id: "box", shape: "box", x: 600, y: -500, size: 100, color: "RED", movable: true, pickable: false, rotation: 45 });
  x.zones.push({ id: "zA", kind: "rect", x: 0, y: 500, w: 800, h: 400 }, { id: "zC", kind: "circle", x: -500, y: -500, r: 100 });
  return x;
}

describe("geometry basics", () => {
  it("distance to segment", () => {
    expect(distToSegment({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 13, y: 4 }, { x: -10, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
  it("rotated rect containment", () => {
    expect(pointInRect({ x: 60, y: 0 }, 0, 0, 100, 100, 45)).toBe(true);
    expect(pointInRect({ x: 60, y: 0 }, 0, 0, 100, 100, 0)).toBe(false);
    expect(pointInRect({ x: 45, y: 45 }, 0, 0, 100, 100, 45)).toBe(false);
  });
  it("headings: 0 up, 90 right, clockwise", () => {
    expect(headingFromVector(0, 1)).toBe(0);
    expect(headingFromVector(1, 0)).toBe(90);
    expect(headingFromVector(0, -1)).toBe(180);
    expect(headingFromVector(-1, 0)).toBe(270);
    expect(snapHeading(355)).toBe(0);
    expect(snapHeading(352)).toBe(345);
    expect(snapHeading(-20)).toBe(345);
  });
  it("snap", () => {
    expect(snapPoint({ x: 149, y: -151 }, 100)).toEqual({ x: 100, y: -200 });
  });
});

describe("hitTest", () => {
  const world = w();
  it("walls are thick segments", () => {
    expect(hitTest(world, { x: 100, y: 19 }, 0)?.id).toBe("wall1");
    expect(hitTest(world, { x: 100, y: 25 }, 0)).toBeNull();
    expect(hitTest(world, { x: 100, y: 25 }, 6)?.id).toBe("wall1");
    expect(hitTest(world, { x: 515, y: 0 }, 0)?.id).toBe("wall1"); // round cap
  });
  it("robot start wins over everything", () => {
    expect(hitTest(world, { x: -800, y: -800 }, 0)).toEqual({ kind: "start", id: START_ID, index: -1 });
  });
  it("objects respect box rotation", () => {
    expect(hitTest(world, { x: 660, y: -500 }, 0)?.id).toBe("box");
    expect(hitTest(world, { x: 645, y: -455 }, 0)).toBeNull();
  });
  it("smallest area wins among zones and floor", () => {
    expect(hitTest(world, { x: 300, y: 500 }, 0)?.id).toBe("dot");
    expect(hitTest(world, { x: 0, y: 500 }, 0)?.id).toBe("zA");
    expect(hitTest(world, { x: 450, y: 750 }, 0)?.id).toBe("big");
    expect(hitTest(world, { x: -500, y: -450 }, 0)?.id).toBe("zC");
  });
  it("tape lines by distance", () => {
    expect(hitTest(world, { x: -895, y: 600 }, 0)?.id).toBe("tape");
    expect(hitTest(world, { x: -870, y: 600 }, 0)).toBeNull();
  });
  it("empty space", () => {
    expect(hitTest(world, { x: 900, y: 900 }, 5)).toBeNull();
  });
});

describe("editing helpers", () => {
  it("translate and remove", () => {
    const x = w();
    translateItem(x, findItem(x, "wall1")!, 10, 20);
    expect(x.walls[0].a).toEqual({ x: -490, y: 20 });
    translateItem(x, findItem(x, "tape")!, 5, 0);
    expect((x.floor[2] as { points: { x: number }[] }).points[1].x).toBe(-895);
    translateItem(x, findItem(x, START_ID)!, 100, 0);
    expect(x.start.x).toBe(-700);
    expect(removeItem(x, findItem(x, START_ID)!)).toBe(false);
    expect(removeItem(x, findItem(x, "dot")!)).toBe(true);
    expect(findItem(x, "dot")).toBeNull();
  });
  it("handles: wall endpoint, rect corner, start rotation", () => {
    const x = w();
    const orig = JSON.parse(JSON.stringify(x)) as World;
    const wall = findItem(x, "wall1")!;
    expect(handlesFor(x, wall)).toHaveLength(2);
    dragHandle(x, orig, wall, 1, { x: 500, y: 300 });
    expect(x.walls[0].b).toEqual({ x: 500, y: 300 });

    const rect = findItem(x, "big")!;
    dragHandle(x, orig, rect, 0, { x: 700, y: 900 }); // fixed corner is (-500, 200)
    expect(x.floor[0]).toMatchObject({ x: 100, y: 550, w: 1200, h: 700 });

    const s = findItem(x, START_ID)!;
    dragHandle(x, orig, s, 0, { x: -700, y: -797 });
    expect(x.start.heading).toBe(90);
  });
});
