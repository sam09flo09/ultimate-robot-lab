/** arm: the Python arm/claw API (fake controller), its friendly errors, and a run on the real sim. */
import { describe, it, expect, beforeAll } from "vitest";
import { createPythonRunner } from "./index";
import { loadSkulpt, fakeController, recorder } from "./testkit";
import type { RunResult } from "../core/modules";
import type { World } from "../core/types";
import { createSim } from "../sim";

beforeAll(() => loadSkulpt());

async function runProg(src: string, over = {}) {
  const { ctl, st } = fakeController(over);
  const { opts, rec } = recorder(ctl);
  const res = await createPythonRunner(opts).run(src);
  return { res, st, rec };
}
const prog = (body: string[]) => ["def main():", ...body.map((l) => "    " + l), "", "start(main)", ""].join("\n");
function expectError(res: RunResult) {
  expect(res.status).toBe("error");
  if (res.status !== "error") throw new Error("not an error");
  return res.error;
}

describe("arm and claw API", () => {
  it("every call reaches the controller and is logged", async () => {
    const { res, st, rec } = await runProg(prog([
      "arm.set_velocity(80, PERCENT)",
      "arm.spin_to_position(45, DEGREES)",
      "print(arm.position(DEGREES))",
      "arm.spin(UP)", "arm.spin(DOWN)", "arm.stop()",
      "claw.close()", "print(claw.is_holding())", "claw.open()", "print(claw.is_holding())",
      "claw.grab()", "claw.release()",
      "arm.spin_to_position(10, DEGREES, wait=False)",
      "arm.spin_to_position(20)",
    ]));
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual([
      "setArmVelocity(80)", "armSpinTo(45)", "armSpin(1)", "armSpin(-1)", "armSpin(0)",
      "claw(true)", "claw(false)", "claw(true)", "claw(false)", "armSpinTo(10)", "armSpinTo(20)",
    ]);
    expect(rec.logs.filter((l) => l.kind === "print").map((l) => l.text)).toEqual(["45.0", "True", "False"]);
    expect(rec.logs.filter((l) => l.kind === "step").map((l) => l.text)).toEqual([
      "arm.set_velocity(80, PERCENT)", "arm.spin_to_position(45, DEGREES)", "arm.spin(UP)", "arm.spin(DOWN)", "arm.stop()",
      "claw.close()", "claw.open()", "claw.grab()", "claw.release()",
      "arm.spin_to_position(10, DEGREES, wait=False)", "arm.spin_to_position(20)",
    ]);
  });

  it("clamps angles to 0..90 with a warning", async () => {
    const { st, rec } = await runProg(prog(["arm.spin_to_position(120, DEGREES)", "arm.spin_to_position(-5, DEGREES)"]));
    expect(st.calls).toEqual(["armSpinTo(90)", "armSpinTo(0)"]);
    expect(rec.logs.filter((l) => l.kind === "warn").map((l) => l.text)[0]).toContain("120 became 90");
  });

  it("no arm -> friendly RuntimeError naming the problem", async () => {
    for (const line of ["arm.spin_to_position(45, DEGREES)", "claw.close()", "arm.position(DEGREES)", "claw.is_holding()"]) {
      const e = expectError((await runProg(prog([line]), { arm: false })).res);
      expect(e.type).toBe("RuntimeError");
      expect(e.html).toContain("This playground has no arm.");
      expect(e.line).toBe(2);
    }
  });

  it("argument mistakes are explained", async () => {
    let e = expectError((await runProg(prog(["arm.spin(FORWARD)"]))).res);
    expect(e.html).toContain("UP or DOWN");
    e = expectError((await runProg(prog(["arm.spin_to_position('high', DEGREES)"]))).res);
    expect(e.html).toContain("arm.spin_to_position angle must be a number");
    e = expectError((await runProg(prog(["arm.spin_to_position(45, MM)"]))).res);
    expect(e.html).toContain("units must be DEGREES");
    e = expectError((await runProg(prog(["claw.close(1)"]))).res);
    expect(e.html).toContain("claw.close() doesn&#39;t take any values");
    e = expectError((await runProg(prog(["claw.grip()"]))).res);
    expect(e.html).toContain("<code>claw</code> has no command <code>grip</code>");
    e = expectError((await runProg(prog(["arm.spin_to_positon(45, DEGREES)"]))).res);
    expect(e.html).toContain("Did you mean <code>arm.spin_to_position</code>?");
  });
});

describe("arm on the real sim", () => {
  it("pick, lift, carry and stack with Python", async () => {
    const world: World = {
      id: "rt-arm", name: "rt", width: 2000, height: 2000, start: { x: 0, y: -600, heading: 0 },
      walls: [], floor: [], zones: [], goals: [{ type: "stackHeight", count: 2 }], hardware: { arm: true }, version: 1,
      objects: [
        { id: "base", shape: "box", x: 0, y: 0, size: 50, height: 50, color: "RED", movable: true, pickable: true, rotation: 0 },
        { id: "top", shape: "box", x: 0, y: -470, size: 50, height: 50, color: "BLUE", movable: true, pickable: true, rotation: 0 },
      ],
    };
    const sim = createSim(world);
    const out: string[] = [];
    const runner = createPythonRunner({ controller: sim.controller, onLine: () => {}, onLog: (e) => { if (e.kind === "print") out.push(e.text); } });
    let result: RunResult | null = null;
    runner.run(prog([
      "claw.close()", "print(claw.is_holding())",
      "arm.spin_to_position(20, DEGREES)",
      "drivetrain.drive_for(FORWARD, 470, MM)",
      "arm.spin_to_position(0, DEGREES)",
      "print(round(arm.position(DEGREES)))",
      "claw.open()",
    ])).then((r) => { result = r; });
    for (let i = 0; i < 2000 && !result; i++) { await new Promise((r) => setTimeout(r, 0)); sim.step(1 / 60); }
    expect(result).toMatchObject({ status: "finished" });
    expect(out).toEqual(["True", "10"]);
    expect(sim.evaluateGoals()[0].passed).toBe(true);
  }, 30_000);
});
