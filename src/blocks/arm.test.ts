// @vitest-environment jsdom
/** arm: Arm category blocks generate the docs/API.md arm/claw Python; the category is hardware-gated. */
import { describe, expect, it } from "vitest";
import * as Blockly from "blockly";
import { generateProgram } from "./generator";
import { HAT_TYPE } from "./definitions";
import { loadState } from "./workspace";
import { buildToolbox, searchableBlocks } from "./toolbox";

type J = Record<string, unknown>;
const num = (v: number) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
function body(b: J): string {
  const ws = new Blockly.Workspace();
  loadState(ws, { blocks: { languageVersion: 0, blocks: [{ type: HAT_TYPE, x: 0, y: 0, inputs: { DO: { block: b } } }] } });
  const lines = generateProgram(ws).code.split("\n");
  const i = lines.indexOf("def main():");
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (!l.startsWith("    ")) break; out.push(l.slice(4)); }
  return out.join("\n");
}
const expr = (b: J) => body({ type: "robot_print_log", inputs: { VALUE: { block: b } } }).replace(/^print\((.*)\)$/, "$1");

describe("arm blocks", () => {
  const S: [J, string][] = [
    [{ type: "robot_arm_spin_to", inputs: { ANGLE: num(45) } }, "arm.spin_to_position(45, DEGREES)"],
    [{ type: "robot_arm_spin_to", fields: { WAIT: false }, inputs: { ANGLE: num(10) } }, "arm.spin_to_position(10, DEGREES, wait=False)"],
    [{ type: "robot_arm_spin" }, "arm.spin(UP)"],
    [{ type: "robot_arm_spin", fields: { DIR: "DOWN" } }, "arm.spin(DOWN)"],
    [{ type: "robot_arm_stop" }, "arm.stop()"],
    [{ type: "robot_arm_set_velocity", inputs: { VALUE: num(80) } }, "arm.set_velocity(80, PERCENT)"],
    [{ type: "robot_claw" }, "claw.close()"],
    [{ type: "robot_claw", fields: { ACTION: "open" } }, "claw.open()"],
  ];
  for (const [b, want] of S) it(`${b.type} ${JSON.stringify(b.fields ?? {})}`, () => expect(body(b)).toBe(want));
  it("reporters", () => {
    expect(expr({ type: "robot_arm_position" })).toBe("arm.position(DEGREES)");
    expect(expr({ type: "robot_claw_holding" })).toBe("claw.is_holding()");
  });
});

describe("Arm category", () => {
  const names = (hw: { pen: boolean; magnet: boolean; arm?: boolean }) =>
    ((buildToolbox(hw) as unknown as { contents: { name: string }[] }).contents).map((c) => c.name);
  it("is shown only with an arm", () => {
    expect(names({ pen: false, magnet: false })).not.toContain("Arm");
    expect(names({ pen: false, magnet: false, arm: true })).toEqual(["Drivetrain", "Sensing", "Controller", "Arm", "Looks", "Control", "Operators", "Variables", "My Blocks"]);
  });
  it("every Arm block (and the starter) can be created headless", () => {
    const tb = buildToolbox({ pen: false, magnet: false, arm: true }) as unknown as { contents: { name: string; contents?: J[] }[] };
    const ws = new Blockly.Workspace();
    for (const it of tb.contents.find((c) => c.name === "Arm")!.contents ?? []) {
      if (it.kind !== "block") continue;
      const { kind: _k, ...state } = it;
      expect(() => Blockly.serialization.blocks.append(state as unknown as Blockly.serialization.blocks.State, ws)).not.toThrow();
    }
  });
  it("search finds the claw only when fitted", () => {
    expect(searchableBlocks({ pen: false, magnet: false, arm: true }).some((b) => b.item.type === "robot_claw" && b.words.includes("grab"))).toBe(true);
    expect(searchableBlocks({ pen: false, magnet: false }).some((b) => b.item.type === "robot_claw")).toBe(false);
  });
});
