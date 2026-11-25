/**
 * match: the built-in match games. Each is an ORIGINAL game (no names from real robotics competitions).
 *
 * Silo Sprint (3600 × 2400 mm field, origin at the centre):
 *   - Team A (red) starts on the left at (-1550, 0) facing right; Team B (blue) is the mirror image.
 *   - 17 yellow disks (80 mm, pickable) are spread across the middle, mirror-symmetric about x = 0.
 *   - Each team has a BIN (floor zone, 1 point per disk) in the corner by its own wall (top side),
 *     a raised SILO (platform 120 mm high, 3 points per disk resting on it) in the bottom corner,
 *     and a HOME zone around its start (2 points if the robot is parked there when the match ends).
 *   - Hardware: magnet + arm/claw. Autonomous 15 s, driver control 60 s, +5 for leading after autonomous.
 *
 * Geometry used by the practice bots (practiceBots.ts): bins are x ∈ [1300, 1800], y ∈ [400, 1200]
 * (mirrored for A); silo B is the box x ∈ [1500, 1740], y ∈ [-940, -700].
 */
import type { World, WorldObject } from "../../core/types";
import type { MatchGame } from "../../core/match";

const W = 3600, H = 2400;
const BIN = { x: 1550, y: 800, w: 500, h: 800 };
const HOME = { x: 1550, y: 0, w: 500, h: 500 };
const SILO = { x: 1620, y: -820, w: 240, h: 240, height: 120 };

/** Disk positions on Team A's half (x < 0) and the centre line; Team B's half mirrors them. */
const HALF_DISKS: Array<[number, number]> = [[-500, -600], [-500, -200], [-500, 200], [-500, 600], [-1000, -900], [-1000, 900]];
const CENTRE_DISKS: Array<[number, number]> = [[0, -800], [0, -400], [0, 0], [0, 400], [0, 800]];

function disks(): WorldObject[] {
  const out: WorldObject[] = [];
  const add = (id: string, x: number, y: number) =>
    out.push({ id, shape: "disk", x, y, size: 80, color: "YELLOW", movable: true, pickable: true });
  HALF_DISKS.forEach(([x, y], i) => add(`disk-a${i + 1}`, x, y));
  CENTRE_DISKS.forEach(([x, y], i) => add(`disk-c${i + 1}`, x, y));
  HALF_DISKS.forEach(([x, y], i) => add(`disk-b${i + 1}`, -x, y));
  return out;
}

export const SILO_SPRINT_WORLD: World = {
  id: "silo-sprint",
  name: "Silo Sprint",
  description: "Two robots, one field. Bring yellow disks to your bin (1 point) or stack them on your silo (3 points), then park at home.",
  width: W,
  height: H,
  background: "grid",
  gridSize: 200,
  start: { x: -HOME.x, y: HOME.y, heading: 90 },
  walls: [],
  floor: [
    { kind: "rect", id: "bin-a-paint", x: -BIN.x, y: BIN.y, w: BIN.w, h: BIN.h, color: "RED" },
    { kind: "rect", id: "bin-b-paint", x: BIN.x, y: BIN.y, w: BIN.w, h: BIN.h, color: "BLUE" },
    { kind: "line", id: "centre-line", points: [{ x: 0, y: -H / 2 }, { x: 0, y: H / 2 }], width: 20, color: "BLACK" },
  ],
  platforms: [
    { id: "silo-a", x: -SILO.x, y: SILO.y, w: SILO.w, h: SILO.h, height: SILO.height, color: "RED" },
    { id: "silo-b", x: SILO.x, y: SILO.y, w: SILO.w, h: SILO.h, height: SILO.height, color: "BLUE" },
  ],
  objects: disks(),
  zones: [
    { id: "bin-a", kind: "rect", x: -BIN.x, y: BIN.y, w: BIN.w, h: BIN.h, label: "Red bin" },
    { id: "bin-b", kind: "rect", x: BIN.x, y: BIN.y, w: BIN.w, h: BIN.h, label: "Blue bin" },
    { id: "home-a", kind: "rect", x: -HOME.x, y: HOME.y, w: HOME.w, h: HOME.h, label: "Red home" },
    { id: "home-b", kind: "rect", x: HOME.x, y: HOME.y, w: HOME.w, h: HOME.h, label: "Blue home" },
  ],
  goals: [],
  hardware: { magnet: true, arm: true },
  robotRules: { maxSize: 160 },
  version: 1,
};

export const SILO_SPRINT: MatchGame = {
  id: "silo-sprint",
  name: "Silo Sprint",
  description: [
    "Two robots share one field. Red starts on the left, blue on the right.",
    "Bring the yellow disks home: each disk in your bin scores 1 point, and each disk sitting on top of your silo scores 3 points (lift it with the arm and claw).",
    "A disk only counts when it is resting: not held by a magnet or a claw.",
    "Autonomous (15 s): your program drives on its own. The team ahead when it ends gets 5 bonus points.",
    "Driver control (60 s): drive with the controller.",
    "When time runs out, park in your home square for 2 more points.",
  ].join("\n"),
  world: SILO_SPRINT_WORLD,
  startB: { x: HOME.x, y: HOME.y, heading: 270 },
  autonomousSeconds: 15,
  driverSeconds: 60,
  autonomousBonus: 5,
  scoring: [
    { kind: "objectsInZone", team: "A", zone: "bin-a", points: 1, label: "Disks in the bin" },
    { kind: "objectsOnPlatform", team: "A", platform: "silo-a", points: 3, label: "Disks on the silo" },
    { kind: "parkInZone", team: "A", zone: "home-a", points: 2, label: "Parked at home" },
    { kind: "objectsInZone", team: "B", zone: "bin-b", points: 1, label: "Disks in the bin" },
    { kind: "objectsOnPlatform", team: "B", platform: "silo-b", points: 3, label: "Disks on the silo" },
    { kind: "parkInZone", team: "B", zone: "home-b", points: 2, label: "Parked at home" },
  ],
};

export const GAMES: MatchGame[] = [SILO_SPRINT];

export function getGame(id: string): MatchGame | undefined {
  return GAMES.find((g) => g.id === id);
}
