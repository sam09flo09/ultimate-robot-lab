import { describe, expect, it } from "vitest";
import { moveGoal, moveInArray, moveVisitZone } from "./goalOrder";
import { newBlankWorld } from "./levelFile";

describe("goal reordering", () => {
  it("moveInArray moves by one and refuses out-of-range moves", () => {
    const a = ["a", "b", "c"];
    expect(moveInArray(a, 0, 1)).toBe(true);
    expect(a).toEqual(["b", "a", "c"]);
    expect(moveInArray(a, 2, -1)).toBe(true);
    expect(a).toEqual(["b", "c", "a"]);
    expect(moveInArray(a, 0, -1)).toBe(false);
    expect(moveInArray(a, 2, 1)).toBe(false);
    expect(moveInArray(a, 5, -1)).toBe(false);
    expect(a).toEqual(["b", "c", "a"]);
  });

  it("moves goals and visitInOrder zones", () => {
    const w = newBlankWorld();
    w.goals = [{ type: "noWallHits" }, { type: "visitInOrder", zones: ["z1", "z2", "z3"] }, { type: "maxTime", seconds: 30 }];
    expect(moveGoal(w, 2, -1)).toBe(true);
    expect(w.goals.map((g) => g.type)).toEqual(["noWallHits", "maxTime", "visitInOrder"]);
    expect(moveVisitZone(w, 2, 0, 1)).toBe(true);
    expect(w.goals[2]).toEqual({ type: "visitInOrder", zones: ["z2", "z1", "z3"] });
    expect(moveVisitZone(w, 0, 0, 1)).toBe(false); // not a visitInOrder goal
    expect(moveVisitZone(w, 2, 2, 1)).toBe(false);
  });
});
