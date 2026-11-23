/** CSV / TSV export of grading results. Pure functions (no DOM). */
import type { GradeResult } from "./grade";

type Cell = string | number | null;

/** Spreadsheet formula-injection guard: text starting with = + - @ (or tab / CR) gets a leading quote. */
export function guardCell(v: Cell): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function csvCell(v: Cell): string {
  const s = guardCell(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function tsvCell(v: Cell): string {
  return guardCell(typeof v === "string" ? v.replace(/[\t\r\n]+/g, " ") : v);
}

export const COLUMNS = [
  "File", "Project", "World", "Status", "Details", "Result", "Goals passed", "Goals total",
  "Final square", "Final X (mm)", "Final Y (mm)", "Final heading", "Steps",
  "Activity", "Activity steps completed (saved)", "Activity steps total", "Current step",
  "Current step passes re-check", "Last saved",
];

const VERDICT = { passed: "Passed", notpassed: "Not passed", error: "Error" } as const;

export function resultRow(r: GradeResult): Cell[] {
  const a = r.activity;
  return [
    r.fileName, r.projectName, r.worldName, r.statusText, r.errorText, VERDICT[r.verdict],
    r.status === "invalid" ? null : r.goalsPassed, r.status === "invalid" ? null : r.goalsTotal,
    r.finalSquare || null, r.finalPose?.x ?? null, r.finalPose?.y ?? null, r.finalPose?.heading ?? null,
    r.status === "invalid" ? null : r.steps,
    a?.title ?? null, a?.stepsCompleted ?? null, a?.stepsTotal ?? null,
    a ? `${a.currentIndex + 1}. ${a.currentTitle}` : null,
    a ? (a.recheck.passed ? "Yes" : "No") : null,
    r.savedAt || null,
  ];
}

export function toCsv(results: GradeResult[]): string {
  const lines = [COLUMNS.map(csvCell).join(","), ...results.map((r) => resultRow(r).map(csvCell).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8 names correctly
}

export function toTsv(results: GradeResult[]): string {
  return [COLUMNS.map(tsvCell).join("\t"), ...results.map((r) => resultRow(r).map(tsvCell).join("\t"))].join("\n");
}
