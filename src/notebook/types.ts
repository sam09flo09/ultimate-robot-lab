/**
 * Engineering notebook data, stored inside the .robolab project (and the browser autosave).
 * Nothing here ever leaves the browser: the student prints the page or copies it as text.
 */

/** One recorded test run of the current project. */
export interface NotebookRun {
  id: string;                 // short random id (for starring / notes)
  at: string;                 // ISO date-time the run ended
  mode: "blocks" | "python";
  world: string;              // playground / challenge name
  /** finished | error | stopped | race (a timed race run). */
  result: "finished" | "error" | "stopped" | "race";
  detail: string;             // "Finished", "NameError on line 4", "Race: 12.40 s (gold)", ...
  goalsPassed: number;
  goalsTotal: number;
  final: string;              // "square 7, facing right" / "x 120, y -40, facing 90°"
  steps: number;              // statements that moved the robot (or were logged) during the run
  /** Small path picture (≤ 240 px), a compact data URL, or null once dropped for space. */
  thumb: string | null;
  starred: boolean;           // include in the printed run log
  note: string;               // one line: "changed the turn to 85°"
}

/** What goes on the printed page. */
export interface NotebookInclude {
  code: boolean;
  path: boolean;              // field picture with the robot's path
  runs: boolean;              // starred run log
  activity: boolean;          // guided-activity progress
  flowchart: boolean;         // only used when a flowchart export is available
}

export interface NotebookData {
  version: 1;
  student: string;            // free text, stored only in the project
  date: string;               // editable; "" = today
  title: string;              // "" = the project name
  goal: string;               // What was the goal?
  tried: string;              // What did you try?
  happened: string;           // What happened / what did you change?
  next: string;               // What would you do next?
  include: NotebookInclude;
  runs: NotebookRun[];        // oldest first, at most MAX_RUNS
}

export const MAX_RUNS = 20;
export const MAX_STUDENT = 60;
export const MAX_TITLE = 80;
export const MAX_DATE = 30;
export const MAX_REFLECTION = 2000;
export const MAX_NOTE = 140;
export const MAX_SHORT = 120;          // world / detail / final strings
export const MAX_THUMB = 40_000;       // chars of one thumbnail data URL
export const THUMB_PX = 240;           // longest side of a thumbnail
export const NOTEBOOK_BUDGET = 300_000; // whole notebook JSON, chars (≈ bytes: it's ASCII apart from typed text)

export const REFLECTIONS: { key: "goal" | "tried" | "happened" | "next"; label: string }[] = [
  { key: "goal", label: "What was the goal?" },
  { key: "tried", label: "What did you try?" },
  { key: "happened", label: "What happened / what did you change?" },
  { key: "next", label: "What would you do next?" },
];
