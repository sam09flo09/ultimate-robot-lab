// Toolbox (category) definition. Rebuilt whenever world hardware changes.
import type * as Blockly from "blockly";
import { BLOCK_DEFS } from "./definitions";

type Item = Record<string, unknown>;
const n = (v: number) => ({ shadow: { type: "math_number", fields: { NUM: v } } });
const t = (v: string) => ({ shadow: { type: "text", fields: { TEXT: v } } });
const blk = (type: string, inputs?: Record<string, unknown>, fields?: Record<string, unknown>): Item => ({
  kind: "block", type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}),
});
const label = (text: string): Item => ({ kind: "label", text });
const sep = (gap = 24): Item => ({ kind: "sep", gap: String(gap) });

/** Block JSON (serialisation format) helpers for multi-block "starter" stacks. */
const s = (type: string, extra: Record<string, unknown> = {}, next?: Item): Item => ({
  type, ...extra, ...(next ? { next: { block: next } } : {}),
});
const starter = (block: Item): Item => ({ kind: "block", ...block });

const driveFor = (d: number, next?: Item) => s("robot_drive_for", { inputs: { DIST: n(d) } }, next);
const turnFor = (a: number, next?: Item) => s("robot_turn_for", { inputs: { ANGLE: n(a) } }, next);

/** Driver-control starters: a reporter (or sum) dropped into a motor's velocity slot. */
const axis = (a: string): Item => s("robot_controller_axis", { fields: { AXIS: a } });
const arith = (op: "ADD" | "MINUS", a: Item, b: Item): Item =>
  s("math_arithmetic", { fields: { OP: op }, inputs: { A: { shadow: n(0).shadow, block: a }, B: { shadow: n(0).shadow, block: b } } });
const spinWith = (motor: string, value: Item, next?: Item) =>
  s("robot_motor_spin", { fields: { MOTOR: motor }, inputs: { VELOCITY: { shadow: n(50).shadow, block: value } } }, next);
const loopWait = (first: Item) => s("robot_forever", { inputs: { DO: { block: first } } });
const wait20 = () => s("robot_wait", { fields: { UNITS: "MSEC" }, inputs: { TIME: n(20) } });

/** "Tank drive": each stick drives one side. */
export const TANK_DRIVE_STARTER: Item = loopWait(
  spinWith("left_motor", axis("axis3"), spinWith("right_motor", axis("axis2"), wait20())));
/** "Arcade drive": left stick forward/back, right stick turns. */
export const ARCADE_DRIVE_STARTER: Item = loopWait(
  spinWith("left_motor", arith("ADD", axis("axis3"), axis("axis1")),
    spinWith("right_motor", arith("MINUS", axis("axis3"), axis("axis1")), wait20())));

/** Hardware that shows extra categories. `arm` is optional so older callers keep working. */
export type ToolboxHardware = { pen: boolean; magnet: boolean; arm?: boolean };

export function buildToolbox(hw: ToolboxHardware): Blockly.utils.toolbox.ToolboxDefinition {
  const cats: Item[] = [
    {
      kind: "category", name: "Drivetrain", categorystyle: "rl_drive_cat", contents: [
        label("Starter · drive a square"),
        starter(s("robot_repeat", {
          inputs: { TIMES: n(4), DO: { block: driveFor(200, turnFor(90)) } },
        })),
        sep(),
        blk("robot_drive_for", { DIST: n(200) }),
        blk("robot_turn_for", { ANGLE: n(90) }),
        blk("robot_turn_to_heading", { ANGLE: n(90) }),
        blk("robot_drive"),
        blk("robot_turn"),
        blk("robot_stop"),
        sep(),
        blk("robot_set_velocity", { VALUE: n(50) }),
        blk("robot_set_velocity", { VALUE: n(50) }, { KIND: "turn" }),
        blk("robot_set_heading", { ANGLE: n(0) }),
        sep(),
        blk("robot_heading"),
        blk("robot_rotation"),
        blk("robot_is_done"),
        label("Motors · one wheel at a time"),
        blk("robot_motor_spin", { VELOCITY: n(50) }),
        blk("robot_motor_spin", { VELOCITY: n(50) }, { MOTOR: "right_motor" }),
        blk("robot_motor_stop"),
        blk("robot_motor_stop", undefined, { MOTOR: "right_motor" }),
        blk("robot_motor_set_velocity", { VELOCITY: n(50) }),
        blk("robot_motor_velocity"),
      ],
    },
    {
      kind: "category", name: "Sensing", categorystyle: "rl_sensing_cat", contents: [
        label("Starter · stop before a wall"),
        starter(s("robot_drive", {}, s("robot_wait_until", {
          inputs: { COND: { block: s("logic_compare", { fields: { OP: "LT" }, inputs: { A: { block: s("robot_distance") }, B: n(150) } }) } },
        }, s("robot_stop")))),
        sep(),
        blk("robot_distance"),
        blk("robot_distance_found"),
        sep(),
        blk("robot_front_near"),
        blk("robot_eye_detect"),
        blk("robot_eye_color"),
        blk("robot_eye_brightness"),
        blk("robot_eye_detect", undefined, { EYE: "down_eye" }),
        blk("robot_eye_color", undefined, { EYE: "down_eye" }),
        blk("robot_eye_brightness", undefined, { EYE: "down_eye" }),
        blk("robot_color_value"),
        sep(),
        blk("robot_bumper"),
        blk("robot_position"),
        blk("robot_position", undefined, { AXIS: "Y" }),
        sep(),
        blk("robot_timer"),
        blk("robot_reset_timer"),
      ],
    },
    {
      kind: "category", name: "Controller", categorystyle: "rl_controller_cat", contents: [
        label("Starter · tank drive"),
        starter(TANK_DRIVE_STARTER),
        label("Starter · arcade drive"),
        starter(ARCADE_DRIVE_STARTER),
        sep(),
        blk("robot_controller_axis"),
        blk("robot_controller_axis", undefined, { AXIS: "axis2" }),
        blk("robot_controller_axis", undefined, { AXIS: "axis1" }),
        blk("robot_controller_axis", undefined, { AXIS: "axis4" }),
        sep(),
        blk("robot_controller_button"),
        blk("robot_controller_button", undefined, { BUTTON: "buttonB" }),
        blk("robot_controller_button", undefined, { BUTTON: "buttonL1" }),
        blk("robot_controller_button", undefined, { BUTTON: "buttonR1" }),
      ],
    },
  ];
  if (hw.pen) {
    cats.push({
      kind: "category", name: "Pen", categorystyle: "rl_pen_cat", contents: [
        label("Starter · draw a line"),
        starter(s("robot_pen_move", {}, driveFor(300, s("robot_pen_move", { fields: { POS: "UP" } })))),
        sep(),
        blk("robot_pen_move"),
        blk("robot_pen_move", undefined, { POS: "UP" }),
        blk("robot_pen_color"),
      ],
    });
  }
  if (hw.magnet) {
    cats.push({
      kind: "category", name: "Magnet", categorystyle: "rl_magnet_cat", contents: [
        label("Starter · carry an object"),
        starter(s("robot_magnet", {}, driveFor(300, s("robot_magnet", { fields: { MODE: "DROP" } })))),
        sep(),
        blk("robot_magnet"),
        blk("robot_magnet", undefined, { MODE: "DROP" }),
      ],
    });
  }
  if (hw.arm) {
    // arm: grab, lift, let go
    cats.push({
      kind: "category", name: "Arm", categorystyle: "rl_arm_cat", contents: [
        label("Starter · pick up and lift"),
        starter(s("robot_claw", {}, s("robot_arm_spin_to", { inputs: { ANGLE: n(45) } }))),
        sep(),
        blk("robot_arm_spin_to", { ANGLE: n(45) }),
        blk("robot_arm_spin"),
        blk("robot_arm_spin", undefined, { DIR: "DOWN" }),
        blk("robot_arm_stop"),
        blk("robot_arm_set_velocity", { VALUE: n(50) }),
        blk("robot_arm_position"),
        sep(),
        blk("robot_claw"),
        blk("robot_claw", undefined, { ACTION: "open" }),
        blk("robot_claw_holding"),
      ],
    });
  }
  cats.push(
    {
      kind: "category", name: "Looks", categorystyle: "rl_looks_cat", contents: [
        blk("robot_screen_print", { VALUE: t("Hello") }),
        blk("robot_screen_newline"),
        blk("robot_screen_clear"),
        sep(),
        blk("robot_print_log", { VALUE: t("checkpoint") }),
      ],
    },
    {
      kind: "category", name: "Control", categorystyle: "rl_control_cat", contents: [
        label("Starter · bump and turn"),
        starter(s("robot_forever", {
          inputs: { DO: { block: s("robot_drive", {}, s("robot_wait_until", { inputs: { COND: { block: s("robot_bumper") } } }, turnFor(90))) } },
        })),
        sep(),
        blk("robot_wait", { TIME: n(1) }),
        blk("robot_repeat", { TIMES: n(4) }),
        blk("robot_forever"),
        sep(),
        blk("robot_if"),
        blk("robot_if_else"),
        blk("robot_wait_until"),
        blk("robot_repeat_until"),
        blk("robot_break"),
      ],
    },
    {
      kind: "category", name: "Operators", categorystyle: "rl_operators_cat", contents: [
        blk("math_number", undefined, { NUM: 0 }),
        blk("math_arithmetic", { A: n(1), B: n(1) }),
        blk("math_arithmetic", { A: n(1), B: n(1) }, { OP: "MINUS" }),
        blk("math_arithmetic", { A: n(1), B: n(1) }, { OP: "MULTIPLY" }),
        blk("math_arithmetic", { A: n(1), B: n(1) }, { OP: "DIVIDE" }),
        blk("math_random_int", { FROM: n(1), TO: n(10) }),
        sep(),
        blk("logic_compare", { B: n(100) }, { OP: "LT" }),
        blk("logic_compare", { B: n(100) }, { OP: "GT" }),
        blk("logic_compare", { B: n(100) }),
        blk("logic_operation"),
        blk("logic_operation", undefined, { OP: "OR" }),
        blk("logic_negate"),
        blk("logic_boolean"),
        sep(),
        blk("math_round", { NUM: n(3.1) }),
        blk("math_modulo", { DIVIDEND: n(10), DIVISOR: n(3) }),
        blk("math_single", { NUM: n(9) }),
        blk("math_trig", { NUM: n(45) }),
        sep(),
        blk("text", undefined, { TEXT: "" }),
        blk("text_join"),
      ],
    },
    { kind: "category", name: "Variables", categorystyle: "rl_variables_cat", custom: "VARIABLE" },
    { kind: "category", name: "My Blocks", categorystyle: "rl_myblocks_cat", custom: "PROCEDURE" },
  );
  return { kind: "categoryToolbox", contents: cats } as unknown as Blockly.utils.toolbox.ToolboxDefinition;
}

/** Flat list of every toolbox block (no starters), with words to match a search. */
export function searchableBlocks(hw: ToolboxHardware): { words: string; item: Item }[] {
  const tb = buildToolbox(hw) as unknown as { contents: Item[] };
  const out: { words: string; item: Item }[] = [];
  for (const cat of tb.contents) {
    const items = (cat.contents as Item[] | undefined) ?? [];
    for (const it of items) {
      if (it.kind !== "block" || it.next || (it.inputs && JSON.stringify(it.inputs).includes('"block"'))) continue;
      out.push({ words: `${cat.name} ${blockWords(String(it.type))} ${JSON.stringify(it.fields ?? {})}`.toLowerCase(), item: it });
    }
  }
  return out;
}

const EXTRA_WORDS: Record<string, string> = {
  math_number: "number", math_arithmetic: "plus minus times divide add subtract multiply math",
  math_random_int: "random pick", logic_compare: "compare equals less greater than = < >",
  logic_operation: "and or", logic_negate: "not", logic_boolean: "true false", math_round: "round up down",
  math_modulo: "remainder modulo", math_single: "square root absolute", math_trig: "sin cos tan trig",
  text: "text word string", text_join: "join text",
  robot_motor_spin: "wheel motor spin speed power driver tank arcade output",
  robot_motor_stop: "wheel motor stop halt brake driver",
  robot_motor_set_velocity: "wheel motor speed power velocity",
  robot_motor_velocity: "wheel motor speed velocity",
  robot_controller_axis: "joystick stick gamepad axis driver control drive input position tank arcade",
  robot_controller_button: "gamepad button press pressing driver control input trigger shoulder",
  robot_arm_spin_to: "arm lift raise lower angle position manipulator",
  robot_arm_spin: "arm lift raise lower up down manipulator",
  robot_arm_stop: "arm halt",
  robot_arm_set_velocity: "arm speed velocity",
  robot_arm_position: "arm angle degrees",
  robot_claw: "claw grab grip pick up release drop gripper end effector",
  robot_claw_holding: "claw holding grab gripper",
};
function blockWords(type: string): string {
  const def = BLOCK_DEFS.find((d) => d.type === type);
  let w = type.replace(/^robot_/, "").replace(/_/g, " ") + " " + (EXTRA_WORDS[type] ?? "");
  if (def) {
    w += " " + String(def.message0).replace(/%\d+/g, " ");
    for (const a of (def.args0 as { options?: [string, string][] }[] | undefined) ?? []) {
      if (a.options) w += " " + a.options.map((o) => o[0]).join(" ");
    }
  }
  return w;
}
