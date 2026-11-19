/**
 * ".robolab-activity" files: defensive parsing (files come from Drive and are untrusted) and
 * serialisation. Only whitelisted fields survive; every string, list and number is capped.
 */
import type { Activity, ActivityStep, ActivityProgress, CodeCheck, RunCheck, QuizQuestion } from "../core/activity";
import type { World } from "../core/types";
import { sanitizeWorld } from "../editor/levelFile";

export const ACTIVITY_EXT = ".robolab-activity";
export const MAX_ACTIVITY_BYTES = 3 * 1024 * 1024;

export const LIMITS = {
  title: 120, summary: 300, author: 80, standards: 24, standard: 60, steps: 60, stepTitle: 120,
  body: 8000, starter: 50_000, checks: 20, label: 300, callName: 80, quiz: 12, prompt: 2000,
  code: 4000, choices: 8, choice: 300, explain: 2000, hints: 12, hint: 2000, done: 2000, minutes: 600,
  logText: 200, playground: 64, id: 64,
};

class Bad extends Error {}
const fail = (m: string): never => { throw new Bad(m); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const CTRL_ALL = /[\u0000-\u001f\u007f]/g;

/** Multi-line text (keeps \n and \t). */
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CTRL, "").slice(0, max) : "");
/** One-line text. */
const line = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(CTRL_ALL, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt;

export function cleanId(v: unknown): string {
  return (typeof v === "string" ? v : "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.id);
}

export interface ParseOptions {
  /** Teacher-made (imported) activity: its id gets a "t-" prefix if missing. Default true. */
  teacher?: boolean;
  /** Used to warn about playgrounds this version doesn't have. */
  knownPlayground?: (id: string) => boolean;
}

/** Validate an untrusted activity object. Throws Error with a teacher/student-readable message. */
export function sanitizeActivity(raw: unknown, opts: ParseOptions = {}): { activity: Activity; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => { if (warnings.length < 20 && !warnings.includes(m)) warnings.push(m); };
  if (!isObj(raw)) fail("This is not a Robot Lab activity.");
  const d = raw as Record<string, unknown>;
  if (d.format !== "robot-lab-activity") fail("This is not a Robot Lab activity file.");
  if (d.version !== 1) fail("This activity was made by a newer Robot Lab.");

  let id = cleanId(d.id) || "activity";
  if (opts.teacher !== false && !id.startsWith("t-")) id = ("t-" + id).slice(0, LIMITS.id);

  const title = line(d.title, LIMITS.title) || "Untitled activity";
  const level = d.level === "starter" || d.level === "core" || d.level === "stretch" ? d.level : "core";
  const standards = (Array.isArray(d.standards) ? d.standards : []).slice(0, LIMITS.standards)
    .map((s) => line(s, LIMITS.standard)).filter(Boolean);

  if (!Array.isArray(d.steps) || d.steps.length === 0) fail("This activity has no steps.");
  const rawSteps = d.steps as unknown[];
  if (rawSteps.length > LIMITS.steps) warn(`Only the first ${LIMITS.steps} steps were kept.`);
  const usedIds = new Set<string>();
  const steps: ActivityStep[] = [];
  rawSteps.slice(0, LIMITS.steps).forEach((rs, i) => {
    if (!isObj(rs)) { warn("Skipped a broken step."); return; }
    steps.push(cleanStep(rs, i, usedIds, warn, opts));
  });
  if (!steps.length) fail("This activity has no usable steps.");

  const activity: Activity = {
    format: "robot-lab-activity", version: 1, id, title,
    summary: line(d.summary, LIMITS.summary),
    level, minutes: int(d.minutes, 1, LIMITS.minutes, 30), standards, steps,
  };
  const author = line(d.author, LIMITS.author);
  if (author && !author.includes("@")) activity.author = author; // never keep an email address
  return { activity, warnings };
}

function cleanStep(s: Record<string, unknown>, i: number, used: Set<string>, warn: (m: string) => void, opts: ParseOptions): ActivityStep {
  let id = cleanId(s.id) || `step-${i + 1}`;
  while (used.has(id)) id = `${id}-${i + 1}`.slice(0, LIMITS.id);
  used.add(id);
  const step: ActivityStep = {
    id,
    title: line(s.title, LIMITS.stepTitle) || `Step ${i + 1}`,
    body: text(s.body, LIMITS.body),
    checks: [],
    hints: (Array.isArray(s.hints) ? s.hints : []).slice(0, LIMITS.hints).map((h) => text(h, LIMITS.hint)).filter((h) => h.trim()),
  };
  // world
  if (isObj(s.world)) {
    if (typeof s.world.playground === "string") {
      const pg = line(s.world.playground, LIMITS.playground);
      if (pg) {
        if (opts.knownPlayground && !opts.knownPlayground(pg)) warn(`Step ${i + 1} uses a playground ("${pg}") that isn't in this version of Robot Lab.`);
        step.world = { playground: pg };
      }
    } else if (isObj(s.world.custom)) {
      const r = sanitizeWorld(s.world.custom);
      r.warnings.slice(0, 3).forEach((w) => warn(`Step ${i + 1}: ${w}`));
      const w: World = { ...r.world, id: "custom" };
      step.world = { custom: w };
    }
  }
  // starter
  if (isObj(s.starter)) {
    const mode = s.starter.mode === "blocks" ? "blocks" : "python";
    const st: NonNullable<ActivityStep["starter"]> = { mode };
    if (typeof s.starter.python === "string") st.python = text(s.starter.python, LIMITS.starter);
    // Blockly state is plain JSON (JSON.parse can't make functions); the blocks editor loads it in try/catch.
    if (mode === "blocks" && isObj(s.starter.blocks)) {
      const json = safeJson(s.starter.blocks);
      if (json && json.length <= 500_000) st.blocks = JSON.parse(json);
      else warn(`Step ${i + 1}: its starter blocks were too big and were dropped.`);
    }
    step.starter = st; // a starter with only a mode just switches the editor to that mode
  }
  if (s.lockMode === "blocks" || s.lockMode === "python") step.lockMode = s.lockMode;
  // checks
  const rawChecks = Array.isArray(s.checks) ? s.checks : [];
  for (const c of rawChecks.slice(0, LIMITS.checks)) {
    const cc = cleanCheck(c);
    if (cc) step.checks.push(cc); else warn(`Step ${i + 1}: skipped a check Robot Lab doesn't know.`);
  }
  // quiz
  if (Array.isArray(s.quiz)) {
    const qs: QuizQuestion[] = [];
    for (const q of s.quiz.slice(0, LIMITS.quiz)) {
      const qq = cleanQuiz(q);
      if (qq) qs.push(qq); else warn(`Step ${i + 1}: skipped a broken quiz question.`);
    }
    if (qs.length) step.quiz = qs;
  }
  const done = text(s.done, LIMITS.done);
  if (done.trim()) step.done = done;
  return step;
}

function safeJson(v: unknown): string | null {
  try { return JSON.stringify(v); } catch { return null; }
}

function cleanCheck(c: unknown): CodeCheck | RunCheck | null {
  if (!isObj(c)) return null;
  const label = text(c.label, LIMITS.label).trim();
  const optLabel = { label };
  switch (c.kind) {
    case "usesCall": {
      const name = line(c.name, LIMITS.callName).replace(/\s+/g, "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name)) return null;
      return { kind: "usesCall", name, ...(c.min !== undefined ? { min: int(c.min, 1, 100, 1) } : {}), ...optLabel };
    }
    case "usesLoop": {
      const loop = c.loop === "for" || c.loop === "while" || c.loop === "any" ? c.loop : undefined;
      return { kind: "usesLoop", ...(loop ? { loop } : {}), ...optLabel };
    }
    case "usesIf": return { kind: "usesIf", ...(c.withElse === true ? { withElse: true } : {}), ...optLabel };
    case "definesFunction": {
      const besides = Array.isArray(c.besides)
        ? c.besides.slice(0, 20).map((b) => line(b, 60)).filter((b) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(b)) : undefined;
      return { kind: "definesFunction", ...(besides ? { besides } : {}), ...optLabel };
    }
    case "assignsVariable": {
      const name = line(c.name, 60);
      if (name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
      return { kind: "assignsVariable", ...(name ? { name } : {}), ...optLabel };
    }
    case "definesConstant": return { kind: "definesConstant", ...optLabel };
    case "hasComment": return { kind: "hasComment", ...(c.min !== undefined ? { min: int(c.min, 1, 100, 1) } : {}), ...optLabel };
    case "readsSensor": return { kind: "readsSensor", ...optLabel };
    case "printsOutput": return { kind: "printsOutput", ...optLabel };
    case "maxLines": return { kind: "maxLines", lines: int(c.lines, 1, 1000, 20), ...optLabel };
    case "goalsComplete": return { kind: "goalsComplete", ...optLabel };
    case "ranWithoutError": return { kind: "ranWithoutError", ...optLabel };
    case "endsInSquare": {
      if (typeof c.square !== "number" || !Number.isFinite(c.square)) return null;
      return { kind: "endsInSquare", square: int(c.square, 1, 10_000, 1), ...optLabel };
    }
    case "logContains": return { kind: "logContains", text: line(c.text, LIMITS.logText), ...optLabel };
    default: return null;
  }
}

function cleanQuiz(q: unknown): QuizQuestion | null {
  if (!isObj(q) || !Array.isArray(q.choices)) return null;
  // choices may hold code, so inner spacing is kept
  const choices = q.choices.slice(0, LIMITS.choices).map((c) => (typeof c === "string" ? c.replace(CTRL_ALL, " ").trim().slice(0, LIMITS.choice) : ""));
  if (choices.length < 2 || choices.some((c) => !c)) return null;
  if (typeof q.answer !== "number" || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= choices.length) return null;
  const prompt = text(q.prompt, LIMITS.prompt);
  if (!prompt.trim()) return null;
  const out: QuizQuestion = { prompt, choices, answer: q.answer, explain: text(q.explain, LIMITS.explain) };
  const code = text(q.code, LIMITS.code);
  if (code.trim()) out.code = code;
  return out;
}

/** Parse a ".robolab-activity" file's text. Throws Error with a readable message. */
export function parseActivityFile(src: string, opts: ParseOptions = {}): { activity: Activity; warnings: string[] } {
  if (typeof src !== "string") fail("This file couldn't be read.");
  if (src.length > MAX_ACTIVITY_BYTES) fail("That file is too big to be a Robot Lab activity.");
  let data: unknown;
  try { data = JSON.parse(src); } catch { fail("This file is not a Robot Lab activity (it isn't readable JSON)."); }
  return sanitizeActivity(data, opts);
}

export function toActivityFile(a: Activity): string {
  return JSON.stringify(a, null, 2);
}

// ---------------------------------------------------------------- progress validation

export function newProgress(a: Activity, now = new Date()): ActivityProgress {
  const t = now.toISOString();
  return { activityId: a.id, stepIndex: 0, completed: [], hintsShown: {}, quizAnswers: {}, startedAt: t, updatedAt: t };
}

/** Validate untrusted progress against its activity (unknown step ids are dropped). */
export function sanitizeProgress(raw: unknown, a: Activity): ActivityProgress {
  const p = newProgress(a);
  if (!isObj(raw)) return p;
  const ids = new Set(a.steps.map((s) => s.id));
  p.stepIndex = int(raw.stepIndex, 0, a.steps.length - 1, 0);
  if (Array.isArray(raw.completed)) p.completed = [...new Set(raw.completed.filter((x): x is string => typeof x === "string" && ids.has(x)))];
  if (isObj(raw.hintsShown)) {
    for (const s of a.steps) {
      const n = raw.hintsShown[s.id];
      if (typeof n === "number") p.hintsShown[s.id] = int(n, 0, s.hints.length, 0);
    }
  }
  if (isObj(raw.quizAnswers)) {
    for (const s of a.steps) {
      const v = raw.quizAnswers[s.id];
      if (!Array.isArray(v) || !s.quiz) continue;
      p.quizAnswers[s.id] = s.quiz.map((q, i) => {
        const x = v[i];
        return typeof x === "number" && Number.isInteger(x) && x >= 0 && x < q.choices.length ? x : -1;
      });
    }
  }
  if (typeof raw.startedAt === "string") p.startedAt = raw.startedAt.slice(0, 40);
  if (typeof raw.updatedAt === "string") p.updatedAt = raw.updatedAt.slice(0, 40);
  return p;
}

/** Validate the `activity` field of a .robolab project. Returns null if it is missing or unusable.
 *  `builtIn` looks up a built-in activity by id: if the project names one, the current built-in is used. */
export function sanitizeEmbedded(raw: unknown, builtIn: (id: string) => Activity | undefined, warnings: string[]):
  { activity: Activity; progress: ActivityProgress } | null {
  if (!isObj(raw) || !isObj(raw.activity)) return null;
  const rawId = cleanId((raw.activity as Record<string, unknown>).id);
  try {
    const known = builtIn(rawId);
    const activity = known ?? sanitizeActivity(raw.activity, { teacher: true }).activity;
    return { activity, progress: sanitizeProgress(raw.progress, activity) };
  } catch (e) {
    warnings.push("The activity saved in this project couldn't be loaded: " + (e as Error).message);
    return null;
  }
}
