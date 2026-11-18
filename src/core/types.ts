/**
 * SHARED CONTRACT — every subsystem codes against this file.
 * Do not change it without updating docs/ARCHITECTURE.md and telling the integrator.
 *
 * Coordinate system (same as the original Grid Robot Sim):
 *   - Units are millimetres. Origin (0,0) is the CENTRE of the field.
 *   - +x is right, +y is UP (screen-up). Renderers must flip y.
 *   - Heading is in degrees, 0 = facing +y (up), increasing CLOCKWISE (90 = right).
 *     Heading is always normalised to [0, 360).
 */

export type Vec = { x: number; y: number };
export type Pose = { x: number; y: number; heading: number };

/** Colours the robot's eye sensors can name. Student API uses these upper-case. */
export type ColorName = "RED" | "GREEN" | "BLUE" | "YELLOW" | "ORANGE" | "PURPLE" | "WHITE" | "BLACK" | "NONE";

/** Hex values renderers should use for each named colour (floor and objects). */
export const COLOR_HEX: Record<ColorName, string> = {
  RED: "#D63B2F",
  GREEN: "#2E9E4F",
  BLUE: "#2F6FD6",
  YELLOW: "#F2C230",
  ORANGE: "#FF6A1A",
  PURPLE: "#8A4FC7",
  WHITE: "#FFFFFF",
  BLACK: "#1A1816",
  NONE: "transparent",
};

// ---------------------------------------------------------------- world model

/** A solid wall: a thick line segment. Robot and objects collide with it. */
export interface Wall { id?: string; a: Vec; b: Vec; thickness: number /* mm */; }

/** Paint on the floor. Read by the down_eye sensor. Drawn under everything. */
export type FloorShape =
  | { kind: "rect"; id?: string; x: number; y: number; w: number; h: number; color: ColorName } // x,y = centre
  | { kind: "circle"; id?: string; x: number; y: number; r: number; color: ColorName }
  | { kind: "line"; id?: string; points: Vec[]; width: number; color: ColorName }; // polyline tape

/** A loose object. Movable objects get pushed by the robot; pickable ones can be lifted by the magnet. */
export interface WorldObject {
  id: string;
  shape: "disk" | "box";
  x: number; y: number;
  size: number;            // disk: diameter; box: side length (mm)
  color: ColorName;
  movable: boolean;        // can be pushed
  pickable: boolean;       // magnet can lift it (implies movable)
  rotation?: number;       // boxes only, degrees
}

/** A named rectangular or circular area used by goals. Not physical. */
export type Zone =
  | { id: string; kind: "rect"; x: number; y: number; w: number; h: number; label?: string }
  | { id: string; kind: "circle"; x: number; y: number; r: number; label?: string };

/** Declarative success conditions, checked by sim/goals.ts. All must pass for "challenge complete". */
export type Goal =
  | { type: "reachZone"; zone: string; description?: string }
  | { type: "objectsInZone"; zone: string; count: number; color?: ColorName; description?: string }
  | { type: "visitInOrder"; zones: string[]; description?: string }
  | { type: "noWallHits"; description?: string }
  | { type: "endFacing"; heading: number; tolerance?: number; description?: string }
  | { type: "maxTime"; seconds: number; description?: string };   // sim time, not wall-clock

export interface World {
  id: string;
  name: string;
  description?: string;          // shown to students; plain text
  width: number; height: number; // field size in mm (centre at origin)
  background?: "plain" | "grid" | "numberGrid"; // numberGrid = the original 10x10 numbered squares
  gridSize?: number;             // mm per square for grid/numberGrid (default 200)
  start: Pose;
  walls: Wall[];                 // the outer border is implicit (always solid) — do not list it
  floor: FloorShape[];
  objects: WorldObject[];
  zones: Zone[];
  goals: Goal[];
  /** Which optional robot hardware is fitted in this world. Missing = false. */
  hardware?: { pen?: boolean; magnet?: boolean };
  /** Starter code for this playground, if any. */
  starter?: { python?: string };
  version: 1;
}

// ---------------------------------------------------------------- simulation state

export interface PenStroke { color: ColorName; width: number; points: Vec[]; }

export interface SimState {
  time: number;                  // simulated seconds since reset
  robot: Pose;
  robotSize: number;             // square footprint side, mm (140 default)
  objects: WorldObject[];        // CURRENT positions (copied from world on reset)
  carrying: string | null;       // id of object held by magnet
  penDown: boolean;
  penColor: ColorName;
  strokes: PenStroke[];
  path: Vec[];                   // breadcrumb trail of robot centre (for "show path")
  wallHits: number;              // count of distinct collisions with walls/border
  bumperPressed: boolean;
  /** Ray from distance sensor this frame, for drawing. null if nothing in range. */
  distanceRay: { from: Vec; to: Vec; hit: boolean } | null;
  visitedZones: string[];        // zone ids in first-entry order
}

export interface GoalResult { goal: Goal; passed: boolean; detail: string; }

/** Events the sim emits; the UI logs them. */
export type SimEvent =
  | { type: "wallHit"; time: number }
  | { type: "pickedUp"; objectId: string; time: number }
  | { type: "dropped"; objectId: string; time: number }
  | { type: "zoneEntered"; zoneId: string; time: number }
  | { type: "goalsComplete"; time: number };

// ---------------------------------------------------------------- the controller

export type DriveDir = "FORWARD" | "REVERSE";
export type TurnDir = "LEFT" | "RIGHT";

/**
 * The ONLY way the student-code runtime touches the robot.
 * Implemented by sim/ (createSim().controller). Used by runtime/.
 *
 * - Methods returning Promise resolve when the motion finishes IN SIM TIME
 *   (the sim is advanced by Sim.step; promises never resolve on their own).
 * - Every Promise rejects with Error("STOPPED") if Sim.abort() is called.
 * - Velocities are percent 0..100. 100% drive = 800 mm/s, 100% turn = 360 deg/s (50% = the original sim's speeds).
 * - drive()/turn() without "for" start continuous motion and return immediately; stop() ends it.
 * - A drive_for that is blocked by a wall or object ends early (resolves) — it never hangs.
 */
export interface RobotController {
  driveFor(dir: DriveDir, mm: number): Promise<void>;
  turnFor(dir: TurnDir, degrees: number): Promise<void>;
  turnToHeading(degrees: number): Promise<void>;
  drive(dir: DriveDir): void;
  turn(dir: TurnDir): void;
  stop(): void;
  setDriveVelocity(percent: number): void;
  setTurnVelocity(percent: number): void;
  setHeading(degrees: number): void;      // re-zeroes the gyro reading, does not move the robot
  heading(): number;                      // gyro reading, [0,360)
  rotation(): number;                     // cumulative, unbounded, clockwise positive
  isDone(): boolean;                      // true when no motion in progress
  wait(seconds: number): Promise<void>;   // sim-time wait

  // sensors
  distanceMM(): number;                   // to nearest wall/object straight ahead; 3000 if nothing within range
  distanceFound(): boolean;               // something within 1000 mm
  frontColor(): ColorName;                // colour of object directly ahead within 100 mm, else NONE
  frontNear(): boolean;                   // object within 100 mm ahead
  frontBrightness(): number;              // 0..100
  downColor(): ColorName;                 // floor colour under robot centre (WHITE if bare floor)
  downBrightness(): number;               // 0..100
  bumperPressed(): boolean;
  positionX(): number;                    // mm
  positionY(): number;                    // mm
  timer(): number;                        // sim seconds since brain.timer reset
  resetTimer(): void;

  // hardware: return false ONLY when the world doesn't fit that hardware
  // (magnet(true) with nothing in front still returns true — it just picks up nothing)
  penDown(down: boolean): boolean;
  setPenColor(c: ColorName): boolean;
  magnet(on: boolean): boolean;           // on = pick up object directly in front; off = drop
}

export interface Sim {
  readonly world: World;
  readonly state: SimState;
  readonly controller: RobotController;
  /** Advance simulated time. Called by the app loop with (realDt * speedMultiplier). */
  step(dtSeconds: number): void;
  /** Reset robot and objects to the world's start. Rejects any pending motion with STOPPED. */
  reset(): void;
  /** Reject all pending controller promises with Error("STOPPED") and halt motion. */
  abort(): void;
  evaluateGoals(): GoalResult[];
  onEvent(cb: (e: SimEvent) => void): () => void;
}
