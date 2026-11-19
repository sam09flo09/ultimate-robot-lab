/**
 * SHARED CONTRACT — guided activities (lessons with steps, hints and automatic checks).
 * Built-in activities live in src/activities/content/. Teachers can write their own and share
 * them as ".robolab-activity" files through Classroom (same flow as levels).
 */
import type { World } from "./types";

/** Curriculum alignment tags shown to teachers, e.g. "YouScience Std 5 Obj 3.2", "TEKS (d)(5)(A)". */
export type StandardTag = string;

/**
 * Text is a SMALL safe markup, never raw HTML:
 *   paragraphs separated by blank lines, **bold**, `code`, "- " bullet lines,
 *   and fenced ```python blocks. Renderers must escape everything else.
 */
export type RichText = string;

/** Automatic checks on the student's Python source (blocks mode checks the generated Python). */
export type CodeCheck =
  | { kind: "usesCall"; name: string; min?: number; label: RichText }      // e.g. name "drivetrain.drive_for", min 4
  | { kind: "usesLoop"; loop?: "for" | "while" | "any"; label: RichText }
  | { kind: "usesIf"; withElse?: boolean; label: RichText }
  | { kind: "definesFunction"; besides?: string[]; label: RichText }      // a def other than `besides` (default ["main"])
  | { kind: "assignsVariable"; name?: string; label: RichText }           // any (or a named) variable assignment
  | { kind: "definesConstant"; label: RichText }                          // an UPPER_CASE name assigned at module level
  | { kind: "hasComment"; min?: number; label: RichText }
  | { kind: "readsSensor"; label: RichText }                              // any distance/front_eye/down_eye/bumper/location call
  | { kind: "printsOutput"; label: RichText }                             // print(...) or brain.screen.print(...)
  | { kind: "maxLines"; lines: number; label: RichText };                 // non-blank, non-comment lines ≤ N (rewards loops)

/** Checks on the most recent run's outcome. */
export type RunCheck =
  | { kind: "goalsComplete"; label: RichText }                            // all world goals passed
  | { kind: "ranWithoutError"; label: RichText }
  | { kind: "endsInSquare"; square: number; label: RichText }             // numberGrid worlds only
  | { kind: "logContains"; text: string; label: RichText };               // print()/screen output contains text

/** A multiple-choice question (great for "identify the keyword / literal / entry point"). */
export interface QuizQuestion {
  prompt: RichText;
  code?: string;              // optional Python snippet shown above the choices
  choices: string[];
  answer: number;             // index into choices
  explain: RichText;          // shown after answering (right or wrong)
}

export interface ActivityStep {
  id: string;
  title: string;
  body: RichText;             // the instructions
  /** Where the robot works for this step. Omit to keep the previous step's world. */
  world?: { playground: string } | { custom: World };
  /** Code put in the editor when the step starts — only if the student hasn't written their own yet,
   *  or when they press "Start this step over". */
  starter?: { mode: "blocks" | "python"; python?: string; blocks?: unknown };
  /** Students may switch mode unless this is set. */
  lockMode?: "blocks" | "python";
  checks: Array<CodeCheck | RunCheck>;    // all must pass to complete the step (may be empty if quiz-only)
  quiz?: QuizQuestion[];                  // all must be answered correctly to complete the step
  hints: RichText[];                      // revealed one at a time
  /** Shown when the step is completed. */
  done?: RichText;
}

export interface Activity {
  format: "robot-lab-activity";
  version: 1;
  id: string;                 // built-ins: "a01-..." ; teacher-made: any, prefixed "t-" on import
  title: string;
  summary: string;            // one line for the catalogue
  level: "starter" | "core" | "stretch";
  minutes: number;            // rough class time
  standards: StandardTag[];
  steps: ActivityStep[];
  author?: string;            // free text, optional (never an email)
}

/** Per-activity progress, kept in localStorage and embedded in saved .robolab projects. */
export interface ActivityProgress {
  activityId: string;
  stepIndex: number;                  // current step
  completed: string[];                // step ids completed
  hintsShown: Record<string, number>; // step id → hints revealed
  quizAnswers: Record<string, number[]>; // step id → chosen indices
  startedAt: string;
  updatedAt: string;
}

/** Result of checking one step, for the UI checklist. */
export interface StepCheckResult {
  passed: boolean;
  items: Array<{ label: RichText; passed: boolean; detail?: string }>;
}
