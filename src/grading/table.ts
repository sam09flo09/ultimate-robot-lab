/**
 * The results table (DOM). All student-supplied text goes in through text nodes / textContent —
 * never innerHTML — so hostile file or project names can't inject markup.
 */
import { h } from "../ui/dom";
import type { GradeResult, Verdict } from "./grade";

export interface Entry { id: number; r: GradeResult; }
export type Filter = "all" | Verdict;
export type SortKey = "verdict" | "name" | "world" | "status" | "goals" | "final" | "steps" | "activity" | "saved";
export interface SortState { key: SortKey; dir: 1 | -1; }

export const COLS: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Student / project" },
  { key: "verdict", label: "Result" },
  { key: "world", label: "World" },
  { key: "status", label: "Run" },
  { key: "goals", label: "Goals" },
  { key: "final", label: "Final position" },
  { key: "steps", label: "Steps" },
  { key: "activity", label: "Activity" },
  { key: "saved", label: "Last saved" },
];

const VERDICT_ORDER: Record<Verdict, number> = { passed: 0, notpassed: 1, error: 2 };
export const VERDICT_TEXT: Record<Verdict, string> = { passed: "Passed", notpassed: "Not passed", error: "Error" };
const STATUS_ORDER = { finished: 0, nostart: 1, timeout: 2, error: 3, invalid: 4 } as const;

function sortValue(r: GradeResult, k: SortKey): string | number {
  switch (k) {
    case "verdict": return VERDICT_ORDER[r.verdict];
    case "name": return (r.projectName || r.fileName).toLowerCase();
    case "world": return r.worldName.toLowerCase();
    case "status": return STATUS_ORDER[r.status];
    case "goals": return r.goalsTotal ? r.goalsPassed / r.goalsTotal : -1;
    case "final": return r.finalSquare ? parseInt(r.finalSquare, 10) : r.finalPose ? r.finalPose.y * 10000 + r.finalPose.x : -Infinity;
    case "steps": return r.status === "invalid" ? -1 : r.steps;
    case "activity": return r.activity ? r.activity.stepsCompleted / Math.max(1, r.activity.stepsTotal) + (r.activity.recheck.passed ? 0.001 : 0) : -1;
    case "saved": { const t = Date.parse(r.savedAt); return Number.isFinite(t) ? t : -Infinity; }
  }
}

export function sortEntries(list: Entry[], s: SortState): Entry[] {
  return [...list].sort((a, b) => {
    const x = sortValue(a.r, s.key), y = sortValue(b.r, s.key);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * s.dir || a.id - b.id;
  });
}

export function filterEntries(list: Entry[], f: Filter): Entry[] {
  return f === "all" ? list : list.filter((e) => e.r.verdict === f);
}

export function savedText(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function finalText(r: GradeResult): string {
  if (!r.finalPose) return "—";
  if (r.finalSquare) return `Square ${r.finalSquare}`;
  return `(${r.finalPose.x}, ${r.finalPose.y}) mm`;
}

const badgeClass = (v: Verdict) => (v === "passed" ? "gr-pass" : v === "notpassed" ? "gr-fail" : "gr-err");

export interface TableHandlers {
  onToggle(id: number): void;
  onSort(key: SortKey): void;
  /** Detail content for an expanded row (built by the panel). */
  detail(e: Entry): HTMLElement;
}

/** Build the header (once per sort change). */
export function renderHead(thead: HTMLElement, sort: SortState, on: TableHandlers): void {
  thead.replaceChildren(h("tr", {}, ...COLS.map((c) => {
    const active = sort.key === c.key;
    const th = h("th", { scope: "col", "aria-sort": active ? (sort.dir === 1 ? "ascending" : "descending") : "none" },
      h("button", { class: "gr-sort", type: "button", onclick: () => on.onSort(c.key) },
        c.label, h("span", { class: "gr-arrow", "aria-hidden": "true" }, active ? (sort.dir === 1 ? "▲" : "▼") : "")));
    return th;
  })));
}

/** Render the body rows. */
export function renderBody(tbody: HTMLElement, rows: Entry[], open: Set<number>, on: TableHandlers): void {
  const out: HTMLElement[] = [];
  for (const e of rows) {
    const r = e.r;
    const isOpen = open.has(e.id);
    const detailId = `gr-d-${e.id}`;
    const nameBtn = h("button", {
      class: "gr-name", type: "button", "aria-expanded": String(isOpen), "aria-controls": detailId,
      onclick: (ev: Event) => { ev.stopPropagation(); on.onToggle(e.id); },
    }, h("span", { class: "gr-caret", "aria-hidden": "true" }, "▶"),
    h("span", {}, r.projectName || "(no project name)", h("span", { class: "gr-file" }, r.fileName)));
    const tr = h("tr", { class: "gr-row" + (isOpen ? " gr-open" : ""), "data-id": String(e.id), onclick: () => on.onToggle(e.id) },
      h("td", {}, nameBtn),
      h("td", {}, h("span", { class: "gr-badge " + badgeClass(r.verdict) }, VERDICT_TEXT[r.verdict])),
      h("td", {}, r.worldName || "—"),
      h("td", {}, r.statusText),
      h("td", { class: "gr-mono" }, r.status === "invalid" ? "—" : r.goalsTotal ? `${r.goalsPassed}/${r.goalsTotal}` : "no goals"),
      h("td", {}, finalText(r)),
      h("td", { class: "gr-mono" }, r.status === "invalid" ? "—" : String(r.steps)),
      h("td", {}, activityCell(r)),
      h("td", {}, savedText(r.savedAt)),
    );
    out.push(tr);
    if (isOpen) {
      const td = h("td", { colspan: String(COLS.length) }, on.detail(e));
      out.push(h("tr", { class: "gr-detail", id: detailId }, td));
    }
  }
  if (!rows.length) out.push(h("tr", {}, h("td", { colspan: String(COLS.length), class: "gr-empty" }, "No files to show.")));
  tbody.replaceChildren(...out);
}

function activityCell(r: GradeResult): Node {
  const a = r.activity;
  if (!a) return document.createTextNode("—");
  const ok = a.recheck.passed;
  return h("span", {},
    a.title,
    h("span", { class: "gr-sub" }, `${a.stepsCompleted}/${a.stepsTotal} steps saved as done`),
    h("span", { class: "gr-sub" + (!ok && a.currentClaimed ? " gr-warn" : "") },
      `Step ${a.currentIndex + 1}: ${ok ? "✓ code passes" : "✗ code doesn't pass"}${!ok && a.currentClaimed ? " (saved as done)" : ""}`));
}
