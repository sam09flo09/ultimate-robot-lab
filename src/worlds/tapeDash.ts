import type { Vec, World } from "../core/types";
import { curve, joinRuns } from "./helpers";

/*
 * Race: a line-follow sprint. A wavy black tape runs left to right (straight lead-in, one and a
 * half gentle waves, straight run-out) and ends on a green finish pad. Three checkpoints sit on the tape.
 * Gentlest bend radius ~320 mm. The starter follows the tape's edge in tiny steps — reliable but slow.
 */
const A = 200, L = 1600, X0 = -900, X1 = 900;
const wave = (x: number) => A * Math.sin((2 * Math.PI * (x - X0)) / L);

function buildTape(): Vec[] {
  return joinRuns(
    curve((t) => ({ x: -1100 + 200 * t, y: 0 }), 2),
    curve((t) => { const x = X0 + (X1 - X0) * t; return { x, y: wave(x) }; }, 60),
    curve((t) => ({ x: X1 + 200 * t, y: wave(X1) }), 2),
  );
}

export const tapeDash: World = {
  id: "tape-dash",
  name: "Tape Dash",
  description:
    "RACE · Sprint along the wavy black tape to the green pad, passing the three checkpoints on the way. " +
    "The down eye sees BLACK on the tape and WHITE off it. How fast can your line follower go before it loses the line?",
  width: 2400,
  height: 1200,
  background: "plain",
  gridSize: 200,
  start: { x: -1050, y: 0, heading: 90 },
  walls: [],
  floor: [
    { kind: "line", id: "tape", points: buildTape(), width: 50, color: "BLACK" },
    { kind: "rect", id: "finish-pad", x: 1125, y: Math.round(wave(X1)), w: 150, h: 300, color: "GREEN" },
  ],
  objects: [],
  zones: [
    { id: "cp1", kind: "circle", x: -500, y: Math.round(wave(-500)), r: 180, label: "Checkpoint 1" },
    { id: "cp2", kind: "circle", x: 100, y: Math.round(wave(100)), r: 180, label: "Checkpoint 2" },
    { id: "cp3", kind: "circle", x: 700, y: Math.round(wave(700)), r: 180, label: "Checkpoint 3" },
    { id: "finish", kind: "rect", x: 1125, y: Math.round(wave(X1)), w: 150, h: 300, label: "Finish" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["cp1", "cp2", "cp3", "finish"], description: "Pass checkpoints 1, 2, 3, then the finish" },
    { type: "reachZone", zone: "finish", description: "Reach the green finish pad" },
  ],
  race: { finishZone: "finish", par: 10 },
  hardware: {},
  starter: {
    python: [
      "# Tape Dash: follow the edge of the tape to the green pad.",
      "# On the tape: steer right. Off the tape: steer left. Bigger steps = faster, but too big and you lose the line!",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(60, PERCENT)",
      "    drivetrain.set_turn_velocity(100, PERCENT)",
      "    while not down_eye.detect(GREEN):",
      "        if down_eye.detect(BLACK):",
      "            drivetrain.turn_for(RIGHT, 8, DEGREES)",
      "        else:",
      "            drivetrain.turn_for(LEFT, 8, DEGREES)",
      "        drivetrain.drive_for(FORWARD, 30, MM)",
      "    drivetrain.stop()",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
