/** arm: Stack Shop is well-formed and its reference solution completes every goal on the real sim. */
import { beforeAll, describe, expect, it } from "vitest";
import { stackShop } from "./stackShop";
import { loadSkulpt } from "../runtime/testkit";
import { runSolution } from "../activities/content/runSolution";
import { STACK_SHOP_FULL } from "../activities/content/solutions";
import { sanitizeWorld, validateWorld } from "../editor";

beforeAll(() => loadSkulpt());

describe("stack-shop", () => {
  it("is a valid arm world that survives the level-file sanitiser", () => {
    const { world, warnings } = sanitizeWorld(JSON.parse(JSON.stringify(stackShop)));
    expect(warnings).toEqual([]);
    expect(world.platforms).toEqual(stackShop.platforms);
    expect(world.hardware?.arm).toBe(true);
    expect(validateWorld(stackShop).filter((i) => i.level !== "info")).toEqual([]);
  });

  it("the reference solution completes every goal", async () => {
    const run = await runSolution(stackShop, STACK_SHOP_FULL, 240);
    expect(run.result?.status, JSON.stringify(run.result)).toBe("finished");
    expect(run.sim.evaluateGoals().filter((g) => !g.passed).map((g) => g.detail)).toEqual([]);
  }, 120_000);

  it("the starter grabs and lifts a block but doesn't finish the job", async () => {
    const run = await runSolution(stackShop, stackShop.starter!.python!, 60);
    expect(run.result?.status).toBe("finished");
    expect(run.log).toContain("Holding: True");
    expect(run.sim.evaluateGoals().every((g) => g.passed)).toBe(false);
  }, 60_000);
});
