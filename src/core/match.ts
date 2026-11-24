/**
 * SHARED CONTRACT — two-robot match mode (autonomous period, then driver control, with scoring).
 *
 *   src/match/engine/  (match-engine agent)  createMatchSim, createIsolatedRunner, GAMES
 *   src/match/ui/      (match-ui agent)      the Match screen, per-player input, scoreboard
 *
 * Student program shape for matches (Python; blocks/flowchart emit the same):
 *
 *     def autonomous():
 *         drivetrain.drive_for(FORWARD, 600, MM)
 *
 *     def driver_control():
 *         while True:
 *             left_motor.spin(FORWARD, controller.axis3.position(), PERCENT)
 *             right_motor.spin(FORWARD, controller.axis2.position(), PERCENT)
 *             wait(20, MSEC)
 *
 *     competition(autonomous, driver_control)
 *
 * Outside a match (normal Run), competition(a, d) simply runs a() then d() so students can test.
 * In a match, the host ends the autonomous period by calling PythonRunner.nextPeriod(): motion stops,
 * autonomous() is interrupted at its next statement, and driver_control() starts.
 */
import type { ColorName, Pose, RobotConfig, SimEvent, SimState, World, RobotController } from "./types";
import type { ControllerInput, PythonRunner, RunnerOptions } from "./modules";

export type Team = "A" | "B";
export const TEAM_COLOR: Record<Team, string> = { A: "#D63B2F", B: "#2F6FD6" };   // red, blue

export type ScoringRule =
  /** points for each object (optionally of a colour) resting in the zone at the moment of scoring */
  | { kind: "objectsInZone"; team: Team; zone: string; points: number; color?: ColorName; label: string }
  /** points if a robot of `team` ("any": each robot scores for its own team) is inside the zone at the END of the match */
  | { kind: "parkInZone"; team: Team | "any"; zone: string; points: number; label: string }
  /** points for each object (optionally of a colour) resting on the platform */
  | { kind: "objectsOnPlatform"; team: Team; platform: string; points: number; color?: ColorName; label: string };

export interface MatchGame {
  id: string;
  name: string;                 // ORIGINAL name — no names from other products
  description: string;          // student-facing rules in plain language
  world: World;                 // the field; Team A starts at world.start
  startB: Pose;                 // Team B start
  autonomousSeconds: number;    // default 15
  driverSeconds: number;        // default 60
  scoring: ScoringRule[];
  /** Bonus to the team leading at the end of autonomous (0 = none; tie = split). */
  autonomousBonus: number;
}

export interface ScoreLine { team: Team; label: string; points: number; count?: number; }
export interface MatchScore {
  A: number; B: number;
  lines: ScoreLine[];           // breakdown for the end screen
  autonomousWinner: Team | "tie" | null;   // null until autonomous has ended
}

export type MatchPhase = "idle" | "autonomous" | "driver" | "ended";

/** One robot in the match: same shape as a Sim's robot side. */
export interface MatchRobot {
  team: Team;
  readonly state: SimState;          // this robot's view: its own pose/sensors; `objects` = the SHARED objects
  readonly controller: RobotController;
}

export interface MatchSim {
  readonly game: MatchGame;
  readonly robots: Record<Team, MatchRobot>;
  readonly phase: MatchPhase;
  readonly time: number;             // sim seconds since the match started
  /** Advance sim time (fixed substeps inside). Robots collide with each other, walls, platforms and
   *  shared objects; either robot can push/pick up shared objects. Deterministic. */
  step(dt: number): void;
  /** Phase transitions are driven by the host (the UI), which also tells the runners. */
  setPhase(p: MatchPhase): void;
  reset(): void;                     // both robots + objects back to the start; phase idle
  abort(): void;                     // reject pending motion of both robots with STOPPED
  score(): MatchScore;               // live score (objects scored "at the moment"); park rules count only when phase === "ended"
  onEvent(cb: (team: Team, e: SimEvent) => void): () => void;
}

/** A Python runner isolated from the page's own Skulpt instance (one per robot), e.g. in a hidden
 *  same-origin iframe. Same API as PythonRunner, plus nextPeriod(). */
export interface IsolatedRunner extends PythonRunner {
  /** Match only: end autonomous() and start driver_control(). No-op if competition() isn't used. */
  nextPeriod(): void;
  /** Remove the hidden frame and free it. */
  dispose(): void;
}
export interface IsolatedRunnerOptions extends Omit<RunnerOptions, "controller" | "input"> {
  controller: RobotController;
  input?: ControllerInput;
  /** Where to put the hidden frame (default document.body). */
  frameHost?: HTMLElement;
}

/** Where Team B's program comes from in the Match screen. */
export type OpponentSource =
  | { kind: "practice"; level: "easy" | "medium" }   // built-in practice bot program (src/match/engine/practiceBots.ts)
  | { kind: "file"; python: string; name: string; robot?: RobotConfig }
  | { kind: "mirror" }                                // the same program as Team A
  | { kind: "none" };                                 // robot B sits still

/** Which input drives each team's controller during the driver period. */
export type PlayerInput = "keyboard-left" | "keyboard-right" | "gamepad-1" | "gamepad-2" | "touch" | "program-only";
