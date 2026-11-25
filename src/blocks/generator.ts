// Python generator for Robot Lab blocks. Emits only the API in docs/API.md (+ math/random).
//
// Line map: every statement block's code is prefixed (in scrub_) with a marker line
// "\u0001<id>\u0001" at the block's indentation. After assembling the program the markers are
// stripped and each remaining line is attributed to the innermost marker whose indentation is
// <= the line's indentation (so `else:` belongs to its `if`, and a dedent leaves inner blocks).
import * as Blockly from "blockly";
import { PythonGenerator, pythonGenerator, Order } from "blockly/python";
import { AUTO_HAT_TYPE, DRIVER_HAT_TYPE, HAT_TYPE } from "./definitions";
import { AXIS_NAMES, BUTTON_NAMES } from "../core/modules";

const M = "\u0001";
const INDENT = "    ";
const PROC_DEFS = new Set(["procedures_defnoreturn", "procedures_defreturn"]);

class RobotPythonGenerator extends PythonGenerator {
  constructor() {
    super("Python");
    this.INDENT = INDENT;
    Object.assign(this.forBlock, pythonGenerator.forBlock);
    this.addReservedWords("competition,autonomous,driver_control"); // match: names the competition shape defines
  }
  override scrub_(block: Blockly.Block, code: string, thisOnly?: boolean): string {
    if (!block.outputConnection) code = `${M}${block.id}${M}\n` + code;
    return super.scrub_(block, code, thisOnly);
  }
  /** Exposes the protected definitions table. */
  takeDefinitions(): Record<string, string> {
    return { ...(this.definitions_ as Record<string, string>) };
  }
}

type G = RobotPythonGenerator;
const val = (b: Blockly.Block, g: G, name: string, order: number, dflt: string) =>
  g.valueToCode(b, name, order) || dflt;
const f = (b: Blockly.Block, name: string) => String(b.getFieldValue(name));
const waitArg = (b: Blockly.Block) => (b.getFieldValue("WAIT") === "FALSE" ? ", wait=False" : "");
const body = (b: Blockly.Block, g: G, name: string) => g.statementToCode(b, name) || g.PASS;

const gens: Record<string, (b: Blockly.Block, g: G) => string | [string, number]> = {
  // drivetrain
  robot_drive_for: (b, g) => `drivetrain.drive_for(${f(b, "DIR")}, ${val(b, g, "DIST", Order.NONE, "0")}, ${f(b, "UNITS")}${waitArg(b)})\n`,
  robot_turn_for: (b, g) => `drivetrain.turn_for(${f(b, "DIR")}, ${val(b, g, "ANGLE", Order.NONE, "0")}, DEGREES${waitArg(b)})\n`,
  robot_turn_to_heading: (b, g) => `drivetrain.turn_to_heading(${val(b, g, "ANGLE", Order.NONE, "0")}, DEGREES${waitArg(b)})\n`,
  robot_drive: (b) => `drivetrain.drive(${f(b, "DIR")})\n`,
  robot_turn: (b) => `drivetrain.turn(${f(b, "DIR")})\n`,
  robot_stop: () => `drivetrain.stop()\n`,
  robot_set_velocity: (b, g) => `drivetrain.set_${f(b, "KIND") === "turn" ? "turn" : "drive"}_velocity(${val(b, g, "VALUE", Order.NONE, "50")}, PERCENT)\n`,
  robot_set_heading: (b, g) => `drivetrain.set_heading(${val(b, g, "ANGLE", Order.NONE, "0")}, DEGREES)\n`,
  robot_heading: () => ["drivetrain.heading(DEGREES)", Order.FUNCTION_CALL],
  robot_rotation: () => ["drivetrain.rotation(DEGREES)", Order.FUNCTION_CALL],
  robot_is_done: () => ["drivetrain.is_done()", Order.FUNCTION_CALL],
  // motors (driver control)
  robot_motor_spin: (b, g) => `${motor(b)}.spin(${dirFR(b)}, ${val(b, g, "VELOCITY", Order.NONE, "50")}, PERCENT)\n`,
  robot_motor_stop: (b) => `${motor(b)}.stop()\n`,
  robot_motor_set_velocity: (b, g) => `${motor(b)}.set_velocity(${val(b, g, "VELOCITY", Order.NONE, "50")}, PERCENT)\n`,
  robot_motor_velocity: (b) => [`${motor(b)}.velocity(PERCENT)`, Order.FUNCTION_CALL],
  // controller
  robot_controller_axis: (b) => {
    const a = f(b, "AXIS");
    return [`controller.${(AXIS_NAMES as string[]).includes(a) ? a : "axis3"}.position()`, Order.FUNCTION_CALL];
  },
  robot_controller_button: (b) => {
    const n = f(b, "BUTTON");
    return [`controller.${(BUTTON_NAMES as string[]).includes(n) ? n : "buttonA"}.pressing()`, Order.FUNCTION_CALL];
  },
  // sensing
  robot_distance: (b) => [`distance.get_distance(${f(b, "UNITS")})`, Order.FUNCTION_CALL],
  robot_distance_found: () => ["distance.found_object()", Order.FUNCTION_CALL],
  robot_front_near: () => ["front_eye.near_object()", Order.FUNCTION_CALL],
  robot_eye_detect: (b) => [`${eye(b)}.detect(${f(b, "COLOR")})`, Order.FUNCTION_CALL],
  robot_eye_color: (b) => [`${eye(b)}.color()`, Order.FUNCTION_CALL],
  robot_eye_brightness: (b) => [`${eye(b)}.brightness(PERCENT)`, Order.FUNCTION_CALL],
  robot_color_value: (b) => [f(b, "COLOR"), Order.ATOMIC],
  robot_bumper: () => ["bumper.pressed()", Order.FUNCTION_CALL],
  robot_position: (b) => [`location.position(${f(b, "AXIS") === "Y" ? "Y" : "X"}, MM)`, Order.FUNCTION_CALL],
  robot_timer: (b) => [`brain.timer.time(${f(b, "UNITS")})`, Order.FUNCTION_CALL],
  robot_reset_timer: () => "brain.timer.clear()\n",
  // pen / magnet
  robot_pen_move: (b) => `pen.move(${f(b, "POS")})\n`,
  robot_pen_color: (b) => `pen.set_pen_color(${f(b, "COLOR")})\n`,
  robot_magnet: (b) => `magnet.energize(${f(b, "MODE")})\n`,
  // arm
  robot_arm_spin_to: (b, g) => `arm.spin_to_position(${val(b, g, "ANGLE", Order.NONE, "0")}, DEGREES${waitArg(b)})\n`,
  robot_arm_spin: (b) => `arm.spin(${f(b, "DIR") === "DOWN" ? "DOWN" : "UP"})\n`,
  robot_arm_stop: () => "arm.stop()\n",
  robot_arm_set_velocity: (b, g) => `arm.set_velocity(${val(b, g, "VALUE", Order.NONE, "50")}, PERCENT)\n`,
  robot_arm_position: () => ["arm.position(DEGREES)", Order.FUNCTION_CALL],
  robot_claw: (b) => `claw.${f(b, "ACTION") === "open" ? "open" : "close"}()\n`,
  robot_claw_holding: () => ["claw.is_holding()", Order.FUNCTION_CALL],
  // looks
  robot_screen_print: (b, g) => `brain.screen.print(${val(b, g, "VALUE", Order.NONE, "''")})\n`,
  robot_screen_newline: () => "brain.screen.new_line()\n",
  robot_screen_clear: () => "brain.screen.clear_screen()\n",
  robot_print_log: (b, g) => `print(${val(b, g, "VALUE", Order.NONE, "''")})\n`,
  // control
  robot_wait: (b, g) => `wait(${val(b, g, "TIME", Order.NONE, "0")}, ${f(b, "UNITS")})\n`,
  robot_repeat: (b, g) => {
    const raw = val(b, g, "TIMES", Order.NONE, "0");
    const times = /^\d+$/.test(raw) ? raw : `int(${raw})`;
    const v = g.nameDB_!.getDistinctName("count", Blockly.Names.NameType.VARIABLE);
    return `for ${v} in range(${times}):\n${body(b, g, "DO")}`;
  },
  robot_forever: (b, g) => `while True:\n${body(b, g, "DO")}`,
  robot_if: (b, g) => `if ${val(b, g, "COND", Order.NONE, "False")}:\n${body(b, g, "DO")}`,
  robot_if_else: (b, g) =>
    `if ${val(b, g, "COND", Order.NONE, "False")}:\n${body(b, g, "DO")}else:\n${body(b, g, "ELSE")}`,
  robot_wait_until: (b, g) =>
    `while not ${notArg(b, g)}:\n${INDENT}wait(5, MSEC)\n`,
  robot_repeat_until: (b, g) => `while not ${notArg(b, g)}:\n${body(b, g, "DO")}`,
  robot_break: () => "break\n",
  // built-in overrides: keep imports to math/random only
  math_change: (b, g) => {
    const v = g.getVariableName(b.getFieldValue("VAR"));
    return `${v} = ${v} + ${val(b, g, "DELTA", Order.ADDITIVE, "0")}\n`;
  },
};
/** Condition for `while not ...`: parenthesised unless it's a bare name or a single call (readability). */
function notArg(b: Blockly.Block, g: G): string {
  const c = val(b, g, "COND", Order.NONE, "False");
  return /^[\w.]+(\([^()]*\))?$/.test(c) ? c : `(${c})`;
}
function motor(b: Blockly.Block) {
  return f(b, "MOTOR") === "right_motor" ? "right_motor" : "left_motor";
}
function dirFR(b: Blockly.Block) {
  return f(b, "DIR") === "REVERSE" ? "REVERSE" : "FORWARD";
}
function eye(b: Blockly.Block) {
  return f(b, "EYE") === "down_eye" ? "down_eye" : "front_eye";
}

let generator: RobotPythonGenerator | null = null;
function getGenerator(): RobotPythonGenerator {
  if (!generator) {
    generator = new RobotPythonGenerator();
    for (const [k, fn] of Object.entries(gens)) {
      (generator.forBlock as Record<string, unknown>)[k] = fn;
    }
  }
  return generator;
}

export interface GeneratedProgram {
  code: string;
  /** lineMap[i] = id of the block that produced line i+1 (null for scaffolding). */
  lineMap: (string | null)[];
}

const ALLOWED_IMPORTS = new Set(["import math", "import random"]);

export function generateProgram(ws: Blockly.Workspace): GeneratedProgram {
  const g = getGenerator();
  g.init(ws);
  const tops = ws.getTopBlocks(true);
  const hat = tops.find((b) => b.type === HAT_TYPE) ?? null;
  // match: "when autonomous" / "when driver control" hats switch to the competition program shape
  const autoHat = tops.find((b) => b.type === AUTO_HAT_TYPE && b.isEnabled()) ?? null;
  const driverHat = tops.find((b) => b.type === DRIVER_HAT_TYPE && b.isEnabled()) ?? null;
  const competition = !!(autoHat || driverHat);
  for (const b of tops) {
    if (PROC_DEFS.has(b.type) && b.isEnabled()) g.blockToCode(b);
  }
  const mainBody = hat ? g.statementToCode(hat, "DO") : "";
  const autoBody = autoHat ? g.statementToCode(autoHat, "DO") : "";
  const driverBody = driverHat ? g.statementToCode(driverHat, "DO") : "";
  const defs = g.takeDefinitions();
  const varNames = Blockly.Variables.allUsedVarModels(ws).map((v) => g.getVariableName(v.getId()));
  g.finish("");

  const imports = Object.values(defs).filter((d) => ALLOWED_IMPORTS.has(d.trim())).map((d) => d.trim());
  const funcs = Object.keys(defs).filter((k) => k.startsWith("%")).sort().map((k) => defs[k]);

  const parts: string[] = [];
  if (imports.length) parts.push([...new Set(imports)].sort().join("\n"));
  if (varNames.length) parts.push(varNames.map((n) => `${n} = 0`).join("\n"));
  for (const fn of funcs) parts.push(`${M}${M}\n` + fn.replace(/\n+$/, ""));
  if (competition) {
    // match: the "when started" blocks (if any) run first as setup, then competition(...)
    const fnDef = (name: string, id: string | null, bodyCode: string) => {
      let d = `${M}${id ?? ""}${M}\ndef ${name}():\n`;
      if (varNames.length) d += `${INDENT}global ${varNames.join(", ")}\n`;
      return (d + (bodyCode || `${INDENT}pass\n`)).replace(/\n+$/, "");
    };
    if (mainBody) parts.push(fnDef("main", null, mainBody));
    parts.push(fnDef("autonomous", autoHat?.id ?? null, autoBody));
    parts.push(fnDef("driver_control", driverHat?.id ?? null, driverBody));
    const tail = (mainBody ? `${M}${M}\nmain()\n` : `${M}${M}\n`) + "competition(autonomous, driver_control)\n";
    return stripMarkers(parts.join("\n\n") + "\n\n" + tail);
  }
  let main = `${M}${M}\ndef main():\n`;
  if (varNames.length) main += `${INDENT}global ${varNames.join(", ")}\n`;
  main += mainBody || `${INDENT}pass\n`;
  parts.push(main.replace(/\n+$/, ""));
  const raw = parts.join("\n\n") + `\n\n${M}${M}\nstart(main)\n`;
  return stripMarkers(raw);
}

function stripMarkers(raw: string): GeneratedProgram {
  const lines = raw.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const out: string[] = [];
  const map: (string | null)[] = [];
  const stack: { indent: number; id: string | null }[] = [];
  const re = new RegExp(`^( *)${M}([^${M}]*)${M}$`);
  for (const line of lines) {
    const m = re.exec(line);
    if (m) {
      const ind = m[1].length;
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      stack.push({ indent: ind, id: m[2] || null });
      continue;
    }
    if (line.trim() !== "") {
      const ind = line.length - line.trimStart().length;
      while (stack.length && stack[stack.length - 1].indent > ind) stack.pop();
    }
    out.push(line);
    map.push(stack.length ? stack[stack.length - 1].id : null);
  }
  // Blank lines are scaffolding.
  for (let i = 0; i < out.length; i++) if (out[i].trim() === "") map[i] = null;
  return { code: out.join("\n") + "\n", lineMap: map };
}
