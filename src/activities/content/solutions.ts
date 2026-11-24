/**
 * Reference solutions for every built-in activity step that has checks.
 * content.test.ts runs each one on the real simulator and checker, so every step is proven completable.
 * Teachers may also find these handy as answer keys.
 */
import type { DriveScript } from "./runSolution";
import { ARM_HELPER_LINES } from "./a13-arms-and-claws"; // arm

const prog = (...lines: string[]) => lines.join("\n") + "\n";

const DEPOT = prog(
  "# Colour Depot: carry every disk to the bin of the same colour.",
  "import math",
  "",
  "RED_BIN = -650",
  "BLUE_BIN = 0",
  "YELLOW_BIN = 650",
  "",
  "def go_to(x, y, stop_short):",
  "    \"\"\"Turn to face the point (x, y), then drive straight toward it.",
  "    Stops stop_short mm before reaching it.\"\"\"",
  "    dx = x - location.position(X, MM)",
  "    dy = y - location.position(Y, MM)",
  "    angle = math.degrees(math.atan2(dx, dy)) % 360",
  "    drivetrain.turn_to_heading(angle, DEGREES)",
  "    length = math.sqrt(dx * dx + dy * dy)",
  "    drivetrain.drive_for(FORWARD, length - stop_short, MM)",
  "",
  "def grab_disk(x, y):",
  "    \"\"\"Drive up to the disk at (x, y) and pick it up.\"\"\"",
  "    go_to(x, y, 150)",
  "    magnet.energize(BOOST)",
  "",
  "def drop_in_bin(bin_x):",
  "    \"\"\"Carry the disk into the bin at bin_x and drop it.\"\"\"",
  "    # come in from straight below so we miss the dividers",
  "    go_to(bin_x, 400, 0)",
  "    go_to(bin_x, 760, 121)",
  "    magnet.energize(DROP)",
  "    # back away so the robot doesn't hit the disk when it turns",
  "    drivetrain.drive_for(REVERSE, 150, MM)",
  "",
  "def deliver(x, y, bin_x):",
  "    \"\"\"Move one disk from (x, y) into its bin.\"\"\"",
  "    grab_disk(x, y)",
  "    drop_in_bin(bin_x)",
  "",
  "def main():",
  "    drivetrain.set_drive_velocity(80, PERCENT)",
  "    drivetrain.set_turn_velocity(80, PERCENT)",
  "    deliver(0, -500, RED_BIN)",
  "    deliver(-550, -250, BLUE_BIN)",
  "    deliver(-700, 100, YELLOW_BIN)",
  "    deliver(300, 250, BLUE_BIN)",
  "    deliver(650, -200, RED_BIN)",
  "    deliver(700, -650, YELLOW_BIN)",
  "",
  "start(main)",
);

/* arm: Stack Shop. The claw holds a block 130 mm ahead of the robot's centre, so go_to(x, y, 130)
 * puts what the claw holds right over (x, y). */
const ARM_HELPERS = ARM_HELPER_LINES;
export const STACK_SHOP_SHELF = prog(
  ...ARM_HELPERS,
  "def main():",
  "    drivetrain.set_drive_velocity(80, PERCENT)",
  "    pick_up(-550, -300)",
  "    place(-550, 380, 30)    # low shelf: 100 mm, so lift above 20 degrees",
  "",
  "start(main)",
);
export const STACK_SHOP_STACK = prog(
  ...ARM_HELPERS,
  "def main():",
  "    drivetrain.set_drive_velocity(80, PERCENT)",
  "    pick_up(-250, -300)",
  "    place(0, 300, 20)       # on the anchor block (50 mm)",
  "    pick_up(250, -300)",
  "    place(0, 300, 30)       # on top of the first red block (100 mm)",
  "",
  "start(main)",
);
export const STACK_SHOP_FULL = prog(
  ...ARM_HELPERS,
  "def main():",
  "    drivetrain.set_drive_velocity(80, PERCENT)",
  "    drivetrain.set_turn_velocity(80, PERCENT)",
  "    pick_up(-250, -300)",
  "    place(0, 300, 20)",
  "    pick_up(250, -300)",
  "    place(0, 300, 30)",
  "    pick_up(-550, -300)",
  "    place(-550, 380, 30)    # low shelf, 100 mm",
  "    pick_up(550, -300)",
  "    place(550, 380, 50)     # high shelf, 200 mm: lift above 42 degrees",
  "",
  "start(main)",
);

const RIGHT_HAND = prog(
  "# Right-hand rule maze solver.",
  "",
  "def wall_ahead():",
  "    \"\"\"True if a wall is close in front of the robot.\"\"\"",
  "    return distance.get_distance(MM) < 300",
  "",
  "def main():",
  "    while not down_eye.detect(GREEN):",
  "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
  "        while wall_ahead():",
  "            drivetrain.turn_for(LEFT, 90, DEGREES)",
  "        drivetrain.drive_for(FORWARD, 400, MM)",
  "",
  "start(main)",
);

const LINE_FOLLOWER = prog(
  "def main():",
  "    drivetrain.set_drive_velocity(50, PERCENT)",
  "    drivetrain.set_turn_velocity(50, PERCENT)",
  "    while not down_eye.detect(GREEN):",
  "        if down_eye.detect(BLACK):",
  "            drivetrain.turn_for(LEFT, 6, DEGREES)",
  "        else:",
  "            drivetrain.turn_for(RIGHT, 6, DEGREES)",
  "        drivetrain.drive_for(FORWARD, 10, MM)",
  "    drivetrain.stop()",
  "",
  "start(main)",
);

const WALL_STOP = prog(
  "def main():",
  "    while distance.get_distance(MM) > 100:",
  "        drivetrain.drive_for(FORWARD, 20, MM)",
  "    print(\"Arrived!\")",
  "",
  "start(main)",
);

const TANK = prog(
  "def main():",
  "    while True:",
  "        left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)",
  "        right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)",
  "        wait(20, MSEC)",
  "",
  "start(main)",
);

const ARCADE = prog(
  "def main():",
  "    while True:",
  "        forward = controller.axis3.position()",
  "        turn = controller.axis1.position()",
  "        left = forward + turn",
  "        right = forward - turn",
  "        left_motor.spin(FORWARD, left, PERCENT)",
  "        right_motor.spin(FORWARD, right, PERCENT)",
  "        wait(20, MSEC)",
  "",
  "start(main)",
);

/** Arcade drive with deadband + clamp; optional extra loop lines (buttons) and speed mode. */
const arcadeFull = (opts: { buttons?: boolean; speedMode?: boolean }) => {
  const scale = opts.speedMode ? " * max_speed / 100" : "";
  return prog(
    "DEADBAND = 10",
    "",
    "def main():",
    ...(opts.speedMode ? ["    max_speed = 100"] : []),
    "    while True:",
    ...(opts.speedMode ? [
      "        if controller.buttonL1.pressing():",
      "            max_speed = 50",
      "        if controller.buttonR1.pressing():",
      "            max_speed = 100",
    ] : []),
    "        forward = controller.axis3.position()",
    "        turn = controller.axis1.position()",
    "        # deadband: a resting stick counts as 0",
    "        if abs(forward) < DEADBAND:",
    "            forward = 0",
    "        if abs(turn) < DEADBAND:",
    "            turn = 0",
    "        left = forward + turn",
    "        right = forward - turn",
    "        # clamp to the motors' range",
    "        if left > 100:",
    "            left = 100",
    "        if left < -100:",
    "            left = -100",
    "        if right > 100:",
    "            right = 100",
    "        if right < -100:",
    "            right = -100",
    `        left_motor.spin(FORWARD, left${scale}, PERCENT)`,
    `        right_motor.spin(FORWARD, right${scale}, PERCENT)`,
    ...(opts.buttons ? [
      "        if controller.buttonA.pressing():",
      "            magnet.energize(BOOST)",
      "        if controller.buttonB.pressing():",
      "            magnet.energize(DROP)",
    ] : []),
    "        wait(20, MSEC)",
    "",
    "start(main)",
  );
};

export const SOLUTIONS: Record<string, Record<string, string>> = {
  "a01-meet-your-robot": {
    "drive-to-41": prog("def main():", "    drivetrain.drive_for(FORWARD, 800, MM)", "", "start(main)"),
    "turn-to-45": prog(
      "def main():",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "",
      "start(main)",
    ),
    "corner-100": prog(
      "def main():",
      "    pen.move(DOWN)",
      "    drivetrain.drive_for(FORWARD, 1800, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 1800, MM)",
      "",
      "start(main)",
    ),
  },
  "a02-blocks-to-python": {
    "write-python": prog(
      "def main():",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "",
      "start(main)",
    ),
    "commented-corner": prog(
      "def main():",
      "    # Up the left side to square 91",
      "    drivetrain.drive_for(FORWARD, 1800, MM)",
      "    # Face right, then across to square 100",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 1800, MM)",
      "",
      "start(main)",
    ),
  },
  "a03-anatomy-of-a-program": {
    "put-together": prog(
      "def main():",
      "    total = 200 * 4",
      "    print(\"Driving\", total, \"mm\")",
      "    drivetrain.drive_for(FORWARD, total, MM)",
      "",
      "start(main)",
    ),
  },
  "a04-variables-and-constants": {
    "constant-square": prog(
      "SIDE = 300",
      "",
      "def main():",
      "    pen.set_pen_color(BLUE)",
      "    pen.move(DOWN)",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    pen.move(UP)",
      "",
      "start(main)",
    ),
    "growing-spiral": prog(
      "def main():",
      "    length = 100",
      "    pen.move(DOWN)",
      "    drivetrain.drive_for(FORWARD, length, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    length = length + 100",
      "    drivetrain.drive_for(FORWARD, length, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    length = length + 100",
      "    drivetrain.drive_for(FORWARD, length, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    length = length + 100",
      "    drivetrain.drive_for(FORWARD, length, MM)",
      "    print(\"length is\", length)",
      "",
      "start(main)",
    ),
  },
  "a05-loops": {
    "long-way": prog(
      "def main():",
      "    pen.move(DOWN)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    pen.move(UP)",
      "",
      "start(main)",
    ),
    "for-square": prog(
      "def main():",
      "    pen.move(DOWN)",
      "    for i in range(4):",
      "        drivetrain.drive_for(FORWARD, 400, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    pen.move(UP)",
      "",
      "start(main)",
    ),
    "any-polygon": prog(
      "SIDES = 6",
      "",
      "def main():",
      "    pen.move(DOWN)",
      "    for i in range(SIDES):",
      "        drivetrain.drive_for(FORWARD, 300, MM)",
      "        drivetrain.turn_for(RIGHT, 360 / SIDES, DEGREES)",
      "    pen.move(UP)",
      "",
      "start(main)",
    ),
    "while-octagon": prog(
      "def main():",
      "    count = 0",
      "    pen.move(DOWN)",
      "    while count < 8:",
      "        drivetrain.drive_for(FORWARD, 200, MM)",
      "        drivetrain.turn_for(RIGHT, 45, DEGREES)",
      "        count = count + 1",
      "        print(\"Lines drawn:\", count)",
      "    pen.move(UP)",
      "",
      "start(main)",
    ),
  },
  "a06-input-and-output": {
    "show-reading": prog(
      "def main():",
      "    reading = distance.get_distance(MM)",
      "    print(\"Distance:\", reading)",
      "    brain.screen.print(reading)",
      "",
      "start(main)",
    ),
    "stop-before-wall": WALL_STOP,
    "wall-moved": WALL_STOP,
    "bumper": prog(
      "def main():",
      "    drivetrain.drive(FORWARD)",
      "    while not bumper.pressed():",
      "        wait(20, MSEC)",
      "    drivetrain.stop()",
      "    print(\"Bump!\")",
      "    drivetrain.drive_for(REVERSE, 300, MM)",
      "",
      "start(main)",
    ),
  },
  "a11-first-driver-program": {
    "tank-blocks": TANK,
    "tank-python": TANK,
    "drive-to-target": TANK,
  },
  "a12-arcade-drive-buttons": {
    "arcade-mix": ARCADE,
    "clamp-deadband": arcadeFull({}),
    "magnet-button": arcadeFull({ buttons: true }),
    "speed-mode": arcadeFull({ buttons: true, speedMode: true }),
  },
  "a07-decisions-line-follow": {
    "color-check": prog(
      "def main():",
      "    if down_eye.detect(GREEN):",
      "        print(\"GO\")",
      "    else:",
      "        print(\"STOP\")",
      "",
      "start(main)",
    ),
    "follow-tape": LINE_FOLLOWER,
  },
  "a08-debugging-detectives": {
    "syntax-bugs": prog(
      "def main():",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "",
      "start(main)",
    ),
    "name-bugs": prog(
      "SIDE = 600",
      "",
      "def main():",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, SIDE, MM)",
      "",
      "start(main)",
    ),
    "logic-bugs": prog(
      "def main():",
      "    pen.move(DOWN)",
      "    for i in range(4):",
      "        drivetrain.drive_for(FORWARD, 400, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "",
      "start(main)",
    ),
    "all-bugs": prog(
      "STEP = 200",
      "",
      "def main():",
      "    for i in range(9):",
      "        drivetrain.drive_for(FORWARD, STEP, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        drivetrain.drive_for(FORWARD, STEP, MM)",
      "        drivetrain.turn_for(LEFT, 90, DEGREES)",
      "",
      "start(main)",
    ),
  },
  "a09-functions-color-depot": {
    "mini-depot": prog(
      "def grab_disk():",
      "    \"\"\"Drive up to the disk ahead and pick it up with the magnet.\"\"\"",
      "    drivetrain.drive_for(FORWARD, 350, MM)",
      "    magnet.energize(BOOST)",
      "",
      "def drop_disk():",
      "    \"\"\"Carry the disk into the bin and let go.\"\"\"",
      "    drivetrain.drive_for(FORWARD, 930, MM)",
      "    magnet.energize(DROP)",
      "",
      "def main():",
      "    grab_disk()",
      "    drop_disk()",
      "",
      "start(main)",
    ),
    "full-depot": DEPOT,
  },
  // arm
  "a13-arms-and-claws": {
    "work-envelope": prog(
      "def main():",
      "    arm.spin_to_position(30, DEGREES)",
      "    print(\"Arm at\", arm.position(DEGREES))",
      "    arm.spin_to_position(90, DEGREES)",
      "    print(\"Arm at\", arm.position(DEGREES))",
      "",
      "start(main)",
    ),
    "pick-and-place": STACK_SHOP_SHELF,
    "stack-three": STACK_SHOP_STACK,
    "stack-shop": STACK_SHOP_FULL,
  },
  "a10-capstone-maze": {
    "plan-and-code": prog(
      "# REQUIREMENTS: reach the green exit; never touch a wall.",
      "# PLAN:",
      "#   up 3 squares, turn right, across 1",
      "#   turn right, down 2, turn left, across 2",
      "#   turn left, up 3, turn right, across 1 to the exit",
      "",
      "def main():",
      "    drivetrain.drive_for(FORWARD, 1200, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "    drivetrain.turn_for(LEFT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "    drivetrain.turn_for(LEFT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 1200, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "",
      "start(main)",
    ),
    "smart-solver": RIGHT_HAND,
    "new-maze": RIGHT_HAND,
  },
};

/*
 * Scripted drivers for steps whose goals need someone at the controller (driver-control activities).
 * Timings assume the API's wheel model: 100% = 800 mm/s at the wheel, track width 120 mm, so
 *   straight at p%: 8p mm/s;  spin on the spot at ±p%: 2 * 8p / 120 rad/s (p = 30 → 229°/s, 90° ≈ 0.39 s).
 * Zones are 400 mm wide, so a few degrees or a few cm of slop still pass.
 */
/** Driver Practice: up 1100 mm into the checkpoint (y ≈ 300), spin right 90°, across 600 mm into the target. */
const tankToTarget: DriveScript = {
  timeline: [
    { t: 0, axes: { axis3: 60, axis2: 60 } },          // 480 mm/s × 2.3 s ≈ 1100 mm
    { t: 2.3, axes: { axis3: 30, axis2: -30 } },       // spin right ≈ 90°
    { t: 2.693, axes: { axis3: 60, axis2: 60 } },      // 480 mm/s × 1.25 s = 600 mm
    { t: 3.943 },                                       // let go
  ],
  stopAt: 4.5,
};
const arcadeToTarget: DriveScript = {
  timeline: [
    { t: 0, axes: { axis3: 60 } },
    { t: 2.3, axes: { axis1: 30 } },
    { t: 2.693, axes: { axis3: 60 } },
    { t: 3.943 },
  ],
  stopAt: 4.5,
};
/** Mini Depot (disk at y = -300, bin y 550..850): up ~360 mm to the disk, A, carry ~1020 mm, B. */
const depotRun = (slowFirst: boolean): DriveScript => {
  const k = slowFirst ? 2 : 1;            // slow mode halves the speed, so push the stick twice as far
  const o = slowFirst ? 0.1 : 0;          // tap L1 first
  return {
    timeline: [
      ...(slowFirst ? [{ t: 0, buttons: { buttonL1: true } }] : []),
      { t: o, axes: { axis3: 50 * k } },                 // 400 mm/s × 0.9 s = 360 mm
      { t: o + 0.9, buttons: { buttonA: true } },        // pick up
      { t: o + 1.1, axes: { axis3: 50 * k } },           // 400 mm/s × 2.55 s ≈ 1020 mm
      { t: o + 3.65 },
      { t: o + 3.75, buttons: { buttonB: true } },       // drop
      { t: o + 3.95 },
    ],
    stopAt: o + 4.5,
  };
};

export const SCRIPTS: Record<string, Record<string, DriveScript>> = {
  "a11-first-driver-program": {
    "drive-to-target": tankToTarget,
  },
  "a12-arcade-drive-buttons": {
    "arcade-mix": arcadeToTarget,
    "clamp-deadband": arcadeToTarget,
    "magnet-button": depotRun(false),
    "speed-mode": depotRun(true),
  },
};
