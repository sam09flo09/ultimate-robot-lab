import type { World } from "../core/types";

export const colorDepot: World = {
  id: "color-depot",
  name: "Colour Depot",
  description:
    "Six coloured disks are scattered around the depot. Use the magnet to pick each one up and drop it on the bin of the same colour. " +
    "The front eye can tell you a disk's colour when it is right in front of the robot.",
  width: 2000,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -850, heading: 0 },
  walls: [
    // short dividers between the bins
    { id: "divider-1", a: { x: -300, y: 1000 }, b: { x: -300, y: 650 }, thickness: 30 },
    { id: "divider-2", a: { x: 300, y: 1000 }, b: { x: 300, y: 650 }, thickness: 30 },
  ],
  floor: [
    { kind: "rect", id: "red-pad", x: -650, y: 800, w: 400, h: 340, color: "RED" },
    { kind: "rect", id: "blue-pad", x: 0, y: 800, w: 400, h: 340, color: "BLUE" },
    { kind: "rect", id: "yellow-pad", x: 650, y: 800, w: 400, h: 340, color: "YELLOW" },
  ],
  objects: [
    { id: "disk-red-1", shape: "disk", x: 0, y: -500, size: 100, color: "RED", movable: true, pickable: true },
    { id: "disk-red-2", shape: "disk", x: 650, y: -200, size: 100, color: "RED", movable: true, pickable: true },
    { id: "disk-blue-1", shape: "disk", x: -550, y: -250, size: 100, color: "BLUE", movable: true, pickable: true },
    { id: "disk-blue-2", shape: "disk", x: 300, y: 250, size: 100, color: "BLUE", movable: true, pickable: true },
    { id: "disk-yellow-1", shape: "disk", x: -700, y: 100, size: 100, color: "YELLOW", movable: true, pickable: true },
    { id: "disk-yellow-2", shape: "disk", x: 700, y: -650, size: 100, color: "YELLOW", movable: true, pickable: true },
  ],
  zones: [
    { id: "red-bin", kind: "rect", x: -650, y: 800, w: 400, h: 340, label: "Red bin" },
    { id: "blue-bin", kind: "rect", x: 0, y: 800, w: 400, h: 340, label: "Blue bin" },
    { id: "yellow-bin", kind: "rect", x: 650, y: 800, w: 400, h: 340, label: "Yellow bin" },
  ],
  goals: [
    { type: "objectsInZone", zone: "red-bin", count: 2, color: "RED", description: "2 red disks in the red bin" },
    { type: "objectsInZone", zone: "blue-bin", count: 2, color: "BLUE", description: "2 blue disks in the blue bin" },
    { type: "objectsInZone", zone: "yellow-bin", count: 2, color: "YELLOW", description: "2 yellow disks in the yellow bin" },
  ],
  hardware: { magnet: true },
  starter: {
    python: [
      "# Colour Depot: carry every disk to the bin of the same colour.",
      "",
      "def main():",
      "    # A red disk is straight ahead. Drive up to it and grab it.",
      "    drivetrain.drive_for(FORWARD, 200, MM)",
      "    if front_eye.detect(RED):",
      "        magnet.energize(BOOST)",
      "    # Now carry it to the red bin (top-left) and drop it there.",
      "    drivetrain.turn_for(LEFT, 25, DEGREES)",
      "    drivetrain.drive_for(FORWARD, 1350, MM)",
      "    magnet.energize(DROP)",
      "",
      "start(main)",
      "",
    ].join("\n"),
  },
  version: 1,
};
