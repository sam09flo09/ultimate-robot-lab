/**
 * debugger: one source of student-facing API docs for editor autocomplete and hover help.
 * Written from docs/API.md and checked against src/runtime/names.ts (see apiDocs.test.ts):
 * every object, method, top-level function and constant the runtime installs has an entry here.
 */
import { CONSTANTS, DIRECTION_CONSTS, UNIT_CONSTS, COLOR_CONSTS, CONTROLLER_AXES, CONTROLLER_BUTTONS } from "../runtime/names";

export interface ApiDoc {
  /** How it's written: "drivetrain.drive_for", "wait", "FORWARD". */
  name: string;
  /** Argument list shown in hints, e.g. "(direction, distance, units, wait=True)". Empty for objects/constants. */
  signature: string;
  /** One student-friendly line. */
  description: string;
  /** A tiny example. */
  example: string;
  /** What it gives back (shown as "→ float"), if anything useful. */
  returns?: string;
  kind: "object" | "method" | "function" | "constant";
}

const m = (name: string, signature: string, description: string, example: string, returns?: string): ApiDoc =>
  ({ name, signature, description, example, returns, kind: "method" });

const AXIS_TEXT: Record<string, string> = {
  axis1: "Right stick, left/right (right is positive)",
  axis2: "Right stick, up/down (up is positive)",
  axis3: "Left stick, up/down (up is positive)",
  axis4: "Left stick, left/right (right is positive)",
};
const AXIS_EXAMPLE: Record<string, string> = {
  axis1: "turn = controller.axis1.position()",
  axis2: "right = controller.axis2.position()",
  axis3: "speed = controller.axis3.position()",
  axis4: "side = controller.axis4.position()",
};

function motorDocs(name: "left_motor" | "right_motor"): ApiDoc[] {
  const axis = name === "left_motor" ? "axis3" : "axis2";
  return [
    m(name + ".spin", "(direction, velocity, units)", "Keep the wheel turning, FORWARD or REVERSE, at -100 to 100 PERCENT (no velocity = the set_velocity speed). A drivetrain command stops it.",
      `for i in range(3):\n    ${name}.spin(FORWARD, controller.${axis}.position(), PERCENT)\n    wait(20, MSEC)`),
    m(name + ".stop", "()", "Stop this wheel.", `${name}.stop()`),
    m(name + ".set_velocity", "(velocity, units)", "Speed for spin(FORWARD) without a velocity, -100 to 100 PERCENT (starts at 50).", `${name}.set_velocity(75, PERCENT)\n${name}.spin(FORWARD)\n${name}.stop()`),
    m(name + ".velocity", "(units)", "The velocity this motor was last told, in PERCENT.", `v = ${name}.velocity(PERCENT)`, "int"),
  ];
}

export const OBJECT_DOCS: ApiDoc[] = [
  { name: "drivetrain", kind: "object", signature: "", description: "The robot's wheels: drive, turn and read the gyro.", example: "drivetrain.drive_for(FORWARD, 200, MM)" },
  { name: "distance", kind: "object", signature: "", description: "Distance sensor on the front of the robot.", example: "distance.get_distance(MM)" },
  { name: "front_eye", kind: "object", signature: "", description: "Colour sensor looking ahead.", example: "front_eye.detect(RED)" },
  { name: "down_eye", kind: "object", signature: "", description: "Colour sensor looking at the floor under the robot.", example: "down_eye.detect(BLACK)" },
  { name: "bumper", kind: "object", signature: "", description: "Bumper switch on the front of the robot.", example: "bumper.pressed()" },
  { name: "location", kind: "object", signature: "", description: "Where the robot is on the field.", example: "location.position(X, MM)" },
  { name: "pen", kind: "object", signature: "", description: "Draws a line where the robot drives (only in playgrounds with a pen).", example: "pen.move(DOWN)" },
  { name: "magnet", kind: "object", signature: "", description: "Picks up and drops objects (only in playgrounds with a magnet).", example: "magnet.energize(BOOST)" },
  { name: "brain", kind: "object", signature: "", description: "The robot's brain: its screen and timer.", example: "brain.screen.print(\"Hello\")" },
  { name: "brain.screen", kind: "object", signature: "", description: "Text on the Screen tab.", example: "brain.screen.print(\"Hello\")" },
  { name: "brain.timer", kind: "object", signature: "", description: "A stopwatch that counts robot time.", example: "brain.timer.time(SECONDS)" },
  // driver control
  { name: "controller", kind: "object", signature: "", description: "The driver's controller: two sticks (axis1 to axis4) and 12 buttons. Keyboard, gamepad or on-screen.", example: "controller.axis3.position()" },
  ...CONTROLLER_AXES.map((a): ApiDoc => ({ name: "controller." + a, kind: "object", signature: "", description: AXIS_TEXT[a] + ", -100 to 100.", example: `controller.${a}.position()` })),
  ...CONTROLLER_BUTTONS.map((b): ApiDoc => ({ name: "controller." + b, kind: "object", signature: "", description: `The ${b.slice(6)} button on the controller.`, example: `controller.${b}.pressing()` })),
  { name: "left_motor", kind: "object", signature: "", description: "The left wheel's motor, for driver control.", example: "left_motor.spin(FORWARD, 50, PERCENT)" },
  { name: "right_motor", kind: "object", signature: "", description: "The right wheel's motor, for driver control.", example: "right_motor.spin(FORWARD, 50, PERCENT)" },
];

export const METHOD_DOCS: ApiDoc[] = [
  m("drivetrain.drive_for", "(direction, distance, units, wait=True)", "Drive straight a set distance. FORWARD or REVERSE; MM or INCHES.", "drivetrain.drive_for(FORWARD, 200, MM)"),
  m("drivetrain.turn_for", "(direction, angle, units, wait=True)", "Turn on the spot. LEFT or RIGHT, in DEGREES.", "drivetrain.turn_for(RIGHT, 90, DEGREES)"),
  m("drivetrain.turn_to_heading", "(angle, units, wait=True)", "Turn the shortest way to face a heading (0 = up, 90 = right).", "drivetrain.turn_to_heading(180, DEGREES)"),
  m("drivetrain.drive", "(direction)", "Start driving and keep going until stop() or another motion.", "drivetrain.drive(FORWARD)"),
  m("drivetrain.turn", "(direction)", "Start turning and keep going until stop().", "drivetrain.turn(LEFT)"),
  m("drivetrain.stop", "()", "Stop all motion.", "drivetrain.stop()"),
  m("drivetrain.set_drive_velocity", "(velocity, units)", "Driving speed, 1 to 100 PERCENT (starts at 50).", "drivetrain.set_drive_velocity(75, PERCENT)"),
  m("drivetrain.set_turn_velocity", "(velocity, units)", "Turning speed, 1 to 100 PERCENT (starts at 50).", "drivetrain.set_turn_velocity(30, PERCENT)"),
  m("drivetrain.set_heading", "(angle, units)", "Tell the gyro which way the robot faces now.", "drivetrain.set_heading(0, DEGREES)"),
  m("drivetrain.heading", "(units)", "Which way the robot faces, 0 to 360 degrees.", "h = drivetrain.heading(DEGREES)", "float"),
  m("drivetrain.rotation", "(units)", "Total turning so far (can go past 360).", "r = drivetrain.rotation(DEGREES)", "float"),
  m("drivetrain.is_done", "()", "True when the robot isn't moving.", "while not drivetrain.is_done():\n    wait(10, MSEC)", "bool"),
  m("distance.get_distance", "(units)", "How far away the thing ahead is (3000 mm if nothing).", "d = distance.get_distance(MM)", "float"),
  m("distance.found_object", "()", "True if something is within 1000 mm ahead.", "if distance.found_object():\n    drivetrain.stop()", "bool"),
  m("front_eye.near_object", "()", "True if an object is within 100 mm ahead.", "if front_eye.near_object():\n    drivetrain.stop()", "bool"),
  m("front_eye.detect", "(color)", "True if the object ahead is this colour.", "if front_eye.detect(RED):\n    print(\"red!\")", "bool"),
  m("front_eye.color", "()", "The colour ahead, like RED. Compare it with ==.", "if front_eye.color() == GREEN:\n    print(\"go\")", "colour"),
  m("front_eye.brightness", "(units)", "How bright it is ahead, 0 to 100 PERCENT.", "b = front_eye.brightness(PERCENT)", "int"),
  m("down_eye.detect", "(color)", "True if the floor under the robot is this colour.", "while not down_eye.detect(BLACK):\n    wait(10, MSEC)", "bool"),
  m("down_eye.color", "()", "The floor colour under the robot, like BLACK.", "c = down_eye.color()", "colour"),
  m("down_eye.brightness", "(units)", "How bright the floor is, 0 to 100 PERCENT.", "b = down_eye.brightness(PERCENT)", "int"),
  m("bumper.pressed", "()", "True while the bumper touches something.", "while not bumper.pressed():\n    wait(10, MSEC)", "bool"),
  m("location.position", "(axis, units)", "The robot's x or y position. Use X or Y, then MM.", "x = location.position(X, MM)", "float"),
  m("pen.move", "(direction)", "DOWN starts drawing, UP stops.", "pen.move(DOWN)"),
  m("pen.set_pen_color", "(color)", "Change the ink colour.", "pen.set_pen_color(BLUE)"),
  m("magnet.energize", "(mode)", "BOOST picks up the object just in front; DROP lets go.", "magnet.energize(BOOST)"),
  m("brain.screen.print", "(value, ...)", "Show text on the Screen tab.", "brain.screen.print(\"Distance:\", d)"),
  m("brain.screen.new_line", "()", "Move to the next line on the screen.", "brain.screen.new_line()"),
  m("brain.screen.clear_screen", "()", "Clear the screen.", "brain.screen.clear_screen()"),
  m("brain.timer.time", "(units)", "Robot time since the start (or the last clear), in SECONDS or MSEC.", "t = brain.timer.time(SECONDS)", "float"),
  m("brain.timer.clear", "()", "Restart the timer from 0.", "brain.timer.clear()"),
  // driver control
  ...CONTROLLER_AXES.map((a) => m(`controller.${a}.position`, "(units=PERCENT)", AXIS_TEXT[a] + ": a whole number from -100 to 100 (0 = stick in the middle).", AXIS_EXAMPLE[a], "int")),
  ...CONTROLLER_BUTTONS.map((b) => m(`controller.${b}.pressing`, "()", `True while the ${b.slice(6)} button is held down.`, `if controller.${b}.pressing():\n    print("${b.slice(6)}")`, "bool")),
  ...motorDocs("left_motor"),
  ...motorDocs("right_motor"),
];

export const FUNCTION_DOCS: ApiDoc[] = [
  { name: "wait", kind: "function", signature: "(time, units=SECONDS)", description: "Do nothing for a while. SECONDS or MSEC.", example: "wait(1, SECONDS)" },
  { name: "start", kind: "function", signature: "(function)", description: "Runs your program. Last line, not indented, no () after main.", example: "start(main)" },
  { name: "print", kind: "function", signature: "(value, ...)", description: "Write in the Steps log.", example: "print(\"x is\", x)" },
];

const CONST_GROUP: Record<string, string> = {};
for (const c of DIRECTION_CONSTS) CONST_GROUP[c] = "Direction";
for (const c of UNIT_CONSTS) CONST_GROUP[c] = "Unit";
for (const c of COLOR_CONSTS) CONST_GROUP[c] = "Colour";
const CONST_TEXT: Record<string, [string, string]> = {
  FORWARD: ["Drive forwards.", "drivetrain.drive_for(FORWARD, 200, MM)"],
  REVERSE: ["Drive backwards.", "drivetrain.drive_for(REVERSE, 200, MM)"],
  LEFT: ["Turn to the left (anticlockwise).", "drivetrain.turn_for(LEFT, 90, DEGREES)"],
  RIGHT: ["Turn to the right (clockwise).", "drivetrain.turn_for(RIGHT, 90, DEGREES)"],
  MM: ["Millimetres. 1 square on the number grid = 200 mm.", "drivetrain.drive_for(FORWARD, 200, MM)"],
  INCHES: ["Inches (1 inch = 25.4 mm).", "drivetrain.drive_for(FORWARD, 8, INCHES)"],
  DEGREES: ["Degrees for turning and headings.", "drivetrain.turn_for(RIGHT, 90, DEGREES)"],
  SECONDS: ["Seconds for wait() and the timer.", "wait(1, SECONDS)"],
  MSEC: ["Milliseconds (1000 MSEC = 1 second).", "wait(500, MSEC)"],
  PERCENT: ["Percent, 0 to 100 (speeds and brightness).", "drivetrain.set_drive_velocity(50, PERCENT)"],
  UP: ["Pen up: stop drawing.", "pen.move(UP)"],
  DOWN: ["Pen down: start drawing.", "pen.move(DOWN)"],
  BOOST: ["Magnet on: pick up the object in front.", "magnet.energize(BOOST)"],
  DROP: ["Magnet off: drop what it holds.", "magnet.energize(DROP)"],
  X: ["The x (left–right) axis for location.position.", "location.position(X, MM)"],
  Y: ["The y (down–up) axis for location.position.", "location.position(Y, MM)"],
  NONE: ["No colour (nothing seen).", "if front_eye.color() == NONE:\n    print(\"nothing\")"],
};

export const CONSTANT_DOCS: ApiDoc[] = CONSTANTS.map((c) => {
  const [d, ex] = CONST_TEXT[c] ?? [`The colour ${c.toLowerCase()}.`, `front_eye.detect(${c})`];
  return { name: c, kind: "constant", signature: "", description: (CONST_GROUP[c] ? CONST_GROUP[c] + ": " : "") + d, example: ex };
});

export const ALL_DOCS: ApiDoc[] = [...OBJECT_DOCS, ...METHOD_DOCS, ...FUNCTION_DOCS, ...CONSTANT_DOCS];

const BY_NAME = new Map(ALL_DOCS.map((d) => [d.name, d] as const));

/** Look up a doc by its full dotted name ("drivetrain.drive_for", "wait", "RED"). */
export function docFor(name: string): ApiDoc | undefined {
  return BY_NAME.get(name);
}

/** Members of an object path ("drivetrain", "brain", "brain.screen"): methods and sub-objects. */
export function membersOf(path: string): ApiDoc[] {
  const pre = path + ".";
  return ALL_DOCS.filter((d) => d.name.startsWith(pre) && !d.name.slice(pre.length).includes("."));
}

/** Python keywords and builtins offered as completions, with a short tip. */
export const KEYWORD_TIPS: { label: string; detail: string; snippet?: string }[] = [
  { label: "def", detail: "make a function", snippet: "def ${1:name}():\n    ${2:pass}" },
  { label: "for", detail: "repeat for each item", snippet: "for ${1:i} in range(${2:4}):\n    ${3:pass}" },
  { label: "while", detail: "repeat while something is true", snippet: "while ${1:True}:\n    ${2:pass}" },
  { label: "if", detail: "do something only when true", snippet: "if ${1:condition}:\n    ${2:pass}" },
  { label: "elif", detail: "else, if …" }, { label: "else", detail: "otherwise" },
  { label: "return", detail: "give a value back from a function" }, { label: "break", detail: "leave the loop" },
  { label: "continue", detail: "skip to the next loop pass" }, { label: "pass", detail: "do nothing" },
  { label: "import", detail: "import math or random" }, { label: "global", detail: "change a variable from outside the function" },
  { label: "and", detail: "both true" }, { label: "or", detail: "either true" }, { label: "not", detail: "the opposite" },
  { label: "in", detail: "is it in the list?" }, { label: "True", detail: "yes" }, { label: "False", detail: "no" },
  { label: "None", detail: "nothing" },
  { label: "range", detail: "range(4) counts 0, 1, 2, 3" }, { label: "len", detail: "how many items" },
  { label: "int", detail: "make a whole number" }, { label: "float", detail: "make a decimal number" },
  { label: "str", detail: "make text" }, { label: "abs", detail: "distance from 0" }, { label: "round", detail: "round a number" },
  { label: "min", detail: "smallest" }, { label: "max", detail: "biggest" }, { label: "sum", detail: "add them up" },
  { label: "main", detail: "your main function" },
];
