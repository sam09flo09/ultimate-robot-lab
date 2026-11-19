/**
 * Activity progress + imported teacher activities in localStorage. Everything is wrapped in
 * try/catch: storage may be full, disabled (some managed Chromebooks) or hold junk.
 */
import type { Activity, ActivityProgress } from "../core/activity";
import { sanitizeProgress, sanitizeActivity } from "./activityFile";

const PROGRESS_PREFIX = "robot-lab-activity-progress-v1:";
const CURRENT_KEY = "robot-lab-activity-current-v1";
const IMPORTED_KEY = "robot-lab-activities-imported-v1";
const DRAFT_KEY = "robot-lab-activity-draft-v1";
const MAX_IMPORTED = 30;
const MAX_IMPORTED_BYTES = 2_500_000;

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function get(key: string): string | null {
  try { return store()?.getItem(key) ?? null; } catch { return null; }
}
function set(key: string, value: string): boolean {
  try { const s = store(); if (!s) return false; s.setItem(key, value); return true; } catch { return false; }
}
function del(key: string): void {
  try { store()?.removeItem(key); } catch { /* ignore */ }
}

export function loadProgress(a: Activity): ActivityProgress | null {
  const raw = get(PROGRESS_PREFIX + a.id);
  if (!raw) return null;
  try {
    const p = sanitizeProgress(JSON.parse(raw), a);
    return p;
  } catch { return null; }
}

export function saveProgress(p: ActivityProgress): boolean {
  return set(PROGRESS_PREFIX + p.activityId, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }));
}

export function clearProgress(activityId: string): void { del(PROGRESS_PREFIX + activityId); }

/** The activity the student had open, so a reload can offer to continue. */
export function loadCurrentId(): string | null {
  const v = get(CURRENT_KEY);
  return v && v.length <= 64 ? v : null;
}
export function saveCurrentId(id: string | null): void {
  if (id) set(CURRENT_KEY, id); else del(CURRENT_KEY);
}

/** Teacher activities opened in this browser (shown in the catalogue). */
export function loadImported(): Activity[] {
  const raw = get(IMPORTED_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: Activity[] = [];
    for (const item of list.slice(0, MAX_IMPORTED)) {
      try { out.push(sanitizeActivity(item, { teacher: true }).activity); } catch { /* skip */ }
    }
    return out;
  } catch { return []; }
}

/** Add or replace (by id) an imported activity; newest first. Returns false if storage refused. */
export function saveImported(a: Activity): boolean {
  const list = [a, ...loadImported().filter((x) => x.id !== a.id)].slice(0, MAX_IMPORTED);
  while (list.length > 1 && JSON.stringify(list).length > MAX_IMPORTED_BYTES) list.pop();
  return set(IMPORTED_KEY, JSON.stringify(list));
}

export function removeImported(id: string): void {
  set(IMPORTED_KEY, JSON.stringify(loadImported().filter((x) => x.id !== id)));
}

/** The teacher's activity being written in the authoring form. */
export function loadDraft(): unknown | null {
  const raw = get(DRAFT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export function saveDraft(d: unknown): void {
  try { set(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
