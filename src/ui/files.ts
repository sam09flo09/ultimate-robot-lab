/**
 * Project / level files: open, save, export, autosave. Everything is local to the browser.
 * Opened files are untrusted: every field is validated and copied into a fresh object.
 */
import type { World } from "../core/types";
import type { ProjectFile, LevelFile } from "../core/modules";
import { sanitizeWorld, levelFileText } from "./modules";
import type { Activity } from "../core/activity";
import { sanitizeActivity, sanitizeEmbedded, ACTIVITY_EXT } from "../activities/activityFile";
import { getBuiltIn } from "../activities/builtins";
import { sanitizeNotebook } from "../notebook/data"; // notebook

export const PROJECT_EXT = ".robolab";
export const LEVEL_EXT = ".robolab-level";
export { ACTIVITY_EXT };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CODE = 200_000;

// ---------------------------------------------------------------- validation

class Bad extends Error {}
const fail = (msg: string): never => { throw new Bad(msg); };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate an untrusted world (never throws; unusable parts are dropped with warnings). */
function cleanWorld(raw: unknown, warnings: string[]): World {
  if (!isObj(raw)) fail("The file is missing its playground.");
  const r = sanitizeWorld(raw);
  warnings.push(...r.warnings.slice(0, 5));
  return r.world;
}

export type OpenedFile =
  | { kind: "project"; project: ProjectFile; warnings: string[] }
  | { kind: "level"; level: LevelFile; warnings: string[] }
  | { kind: "activity"; activity: Activity; warnings: string[] };

/** Parse an untrusted file's text. Throws Error with a student-readable message. */
export function parseFileText(text: string, knownWorld: (id: string) => boolean): OpenedFile {
  let data: unknown;
  try { data = JSON.parse(text); } catch { fail("This file is not a Robot Lab file (it isn't readable JSON)."); }
  if (!isObj(data)) fail("This file is not a Robot Lab file.");
  const d = data as Record<string, unknown>;
  if (d.format === "robot-lab-level") {
    if (d.version !== 1) fail("This level was made by a newer Robot Lab. Ask your teacher.");
    const lw: string[] = [];
    return { kind: "level", level: { format: "robot-lab-level", version: 1, world: cleanWorld(d.world, lw) }, warnings: lw };
  }
  if (d.format === "robot-lab-activity") {
    const r = sanitizeActivity(d, { teacher: true, knownPlayground: knownWorld });
    return { kind: "activity", activity: r.activity, warnings: r.warnings };
  }
  if (d.format !== "robot-lab-project") fail("This file is not a Robot Lab project, level or activity.");
  if (d.version !== 1) fail("This project was saved by a newer Robot Lab.");
  const warnings: string[] = [];
  const mode = d.mode === "blocks" ? "blocks" : "python";
  let worldId = typeof d.worldId === "string" ? d.worldId.slice(0, 64) : "";
  let customWorld: World | null = null;
  if (worldId === "custom") customWorld = { ...cleanWorld(d.customWorld, warnings), id: "custom" };
  else if (!knownWorld(worldId)) { warnings.push("The playground this project used isn't in this version of Robot Lab, so it opened in the first playground."); worldId = ""; }
  const python = typeof d.python === "string" ? d.python.slice(0, MAX_CODE) : "";
  // Blockly state is handed to the blocks editor, which loads it inside try/catch. Only
  // plain JSON survives JSON.parse, so no functions/prototypes can sneak in.
  const blocks = mode === "blocks" && isObj(d.blocks) ? d.blocks : null;
  return {
    kind: "project", warnings,
    project: {
      format: "robot-lab-project", version: 1,
      name: cleanName(typeof d.name === "string" ? d.name : ""),
      mode, python, blocks, worldId, customWorld,
      savedAt: typeof d.savedAt === "string" ? d.savedAt.slice(0, 40) : "",
      activity: sanitizeEmbedded(d.activity, getBuiltIn, warnings),
      notebook: sanitizeNotebook(d.notebook, warnings), // notebook: validated, capped
    },
  };
}

export function cleanName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const n = s.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  return n || "My robot project";
}

/** A safe filename stem. */
export function fileStem(name: string): string {
  return cleanName(name).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "robot-project";
}

// ---------------------------------------------------------------- open

/** Ask the user for a file (works for Drive files on ChromeOS through the Files app). */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    let settled = false;
    input.addEventListener("change", async () => {
      settled = true;
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      if (f.size > MAX_FILE_BYTES) return reject(new Error("That file is too big to be a Robot Lab file."));
      try { resolve({ name: f.name, text: await f.text() }); } catch { reject(new Error("The file couldn't be read.")); }
    });
    input.addEventListener("cancel", () => { if (!settled) { input.remove(); resolve(null); } });
    input.click();
  });
}

// ---------------------------------------------------------------- save

type Handle = { createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>; name?: string };
type SavePicker = (o: unknown) => Promise<Handle>;

export interface SaveResult { ok: boolean; how: "picker" | "download" | "cancelled"; fileName?: string; }

/**
 * Save text. Uses the File System Access API when available so later "Save" overwrites the same
 * file; otherwise downloads. `handle` is the handle from a previous save (or null).
 */
export async function saveText(opts: {
  text: string; suggestedName: string; mime: string; ext: string; description: string;
  handle: Handle | null; forcePicker?: boolean;
}): Promise<SaveResult & { handle: Handle | null }> {
  const blob = new Blob([opts.text], { type: opts.mime });
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let handle = opts.forcePicker ? null : opts.handle;
  if (picker && !handle) {
    try {
      handle = await picker({
        suggestedName: opts.suggestedName,
        types: [{ description: opts.description, accept: { [opts.mime]: [opts.ext] } }],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return { ok: false, how: "cancelled", handle: opts.handle };
      handle = null; // SecurityError in iframes etc. → fall back to download
    }
  }
  if (handle) {
    try {
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      return { ok: true, how: "picker", handle, fileName: handle.name };
    } catch { handle = null; /* permission revoked → download */ }
  }
  download(blob, opts.suggestedName);
  return { ok: true, how: "download", handle: null, fileName: opts.suggestedName };
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function toLevelJson(world: World): string {
  return levelFileText(world);
}

// ---------------------------------------------------------------- autosave

const AUTOSAVE_KEY = "robot-lab-autosave-v1";
const LEVEL_DRAFT_KEY = "robot-lab-level-draft-v1";

/** What the autosave keeps: the project plus both editors' contents. */
export interface AutosaveData { project: ProjectFile; pythonText: string; blocksState: unknown | null; }

export function readAutosave(knownWorld: (id: string) => boolean): AutosaveData | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!isObj(d) || !isObj(d.project)) return null;
    const parsed = parseFileText(JSON.stringify(d.project), knownWorld);
    if (parsed.kind !== "project") return null;
    return {
      project: parsed.project,
      pythonText: typeof d.pythonText === "string" ? d.pythonText.slice(0, MAX_CODE) : parsed.project.python,
      blocksState: isObj(d.blocksState) ? d.blocksState : parsed.project.blocks,
    };
  } catch { return null; }
}

export function writeAutosave(d: AutosaveData): void {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(d)); } catch { /* storage full / disabled */ }
}

export function readLevelDraft(): World | null {
  try { const r = localStorage.getItem(LEVEL_DRAFT_KEY); return r ? sanitizeWorld(JSON.parse(r)).world : null; } catch { return null; }
}
export function writeLevelDraft(w: World): void {
  try { localStorage.setItem(LEVEL_DRAFT_KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null, last: A | null = null;
  const f = (...a: A) => { last = a; if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  f.flush = () => { if (t) { clearTimeout(t); t = null; if (last) fn(...last); } };
  return f;
}
