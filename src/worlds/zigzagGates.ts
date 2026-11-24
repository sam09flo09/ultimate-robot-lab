import type { World } from "../core/types";

/*
 * Race: a slalom left to right through three gates. Each gate is a wall with a 400 mm gap,
 * alternating bottom / top / bottom, so the robot has to weave. Finish in the green box on the right.
 * The starter only drives in straight lines with square turns at 25% — slow on purpose.
 */
export const zigzagGates: World = {
  id: "zigzag-gates",
  name: "Zigzag Gates",
  description:
    "RACE · Weave through the three gates (low, high, low) and into the green finish box. " +
    "Time starts when your program starts. Straight lines and square turns work — diagonals are faster.",
  width: 2800,
  height: 1200,
  background: "grid",
  gridSize: 200,
  start: { x: -1200, y: 0, heading: 90 },
  walls: [
    { id: "gate-1", a: { x: -700, y: 600 }, b: { x: -700, y: -200 }, thickness: 20 },
    { id: "gate-2", a: { x: 0, y: -600 }, b: { x: 0, y: 200 }, thickness: 20 },
    { id: "gate-3", a: { x: 700, y: 600 }, b: { x: 700, y: -200 }, thickness: 20 },
  ],
  floor: [
    { kind: "rect", id: "finish-pad", x: 1250, y: 0, w: 280, h: 1180, color: "GREEN" },
    { kind: "circle", id: "cone-1", x: -700, y: -200, r: 30, color: "ORANGE" },
    { kind: "circle", id: "cone-2", x: 0, y: 200, r: 30, color: "ORANGE" },
    { kind: "circle", id: "cone-3", x: 700, y: -200, r: 30, color: "ORANGE" },
  ],
  objects: [],
  zones: [
    { id: "gap1", kind: "circle", x: -700, y: -400, r: 190, label: "Gate 1" },
    { id: "gap2", kind: "circle", x: 0, y: 400, r: 190, label: "Gate 2" },
    { id: "gap3", kind: "circle", x: 700, y: -400, r: 190, label: "Gate 3" },
    { id: "finish", kind: "rect", x: 1250, y: 0, w: 300, h: 1200, label: "Finish" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["gap1", "gap2", "gap3", "finish"], description: "Go through gates 1, 2, 3, then the finish" },
    { type: "reachZone", zone: "finish", description: "Reach the green finish box" },
  ],
  race: { finishZone: "finish", par: 9 },
  hardware: {},
  starter: {
    python: [
      "# Zigzag Gates: weave low, high, low, then into the green box.",
      "# This works but it's slow. Try faster velocities, then diagonals with turn_to_heading.",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(25, PERCENT)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)   # face down",
      "    drivetrain.drive_for(FORWARD, 400, MM)",
      "    drivetrain.turn_for(LEFT, 90, DEGREES)    # face right: through gate 1",
      "    drivetrain.drive_for(FORWARD, 850, MM)",
      "    drivetrain.turn_for(LEFT, 90, DEGREES)    # face up",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)   # face right: through gate 2",
      "    drivetrain.drive_for(FORWARD, 700, MM)",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)   # face down",
      "    drivetrain.drive_for(FORWARD, 800, MM)",
      "    drivetrain.turn_for(LEFT, 90, DEGREES)    # face right: through gate 3",
      "    drivetrain.drive_for(FORWARD, 900, MM)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
