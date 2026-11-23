/**
 * Teacher grading panel: add many turned-in .robolab files, grade them headlessly one at a time,
 * and show a sortable / filterable results table with CSV and copy export.
 * Privacy: files are read in the browser and results are kept in memory only (never localStorage).
 */
import type { ProjectFile } from "../core/modules";
import { h, setText, toast } from "../ui/dom";
import { download } from "../ui/files";
import { gradeFileText, invalidResult, MAX_FILES, MAX_FILE_BYTES, type GradeResult } from "./grade";
import { toCsv, toTsv } from "./export";
import { injectGradingStyles } from "./styles";
import {
  renderBody, renderHead, sortEntries, filterEntries, finalText, savedText, VERDICT_TEXT,
  type Entry, type Filter, type SortKey, type SortState,
} from "./table";

export interface GradingPanelOptions {
  /** True while the student-facing program is running (Skulpt is global: never grade then). */
  isMainRunning(): boolean;
  /** Load a graded project into the main app in review mode and close the overlay. */
  openProject(project: ProjectFile, fileName: string): void;
}

export interface GradingPanel {
  readonly busy: boolean;
  /** Stop grading (e.g. when the overlay closes). */
  cancel(): void;
  focus(): void;
}

const OK_EXT = /\.(robolab|json)$/i;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const frame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

export function createGradingPanel(host: HTMLElement, opts: GradingPanelOptions): GradingPanel {
  injectGradingStyles();
  let entries: Entry[] = [];
  let nextId = 1;
  let filter: Filter = "all";
  let sort: SortState = { key: "name", dir: 1 };
  const open = new Set<number>();
  const codeOpen = new Set<number>();
  let busy = false;
  let signal = { cancelled: false };

  // ---------------------------------------------------------------- DOM
  const filesInput = h("input", { type: "file", multiple: true, accept: ".robolab,.json,application/json", hidden: true }) as HTMLInputElement;
  const folderInput = h("input", { type: "file", multiple: true, hidden: true }) as HTMLInputElement;
  folderInput.setAttribute("webkitdirectory", "");
  const pickBtn = h("button", { class: "btn btn-primary", type: "button", onclick: () => filesInput.click() }, "Grade student work…");
  const folderBtn = h("button", { class: "btn", type: "button", onclick: () => folderInput.click() }, "Choose a folder…");
  const note = h("div", { class: "gr-note", role: "status", "aria-live": "polite" });
  const drop = h("section", { class: "gr-drop", "aria-label": "Add student files" },
    h("h3", {}, "Grade student work"),
    h("p", {}, "Choose the ", h("code", {}, ".robolab"), " files your students turned in (download the assignment folder from Drive), or drop them here. Each program runs on its own challenge, here in this browser."),
    pickBtn, folderBtn, filesInput, folderInput,
    h("span", { class: "gr-privacy" }, `Nothing is uploaded or saved: results stay on this page until you close it. Up to ${MAX_FILES} files at a time.`),
  );
  const bar = h("progress", { max: "1", value: "0" }) as HTMLProgressElement;
  const progText = h("span", {});
  const cancelBtn = h("button", { class: "btn btn-sm", type: "button", onclick: () => { signal.cancelled = true; } }, "Cancel");
  const prog = h("div", { class: "gr-prog", hidden: true, role: "status", "aria-live": "polite" }, progText, bar, cancelBtn);

  const filterBtns = new Map<Filter, HTMLButtonElement>();
  const filterSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Show" });
  for (const [f, label] of [["all", "All"], ["passed", "Passed"], ["notpassed", "Not passed"], ["error", "Errors"]] as Array<[Filter, string]>) {
    const b = h("button", { class: "seg-btn", type: "button", role: "radio", "aria-checked": String(f === filter), onclick: () => { filter = f; render(); } }) as HTMLButtonElement;
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const all = [...filterBtns.keys()];
      const i = all.indexOf(f);
      const n = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      filter = n; render(); filterBtns.get(n)!.focus();
    });
    b.dataset.label = label;
    filterBtns.set(f, b);
    filterSeg.append(b);
  }
  const copyBtn = h("button", { class: "btn btn-sm", type: "button", onclick: () => void copyTable() }, "Copy table");
  const csvBtn = h("button", { class: "btn btn-sm", type: "button", onclick: () => downloadCsv() }, "Download CSV");
  const clearBtn = h("button", { class: "btn btn-sm", type: "button", onclick: () => clearAll() }, "Clear");
  const tools = h("div", { class: "gr-tools" }, filterSeg, h("div", { class: "gr-spacer" }), copyBtn, csvBtn, clearBtn);

  const thead = h("thead", {});
  const tbody = h("tbody", {});
  const table = h("table", { class: "gr-table" }, h("caption", { class: "sr-only" }, "Grading results. Column buttons sort; row buttons show details."), thead, tbody);
  const wrap = h("div", { class: "gr-wrap" }, table);
  const root = h("div", { class: "gr-root" }, drop, prog, note, tools, wrap);
  host.replaceChildren(root);

  // ---------------------------------------------------------------- input
  filesInput.addEventListener("change", () => { const fs = [...(filesInput.files ?? [])]; filesInput.value = ""; void addFiles(fs, false); });
  folderInput.addEventListener("change", () => { const fs = [...(folderInput.files ?? [])]; folderInput.value = ""; void addFiles(fs, true); });

  root.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = busy ? "none" : "copy";
    drop.classList.add("gr-over");
  });
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget as Node | null)) drop.classList.remove("gr-over"); });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("gr-over");
    if (!e.dataTransfer) return;
    void droppedFiles(e.dataTransfer).then(({ files, fromFolder }) => addFiles(files, fromFolder));
  });

  async function addFiles(files: File[], fromFolder: boolean): Promise<void> {
    if (busy || !files.length) return;
    if (opts.isMainRunning()) { setText(note, "Stop the student program that is running first, then grade."); return; }
    const notes: string[] = [];
    if (fromFolder) {
      const keep = files.filter((f) => OK_EXT.test(f.name));
      if (keep.length < files.length) notes.push(`Skipped ${files.length - keep.length} file${files.length - keep.length === 1 ? "" : "s"} that ${files.length - keep.length === 1 ? "isn't a" : "aren't"} .robolab file${files.length - keep.length === 1 ? "" : "s"}.`);
      files = keep;
    }
    const room = MAX_FILES - entries.length;
    if (room <= 0) { setText(note, `The table already has ${MAX_FILES} files. Press Clear to start a new batch.`); return; }
    if (files.length > room) { notes.push(`Only the first ${room} files were graded (limit ${MAX_FILES}).`); files = files.slice(0, room); }
    if (!files.length) { setText(note, notes.join(" ") || "No .robolab files found."); return; }

    busy = true;
    signal = { cancelled: false };
    pickBtn.disabled = folderBtn.disabled = clearBtn.disabled = true;
    prog.hidden = false;
    setText(note, "");
    let done = 0;
    for (const f of files) {
      if (signal.cancelled) break;
      setText(progText, `Grading ${done + 1} of ${files.length}…`);
      bar.max = files.length; bar.value = done;
      await frame(); // let the progress bar paint
      let r: GradeResult;
      if (f.size > MAX_FILE_BYTES) r = invalidResult(f.name, "This file is too big to be a Robot Lab project (over 2 MB).");
      else {
        let text: string | null = null;
        try { text = await f.text(); } catch { /* unreadable */ }
        r = text === null ? invalidResult(f.name, "This file couldn't be read.") : await gradeFileText(f.name, text, { signal });
      }
      if (signal.cancelled && r.statusText === "Cancelled") break;
      entries.push({ id: nextId++, r });
      done++;
      render();
      await tick();
    }
    const cancelled = signal.cancelled;
    busy = false;
    prog.hidden = true;
    pickBtn.disabled = folderBtn.disabled = clearBtn.disabled = false;
    if (cancelled) notes.unshift(`Stopped after ${done} of ${files.length} files.`);
    else notes.unshift(`Graded ${done} file${done === 1 ? "" : "s"}.`);
    setText(note, notes.join(" "));
    render();
  }

  // ---------------------------------------------------------------- render
  const handlers = {
    onToggle: (id: number) => { if (open.has(id)) open.delete(id); else open.add(id); render(); focusRow(id); },
    onSort: (key: SortKey) => { sort = sort.key === key ? { key, dir: (sort.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: 1 }; render(); focusSort(key); },
    detail: (e: Entry) => detailView(e),
  };

  function render(): void {
    const counts: Record<Filter, number> = { all: entries.length, passed: 0, notpassed: 0, error: 0 };
    for (const e of entries) counts[e.r.verdict]++;
    for (const [f, b] of filterBtns) {
      b.setAttribute("aria-checked", String(f === filter));
      b.replaceChildren(b.dataset.label ?? "", h("span", { class: "gr-count" }, String(counts[f])));
    }
    const has = entries.length > 0;
    tools.hidden = !has; wrap.hidden = !has;
    copyBtn.disabled = csvBtn.disabled = !has;
    renderHead(thead, sort, handlers);
    renderBody(tbody, sortEntries(filterEntries(entries, filter), sort), open, handlers);
  }

  function focusRow(id: number): void {
    (tbody.querySelector(`tr[data-id="${id}"] .gr-name`) as HTMLElement | null)?.focus();
  }
  function focusSort(key: SortKey): void {
    const i = ["name", "verdict", "world", "status", "goals", "final", "steps", "activity", "saved"].indexOf(key);
    (thead.querySelectorAll(".gr-sort")[i] as HTMLElement | undefined)?.focus();
  }

  function detailView(e: Entry): HTMLElement {
    const r = e.r;
    const mark = (ok: boolean) => h("span", { class: ok ? "gr-ok" : "gr-no", "aria-label": ok ? "passed" : "not passed" }, ok ? "✓" : "✗");
    const blocks: HTMLElement[] = [];
    const runBox = h("div", {}, h("h4", {}, "Run"),
      h("div", {}, `${VERDICT_TEXT[r.verdict]} · ${r.statusText}`),
      r.errorText ? h("div", { class: "gr-sub" }, r.errorText) : null,
      r.status !== "invalid" ? h("div", { class: "gr-sub" }, `${r.mode === "blocks" ? "Blocks" : "Python"} · ${r.steps} robot command${r.steps === 1 ? "" : "s"} · ${r.simSeconds} s of robot time · ended at ${finalText(r)}${r.finalPose ? `, facing ${r.finalPose.heading}°` : ""}`) : null,
      h("div", { class: "gr-sub" }, `Last saved: ${savedText(r.savedAt)}`),
      ...r.warnings.map((w) => h("div", { class: "gr-sub" }, w)));
    blocks.push(runBox);
    if (r.status !== "invalid") {
      blocks.push(h("div", {}, h("h4", {}, `Goals ${r.goalsPassed}/${r.goalsTotal}`),
        r.goals.length
          ? h("ul", { class: "gr-list" }, ...r.goals.map((g) => h("li", {}, mark(g.passed), h("span", {}, g.text, g.detail ? h("small", {}, " — " + g.detail) : null))))
          : h("div", { class: "gr-sub" }, "This world has no goals (free play).")));
    }
    if (r.activity) {
      const a = r.activity;
      blocks.push(h("div", {}, h("h4", {}, "Activity"),
        h("div", {}, a.title),
        h("div", { class: "gr-sub" }, `${a.stepsCompleted} of ${a.stepsTotal} steps saved as done. Current step ${a.currentIndex + 1}: ${a.currentTitle}${a.currentClaimed ? " (saved as done)" : ""}.`),
        h("div", { class: "gr-sub" + (!a.recheck.passed && a.currentClaimed ? " gr-warn" : "") },
          a.recheck.passed ? "Re-checked now: the submitted code passes this step." : "Re-checked now: the submitted code doesn't pass this step."),
        h("ul", { class: "gr-list" }, ...a.recheck.items.map((it) => h("li", {}, mark(it.passed), h("span", {}, it.label, it.detail ? h("small", {}, " — " + it.detail) : null))))));
    }
    if (r.output.length) blocks.push(h("div", {}, h("h4", {}, "Printed output"), h("pre", { class: "gr-out" }, r.output.join("\n"))));

    const codeHost = h("div", { class: "gr-code", hidden: !codeOpen.has(e.id) });
    if (codeOpen.has(e.id)) void showCode(codeHost, r.python);
    const actions = h("div", { class: "gr-actions" });
    if (r.project) {
      const p = r.project;
      actions.append(
        h("button", {
          class: "btn btn-sm gr-code-btn", type: "button", "aria-expanded": String(codeOpen.has(e.id)),
          onclick: () => { if (codeOpen.has(e.id)) codeOpen.delete(e.id); else codeOpen.add(e.id); render(); (tbody.querySelector(`#gr-d-${e.id} .gr-code-btn`) as HTMLElement | null)?.focus(); },
        }, codeOpen.has(e.id) ? "Hide code" : "View code"),
        h("button", {
          class: "btn btn-sm btn-primary", type: "button",
          onclick: () => { if (!busy) opts.openProject(p, r.fileName); },
        }, "Open in Robot Lab"),
      );
    }
    const box = h("div", {}, h("div", { class: "gr-dgrid" }, ...blocks), actions, codeHost);
    box.addEventListener("click", (ev) => ev.stopPropagation()); // clicks inside details don't collapse the row
    return box;
  }

  async function showCode(host: HTMLElement, code: string): Promise<void> {
    const pre = h("pre", { tabindex: "0", "aria-label": "Student code (read only)" }, code || "(no code)");
    host.replaceChildren(pre);
    try {
      const { createPythonEditor } = await import("../ui/pythonEditor");
      if (!host.isConnected) return;
      host.replaceChildren();
      createPythonEditor(host, { doc: code, readOnly: true, label: "Student code (read only)" });
    } catch { /* keep the <pre> */ }
  }

  // ---------------------------------------------------------------- export
  function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function visible(): GradeResult[] { return sortEntries(filterEntries(entries, filter), sort).map((e) => e.r); }
  function downloadCsv(): void {
    if (!entries.length) return;
    download(new Blob([toCsv(visible())], { type: "text/csv;charset=utf-8" }), `robot-lab-grades-${stamp()}.csv`);
    toast("Downloaded the results as CSV.");
  }
  async function copyTable(): Promise<void> {
    if (!entries.length) return;
    const text = toTsv(visible());
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste into Google Sheets."); }
    catch {
      // Fallback for browsers without clipboard permission.
      const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;left:-9999px" }) as HTMLTextAreaElement;
      ta.value = text; document.body.append(ta); ta.select();
      const ok = (() => { try { return document.execCommand("copy"); } catch { return false; } })();
      ta.remove();
      toast(ok ? "Copied. Paste into Google Sheets." : "Couldn't copy. Use Download CSV instead.");
    }
  }
  function clearAll(): void {
    if (busy) return;
    entries = []; open.clear(); codeOpen.clear();
    setText(note, "");
    render();
    pickBtn.focus();
  }

  render();
  return {
    get busy() { return busy; },
    cancel() { signal.cancelled = true; },
    focus() { pickBtn.focus(); },
  };
}

// ---------------------------------------------------------------- drag and drop (files and folders)

type FsEntry = { isFile: boolean; isDirectory: boolean; name: string; file?(ok: (f: File) => void, err: (e: unknown) => void): void; createReader?(): { readEntries(ok: (es: FsEntry[]) => void, err: (e: unknown) => void): void } };

async function droppedFiles(dt: DataTransfer): Promise<{ files: File[]; fromFolder: boolean }> {
  const items = [...(dt.items ?? [])];
  const entries = items.map((it) => (it as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null);
  if (!entries.some((e) => e?.isDirectory)) return { files: [...dt.files], fromFolder: false };
  const out: File[] = [];
  const walk = async (e: FsEntry, depth: number): Promise<void> => {
    if (out.length > MAX_FILES * 5 || depth > 4) return;
    if (e.isFile && e.file) {
      const f = await new Promise<File | null>((res) => e.file!(res, () => res(null)));
      if (f) out.push(f);
    } else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      for (;;) {
        const batch = await new Promise<FsEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const c of batch) await walk(c, depth + 1);
      }
    }
  };
  for (const e of entries) if (e) await walk(e, 0);
  return { files: out, fromFolder: true };
}
