/**
 * Notebook data: creation, the capped run log, the size budget and validation of untrusted
 * (opened-file / autosave) notebook data. Pure functions — no DOM.
 */
import {
  MAX_RUNS, MAX_STUDENT, MAX_TITLE, MAX_DATE, MAX_REFLECTION, MAX_NOTE, MAX_SHORT, MAX_THUMB, NOTEBOOK_BUDGET,
  type NotebookData, type NotebookRun, type NotebookInclude,
} from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function defaultInclude(): NotebookInclude {
  return { code: true, path: true, runs: true, activity: true, flowchart: true };
}

export function emptyNotebook(): NotebookData {
  return { version: 1, student: "", date: "", title: "", goal: "", tried: "", happened: "", next: "", include: defaultInclude(), runs: [] };
}

export function newRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Single-line text: no control characters, trimmed, capped. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Multi-line text: keeps \n (and tabs as spaces), drops other control characters, capped. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, max);
}

const THUMB_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** A thumbnail is only kept if it is a small base64 PNG/JPEG/WebP data URL. */
export function cleanThumb(v: unknown): string | null {
  return typeof v === "string" && v.length <= MAX_THUMB && THUMB_RE.test(v) ? v : null;
}

const RESULTS = ["finished", "error", "stopped", "race"] as const;
const num = (v: unknown, lo: number, hi: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0;

function cleanRun(r: unknown): NotebookRun | null {
  if (!isObj(r)) return null;
  const at = cleanLine(r.at, 40);
  const id = cleanLine(r.id, 16).replace(/[^A-Za-z0-9_-]/g, "") || newRunId();
  const goalsTotal = num(r.goalsTotal, 0, 99);
  return {
    id, at,
    mode: r.mode === "python" ? "python" : "blocks",
    world: cleanLine(r.world, MAX_SHORT),
    result: (RESULTS as readonly unknown[]).includes(r.result) ? r.result as NotebookRun["result"] : "finished",
    detail: cleanLine(r.detail, MAX_SHORT),
    goalsPassed: Math.min(num(r.goalsPassed, 0, 99), goalsTotal),
    goalsTotal,
    final: cleanLine(r.final, MAX_SHORT),
    steps: num(r.steps, 0, 1_000_000),
    thumb: cleanThumb(r.thumb),
    starred: r.starred === true,
    note: cleanLine(r.note, MAX_NOTE),
  };
}

/** Validate untrusted notebook data. Returns null when there is none. Never throws. */
export function sanitizeNotebook(raw: unknown, warnings: string[] = []): NotebookData | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) { warnings.push("The engineering notebook notes in this file couldn't be read, so they were left out."); return null; }
  const inc = isObj(raw.include) ? raw.include : {};
  const d = defaultInclude();
  const include: NotebookInclude = {
    code: typeof inc.code === "boolean" ? inc.code : d.code,
    path: typeof inc.path === "boolean" ? inc.path : d.path,
    runs: typeof inc.runs === "boolean" ? inc.runs : d.runs,
    activity: typeof inc.activity === "boolean" ? inc.activity : d.activity,
    flowchart: typeof inc.flowchart === "boolean" ? inc.flowchart : d.flowchart,
  };
  const runsIn = Array.isArray(raw.runs) ? raw.runs.slice(-MAX_RUNS * 2) : [];
  const runs: NotebookRun[] = [];
  const seen = new Set<string>();
  for (const r of runsIn) {
    const c = cleanRun(r);
    if (!c) continue;
    if (seen.has(c.id)) c.id = newRunId();
    seen.add(c.id);
    runs.push(c);
  }
  const nb: NotebookData = {
    version: 1,
    student: cleanLine(raw.student, MAX_STUDENT),
    date: cleanLine(raw.date, MAX_DATE),
    title: cleanLine(raw.title, MAX_TITLE),
    goal: cleanText(raw.goal, MAX_REFLECTION),
    tried: cleanText(raw.tried, MAX_REFLECTION),
    happened: cleanText(raw.happened, MAX_REFLECTION),
    next: cleanText(raw.next, MAX_REFLECTION),
    include,
    runs: capRuns(runs),
  };
  return enforceBudget(nb);
}

/** Keep at most MAX_RUNS runs: the oldest un-starred runs go first, then the oldest starred ones. */
export function capRuns(runs: NotebookRun[], max = MAX_RUNS): NotebookRun[] {
  const out = runs.slice();
  while (out.length > max) {
    const i = out.findIndex((r) => !r.starred);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}

/** Add a run (newest last), capping the log and the size budget. Returns a new object. */
export function addRun(nb: NotebookData, run: NotebookRun, budget = NOTEBOOK_BUDGET): NotebookData {
  return enforceBudget({ ...nb, runs: capRuns([...nb.runs, run]) }, budget);
}

export function notebookSize(nb: NotebookData): number {
  return JSON.stringify(nb).length;
}

/**
 * Keep the whole notebook under `budget` characters of JSON by dropping thumbnails, oldest first
 * (un-starred before starred). Text is already capped, so this always fits in practice.
 */
export function enforceBudget(nb: NotebookData, budget = NOTEBOOK_BUDGET): NotebookData {
  let size = notebookSize(nb);
  if (size <= budget) return nb;
  const runs = nb.runs.map((r) => ({ ...r }));
  const order = [...runs.filter((r) => !r.starred), ...runs.filter((r) => r.starred)];
  for (const r of order) {
    if (size <= budget) break;
    if (!r.thumb) continue;
    size -= r.thumb.length - 4; // "…" → null
    r.thumb = null;
  }
  const out = { ...nb, runs };
  // Still too big (only possible with a tiny budget): drop the oldest runs.
  while (out.runs.length && notebookSize(out) > budget) out.runs.shift();
  return out;
}

/** Update one run's star / note (returns a new object; unknown id = unchanged). */
export function updateRun(nb: NotebookData, id: string, patch: { starred?: boolean; note?: string }): NotebookData {
  return {
    ...nb,
    runs: nb.runs.map((r) => r.id !== id ? r : {
      ...r,
      ...(patch.starred !== undefined ? { starred: !!patch.starred } : {}),
      ...(patch.note !== undefined ? { note: cleanLine(patch.note, MAX_NOTE) } : {}),
    }),
  };
}

/** True when the notebook has nothing worth saving (keeps untouched projects' files small). */
export function isEmptyNotebook(nb: NotebookData | null | undefined): boolean {
  if (!nb) return true;
  return !nb.runs.length && !nb.student && !nb.title && !nb.goal && !nb.tried && !nb.happened && !nb.next && !nb.date;
}
