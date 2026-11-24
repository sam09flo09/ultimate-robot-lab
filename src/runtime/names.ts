/**
 * Every name the student API (docs/API.md) defines. Shared by the runtime (to install them)
 * and by friendly() (to suggest corrections for typos and wrong capitals).
 */

export const DIRECTION_CONSTS = ["FORWARD", "REVERSE", "LEFT", "RIGHT"] as const;
export const UNIT_CONSTS = ["MM", "INCHES", "DEGREES", "SECONDS", "MSEC", "PERCENT"] as const;
export const COLOR_CONSTS = ["RED", "GREEN", "BLUE", "YELLOW", "ORANGE", "PURPLE", "WHITE", "BLACK", "NONE"] as const;
export const OTHER_CONSTS = ["UP", "DOWN", "BOOST", "DROP", "X", "Y"] as const;

/** All constants. Each is a plain string equal to its own name. */
export const CONSTANTS: readonly string[] = [...DIRECTION_CONSTS, ...UNIT_CONSTS, ...COLOR_CONSTS, ...OTHER_CONSTS];

/** Driver control: the controller's axes and buttons (same order as core/modules AXIS_NAMES / BUTTON_NAMES). */
export const CONTROLLER_AXES = ["axis1", "axis2", "axis3", "axis4"] as const;
export const CONTROLLER_BUTTONS = [
  "buttonA", "buttonB", "buttonX", "buttonY", "buttonUp", "buttonDown", "buttonLeft", "buttonRight",
  "buttonL1", "buttonL2", "buttonR1", "buttonR2",
] as const;
/** Python class names of the controller parts: one class per axis/button so error messages can name it. */
export const axisClass = (a: string) => "ControllerAxis" + a.slice(4);
export const buttonClass = (b: string) => "Controller" + b[0].toUpperCase() + b.slice(1);
export const MOTOR_CLASSES = { left_motor: "LeftMotor", right_motor: "RightMotor" } as const;

export interface ApiObject {
  /** How students write it: "drivetrain", "brain.screen". */
  path: string;
  /** The Python class name (shows up in AttributeError / TypeError messages). */
  className: string;
  /** method name -> example call */
  methods: Record<string, string>;
  /** a sensible "use it like this" example */
  example: string;
}

export const API_OBJECTS: ApiObject[] = [
  {
    path: "drivetrain", className: "Drivetrain", example: "drivetrain.drive_for(FORWARD, 200, MM)",
    methods: {
      drive_for: "drivetrain.drive_for(FORWARD, 200, MM)",
      turn_for: "drivetrain.turn_for(RIGHT, 90, DEGREES)",
      turn_to_heading: "drivetrain.turn_to_heading(90, DEGREES)",
      drive: "drivetrain.drive(FORWARD)",
      turn: "drivetrain.turn(RIGHT)",
      stop: "drivetrain.stop()",
      set_drive_velocity: "drivetrain.set_drive_velocity(50, PERCENT)",
      set_turn_velocity: "drivetrain.set_turn_velocity(50, PERCENT)",
      set_heading: "drivetrain.set_heading(0, DEGREES)",
      heading: "drivetrain.heading(DEGREES)",
      rotation: "drivetrain.rotation(DEGREES)",
      is_done: "drivetrain.is_done()",
    },
  },
  {
    path: "distance", className: "DistanceSensor", example: "distance.get_distance(MM)",
    methods: { get_distance: "distance.get_distance(MM)", found_object: "distance.found_object()" },
  },
  {
    path: "front_eye", className: "FrontEye", example: "front_eye.detect(RED)",
    methods: {
      near_object: "front_eye.near_object()", detect: "front_eye.detect(RED)",
      color: "front_eye.color()", brightness: "front_eye.brightness(PERCENT)",
    },
  },
  {
    path: "down_eye", className: "DownEye", example: "down_eye.detect(BLACK)",
    methods: { detect: "down_eye.detect(BLACK)", color: "down_eye.color()", brightness: "down_eye.brightness(PERCENT)" },
  },
  { path: "bumper", className: "Bumper", example: "bumper.pressed()", methods: { pressed: "bumper.pressed()" } },
  { path: "location", className: "Location", example: "location.position(X, MM)", methods: { position: "location.position(X, MM)" } },
  {
    path: "pen", className: "Pen", example: "pen.move(DOWN)",
    methods: { move: "pen.move(DOWN)", set_pen_color: "pen.set_pen_color(RED)" },
  },
  { path: "magnet", className: "Magnet", example: "magnet.energize(BOOST)", methods: { energize: "magnet.energize(BOOST)" } },
  {
    path: "brain", className: "Brain", example: "brain.screen.print(\"Hello\")",
    methods: { screen: "brain.screen.print(\"Hello\")", timer: "brain.timer.time(SECONDS)" },
  },
  {
    path: "brain.screen", className: "Screen", example: "brain.screen.print(\"Hello\")",
    methods: {
      print: "brain.screen.print(\"Hello\")", new_line: "brain.screen.new_line()",
      clear_screen: "brain.screen.clear_screen()",
    },
  },
  {
    path: "brain.timer", className: "Timer", example: "brain.timer.time(SECONDS)",
    methods: { time: "brain.timer.time(SECONDS)", clear: "brain.timer.clear()" },
  },
  ...driverObjects(),
  // arm: arm and claw (only in playgrounds with an arm; listed after the motors so
  // "spin belongs to left_motor" hints keep pointing at the wheels)
  {
    path: "arm", className: "Arm", example: "arm.spin_to_position(45, DEGREES)",
    methods: {
      spin_to_position: "arm.spin_to_position(45, DEGREES)", spin: "arm.spin(UP)", stop: "arm.stop()",
      set_velocity: "arm.set_velocity(50, PERCENT)", position: "arm.position(DEGREES)",
    },
  },
  {
    path: "claw", className: "Claw", example: "claw.close()",
    methods: { close: "claw.close()", grab: "claw.grab()", open: "claw.open()", release: "claw.release()", is_holding: "claw.is_holding()" },
  },
];

/** Top-level names the runtime installs (besides constants). */
export const TOP_LEVEL = [
  "drivetrain", "distance", "front_eye", "down_eye", "bumper", "location", "pen", "magnet", "arm", "claw", "brain",
  "controller", "left_motor", "right_motor", "wait", "start", "print",
];

/** Python builtins/keywords students commonly use (for case hints and typo suggestions). */
export const PY_NAMES = [
  "True", "False", "None", "range", "len", "int", "float", "str", "abs", "round", "min", "max", "sum",
  "list", "dict", "bool", "input", "type", "math", "random", "import", "def", "while", "for", "if",
  "elif", "else", "return", "break", "continue", "and", "or", "not", "in", "pass", "main",
];

function driverObjects(): ApiObject[] {
  const out: ApiObject[] = [];
  const parts: Record<string, string> = {};
  for (const a of CONTROLLER_AXES) parts[a] = `controller.${a}.position()`;
  for (const b of CONTROLLER_BUTTONS) parts[b] = `controller.${b}.pressing()`;
  out.push({ path: "controller", className: "Controller", example: "controller.axis3.position()", methods: parts });
  for (const a of CONTROLLER_AXES) {
    out.push({ path: "controller." + a, className: axisClass(a), example: `controller.${a}.position()`, methods: { position: `controller.${a}.position()` } });
  }
  for (const b of CONTROLLER_BUTTONS) {
    out.push({ path: "controller." + b, className: buttonClass(b), example: `controller.${b}.pressing()`, methods: { pressing: `controller.${b}.pressing()` } });
  }
  for (const m of ["left_motor", "right_motor"] as const) {
    out.push({
      path: m, className: MOTOR_CLASSES[m], example: `${m}.spin(FORWARD, 50, PERCENT)`,
      methods: {
        spin: `${m}.spin(FORWARD, 50, PERCENT)`, stop: `${m}.stop()`,
        set_velocity: `${m}.set_velocity(50, PERCENT)`, velocity: `${m}.velocity(PERCENT)`,
      },
    });
  }
  return out;
}

/** Objects whose "methods" are really sub-objects (brain.screen, controller.axis3). */
const HAS_PARTS = new Set(["brain", "controller"]);

/** method name -> objects that have it, e.g. "drive_for" -> ["drivetrain"] */
export function ownersOf(method: string): ApiObject[] {
  return API_OBJECTS.filter((o) => Object.prototype.hasOwnProperty.call(o.methods, method) && !HAS_PARTS.has(o.path));
}

export function objectByClass(className: string): ApiObject | undefined {
  return API_OBJECTS.find((o) => o.className === className);
}

export const ALL_METHOD_NAMES: string[] = Array.from(
  new Set(API_OBJECTS.filter((o) => !HAS_PARTS.has(o.path)).flatMap((o) => Object.keys(o.methods))),
);
