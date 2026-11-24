/**
 * Small custom worlds used by the built-in activities when none of the six playgrounds fits a step.
 * Each one is a plain, valid World (see core/types.ts). Treat them as read-only.
 */
import type { World } from "../../core/types";
import { mazeWalls } from "../../worlds/helpers";
import { stackShop } from "../../worlds/stackShop"; // arm

/** A short course with a wall across it. The robot must stop in the zone just before the wall. */
export const WALL_STOP_1: World = {
  id: "act-wall-stop-1",
  name: "Wall Stop 1",
  description: "Drive up to the wall and stop in the yellow zone without touching the wall.",
  width: 1200,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -800, heading: 0 },
  walls: [{ id: "stop-wall", a: { x: -400, y: 500 }, b: { x: 400, y: 500 }, thickness: 40 }],
  floor: [{ kind: "rect", id: "stop-paint", x: 0, y: 325, w: 300, h: 150, color: "YELLOW" }],
  objects: [],
  // Wall face is at y = 480. Robot centre in 250..400 means its front is 10..160 mm from the wall.
  zones: [{ id: "stop-zone", kind: "rect", x: 0, y: 325, w: 300, h: 150, label: "Stop zone" }],
  goals: [
    { type: "reachZone", zone: "stop-zone", description: "Stop in the yellow zone" },
    { type: "noWallHits", description: "Don't touch the wall" },
  ],
  hardware: {},
  version: 1,
};

/** Same idea, but the wall is much closer. Code that uses the sensor still works; fixed distances crash. */
export const WALL_STOP_2: World = {
  id: "act-wall-stop-2",
  name: "Wall Stop 2",
  description: "The wall has moved! Stop in the yellow zone without touching the wall.",
  width: 1200,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -800, heading: 0 },
  walls: [{ id: "stop-wall", a: { x: -400, y: -100 }, b: { x: 400, y: -100 }, thickness: 40 }],
  floor: [{ kind: "rect", id: "stop-paint", x: 0, y: -275, w: 300, h: 150, color: "YELLOW" }],
  objects: [],
  // Wall face is at y = -120. Robot centre in -350..-200 means its front is 10..160 mm from the wall.
  zones: [{ id: "stop-zone", kind: "rect", x: 0, y: -275, w: 300, h: 150, label: "Stop zone" }],
  goals: [
    { type: "reachZone", zone: "stop-zone", description: "Stop in the yellow zone" },
    { type: "noWallHits", description: "Don't touch the wall" },
  ],
  hardware: {},
  version: 1,
};

/** A wall to bump into on purpose, then back away into the green zone. */
export const BUMPER_TEST: World = {
  id: "act-bumper-test",
  name: "Bumper Test",
  description: "Drive until the bumper touches the wall, then back up into the green zone.",
  width: 1200,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -800, heading: 0 },
  walls: [{ id: "bump-wall", a: { x: -400, y: 300 }, b: { x: 400, y: 300 }, thickness: 40 }],
  floor: [{ kind: "rect", id: "back-paint", x: 0, y: -100, w: 300, h: 300, color: "GREEN" }],
  objects: [],
  zones: [
    { id: "touch-zone", kind: "rect", x: 0, y: 200, w: 400, h: 60, label: "Wall touch" },
    { id: "back-zone", kind: "rect", x: 0, y: -100, w: 300, h: 300, label: "Back-up zone" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["touch-zone", "back-zone"], description: "Touch the wall, then back into the green zone" },
  ],
  hardware: {},
  version: 1,
};

/** The robot starts on a green pad, for a first if/else test. */
export const COLOR_CHECK: World = {
  id: "act-color-check",
  name: "Colour Check",
  description: "The robot is sitting on a green pad. What does the down eye see?",
  width: 1200,
  height: 1200,
  background: "plain",
  gridSize: 200,
  start: { x: 0, y: 0, heading: 0 },
  walls: [],
  floor: [{ kind: "rect", id: "green-pad", x: 0, y: 0, w: 300, h: 300, color: "GREEN" }],
  objects: [],
  zones: [],
  goals: [],
  hardware: {},
  version: 1,
};

/** The number grid with three corner markers, for the "logic bug" detective step. */
export const GRID_CORNERS: World = {
  id: "act-grid-corners",
  name: "Grid Corners",
  description: "Drive a square: visit squares 21, 23 and 3 in that order, then finish back in square 1.",
  width: 2000,
  height: 2000,
  background: "numberGrid",
  gridSize: 200,
  start: { x: -900, y: -900, heading: 0 },
  walls: [],
  floor: [],
  objects: [],
  zones: [
    { id: "sq21", kind: "circle", x: -900, y: -500, r: 60, label: "Square 21" },
    { id: "sq23", kind: "circle", x: -500, y: -500, r: 60, label: "Square 23" },
    { id: "sq3", kind: "circle", x: -500, y: -900, r: 60, label: "Square 3" },
  ],
  goals: [{ type: "visitInOrder", zones: ["sq21", "sq23", "sq3"], description: "Visit squares 21, 23 and 3 in order" }],
  hardware: { pen: true },
  version: 1,
};

/** One red disk and one red bin, straight ahead. */
export const MINI_DEPOT: World = {
  id: "act-mini-depot",
  name: "Mini Depot",
  description: "One red disk, one red bin. Pick up the disk with the magnet and drop it in the bin.",
  width: 1200,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: 0, y: -800, heading: 0 },
  walls: [],
  floor: [{ kind: "rect", id: "red-pad", x: 0, y: 700, w: 400, h: 300, color: "RED" }],
  objects: [{ id: "disk-red", shape: "disk", x: 0, y: -300, size: 100, color: "RED", movable: true, pickable: true }],
  zones: [{ id: "red-bin", kind: "rect", x: 0, y: 700, w: 400, h: 300, label: "Red bin" }],
  goals: [{ type: "objectsInZone", zone: "red-bin", count: 1, color: "RED", description: "The red disk is in the red bin" }],
  hardware: { magnet: true },
  version: 1,
};

/*
 * A second 5 x 5 maze (400 mm cells, same size as Corridor Quest) with a different layout,
 * to test whether a maze program really "thinks" or only memorised one route.
 */
const MAZE2_PASSAGES: [number, number, number, number][] = [
  [0, 0, 1, 0], [1, 0, 2, 0], [2, 0, 3, 0], [3, 0, 4, 0],
  [4, 0, 4, 1], [4, 1, 3, 1], [3, 1, 2, 1], [2, 1, 1, 1], [1, 1, 0, 1],
  [4, 1, 4, 2],
  [0, 1, 0, 2], [0, 2, 1, 2], [1, 2, 2, 2], [2, 2, 3, 2], [3, 2, 3, 3],
  [4, 3, 3, 3], [3, 3, 2, 3], [2, 3, 1, 3], [1, 3, 0, 3],
  [0, 3, 0, 4], [0, 4, 1, 4], [1, 4, 2, 4], [2, 4, 3, 4], [3, 4, 4, 4],
];

export const MAZE_2: World = {
  id: "act-maze-2",
  name: "Corridor Quest 2",
  description: "A brand-new maze. Find the green exit in the top-right corner without bumping the walls.",
  width: 2000,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: -800, y: -800, heading: 0 },
  walls: mazeWalls(5, 5, 400, -1000, -1000, MAZE2_PASSAGES, 40, "maze2"),
  floor: [{ kind: "rect", id: "exit-pad", x: 800, y: 800, w: 300, h: 300, color: "GREEN" }],
  objects: [],
  zones: [{ id: "exit", kind: "rect", x: 800, y: 800, w: 320, h: 320, label: "Exit" }],
  goals: [
    { type: "reachZone", zone: "exit", description: "Reach the green exit" },
    { type: "noWallHits", description: "Don't hit any walls" },
  ],
  hardware: {},
  version: 1,
};

/**
 * Driver practice: drive (with the controller) up through the yellow checkpoint, turn right,
 * and park on the green target. A short wall stops you cutting the corner.
 */
export const DRIVER_PRACTICE: World = {
  id: "act-driver-practice",
  name: "Driver Practice",
  description: "Drive up through the yellow checkpoint, turn right, and reach the green target. Don't touch the wall.",
  width: 1200,
  height: 2000,
  background: "grid",
  gridSize: 200,
  start: { x: -300, y: -800, heading: 0 },
  // The wall's top end is at y = 120; the checkpoint/target row is y = 100..500, so there is room to turn above it.
  walls: [{ id: "corner-wall", a: { x: -100, y: -600 }, b: { x: -100, y: 100 }, thickness: 40 }],
  floor: [
    { kind: "rect", id: "checkpoint-paint", x: -300, y: 300, w: 400, h: 400, color: "YELLOW" },
    { kind: "rect", id: "target-paint", x: 300, y: 300, w: 400, h: 400, color: "GREEN" },
  ],
  objects: [],
  zones: [
    { id: "checkpoint", kind: "rect", x: -300, y: 300, w: 400, h: 400, label: "Checkpoint" },
    { id: "target", kind: "rect", x: 300, y: 300, w: 400, h: 400, label: "Target" },
  ],
  goals: [
    { type: "visitInOrder", zones: ["checkpoint", "target"], description: "Drive through the yellow checkpoint, then reach the green target" },
    { type: "noWallHits", description: "Don't touch the wall" },
  ],
  hardware: {},
  version: 1,
};

// arm: Stack Shop with one job at a time (a13 Arms and claws)
const { starter: _starter, ...shopNoStarter } = stackShop;
/** Stack Shop, but the only goal is the blue block on the low shelf. */
export const SHELF_DROP: World = {
  ...shopNoStarter,
  id: "act-shelf-drop",
  name: "Shelf Drop",
  description: "Pick up the blue block and put it on the low shelf (100 mm high). Lift it high enough first!",
  goals: [{ type: "objectsOnPlatform", platform: "low-shelf", count: 1, color: "BLUE", description: "The blue block is on the low shelf" }],
};
/** Stack Shop, but the only goal is a stack 3 tall on the pad. */
export const STACK_PAD: World = {
  ...shopNoStarter,
  id: "act-stack-pad",
  name: "Stack Pad",
  description: "Stack both red blocks on the orange anchor block to make a stack 3 blocks tall.",
  goals: [{ type: "stackHeight", count: 3, zone: "stack-pad", description: "A stack 3 blocks tall on the orange pad" }],
};

export const CUSTOM_WORLDS: World[] = [WALL_STOP_1, WALL_STOP_2, BUMPER_TEST, COLOR_CHECK, GRID_CORNERS, MINI_DEPOT, MAZE_2, DRIVER_PRACTICE, SHELF_DROP, STACK_PAD];
