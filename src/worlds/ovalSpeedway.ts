import type { FloorShape, World } from "../core/types";

/*
 * Race: two laps around a walled infield, clockwise. The robot starts on the left straight just
 * behind the chequered line, facing up. Each lap: checkpoints 1 (top), 2 (right), 3 (bottom), then
 * back across the line. The track is 600 mm wide all the way round.
 * The starter drives square corners at 30% — it finishes, but slowly. Students can speed it up.
 */
function chequers(x0: number, y0: number, cols: number, rows: number, sq: number): FloorShape[] {
  const out: FloorShape[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if ((r + c) % 2) continue;
    out.push({ kind: "rect", id: `chq-${r}-${c}`, x: x0 + sq / 2 + c * sq, y: y0 + sq / 2 + r * sq, w: sq, h: sq, color: "BLACK" });
  }
  return out;
}

export const ovalSpeedway: World = {
  id: "oval-speedway",
  name: "Oval Speedway",
  description:
    "RACE · 2 laps. Drive clockwise round the infield: checkpoint 1 (top), 2 (right), 3 (bottom), then cross the " +
    "chequered line. The clock runs in robot time, so the Speed buttons don't change your time — only a faster program does.",
  width: 2400,
  height: 1600,
  background: "plain",
  gridSize: 200,
  start: { x: -900, y: -250, heading: 0 },
  walls: [
    { id: "infield-top", a: { x: -600, y: 200 }, b: { x: 600, y: 200 }, thickness: 20 },
    { id: "infield-right", a: { x: 600, y: 200 }, b: { x: 600, y: -200 }, thickness: 20 },
    { id: "infield-bottom", a: { x: 600, y: -200 }, b: { x: -600, y: -200 }, thickness: 20 },
    { id: "infield-left", a: { x: -600, y: -200 }, b: { x: -600, y: 200 }, thickness: 20 },
  ],
  floor: [
    { kind: "rect", id: "infield", x: 0, y: 0, w: 1180, h: 380, color: "GREEN" },
    ...chequers(-1200, -50, 12, 2, 50),
  ],
  objects: [],
  zones: [
    { id: "cp1", kind: "circle", x: 0, y: 500, r: 250, label: "Checkpoint 1" },
    { id: "cp2", kind: "circle", x: 900, y: 0, r: 250, label: "Checkpoint 2" },
    { id: "cp3", kind: "circle", x: 0, y: -500, r: 250, label: "Checkpoint 3" },
    { id: "finish", kind: "rect", x: -900, y: 0, w: 600, h: 100, label: "Finish line" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["cp1", "cp2", "cp3", "finish"], description: "Pass checkpoints 1, 2, 3, then the finish line" },
    { type: "reachZone", zone: "finish", description: "Cross the finish line" },
  ],
  race: { finishZone: "finish", par: 18, laps: 2 },
  hardware: {},
  starter: {
    python: [
      "# Oval Speedway: 2 laps, clockwise. Can you beat the par time?",
      "# Ideas: faster drive and turn velocity, fewer stops, cutting corners.",
      "",
      "def main():",
      "    drivetrain.set_drive_velocity(30, PERCENT)",
      "    drivetrain.drive_for(FORWARD, 750, MM)",
      "    for lap in range(2):",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        drivetrain.drive_for(FORWARD, 1800, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        drivetrain.drive_for(FORWARD, 1000, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        drivetrain.drive_for(FORWARD, 1800, MM)",
      "        drivetrain.turn_for(RIGHT, 90, DEGREES)",
      "        drivetrain.drive_for(FORWARD, 1000, MM)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
