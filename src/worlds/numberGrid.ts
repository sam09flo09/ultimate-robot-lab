import type { World } from "../core/types";

/** The original Grid Robot Sim template, character for character. */
export const ORIGINAL_TEMPLATE = [
  "# My robot program",
  "",
  "def main():",
  "    # Write your statements below, indented 4 spaces.",
  "    pass  # placeholder: delete this line when you add statements",
  "",
  "# Start the program at main(). Do not delete.",
  "start(main)",
  "",
].join("\n");

/** Exactly the original sim: a 10 x 10 board of numbered 200 mm squares, 1 in the bottom-left. */
export const numberGrid: World = {
  id: "number-grid",
  name: "Number Grid",
  description:
    "The classic 10 by 10 number board. Squares are 200 mm wide and numbered 1 to 100, starting in the bottom-left corner. " +
    "The robot starts in square 1 facing up (toward 11). Can you drive it to square 100? The pen is fitted if you want to draw your route.",
  width: 2000,
  height: 2000,
  background: "numberGrid",
  gridSize: 200,
  start: { x: -900, y: -900, heading: 0 },
  walls: [],
  floor: [],
  objects: [],
  zones: [],
  goals: [],
  hardware: { pen: true },
  starter: { python: ORIGINAL_TEMPLATE },
  version: 1,
};
