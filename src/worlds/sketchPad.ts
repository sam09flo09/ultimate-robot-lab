import type { World } from "../core/types";

export const sketchPad: World = {
  id: "sketch-pad",
  name: "Sketch Pad",
  description:
    "A big blank sheet with a pen on the robot. Put the pen down and drive to draw. " +
    "Try a square, a triangle, a star, or your initials. Change colours with pen.set_pen_color. There is no right answer here!",
  width: 2000,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: -200, y: -200, heading: 0 },
  walls: [],
  floor: [],
  objects: [],
  zones: [],
  goals: [],
  hardware: { pen: true },
  starter: {
    python: [
      "# Sketch Pad: draw with the pen.",
      "",
      "def main():",
      "    pen.set_pen_color(BLUE)",
      "    pen.move(DOWN)",
      "    # A square: 4 sides of 400 mm.",
      "    for i in range(4):",
      "        drivetrain.drive_for(FORWARD, 400, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "    pen.move(UP)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
