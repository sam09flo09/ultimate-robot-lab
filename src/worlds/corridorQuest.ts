import type { World } from "../core/types";
import { mazeWalls } from "./helpers";

/*
 * A 5 x 5 maze of 400 mm cells (walls sit on the 200 mm grid lines).
 * Cell (col,row), row 0 at the bottom. Start = (0,0), exit = (4,4).
 * Passages form a spanning tree, so there is exactly one route, plus some dead ends.
 * Corridors are 400 mm between wall centres = 360 mm clear with 40 mm walls.
 */
const PASSAGES: [number, number, number, number][] = [
  // the route
  [0, 0, 0, 1], [0, 1, 0, 2], [0, 2, 0, 3], [0, 3, 1, 3], [1, 3, 1, 2], [1, 2, 1, 1],
  [1, 1, 2, 1], [2, 1, 3, 1], [3, 1, 3, 2], [3, 2, 3, 3], [3, 3, 3, 4], [3, 4, 4, 4],
  // dead ends
  [0, 3, 0, 4], [0, 4, 1, 4], [1, 4, 2, 4], [2, 4, 2, 3], [2, 3, 2, 2],
  [1, 1, 1, 0], [1, 0, 2, 0],
  [3, 1, 3, 0], [3, 0, 4, 0], [4, 0, 4, 1], [4, 1, 4, 2], [4, 2, 4, 3],
];

export const corridorQuest: World = {
  id: "corridor-quest",
  name: "Corridor Quest",
  description:
    "A maze of corridors with one way out. Find the green exit in the top-right corner without bumping the walls. " +
    "Use the distance sensor to see how far away the next wall is, and the bumper to feel when you touch one.",
  width: 2000,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: -800, y: -800, heading: 0 },
  walls: mazeWalls(5, 5, 400, -1000, -1000, PASSAGES, 40, "maze"),
  floor: [{ kind: "rect", id: "exit-pad", x: 800, y: 800, w: 300, h: 300, color: "GREEN" }],
  objects: [],
  zones: [{ id: "exit", kind: "rect", x: 800, y: 800, w: 320, h: 320, label: "Exit" }],
  goals: [
    { type: "reachZone", zone: "exit", description: "Reach the green exit" },
    { type: "noWallHits", description: "Don't hit any walls" },
  ],
  hardware: {},
  starter: {
    python: [
      "# Corridor Quest: find the green exit (top-right).",
      "# distance.get_distance(MM) tells you how far away the wall ahead is.",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(50, PERCENT)",
      "    # Drive up the first corridor and stop before the wall.",
      "    while distance.get_distance(MM) > 150:",
      "        drivetrain.drive(FORWARD)",
      "        wait(20, MSEC)",
      "    drivetrain.stop()",
      "    # Which way now? Turn, then keep exploring.",
      "    drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
