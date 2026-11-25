// Custom Robot Lab block definitions (Blockly JSON format).
// Every custom block's Python is defined in ./generator.ts and must match docs/API.md.
import * as Blockly from "blockly";

export const HAT_TYPE = "robot_when_started";
/** match: the two competition hats. With either on the workspace the program ends in
 *  competition(autonomous, driver_control) instead of start(main). */
export const AUTO_HAT_TYPE = "robot_when_autonomous";
export const DRIVER_HAT_TYPE = "robot_when_driver_control";

type Opt = [string, string];
const DIR_FR: Opt[] = [["forward", "FORWARD"], ["reverse", "REVERSE"]];
const DIR_LR: Opt[] = [["right", "RIGHT"], ["left", "LEFT"]];
const DIST_UNITS: Opt[] = [["mm", "MM"], ["inches", "INCHES"]];
const TIME_UNITS: Opt[] = [["seconds", "SECONDS"], ["msec", "MSEC"]];
const EYES: Opt[] = [["front", "front_eye"], ["down", "down_eye"]];
export const COLOURS: Opt[] = [
  ["red", "RED"], ["green", "GREEN"], ["blue", "BLUE"], ["yellow", "YELLOW"], ["orange", "ORANGE"],
  ["purple", "PURPLE"], ["white", "WHITE"], ["black", "BLACK"], ["none", "NONE"],
];
const PEN_COLOURS: Opt[] = COLOURS.filter(([, v]) => v !== "NONE");
const MOTORS: Opt[] = [["left", "left_motor"], ["right", "right_motor"]];
/** Controller sticks, labelled for people (the Python name is in brackets). Values are AxisName. */
export const AXIS_OPTIONS: Opt[] = [
  ["left stick up/down (axis3)", "axis3"],
  ["left stick left/right (axis4)", "axis4"],
  ["right stick up/down (axis2)", "axis2"],
  ["right stick left/right (axis1)", "axis1"],
];
/** Controller buttons, labelled for people. Values are ButtonName. */
export const BUTTON_OPTIONS: Opt[] = [
  ["A", "buttonA"], ["B", "buttonB"], ["X", "buttonX"], ["Y", "buttonY"],
  ["L1 (top left)", "buttonL1"], ["L2 (bottom left)", "buttonL2"],
  ["R1 (top right)", "buttonR1"], ["R2 (bottom right)", "buttonR2"],
  ["up arrow", "buttonUp"], ["down arrow", "buttonDown"], ["left arrow", "buttonLeft"], ["right arrow", "buttonRight"],
];

const dd = (name: string, options: Opt[]) => ({ type: "field_dropdown", name, options });
const num = (name: string) => ({ type: "input_value", name, check: "Number" });
const bool = (name: string) => ({ type: "input_value", name, check: "Boolean" });
const any = (name: string) => ({ type: "input_value", name });
const stmt = (name: string) => ({ type: "input_statement", name });
const waitBox = { type: "field_checkbox", name: "WAIT", checked: true };

const STMT = { previousStatement: null, nextStatement: null, inputsInline: true };
const NUM_OUT = { output: "Number" };
const BOOL_OUT = { output: "Boolean" };

export const BLOCK_DEFS: Record<string, unknown>[] = [
  // ------------------------------------------------------------ start
  {
    type: HAT_TYPE, message0: "when started %1 %2",
    args0: [{ type: "input_dummy" }, stmt("DO")],
    style: "rl_start", tooltip: "Your program starts here. Snap blocks underneath.",
  },
  // match: competition program shape
  {
    type: AUTO_HAT_TYPE, message0: "when autonomous %1 %2",
    args0: [{ type: "input_dummy" }, stmt("DO")],
    style: "rl_start", tooltip: "Match: the robot drives itself here during the autonomous period. Then 'when driver control' starts.",
  },
  {
    type: DRIVER_HAT_TYPE, message0: "when driver control %1 %2",
    args0: [{ type: "input_dummy" }, stmt("DO")],
    style: "rl_start", tooltip: "Match: runs after autonomous. Read the controller here (usually inside a forever loop).",
  },
  // ------------------------------------------------------------ drivetrain
  { type: "robot_drive_for", message0: "drive %1 for %2 %3 %4 wait", args0: [dd("DIR", DIR_FR), num("DIST"), dd("UNITS", DIST_UNITS), waitBox], ...STMT, style: "rl_drive", tooltip: "Drive a set distance. Untick 'wait' to keep going with the next block straight away." },
  { type: "robot_turn_for", message0: "turn %1 for %2 degrees %3 wait", args0: [dd("DIR", DIR_LR), num("ANGLE"), waitBox], ...STMT, style: "rl_drive", tooltip: "Turn on the spot by an angle." },
  { type: "robot_turn_to_heading", message0: "turn to heading %1 degrees %2 wait", args0: [num("ANGLE"), waitBox], ...STMT, style: "rl_drive", tooltip: "Turn the shortest way to face a compass heading (0 = where you started)." },
  { type: "robot_drive", message0: "drive %1", args0: [dd("DIR", DIR_FR)], ...STMT, style: "rl_drive", tooltip: "Start driving and keep going until stopped." },
  { type: "robot_turn", message0: "turn %1", args0: [dd("DIR", DIR_LR)], ...STMT, style: "rl_drive", tooltip: "Start turning and keep going until stopped." },
  { type: "robot_stop", message0: "stop driving", ...STMT, style: "rl_drive", tooltip: "Stop all motion." },
  { type: "robot_set_velocity", message0: "set %1 velocity to %2 %%", args0: [dd("KIND", [["drive", "drive"], ["turn", "turn"]]), num("VALUE")], ...STMT, style: "rl_drive", tooltip: "Speed from 1 to 100 percent (50 to start with)." },
  { type: "robot_set_heading", message0: "set heading to %1 degrees", args0: [num("ANGLE")], ...STMT, style: "rl_drive", tooltip: "Tell the robot which way it is facing now." },
  { type: "robot_heading", message0: "heading in degrees", ...NUM_OUT, style: "rl_drive", tooltip: "Compass heading, 0 to 359." },
  { type: "robot_rotation", message0: "rotation in degrees", ...NUM_OUT, style: "rl_drive", tooltip: "Total amount turned (can go past 360 or below 0)." },
  { type: "robot_is_done", message0: "drive is done?", ...BOOL_OUT, style: "rl_drive", tooltip: "True when the robot has finished moving." },
  // ------------------------------------------------------------ motors (driver control; Drivetrain category)
  { type: "robot_motor_spin", message0: "spin %1 motor %2 at %3 %%", args0: [dd("MOTOR", MOTORS), dd("DIR", DIR_FR), num("VELOCITY")], ...STMT, style: "rl_drive", tooltip: "Spin one wheel's motor and keep it spinning. -100 to 100 percent (a negative number spins it backwards)." },
  { type: "robot_motor_stop", message0: "stop %1 motor", args0: [dd("MOTOR", MOTORS)], ...STMT, style: "rl_drive", tooltip: "Stop one wheel's motor." },
  { type: "robot_motor_set_velocity", message0: "set %1 motor velocity to %2 %%", args0: [dd("MOTOR", MOTORS), num("VELOCITY")], ...STMT, style: "rl_drive", tooltip: "Set the speed a motor will spin at (50 to start with)." },
  { type: "robot_motor_velocity", message0: "%1 motor velocity in %%", args0: [dd("MOTOR", MOTORS)], ...NUM_OUT, style: "rl_drive", tooltip: "The speed this motor was last told to spin at." },
  // ------------------------------------------------------------ controller (driver control)
  { type: "robot_controller_axis", message0: "controller %1 position", args0: [dd("AXIS", AXIS_OPTIONS)], ...NUM_OUT, style: "rl_controller", tooltip: "Where a joystick is pushed: -100 (down or left) to 100 (up or right). 0 in the middle." },
  { type: "robot_controller_button", message0: "controller button %1 pressed?", args0: [dd("BUTTON", BUTTON_OPTIONS)], ...BOOL_OUT, style: "rl_controller", tooltip: "True while that controller button is held down." },
  // ------------------------------------------------------------ sensing
  { type: "robot_distance", message0: "distance in %1", args0: [dd("UNITS", DIST_UNITS)], ...NUM_OUT, style: "rl_sensing", tooltip: "Distance to the nearest thing ahead (3000 mm if nothing)." },
  { type: "robot_distance_found", message0: "distance sensor found object?", ...BOOL_OUT, style: "rl_sensing", tooltip: "True if something is within 1000 mm ahead." },
  { type: "robot_front_near", message0: "front eye near object?", ...BOOL_OUT, style: "rl_sensing", tooltip: "True if something is within 100 mm ahead." },
  { type: "robot_eye_detect", message0: "%1 eye detects %2 ?", args0: [dd("EYE", EYES), dd("COLOR", COLOURS)], ...BOOL_OUT, style: "rl_sensing", tooltip: "True if the eye sees that colour." },
  { type: "robot_eye_color", message0: "%1 eye colour", args0: [dd("EYE", EYES)], output: "String", style: "rl_sensing", tooltip: "The colour the eye sees. Compare it with a colour block." },
  { type: "robot_eye_brightness", message0: "%1 eye brightness in %%", args0: [dd("EYE", EYES)], ...NUM_OUT, style: "rl_sensing", tooltip: "Brightness from 0 to 100." },
  { type: "robot_color_value", message0: "%1", args0: [dd("COLOR", COLOURS)], output: "String", style: "rl_sensing", tooltip: "A colour, to compare with an eye's colour." },
  { type: "robot_bumper", message0: "bumper pressed?", ...BOOL_OUT, style: "rl_sensing", tooltip: "True while the bumper is touching something." },
  { type: "robot_position", message0: "position %1 in mm", args0: [dd("AXIS", [["X", "X"], ["Y", "Y"]])], ...NUM_OUT, style: "rl_sensing", tooltip: "Where the robot is on the playground." },
  { type: "robot_timer", message0: "timer in %1", args0: [dd("UNITS", TIME_UNITS)], ...NUM_OUT, style: "rl_sensing", tooltip: "Time since the start (or the last reset)." },
  { type: "robot_reset_timer", message0: "reset timer", ...STMT, style: "rl_sensing", tooltip: "Set the timer back to 0." },
  // ------------------------------------------------------------ pen
  { type: "robot_pen_move", message0: "move pen %1", args0: [dd("POS", [["down", "DOWN"], ["up", "UP"]])], ...STMT, style: "rl_pen", tooltip: "Pen down draws a line as the robot drives." },
  { type: "robot_pen_color", message0: "set pen colour to %1", args0: [dd("COLOR", PEN_COLOURS)], ...STMT, style: "rl_pen", tooltip: "Change the pen's colour." },
  // ------------------------------------------------------------ magnet
  { type: "robot_magnet", message0: "magnet %1", args0: [dd("MODE", [["pick up", "BOOST"], ["drop", "DROP"]])], ...STMT, style: "rl_magnet", tooltip: "Pick up the object just in front, or drop it." },
  // ------------------------------------------------------------ arm (only in worlds with an arm)
  { type: "robot_arm_spin_to", message0: "spin arm to %1 degrees %2 wait", args0: [num("ANGLE"), waitBox], ...STMT, style: "rl_arm", tooltip: "Move the arm to an angle: 0 = down (claw at the floor), 90 = straight up. Stops early if it lands on something." },
  { type: "robot_arm_spin", message0: "move arm %1", args0: [dd("DIR", [["up", "UP"], ["down", "DOWN"]])], ...STMT, style: "rl_arm", tooltip: "Keep the arm moving until 'stop arm' (it stops by itself at the top and bottom)." },
  { type: "robot_arm_stop", message0: "stop arm", ...STMT, style: "rl_arm", tooltip: "Stop the arm where it is." },
  { type: "robot_arm_set_velocity", message0: "set arm velocity to %1 %%", args0: [num("VALUE")], ...STMT, style: "rl_arm", tooltip: "Arm speed from 1 to 100 percent (50 to start with)." },
  { type: "robot_arm_position", message0: "arm position in degrees", ...NUM_OUT, style: "rl_arm", tooltip: "The arm's angle: 0 (down) to 90 (up)." },
  { type: "robot_claw", message0: "%1 claw", args0: [dd("ACTION", [["close", "close"], ["open", "open"]])], ...STMT, style: "rl_arm", tooltip: "Close the claw to grab the object in front of it (at the claw's height), or open it to let go." },
  { type: "robot_claw_holding", message0: "claw holding?", ...BOOL_OUT, style: "rl_arm", tooltip: "True while the claw is holding something." },
  // ------------------------------------------------------------ looks
  { type: "robot_screen_print", message0: "print %1 on screen", args0: [any("VALUE")], ...STMT, style: "rl_looks", tooltip: "Show text or a number on the robot's screen." },
  { type: "robot_screen_newline", message0: "screen new line", ...STMT, style: "rl_looks", tooltip: "Move to the next line on the screen." },
  { type: "robot_screen_clear", message0: "clear screen", ...STMT, style: "rl_looks", tooltip: "Wipe the robot's screen." },
  { type: "robot_print_log", message0: "print %1 to log", args0: [any("VALUE")], ...STMT, style: "rl_looks", tooltip: "Write to the step log." },
  // ------------------------------------------------------------ control
  { type: "robot_wait", message0: "wait %1 %2", args0: [num("TIME"), dd("UNITS", TIME_UNITS)], ...STMT, style: "rl_control", tooltip: "Pause before the next block." },
  { type: "robot_repeat", message0: "repeat %1 times %2 %3", args0: [num("TIMES"), { type: "input_dummy" }, stmt("DO")], previousStatement: null, nextStatement: null, style: "rl_control", tooltip: "Run the blocks inside a number of times." },
  { type: "robot_forever", message0: "forever %1 %2", args0: [{ type: "input_dummy" }, stmt("DO")], previousStatement: null, style: "rl_control", tooltip: "Run the blocks inside again and again." },
  { type: "robot_if", message0: "if %1 then %2 %3", args0: [bool("COND"), { type: "input_dummy" }, stmt("DO")], previousStatement: null, nextStatement: null, style: "rl_control", tooltip: "Run the blocks inside only if the condition is true." },
  { type: "robot_if_else", message0: "if %1 then %2 %3 else %4 %5", args0: [bool("COND"), { type: "input_dummy" }, stmt("DO"), { type: "input_dummy" }, stmt("ELSE")], previousStatement: null, nextStatement: null, style: "rl_control", tooltip: "Run one group of blocks or the other." },
  { type: "robot_wait_until", message0: "wait until %1", args0: [bool("COND")], ...STMT, style: "rl_control", tooltip: "Pause until the condition becomes true." },
  { type: "robot_repeat_until", message0: "repeat until %1 %2 %3", args0: [bool("COND"), { type: "input_dummy" }, stmt("DO")], previousStatement: null, nextStatement: null, style: "rl_control", tooltip: "Keep running the blocks inside until the condition is true." },
  { type: "robot_break", message0: "break out of loop", previousStatement: null, style: "rl_control", tooltip: "Leave the loop this block is in." },
];

export const CUSTOM_TYPES = BLOCK_DEFS.map((d) => d.type as string);

let registered = false;
/** Registers all custom blocks with Blockly. Safe to call many times. */
export function registerBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFS.filter((d) => d.type !== HAT_TYPE));
  // Number and text values get a neutral look, so they read as "slots" in any block.
  for (const t of ["math_number", "text"]) {
    const base = Blockly.Blocks[t];
    if (!base || (base as { __rl?: boolean }).__rl) continue;
    const init = base.init;
    Blockly.Blocks[t] = { ...base, __rl: true, init(this: Blockly.Block) { init.call(this); this.setStyle("rl_value"); } };
  }
  const hatJson = BLOCK_DEFS.find((d) => d.type === HAT_TYPE)!;
  Blockly.Blocks[HAT_TYPE] = {
    init(this: Blockly.Block) {
      this.jsonInit(hatJson);
      this.setDeletable(false);
    },
  };
}
