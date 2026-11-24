import type { World } from "../core/types";

/*
 * builder: Gear Lab — a two-lane playground for the Robot Builder (speed vs torque).
 *   Bottom lane: an empty 2.4 m straight to the yellow finish — pure speed.
 *   Top lane: a heavy crate (mass 2) to shove into the green bay. The default robot (push strength 1)
 *   stalls against it; 4 motors or 2:1 torque gearing push it — but gearing down is slow.
 * Both lanes end in the finish zone, so the race clock stops either way and the race history shows
 * which robot design set each time.
 */
export const gearLab: World = {
  id: "gear-lab",
  name: "Gear Lab",
  description:
    "RACE · Two lanes, one finish. Race the empty straight (bottom), or push the heavy crate (top) into the green bay. " +
    "The crate is twice as heavy as a normal object: open 🔧 Robot to change gears, wheels and motors. Fast or strong — can you be both?",
  width: 3000,
  height: 1400,
  background: "grid",
  gridSize: 200,
  start: { x: -1250, y: -350, heading: 90 },
  walls: [{ id: "divider", a: { x: -700, y: 0 }, b: { x: 1500, y: 0 }, thickness: 20 }],
  floor: [
    { kind: "rect", id: "bay-paint", x: 1300, y: 350, w: 300, h: 680, color: "GREEN" },
    { kind: "rect", id: "finish-paint", x: 1300, y: -350, w: 300, h: 680, color: "YELLOW" },
    { kind: "line", id: "finish-line", points: [{ x: 1150, y: -690 }, { x: 1150, y: 690 }], width: 16, color: "BLACK" },
  ],
  objects: [
    { id: "crate", shape: "box", x: -200, y: 350, size: 120, color: "ORANGE", movable: true, pickable: false, mass: 2 },
  ],
  zones: [
    { id: "bay", kind: "rect", x: 1300, y: 350, w: 300, h: 680, label: "Bay" },
    { id: "finish", kind: "rect", x: 1300, y: 0, w: 300, h: 1400, label: "Finish" },
  ],
  goals: [
    { type: "reachZone", zone: "finish", description: "Cross the finish line (either lane)" },
    { type: "objectsInZone", zone: "bay", count: 1, description: "Push the heavy crate into the green bay" },
  ],
  race: { finishZone: "finish", par: 2.4 },
  hardware: {},
  starter: {
    python: [
      "# Gear Lab: open 🔧 Robot and try different gears, wheels and motors.",
      "# Bigger gear ratio = slower but stronger. Can your robot push the crate?",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(100, PERCENT)",
      "    drivetrain.set_turn_velocity(100, PERCENT)",
      "    # Race the empty straight:",
      "    drivetrain.drive_for(FORWARD, 2600, MM)",
      "    # Or push the crate instead (top lane) - swap the line above for these:",
      "    # drivetrain.turn_for(LEFT, 90, DEGREES)",
      "    # drivetrain.drive_for(FORWARD, 700, MM)",
      "    # drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    # drivetrain.drive_for(FORWARD, 2600, MM)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
