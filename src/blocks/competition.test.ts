// @vitest-environment jsdom
// match: the competition program shape ("when autonomous" / "when driver control" hats)
import { describe, expect, it, beforeAll } from "vitest";
import * as Blockly from "blockly";
import { generateProgram } from "./generator";
import { AUTO_HAT_TYPE, DRIVER_HAT_TYPE, HAT_TYPE } from "./definitions";
import { loadState, saveState } from "./workspace";
import { buildToolbox, searchableBlocks } from "./toolbox";
import { createPythonRunner } from "../runtime";
import { loadSkulpt, fakeController, recorder } from "../runtime/testkit";

beforeAll(() => loadSkulpt());

type J = Record<string, unknown>;
const num = (v: number) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
const drive = (mm: number, next?: J): J => ({ type: "robot_drive_for", inputs: { DIST: num(mm) }, ...(next ? { next: { block: next } } : {}) });
const hat = (type: string, body?: J, x = 0): J => ({ type, x, y: 0, ...(body ? { inputs: { DO: { block: body } } } : {}) });

function ws(blocks: J[], variables: J[] = []): Blockly.Workspace {
  const w = new Blockly.Workspace();
  loadState(w, { blocks: { languageVersion: 0, blocks }, ...(variables.length ? { variables } : {}) });
  return w;
}

describe("competition hats", () => {
  it("without them, the program is still def main / start(main)", () => {
    expect(generateProgram(ws([hat(HAT_TYPE, drive(100))])).code).toBe("def main():\n    drivetrain.drive_for(FORWARD, 100, MM)\n\nstart(main)\n");
  });

  it("generate autonomous + driver_control + competition(...)", () => {
    const w = ws([
      hat(HAT_TYPE),
      hat(AUTO_HAT_TYPE, drive(200), 300),
      hat(DRIVER_HAT_TYPE, { type: "robot_forever", inputs: { DO: { block: { type: "robot_motor_spin", inputs: { VELOCITY: { shadow: num(50).shadow, block: { type: "robot_controller_axis", fields: { AXIS: "axis3" } } } } } } } }, 600),
    ]);
    const { code, lineMap } = generateProgram(w);
    expect(code).toBe([
      "def autonomous():",
      "    drivetrain.drive_for(FORWARD, 200, MM)",
      "",
      "def driver_control():",
      "    while True:",
      "        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
      "",
      "competition(autonomous, driver_control)",
      "",
    ].join("\n"));
    const autoHat = w.getBlocksByType(AUTO_HAT_TYPE, false)[0];
    const drv = w.getBlocksByType("robot_drive_for", false)[0];
    expect(lineMap[0]).toBe(autoHat.id);
    expect(lineMap[1]).toBe(drv.id);
    expect(lineMap[7]).toBeNull();
  });

  it("one hat alone still makes both functions (the other just passes); 'when started' blocks run first as setup", () => {
    const code = generateProgram(ws([hat(HAT_TYPE, { type: "robot_set_velocity", inputs: { VALUE: num(80) } }), hat(DRIVER_HAT_TYPE, drive(50), 300)])).code;
    expect(code).toBe([
      "def main():",
      "    drivetrain.set_drive_velocity(80, PERCENT)",
      "",
      "def autonomous():",
      "    pass",
      "",
      "def driver_control():",
      "    drivetrain.drive_for(FORWARD, 50, MM)",
      "",
      "main()",
      "competition(autonomous, driver_control)",
      "",
    ].join("\n"));
  });

  it("variables are global in every function", () => {
    const vars = [{ name: "score", id: "v1" }];
    const code = generateProgram(ws([hat(HAT_TYPE), hat(AUTO_HAT_TYPE, { type: "variables_set", fields: { VAR: { id: "v1" } }, inputs: { VALUE: { block: { type: "math_number", fields: { NUM: 3 } } } } }, 300)], vars)).code;
    expect(code).toContain("score = 0\n");
    expect(code).toContain("def autonomous():\n    global score\n    score = 3\n");
    expect(code).toContain("def driver_control():\n    global score\n    pass\n");
  });

  it("blocks under the hats are not greyed out, and the hats survive save/load", () => {
    const w = ws([hat(HAT_TYPE), hat(AUTO_HAT_TYPE, drive(10), 300)]);
    expect(w.getBlocksByType("robot_drive_for", false)[0].isEnabled()).toBe(true);
    const w2 = new Blockly.Workspace();
    loadState(w2, saveState(w));
    expect(w2.getBlocksByType(AUTO_HAT_TYPE, false)).toHaveLength(1);
    expect(w2.getBlocksByType(HAT_TYPE, false)).toHaveLength(1);
    expect(w2.getBlocksByType(AUTO_HAT_TYPE, false)[0].isDeletable()).toBe(true);
  });

  it("a My Block called autonomous doesn't clash with the generated function", () => {
    const code = generateProgram(ws([
      hat(HAT_TYPE),
      hat(AUTO_HAT_TYPE, { type: "procedures_callnoreturn", extraState: { name: "autonomous" } }, 300),
      { type: "procedures_defnoreturn", x: 600, y: 0, fields: { NAME: "autonomous" }, inputs: { STACK: { block: drive(5) } } },
    ])).code;
    expect(code.match(/^def autonomous\(\):/gm)).toHaveLength(1);
    expect(code).toMatch(/^def autonomous2\(\):/m);
  });

  it("are in the Control toolbox and searchable", () => {
    const json = JSON.stringify(buildToolbox({ pen: false, magnet: false }));
    expect(json).toContain(AUTO_HAT_TYPE);
    expect(json).toContain(DRIVER_HAT_TYPE);
    const hits = searchableBlocks({ pen: false, magnet: false }).filter((b) => b.words.includes("autonomous")).map((b) => b.item.type);
    expect(hits).toContain(AUTO_HAT_TYPE);
  });

  it("the generated program runs: autonomous then driver_control", async () => {
    const code = generateProgram(ws([hat(HAT_TYPE), hat(AUTO_HAT_TYPE, drive(200), 300), hat(DRIVER_HAT_TYPE, drive(50), 600)])).code;
    const { ctl, st } = fakeController();
    const res = await createPythonRunner(recorder(ctl).opts).run(code);
    expect(res.status).toBe("finished");
    expect(st.calls).toEqual(["driveFor(FORWARD,200)", "driveFor(FORWARD,50)"]);
  });
});
