/**
 * match: built-in practice opponents for Team B in Silo Sprint (OpponentSource { kind: "practice" }).
 * Plain student-style Python (docs/API.md + competition()), so students can read them after a match.
 * Team B starts at (1550, 0) facing left; its bin is x 1300..1800, y 400..1200 (see games.ts).
 * practiceBots.test.ts proves both score on the real match sim.
 */

const HELPERS = [
  "import math",
  "",
  "def go_to(x, y, stop_short):",
  "    \"\"\"Face the point (x, y) and drive toward it, stopping stop_short mm before it.\"\"\"",
  "    dx = x - location.position(X, MM)",
  "    dy = y - location.position(Y, MM)",
  "    drivetrain.turn_to_heading(math.degrees(math.atan2(dx, dy)) % 360, DEGREES)",
  "    drivetrain.drive_for(FORWARD, math.sqrt(dx * dx + dy * dy) - stop_short, MM)",
  "",
];

export const EASY_BOT = [
  "# Practice bot (easy): pushes disks into the blue bin with its front.",
  ...HELPERS,
  "def push_right(x, y):",
  "    \"\"\"From just left of the disk at (x, y), push it right into the bin, then back off.\"\"\"",
  "    go_to(x - 250, y, 0)",
  "    drivetrain.turn_to_heading(90, DEGREES)",
  "    drivetrain.drive_for(FORWARD, 1500 - (x - 250), MM)",
  "    drivetrain.drive_for(REVERSE, 250, MM)",
  "",
  "def autonomous():",
  "    drivetrain.set_drive_velocity(60, PERCENT)",
  "    go_to(700, 650, 0)",
  "    push_right(1000, 900)",
  "",
  "def driver_control():",
  "    # nobody is driving: keep collecting on its own",
  "    go_to(800, 350, 0)",
  "    go_to(250, 400, 0)",
  "    push_right(500, 600)",
  "    go_to(1550, 0, 0)   # park at home",
  "    while True:",
  "        wait(1, SECONDS)",
  "",
  "competition(autonomous, driver_control)",
  "",
].join("\n");

export const MEDIUM_BOT = [
  "# Practice bot (medium): carries disks to the blue bin with the magnet, then parks at home.",
  ...HELPERS,
  "# (x, y) of the disks to fetch, nearest first",
  "DISKS = [(1000, 900), (500, 600), (500, 200), (1000, -900), (500, -200), (500, -600), (0, 400), (0, 800), (0, 0)]",
  "BIN_SLOTS = [1000, 800, 600, 500, 1100, 700]",
  "count = 0",
  "",
  "def fetch(x, y):",
  "    \"\"\"Pick up the disk at (x, y) and drop it in the bin.\"\"\"",
  "    global count",
  "    go_to(x, y, 125)",
  "    magnet.energize(BOOST)",
  "    slot = BIN_SLOTS[count % len(BIN_SLOTS)]",
  "    go_to(1150, slot, 0)",
  "    go_to(1450, slot, 0)",
  "    magnet.energize(DROP)",
  "    drivetrain.drive_for(REVERSE, 250, MM)",
  "    count = count + 1",
  "",
  "def autonomous():",
  "    drivetrain.set_drive_velocity(80, PERCENT)",
  "    drivetrain.set_turn_velocity(80, PERCENT)",
  "    fetch(DISKS[0][0], DISKS[0][1])",
  "    fetch(DISKS[1][0], DISKS[1][1])",
  "",
  "def driver_control():",
  "    # nobody is driving: keep collecting, and park at home near the end (75 s in)",
  "    i = 2",
  "    while i < len(DISKS) and brain.timer.time(SECONDS) < 62:",
  "        fetch(DISKS[i][0], DISKS[i][1])",
  "        i = i + 1",
  "    go_to(1550, 0, 0)",
  "    while True:",
  "        wait(1, SECONDS)",
  "",
  "competition(autonomous, driver_control)",
  "",
].join("\n");

export const PRACTICE_BOTS: Record<"easy" | "medium", { name: string; python: string }> = {
  easy: { name: "Practice bot (easy)", python: EASY_BOT },
  medium: { name: "Practice bot (medium)", python: MEDIUM_BOT },
};

export function practiceBot(level: "easy" | "medium"): string {
  return PRACTICE_BOTS[level].python;
}
