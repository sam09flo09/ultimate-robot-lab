/**
 * SHARED CONTRACT — the public entry point of each subsystem.
 * Each folder's index.ts must export a function matching these signatures.
 *
 *   src/sim/index.ts      export function createSim(world: World, config?: RobotConfig): Sim
 *   src/render/index.ts   export function createRenderer(canvas: HTMLCanvasElement): Renderer
 *   src/worlds/index.ts   export const PLAYGROUNDS: World[]; export function getPlayground(id): World | undefined
 *   src/runtime/index.ts  export function createPythonRunner(opts: RunnerOptions): PythonRunner
 *   src/blocks/index.ts   export function createBlocksEditor(host: HTMLElement, opts: BlocksOptions): BlocksEditor
 *   src/editor/index.ts   export function createLevelEditor(host: HTMLElement, opts: LevelEditorOptions): LevelEditor
 *   src/ui/              the app shell; src/main.ts wires everything together
 */
import type { World, SimState, RobotController, ColorName, RobotConfig } from "./types";
import type { Activity, ActivityProgress } from "./activity";

// ---------------------------------------------------------------- render

export interface RenderOptions {
  showPath: boolean;
  showSensors: boolean;     // draw distance ray etc.
  showZones: boolean;       // outline goal zones
  /** Optional overlay for the level editor: id of selected item to highlight.
   *  The special value "start" outlines the robot start pose. */
  selectedId?: string | null;
}
export interface Renderer {
  /** Draw one frame. Must be cheap: called every animation frame on a Chromebook. */
  draw(world: World, state: SimState | null, opts: RenderOptions): void;
  /** Convert a canvas-pixel point (e.g. from a mouse event, CSS px relative to canvas) to world mm. */
  toWorld(px: number, py: number): { x: number; y: number };
  /** Inverse of toWorld. */
  toCanvas(x: number, y: number): { px: number; py: number };
  /** Call after the canvas element is resized. Handles devicePixelRatio.
   *  The canvas must be sized by CSS (e.g. width/height 100% of its box). */
  resize(): void;
  /** Rebuild the cached static layer (call after editing a world object in place). */
  invalidate(): void;
  /** Optional zoom/pan (used by the level editor). zoom 1 = whole field fits (the default view);
   *  cx/cy = the world-mm point shown at the canvas centre. null resets to the default view.
   *  draw(), toWorld() and toCanvas() all honour it. The main app never calls this. */
  setView?(view: { zoom: number; cx: number; cy: number } | null): void;
}

// ---------------------------------------------------------------- 3D renderer (src/render3d)
//   export function createRenderer3D(canvas: HTMLCanvasElement, opts?: Renderer3DOptions): Renderer3D
//   export function webglSupported(): boolean
// Draws the SAME World + SimState as the 2D renderer (the sim stays 2D: floor plane, heading
// clockwise from +y). World mm map to 3D as x → x, y → -z, height → +y.

export type CameraMode = "overhead" | "follow" | "orbit";
export type Quality = "low" | "high";

export interface Renderer3DOptions {
  quality?: Quality;        // default "high"; "low" = no shadows, pixel ratio 1, simpler models
}

export interface Renderer3D extends Renderer {
  setCamera(mode: CameraMode): void;
  readonly camera: CameraMode;
  setQuality(q: Quality): void;
  /** Rolling average of the last ~60 frame times in ms (draw() → next draw()). For the auto-fallback. */
  frameMs(): number;
  /** Re-centre the orbit / overhead camera on the whole field. */
  resetCamera(): void;
  /** Free GPU resources and remove the canvas's listeners. The canvas is left in place. */
  dispose(): void;
}

// ---------------------------------------------------------------- python runtime

export interface RunnerOptions {
  controller: RobotController;
  /** Fires when execution moves to a new source line (1-based). Used for highlighting. */
  onLine: (line: number) => void;
  /** A statement-level log entry ("drive_for(FORWARD, 200, MM)"), print() output, or warning. */
  onLog: (entry: { line: number; text: string; kind: "step" | "print" | "warn" }) => void;
  /** brain.screen output (separate from the log). */
  onScreen?: (op: { kind: "print"; text: string } | { kind: "clear" } | { kind: "newline" }) => void;
  /** debugger: fires when the program halts (pause(), step(), or a run started paused).
   *  `line` is the line about to run (or the motion line still in progress); `vars` = the student's variables. */
  onPause?: (info: { line: number; vars: VarView[] }) => void;
  /** controller: the live controller input. Read synchronously by controller.* calls.
   *  Absent = a controller that is never touched (all axes 0, no buttons). */
  input?: ControllerInput;
  /** controller: fires once per run, the first time the program reads the controller
   *  (the app uses it to show the on-screen controller and force 1× speed). */
  onControllerUsed?: () => void;
}

// ---------------------------------------------------------------- controller (driver control)
//   src/input/index.ts   export function createInputHub(opts: InputHubOptions): InputHub

/** VEX-style controller layout. Axes are -100..100 (up/right positive):
 *  axis1 = right stick X, axis2 = right stick Y, axis3 = left stick Y, axis4 = left stick X. */
export type AxisName = "axis1" | "axis2" | "axis3" | "axis4";
export type ButtonName = "buttonL1" | "buttonL2" | "buttonR1" | "buttonR2"
  | "buttonUp" | "buttonDown" | "buttonLeft" | "buttonRight"
  | "buttonX" | "buttonB" | "buttonY" | "buttonA";
export const AXIS_NAMES: AxisName[] = ["axis1", "axis2", "axis3", "axis4"];
export const BUTTON_NAMES: ButtonName[] = ["buttonL1", "buttonL2", "buttonR1", "buttonR2",
  "buttonUp", "buttonDown", "buttonLeft", "buttonRight", "buttonX", "buttonB", "buttonY", "buttonA"];

export interface ControllerState {
  axes: Record<AxisName, number>;          // integers -100..100
  buttons: Record<ButtonName, boolean>;
}
export interface ControllerInput {
  /** Current state; must be cheap (called on every controller.* read). */
  read(): ControllerState;
}

export type InputSourceKind = "keyboard" | "gamepad" | "touch";
export interface InputHubOptions {
  /** Element whose keyboard events count (keys are ignored while typing in an editor/input). */
  keyTarget: Window | HTMLElement;
  /** Container for the on-screen controller (two joysticks + buttons), shown on demand. */
  touchHost: HTMLElement;
}
/** Merges keyboard + gamepad (Gamepad API) + on-screen touch controls into one ControllerInput.
 *  Largest-magnitude axis value wins; a button is pressed if pressed on any source. */
export interface InputHub extends ControllerInput {
  /** Listen to inputs only while true (the app enables it while a program runs). */
  setActive(on: boolean): void;
  showTouchControls(show: boolean): void;
  /** Which sources are currently connected/active (for the status chip). */
  sources(): InputSourceKind[];
  onChange(cb: () => void): () => void;   // fires when sources change (gamepad connected, etc.)
  dispose(): void;
}
/** debugger: one row of the Variables panel. `value` is a short, safe repr (≤ ~80 chars). */
export interface VarView {
  name: string;
  value: string;
  type: string;              // "int", "float", "str", "list", ...
  scope: "global" | "local";
}
/** debugger: options for PythonRunner.run(). */
export interface RunOptions {
  /** Halt before the first line (for "Step through"). */
  startPaused?: boolean;
}
export interface FriendlyError {
  line: number;            // 0 if unknown
  type: string;            // "SyntaxError", "NameError", ...
  html: string;            // student-friendly explanation, safe HTML
  raw: string;             // original Python message
}
export type RunResult =
  | { status: "finished"; startCalled: boolean; steps: number }
  | { status: "stopped" }
  | { status: "error"; error: FriendlyError };

export interface PythonRunner {
  /** Runs to completion (or stop/error). Never rejects — errors come back as RunResult. */
  run(source: string, runOpts?: RunOptions): Promise<RunResult>;
  /** Request stop; the pending run() resolves with {status:"stopped"} soon after. Works while paused. */
  stop(): void;
  readonly running: boolean;
  // ---- debugger (additive)
  /** Halt at the next line. If the program is waiting for a motion or wait(), it halts right away
   *  (the app must stop stepping the sim while `paused`, so the robot freezes mid-motion). */
  pause(): void;
  /** Carry on after a pause. */
  resume(): void;
  /** While paused: run until the next line, then pause again. While running: same as pause(). */
  step(): void;
  /** True while the program is halted. */
  readonly paused: boolean;
  /** The student's variables as of the last time Python handed control back (cheap; for live updates). */
  variables(): VarView[];
}

// ---------------------------------------------------------------- blocks

export interface BlocksOptions {
  onChange: () => void;
  /** Hardware available in the current world; hide pen/magnet categories when false. */
  hardware: { pen: boolean; magnet: boolean };
}
export interface BlocksEditor {
  /** Python generated from the workspace. Always a complete program ending in start(main). */
  getPython(): string;
  /** Serialisable workspace (Blockly JSON serialisation). */
  getState(): unknown;
  setState(state: unknown): void;
  /** Highlight the block that produced a given generated-Python line (0 = clear). */
  highlightLine(line: number): void;
  setHardware(hw: { pen: boolean; magnet: boolean }): void;
  setReadOnly(ro: boolean): void;
  resize(): void;          // call when the host element changes size / becomes visible
  dispose(): void;
}

// ---------------------------------------------------------------- level editor

export interface LevelEditorOptions {
  world: World;            // edited in a deep copy
  onChange: (w: World) => void;
  onTest: (w: World) => void; // "Test this level" button
  /** Hosted inside the app shell, which supplies its own Save / Test buttons: hide the editor's. */
  embedded?: boolean;
}
export interface LevelEditor {
  getWorld(): World;
  setWorld(w: World): void;
  dispose(): void;
}

// ---------------------------------------------------------------- project file (.robolab)

/** What students save to Drive and turn in on Classroom. JSON, file extension ".robolab". */
export interface ProjectFile {
  format: "robot-lab-project";
  version: 1;
  name: string;
  mode: "blocks" | "python" | "flowchart"; // flowchart: third mode (src/flowchart)
  python: string;               // always present (for blocks/flowchart mode it's the generated code)
  blocks: unknown | null;       // Blockly state if mode === "blocks"
  /** flowchart: the flowchart (src/flowchart FlowChart JSON) if mode === "flowchart". */
  flowchart?: unknown | null;
  worldId: string;              // a playground id, or "custom"
  customWorld: World | null;    // embedded when worldId === "custom" (teacher-made challenge)
  savedAt: string;              // ISO date
  /** builder: the student's robot design (missing = DEFAULT_ROBOT). */
  robot?: RobotConfig;
  /** Optional: the guided activity this project belongs to, with the student's progress,
   *  so a teacher opening a turned-in file sees which steps were completed. */
  activity?: { activity: Activity; progress: ActivityProgress } | null;
}

/** What teachers share: a challenge file (".robolab-level"). */
export interface LevelFile {
  format: "robot-lab-level";
  version: 1;
  world: World;
}

export type { ColorName };
