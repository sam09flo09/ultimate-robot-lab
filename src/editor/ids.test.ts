import { describe, expect, it } from "vitest";
import { collectIds, ensureIds, nextId } from "./ids";
import { newBlankWorld } from "./levelFile";

describe("ids", () => {
  it("nextId picks the smallest unused number", () => {
    const used = new Set(["wall1", "wall2", "wall4"]);
    expect(nextId(used, "wall")).toBe("wall3");
    expect(nextId(used, "wall")).toBe("wall5");
  });
  it("ensureIds makes every id present, valid and globally unique", () => {
    const w = newBlankWorld();
    w.walls.push({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 5 }, { id: "same", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, thickness: 5 });
    w.floor.push({ kind: "circle", id: "same", x: 0, y: 0, r: 5, color: "RED" }, { kind: "circle", id: "bad id!", x: 0, y: 0, r: 5, color: "RED" });
    w.objects.push({ id: "same", shape: "disk", x: 0, y: 0, size: 10, color: "RED", movable: true, pickable: false });
    w.zones.push({ id: "wall1", kind: "circle", x: 0, y: 0, r: 5 });
    ensureIds(w);
    const all = [...w.walls, ...w.floor, ...w.objects, ...w.zones].map((x) => x.id!);
    expect(all.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    expect(w.walls[1].id).toBe("same");
    expect(w.zones[0].id).toBe("wall1");
    expect(w.walls[0].id).not.toBe("wall1");
    expect(collectIds(w).size).toBe(all.length);
  });
  it("repeated adds never collide", () => {
    const w = newBlankWorld();
    for (let i = 0; i < 50; i++) w.objects.push({ id: nextId(collectIds(w), "obj"), shape: "disk", x: 0, y: 0, size: 10, color: "RED", movable: true, pickable: false });
    expect(new Set(w.objects.map((o) => o.id)).size).toBe(50);
  });
});
