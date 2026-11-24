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
  /** builder: how hard it is to push, in "robot strengths" (default 1). A robot whose
   *  pushStrength (see RobotConfig) is below this stalls against it instead of pushing it. */
  mass?: number;
  /** arm: height of the object's bottom above the floor, mm (0 = on the floor; >0 = on a platform or another object). */
  z?: number;
  /** arm: object height, mm (default: disk 30, box = size). Used for stacking and 3D drawing. */
  height?: number;
}

/** arm: a raised, solid block objects can be placed on. Robot and floor objects collide with it like a wall. */
export interface Platform { id: string; x: number; y: number; w: number; h: number; height: number; color?: ColorName; }

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
  | { type: "maxTime"; seconds: number; description?: string }    // sim time, not wall-clock
  // arm: objects resting on a platform (optionally of a colour), and a stack at least N objects tall
  | { type: "objectsOnPlatform"; platform: string; count: number; color?: ColorName; description?: string }
  | { type: "stackHeight"; count: number; zone?: string; description?: string };

/**
 * Race / time-trial settings (optional, additive). A race is finished when the robot enters
 * `finishZone` after visiting the checkpoint zones (the world's first visitInOrder goal, minus the
 * finish zone) in order, `laps` times. Times are SIM seconds (independent of the speed buttons).
 */
export interface RaceSpec {
  finishZone: string;
  par?: number;   // seconds of sim time: gold <= par, silver <= 1.25 x par, bronze otherwise
  laps?: number;  // default 1
}

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
  hardware?: { pen?: boolean; magnet?: boolean; arm?: boolean };
  /** arm: raised platforms (default none). */
  platforms?: Platform[];
  /** builder: limits for this world's robot. Missing = any legal RobotConfig.
   *  `locked` = students can't change the robot here (e.g. a fair race). */
  robotRules?: { locked?: boolean; maxSize?: number; config?: Partial<RobotConfig> };
  /** Starter code for this playground, if any. */
  starter?: { python?: string };
  /** Race / time-trial mode (see RaceSpec). Missing = not a race. */
  race?: RaceSpec;
  version: 1;
}

// ---------------------------------------------------------------- robot builder

/**
 * builder: the student's robot design. Every field has a default, so a missing config = today's robot.
 * Physics (sim/): top wheel speed = 800 mm/s × (wheelDiameter / 100) ÷ gearRatio;
 *   pushStrength = (motors / 2) × gearRatio × (100 / wheelDiameter)  (default robot = 1.0).
 *   Turn rate follows from wheel speed and track width (= size − 20 mm).
 *   drive_for distances and turn_for angles stay exact; only how long they take changes.
 */
export interface RobotConfig {
  size: number;            // square footprint side, mm: 120..200, default 140
  wheelDiameter: number;   // mm: 60, 80, 100 (default), 130
  gearRatio: number;       // output torque multiplier: 1/3, 1/2, 1 (default), 2, 3  (higher = slower, stronger)
  motors: 2 | 4;           // default 2; 4 doubles push strength
  /** Where the distance sensor and front eye sit along the front edge, mm from centre (−size/2..size/2). Default 0. */
  sensorOffset: number;
  name?: string;           // student's robot name, shown in the builder
}
export const DEFAULT_ROBOT: RobotConfig = { size: 140, wheelDiameter: 100, gearRatio: 1, motors: 2, sensorOffset: 0 };

/** arm: live arm/claw state. Arm angle 0 = down (claw at floor level), 90 = straight up.
 *  Claw reach is ~110 mm in front of the robot's front face; lift height at angle a = 300 × sin(a) mm. */
export interface ArmState { angle: number; clawClosed: boolean; holding: string | null; }

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
  /** builder: the robot design in use (DEFAULT_ROBOT if none). robotSize === config.size. */
  config?: RobotConfig;
  /** arm: present only when the world fits an arm. */
  arm?: ArmState;
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

  // driver control: independent left/right wheel speeds (differential drive)
  /** Spin the wheels continuously at these percents (-100..100; 100% = 800 mm/s at that wheel's
   *  rim, the same top speed as drive()). Supersedes any drive/turn/…_for motion (resolving its
   *  promise, like stop()). 0,0 stops. Track width (wheel to wheel) = 120 mm. Collisions, pushing,
   *  wall hits and the bumper behave as for drive(). Runs until changed, stop(), or abort(). */
  setWheelVelocities(leftPercent: number, rightPercent: number): void;

  // arm (only in worlds with hardware.arm; otherwise armAvailable() is false and the rest are no-ops)
  armAvailable(): boolean;
  /** Move the arm to an angle 0..90 at the arm velocity; resolves when there (or blocked). */
  armSpinTo(degrees: number): Promise<void>;
  /** Continuous arm motion: +1 up, −1 down, 0 stop. */
  armSpin(direction: 1 | -1 | 0): void;
  setArmVelocity(percent: number): void;  // default 50% = 60°/s
  armAngle(): number;
  /** Close (grab the object between the claw jaws, if any) or open (release it where it is:
   *  onto a platform/stack top if over one, else to the floor). Resolves after ~0.3 s sim time. */
  claw(closed: boolean): Promise<void>;
  clawHolding(): boolean;
}

export interface Sim {
  readonly world: World;
  /** builder: swap the robot design (clamped to legal values and world.robotRules); also resets. */
  setConfig(config: RobotConfig): void;
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
