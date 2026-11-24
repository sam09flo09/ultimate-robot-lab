/**
 * Teacher grading core: run a student's .robolab project headlessly on a fresh simulator and
 * summarise the outcome. No DOM, no storage — results live only in memory.
 *
 * Skulpt state is global (Sk.configure / Sk.builtins are set at the start of every run), so callers
 * must grade ONE project at a time and never while the student-facing program is running. The main
 * app's runner re-configures Skulpt at the start of each of its own runs, so nothing needs restoring.
 */
import type { World, RobotController, Pose } from "../core/types";
import type { ProjectFile, RunResult } from "../core/modules";
import type { StepCheckResult } from "../core/activity";
import { createSim } from "../sim";
import { createPythonRunner } from "../runtime";
import { getPlayground, PLAYGROUNDS } from "../worlds";
import { parseFileText } from "../ui/files";
import { squareText, goalText } from "../ui/status";
import { checkStep } from "../activities/checks";
import { plainText } from "../activities/markup";

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const OUTPUT_CAP = 200;

/** "driver" = a driver-control program (it read the controller) that never ended: it needs a person
 *  on the controller, so it can't be graded automatically. */
export type GradeStatus = "finished" | "error" | "timeout" | "driver" | "nostart" | "invalid";
export const DRIVER_STATUS_TEXT = "Needs a driver";
export const DRIVER_DETAIL = "This is a driver-control program: it needs a person on the controller, so it can't be graded automatically. Open it in Robot Lab to try it.";
/** For the filter: passed = ran, every goal passed and (if an activity) the current step re-checks OK. */
export type Verdict = "passed" | "notpassed" | "error";

export interface GradeOptions {
  /** Sim-time cap in seconds (default 300). */
  simSeconds?: number;
  /** Wall-clock cap in ms (default 3000). */
  wallMs?: number;
  /** Cooperative cancel: checked between sim chunks. */
  signal?: { cancelled: boolean };
}

export interface GradeResult {
  fileName: string;
  projectName: string;
  worldId: string;
  worldName: string;
  mode: "blocks" | "python" | "";
  savedAt: string;           // ISO string from the file ("" if unknown)
  status: GradeStatus;
  statusText: string;        // short, plain text ("Finished", "NameError on line 4", ...)
  errorText: string;         // longer plain-text explanation ("" if none)
  verdict: Verdict;
  goals: Array<{ text: string; passed: boolean; detail: string }>;
  goalsPassed: number;
  goalsTotal: number;
  finalPose: Pose | null;
  finalSquare: string;       // number-grid square ("" on other worlds)
  steps: number;             // robot commands run
  simSeconds: number;
  output: string[];          // print()/screen output (capped)
  activity: null | {
    title: string;
    stepsCompleted: number;  // as saved in the file (the student's claim)
    stepsTotal: number;
    currentIndex: number;
    currentTitle: string;
    currentClaimed: boolean; // the saved progress says the current step is done
    /** Re-check of the current step against the submitted code and this grading run. */
    recheck: StepCheckResult;
  };
  python: string;
  warnings: string[];
  project: ProjectFile | null;
}

// ---------------------------------------------------------------- helpers

const knownWorld = (id: string) => !!getPlayground(id);

/** Friendly-error HTML (always produced by our own esc()-based code) → plain text. */
export function htmlToText(html: string): string {
  return String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function blank(fileName: string): GradeResult {
  return {
    fileName, projectName: "", worldId: "", worldName: "", mode: "", savedAt: "",
    status: "invalid", statusText: "Couldn't open", errorText: "", verdict: "error",
    goals: [], goalsPassed: 0, goalsTotal: 0, finalPose: null, finalSquare: "", steps: 0, simSeconds: 0,
    output: [], activity: null, python: "", warnings: [], project: null,
  };
}

/** A row for a file that couldn't be read or parsed. */
export function invalidResult(fileName: string, message: string): GradeResult {
  return { ...blank(fileName), errorText: message };
}

function worldFor(p: ProjectFile): World {
  if (p.worldId === "custom" && p.customWorld) return p.customWorld;
  return getPlayground(p.worldId) ?? PLAYGROUNDS[0];
}

const macrotask: () => Promise<void> = (() => {
  if (typeof MessageChannel !== "undefined") {
    // Much faster than setTimeout(0) in browsers (no 4 ms clamp).
    const ch = new MessageChannel();
    const queue: Array<() => void> = [];
    ch.port1.onmessage = () => { queue.shift()?.(); };
    const unref = (ch.port1 as unknown as { unref?: () => void }).unref; // Node: don't keep the process alive
    if (unref) unref.call(ch.port1);
    return () => new Promise<void>((r) => { queue.push(r); ch.port2.postMessage(0); });
  }
  return () => new Promise<void>((r) => setTimeout(r, 0));
})();
const timeout0 = () => new Promise<void>((r) => setTimeout(r, 0));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- the run

/**
 * Run one project and summarise it. Never throws.
 *
 * Stepping: while Python is waiting on a robot motion/wait, the sim is stepped synchronously at
 * 1/60 s until that promise settles, then Python gets a macrotask to issue its next command — so
 * motion programs grade much faster than real time with the same sim-time behaviour as the app.
 * When Python is busy (e.g. a polling `while` loop with no wait), it gets one ~15 ms slice per
 * 1/24 s of sim time, like the app at 2.5× speed.
 */
export async function gradeProject(project: ProjectFile, fileName: string, opts: GradeOptions = {}): Promise<GradeResult> {
  const simCap = opts.simSeconds ?? 300;
  const wallCap = opts.wallMs ?? 3000;
  const r = blank(fileName);
  r.project = project;
  r.projectName = project.name;
  r.mode = project.mode;
  r.savedAt = project.savedAt;
  r.python = project.python;
  r.worldId = project.worldId;
  let world: World;
  try { world = worldFor(project); }
  catch { return { ...r, errorText: "This project's playground couldn't be loaded." }; }
  r.worldName = world.name;

  const sim = createSim(world);
  const base = sim.controller;
  let pending = 0, settled = 0;
  const track = <T>(p: Promise<T>): Promise<T> => {
    pending++;
    p.then(() => { pending--; settled++; }, () => { pending--; settled++; });
    return p;
  };
  const ctl: RobotController = {
    ...bindAll(base),
    driveFor: (d, mm) => track(base.driveFor(d, mm)),
    turnFor: (d, deg) => track(base.turnFor(d, deg)),
    turnToHeading: (deg) => track(base.turnToHeading(deg)),
    wait: (s) => track(base.wait(s)),
  };
  let readController = false;
  const output: string[] = [];
  const pushOut = (t: string) => { if (output.length < OUTPUT_CAP) output.push(t); };
  const runner = createPythonRunner({
    controller: ctl,
    onLine: () => {},
    onLog: (e) => { if (e.kind === "print") pushOut(e.text); },
    onScreen: (op) => { if (op.kind === "print") pushOut(op.text); },
    onControllerUsed: () => { readController = true; },
  });

  let result: RunResult | null = null;
  let timedOut: "" | "wall" | "sim" | "cancel" = "";
  const t0 = now();
  let lastBreath = t0;
  const dt = 1 / 60, busyDt = 1 / 24;
  try {
    runner.run(project.python).then((res) => { result = res; }, () => { /* run() never rejects */ });
    await macrotask();
    while (result === null) {
      const t = now();
      if (opts.signal?.cancelled) { timedOut = "cancel"; break; }
      if (t - t0 > wallCap) { timedOut = "wall"; break; }
      if (sim.state.time >= simCap) { timedOut = "sim"; break; }
      if (pending > 0) {
        const before = settled;
        sim.step(dt);
        await Promise.resolve(); // our .then on the motion promise runs first
        if (settled !== before) await macrotask(); // let Python carry on to its next command
      } else {
        // Python is running (or yielded with setTimeout inside a busy loop): give it a turn.
        await timeout0();
        if (result === null && pending === 0) sim.step(busyDt);
      }
      if (now() - lastBreath > 40) { lastBreath = now(); await timeout0(); } // keep the page responsive
    }
  } catch {
    /* sim errors are treated like a stopped run below */
  }
  if (result === null) {
    runner.stop();
    await Promise.resolve();
  }
  try { sim.abort(); } catch { /* ignore */ }
  try { for (let i = 0; i < 40; i++) sim.step(dt); } catch { /* ignore */ } // let objects settle (as the app does)

  const res = result as RunResult | null;
  if (readController && timedOut !== "cancel" && (timedOut || !res || res.status === "stopped")) {
    r.status = "driver";
    r.statusText = DRIVER_STATUS_TEXT;
    r.errorText = DRIVER_DETAIL;
  } else if (timedOut || !res || res.status === "stopped") {
    r.status = "timeout";
    r.statusText = timedOut === "cancel" ? "Cancelled" : "Timed out";
    r.errorText = timedOut === "sim"
      ? `The program was still running after ${simCap} s of robot time (a loop that never ends?).`
      : timedOut === "cancel" ? "Grading was cancelled before this program finished."
        : `The program didn't finish within ${Math.round(wallCap / 100) / 10} s of grading time (a loop that never ends?).`;
  } else if (res.status === "error") {
    r.status = "error";
    r.statusText = res.error.line ? `${res.error.type} on line ${res.error.line}` : res.error.type;
    r.errorText = htmlToText(res.error.html);
  } else if (!res.startCalled) {
    r.status = "nostart";
    r.statusText = "No start(main)";
    r.errorText = "The program finished, but main() never started. Is start(main) on the last line, not indented?";
    r.steps = res.steps;
  } else {
    r.status = "finished";
    r.statusText = "Finished";
    r.steps = res.steps;
  }

  const goals = safeGoals(sim);
  r.goals = goals.map((g) => ({ text: goalText(g.goal, world), passed: g.passed, detail: g.detail }));
  r.goalsTotal = goals.length;
  r.goalsPassed = goals.filter((g) => g.passed).length;
  const st = sim.state;
  r.finalPose = { x: Math.round(st.robot.x), y: Math.round(st.robot.y), heading: Math.round(st.robot.heading * 10) / 10 };
  r.finalSquare = world.background === "numberGrid" ? squareText(world, st.robot.x, st.robot.y) : "";
  r.simSeconds = Math.round(st.time * 10) / 10;
  r.output = output;

  const pa = project.activity;
  if (pa && pa.activity.steps.length) {
    const steps = pa.activity.steps;
    const idx = Math.max(0, Math.min(steps.length - 1, pa.progress.stepIndex | 0));
    const step = steps[idx];
    const ids = new Set(steps.map((s) => s.id));
    const sq = parseInt(r.finalSquare, 10);
    const allGoals = goals.length > 0 && goals.every((g) => g.passed);
    const recheck = checkStep(step, {
      python: project.python,
      quizAnswers: pa.progress.quizAnswers[step.id] ?? [],
      starterPython: step.starter?.python,
      lastRun: res && !timedOut ? { result: res, goalsAllPassed: allGoals, finalSquare: Number.isFinite(sq) ? sq : null, output } : null,
    });
    recheck.items = recheck.items.map((it) => ({ ...it, label: plainText(it.label) }));
    r.activity = {
      title: pa.activity.title,
      stepsCompleted: pa.progress.completed.filter((id) => ids.has(id)).length,
      stepsTotal: steps.length,
      currentIndex: idx,
      currentTitle: step.title,
      currentClaimed: pa.progress.completed.includes(step.id),
      recheck,
    };
  }

  r.verdict = verdictOf(r);
  return r;
}

function verdictOf(r: GradeResult): Verdict {
  if (r.status === "invalid" || r.status === "error" || r.status === "timeout") return "error";
  if (r.status !== "finished") return "notpassed";
  if (r.goalsPassed < r.goalsTotal) return "notpassed";
  if (r.activity && !r.activity.recheck.passed) return "notpassed";
  return "passed";
}

function safeGoals(sim: ReturnType<typeof createSim>) {
  try { return sim.evaluateGoals(); } catch { return []; }
}

/** Copy every method of the controller, bound, so it can be spread into a wrapper. */
function bindAll(c: RobotController): RobotController {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(c) as Array<keyof RobotController>) {
    const v = c[k];
    out[k] = typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  }
  return out as unknown as RobotController;
}

/** Parse a file's text with the app's own defensive parser, then grade it. Never throws. */
export async function gradeFileText(fileName: string, text: string, opts: GradeOptions = {}): Promise<GradeResult> {
  let opened;
  try { opened = parseFileText(text, knownWorld); }
  catch (e) { return invalidResult(fileName, (e as Error).message || "This file couldn't be read."); }
  if (opened.kind !== "project") {
    return invalidResult(fileName, opened.kind === "level"
      ? "This is a challenge (level) file, not a student's project."
      : "This is an activity file, not a student's project.");
  }
  try {
    const r = await gradeProject(opened.project, fileName, opts);
    r.warnings = opened.warnings;
    return r;
  } catch (e) {
    return invalidResult(fileName, "Robot Lab couldn't grade this file: " + String((e as Error)?.message ?? e));
  }
}
