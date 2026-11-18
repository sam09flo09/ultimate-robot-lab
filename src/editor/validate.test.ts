import { describe, expect, it } from "vitest";
import { newBlankWorld } from "./levelFile";
import { validateWorld } from "./validate";

describe("validateWorld", () => {
  it("flags missing zones, start in wall, objects outside", () => {
    const w = newBlankWorld();
    w.start = { x: 0, y: 0, heading: 0 };
    w.walls.push({ id: "wall1", a: { x: -100, y: 0 }, b: { x: 100, y: 0 }, thickness: 20 });
    w.objects.push({ id: "obj1", shape: "disk", x: 5000, y: 0, size: 100, color: "RED", movable: true, pickable: false });
    w.goals.push({ type: "reachZone", zone: "gone" }, { type: "visitInOrder", zones: [] });
    const t = validateWorld(w).filter((i) => i.level === "error").map((i) => i.text).join("\n");
    expect(t).toContain('"gone"');
    expect(t).toContain("no zones to visit");
    expect(t).toContain("inside a wall");
    expect(t).toContain('"obj1" is outside');
  });
  it("a clean level has no errors or warnings", () => {
    const w = newBlankWorld();
    w.zones.push({ id: "zone1", kind: "rect", x: 500, y: 500, w: 300, h: 300 });
    w.goals.push({ type: "reachZone", zone: "zone1" });
    expect(validateWorld(w).filter((i) => i.level !== "info")).toEqual([]);
  });
});
