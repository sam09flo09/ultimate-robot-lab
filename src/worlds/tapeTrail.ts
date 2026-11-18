import type { Vec, World } from "../core/types";
import { arc, curve, joinRuns } from "./helpers";

/*
 * A closed loop of black tape, driven clockwise from the middle of the left side.
 * Rounded-rectangle loop (x ±700, y ±600, corner radius 300) with an S-bend along the top
 * and an inward bump along the bottom. All joins are tangent (no kinks).
 */
const PI = Math.PI;

function buildLoop(): Vec[] {
  const leftUp = curve((t) => ({ x: -700, y: t * 300 }), 8);
  const cornerTL = arc(-400, 300, 300, PI, PI / 2);
  // S-bend: zero height and zero slope at both ends.
  const top = curve((t) => {
    const s = Math.sin(PI * t);
    return { x: -400 + 800 * t, y: 600 + 150 * Math.sin(2 * PI * t) * s * s };
  }, 28);
  const cornerTR = arc(400, 300, 300, PI / 2, 0);
  const right = curve((t) => ({ x: 700, y: 300 - 600 * t }), 15);
  const cornerBR = arc(400, -300, 300, 0, -PI / 2);
  // inward bump, rising 200 mm at the middle, flat at the ends.
  const bottom = curve((t) => ({ x: 400 - 800 * t, y: -600 + 100 * (1 - Math.cos(2 * PI * t)) }), 28);
  const cornerBL = arc(-400, -300, 300, -PI / 2, -PI);
  const leftUp2 = curve((t) => ({ x: -700, y: -300 + 300 * t }), 8);
  return joinRuns(leftUp, cornerTL, top, cornerTR, right, cornerBR, bottom, cornerBL, leftUp2);
}

export const tapeTrail: World = {
  id: "tape-trail",
  name: "Tape Trail",
  description:
    "Follow the black tape all the way around the track. The down eye sensor looks at the floor under the robot: " +
    "is it seeing BLACK tape or WHITE floor? Pass the three checkpoints in order and stop on the green finish line.",
  width: 2000,
  height: 2000,
  background: "plain",
  gridSize: 200,
  start: { x: -700, y: 0, heading: 0 },
  walls: [],
  floor: [
    { kind: "line", id: "tape", points: buildLoop(), width: 50, color: "BLACK" },
    { kind: "rect", id: "finish-line", x: -700, y: -220, w: 140, h: 60, color: "GREEN" },
  ],
  objects: [],
  zones: [
    { id: "cp1", kind: "circle", x: 0, y: 600, r: 160, label: "Checkpoint 1" },
    { id: "cp2", kind: "circle", x: 700, y: 0, r: 160, label: "Checkpoint 2" },
    { id: "cp3", kind: "circle", x: 0, y: -450, r: 160, label: "Checkpoint 3" },
    { id: "finish", kind: "rect", x: -700, y: -220, w: 300, h: 160, label: "Finish" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["cp1", "cp2", "cp3", "finish"], description: "Pass checkpoints 1, 2, 3, then the finish" },
    { type: "reachZone", zone: "finish", description: "End on the finish line" },
  ],
  hardware: {},
  starter: {
    python: [
      "# Tape Trail: follow the black tape around the loop.",
      "# down_eye.detect(BLACK) is True when the robot is over the tape.",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(30, PERCENT)",
      "    drivetrain.set_turn_velocity(30, PERCENT)",
      "    while not down_eye.detect(GREEN):",
      "        if down_eye.detect(BLACK):",
      "            drivetrain.drive_for(FORWARD, 20, MM)",
      "        else:",
      "            # Off the tape! Which way should the robot turn to find it again?",
      "            drivetrain.turn_for(RIGHT, 5, DEGREES)",
      "    drivetrain.stop()",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
