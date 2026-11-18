/**
 * SHARED CONTRACT — the public entry point of each subsystem.
 * Each folder's index.ts must export a function matching these signatures.
 *
 *   src/sim/index.ts      export function createSim(world: World): Sim
 *   src/render/index.ts   export function createRenderer(canvas: HTMLCanvasElement): Renderer
 *   src/worlds/index.ts   export const PLAYGROUNDS: World[]; export function getPlayground(id): World | undefined
 *   src/runtime/index.ts  export function createPythonRunner(opts: RunnerOptions): PythonRunner
 *   src/blocks/index.ts   export function createBlocksEditor(host: HTMLElement, opts: BlocksOptions): BlocksEditor
 *   src/editor/index.ts   export function createLevelEditor(host: HTMLElement, opts: LevelEditorOptions): LevelEditor
 *   src/ui/              the app shell; src/main.ts wires everything together
 */
import type { World, SimState, RobotController, ColorName } from "./types";

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
  run(source: string): Promise<RunResult>;
  /** Request stop; the pending run() resolves with {status:"stopped"} soon after. */
  stop(): void;
  readonly running: boolean;
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
  mode: "blocks" | "python";
  python: string;               // always present (for blocks mode it's the generated code)
  blocks: unknown | null;       // Blockly state if mode === "blocks"
  worldId: string;              // a playground id, or "custom"
  customWorld: World | null;    // embedded when worldId === "custom" (teacher-made challenge)
  savedAt: string;              // ISO date
}

/** What teachers share: a challenge file (".robolab-level"). */
export interface LevelFile {
  format: "robot-lab-level";
  version: 1;
  world: World;
}

export type { ColorName };
