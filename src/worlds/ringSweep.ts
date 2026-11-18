import type { World } from "../core/types";

/*
 * A 2400 mm square arena with a ring (black edge at r 700..760) in the middle.
 * Four coloured boxes sit inside the ring, one on each side of the robot.
 * Push each box out of the ring into the pit of the same colour beyond the ring edge.
 */
export const ringSweep: World = {
  id: "ring-sweep",
  name: "Ring Sweep",
  description:
    "Clear the ring! Four boxes sit inside the circle. Push each one straight out across the black ring line " +
    "into the pit of the same colour. The robot can push boxes but cannot lift them. Can you finish in under 2 minutes?",
  width: 2400,
  height: 2400,
  background: "plain",
  gridSize: 200,
  start: { x: 0, y: 0, heading: 0 },
  walls: [],
  floor: [
    { kind: "circle", id: "ring-edge", x: 0, y: 0, r: 760, color: "BLACK" },
    { kind: "circle", id: "ring-floor", x: 0, y: 0, r: 700, color: "WHITE" },
    { kind: "rect", id: "north-pad", x: 0, y: 980, w: 760, h: 400, color: "RED" },
    { kind: "rect", id: "east-pad", x: 980, y: 0, w: 400, h: 760, color: "BLUE" },
    { kind: "rect", id: "south-pad", x: 0, y: -980, w: 760, h: 400, color: "GREEN" },
    { kind: "rect", id: "west-pad", x: -980, y: 0, w: 400, h: 760, color: "YELLOW" },
  ],
  objects: [
    { id: "box-red", shape: "box", x: 0, y: 400, size: 120, color: "RED", movable: true, pickable: false, rotation: 0 },
    { id: "box-blue", shape: "box", x: 400, y: 0, size: 120, color: "BLUE", movable: true, pickable: false, rotation: 0 },
    { id: "box-green", shape: "box", x: 0, y: -400, size: 120, color: "GREEN", movable: true, pickable: false, rotation: 0 },
    { id: "box-yellow", shape: "box", x: -400, y: 0, size: 120, color: "YELLOW", movable: true, pickable: false, rotation: 0 },
  ],
  zones: [
    { id: "north-pit", kind: "rect", x: 0, y: 980, w: 760, h: 400, label: "Red pit" },
    { id: "east-pit", kind: "rect", x: 980, y: 0, w: 400, h: 760, label: "Blue pit" },
    { id: "south-pit", kind: "rect", x: 0, y: -980, w: 760, h: 400, label: "Green pit" },
    { id: "west-pit", kind: "rect", x: -980, y: 0, w: 400, h: 760, label: "Yellow pit" },
  ],
  goals: [
    { type: "objectsInZone", zone: "north-pit", count: 1, color: "RED", description: "Red box in the red pit" },
    { type: "objectsInZone", zone: "east-pit", count: 1, color: "BLUE", description: "Blue box in the blue pit" },
    { type: "objectsInZone", zone: "south-pit", count: 1, color: "GREEN", description: "Green box in the green pit" },
    { type: "objectsInZone", zone: "west-pit", count: 1, color: "YELLOW", description: "Yellow box in the yellow pit" },
    { type: "maxTime", seconds: 120, description: "Finish within 2 minutes" },
  ],
  hardware: {},
  starter: {
    python: [
      "# Ring Sweep: push every box out of the ring into its pit.",
      "",
      "def main():",
      "    # The red box is straight ahead. Push it out to the red pit.",
      "    drivetrain.drive_for(FORWARD, 750, MM)",
      "    # Back up to the middle and turn to face the next box.",
      "    drivetrain.drive_for(REVERSE, 750, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    # Your turn: push the blue, green and yellow boxes out too.",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
