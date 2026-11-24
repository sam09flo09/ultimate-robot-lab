import type { World } from "../core/types";

/**
 * arm: Stack Shop. The robot has a lifting arm with a claw. Two shelves of different heights, a stacking
 * pad with a heavy anchor block, and four 50 mm blocks to sort and stack.
 *
 * Geometry used by the reference solutions (activities/content/solutions.ts):
 *  - the claw holds a block 130 mm ahead of the robot's centre (70 mm half-robot + 60 mm);
 *  - low shelf top 100 mm (arm ≥ 20°), high shelf top 200 mm (arm ≥ 42°);
 *  - shelf front edges at y = 325, so a robot facing up (0°) stops with its centre at y = 250 and the
 *    held block's centre 55 mm onto the shelf.
 */
export const stackShop: World = {
  id: "stack-shop",
  name: "Stack Shop",
  description:
    "This robot has an arm with a claw. Close the claw to grab a block, spin the arm up to lift it, and open the claw to let go. " +
    "Put the blue block on the low shelf, the yellow block on the high shelf, and build a stack 3 blocks tall on the orange pad. " +
    "Lift high enough before you drive to a shelf: the arm stops when what it carries lands on something.",
  width: 2000,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -750, heading: 0 },
  walls: [],
  floor: [
    { kind: "rect", id: "stack-paint", x: 0, y: 300, w: 300, h: 300, color: "ORANGE" },
    { kind: "rect", id: "start-paint", x: 0, y: -750, w: 260, h: 260, color: "WHITE" },
  ],
  platforms: [
    { id: "low-shelf", x: -550, y: 450, w: 320, h: 250, height: 100, color: "BLUE" },
    { id: "high-shelf", x: 550, y: 450, w: 320, h: 250, height: 200, color: "GREEN" },
  ],
  objects: [
    // the anchor block on the stacking pad: too heavy to push or lift
    { id: "anchor", shape: "box", x: 0, y: 300, size: 60, height: 50, color: "ORANGE", movable: false, pickable: false, rotation: 0 },
    { id: "red-1", shape: "box", x: -250, y: -300, size: 50, height: 50, color: "RED", movable: true, pickable: true, rotation: 0 },
    { id: "red-2", shape: "box", x: 250, y: -300, size: 50, height: 50, color: "RED", movable: true, pickable: true, rotation: 0 },
    { id: "blue-1", shape: "box", x: -550, y: -300, size: 50, height: 50, color: "BLUE", movable: true, pickable: true, rotation: 0 },
    { id: "yellow-1", shape: "box", x: 550, y: -300, size: 50, height: 50, color: "YELLOW", movable: true, pickable: true, rotation: 0 },
  ],
  zones: [{ id: "stack-pad", kind: "rect", x: 0, y: 300, w: 300, h: 300, label: "Stack pad" }],
  goals: [
    { type: "objectsOnPlatform", platform: "low-shelf", count: 1, color: "BLUE", description: "The blue block is on the low shelf" },
    { type: "objectsOnPlatform", platform: "high-shelf", count: 1, color: "YELLOW", description: "The yellow block is on the high shelf" },
    { type: "stackHeight", count: 3, zone: "stack-pad", description: "A stack 3 blocks tall on the orange pad" },
  ],
  hardware: { arm: true },
  starter: {
    python: [
      "# Stack Shop: grab, lift, carry, place.",
      "",
      "def main():",
      "    # The red block is ahead and to the left. Drive up to it.",
      "    drivetrain.turn_for(LEFT, 29, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 385, MM)",
      "    claw.close()                          # grab it",
      "    arm.spin_to_position(30, DEGREES)     # lift it 150 mm",
      "    print(\"Holding:\", claw.is_holding())",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
