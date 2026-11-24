/** Engineering notebook page (src/notebook): public entry. */
export * from "./types";
export { emptyNotebook, sanitizeNotebook, addRun, capRuns, enforceBudget, updateRun, isEmptyNotebook, notebookSize } from "./data";
export { buildPageHtml, buildText, type PageInput, type PageActivity } from "./page";
export { createNotebook, type NotebookController, type NotebookHost, type RunRecord } from "./ui";
