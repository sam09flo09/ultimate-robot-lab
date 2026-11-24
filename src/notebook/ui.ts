/**
 * Engineering notebook UI: records test runs, the "Notebook page" dialog (name, date, title,
 * reflections, starred runs with notes, what to include), the print view (an in-page overlay that
 * @media print turns into the only thing on the page) and "Copy as text".
 * Nothing is sent anywhere: the data lives in the project file and the browser autosave.
 */
import type { World, SimState } from "../core/types";
import { h, toast } from "../ui/dom";
import {
  MAX_STUDENT, MAX_TITLE, MAX_DATE, MAX_REFLECTION, MAX_NOTE, REFLECTIONS,
  type NotebookData, type NotebookRun, type NotebookInclude,
} from "./types";
import { emptyNotebook, addRun, updateRun, newRunId, cleanLine, cleanText, enforceBudget } from "./data";
import { buildPageHtml, buildText, formatWhen, runResultText, todayText, type PageActivity, type PageInput } from "./page";
import { fieldThumb, fieldPicture, findFlowchartExport, type RendererFactory } from "./capture";
import { injectNotebookCss } from "./styles";

export interface NotebookHost {
  createRenderer: RendererFactory;
  world(): World;
  worldName(): string;
  /** The sim state shown now (used for the field picture when there is no recorded run on this world). */
  state(): SimState | null;
  projectName(): string;
  mode(): "blocks" | "python" | "flowchart";
  code(): string;
  activity(): PageActivity | null;
  /** Notebook data changed (autosave). */
  changed(): void;
}

export interface RunRecord {
  mode: "blocks" | "python" | "flowchart";
  result: NotebookRun["result"];
  detail: string;
  goalsPassed: number;
  goalsTotal: number;
  final: string;
  steps: number;
}

export interface NotebookController {
  data(): NotebookData;
  /** Replace the notebook (project opened / new project). null = empty. */
  load(nb: NotebookData | null): void;
  /** Record a finished run (thumbnail drawn from the world + the state right now). */
  record(r: RunRecord): void;
  open(): void;
  isOpen(): boolean;
  /** Build the page input (exposed for tests / automation). */
  pageInput(): Promise<PageInput>;
  openPrintView(): Promise<void>;
  copyText(): Promise<boolean>;
}

function deepCopyState(s: SimState | null): SimState | null {
  if (!s) return null;
  try { return typeof structuredClone === "function" ? structuredClone(s) : JSON.parse(JSON.stringify(s)) as SimState; } catch { return null; }
}

export function createNotebook(host: NotebookHost): NotebookController {
  injectNotebookCss();
  let nb: NotebookData = emptyNotebook();
  let lastRun: { world: World; state: SimState | null } | null = null;
  let dlg: HTMLElement | null = null;
  let view: HTMLElement | null = null;

  const set = (next: NotebookData) => { nb = next; host.changed(); };

  function record(r: RunRecord): void {
    const world = host.world();
    const state = deepCopyState(host.state());
    lastRun = { world, state };
    const run: NotebookRun = {
      id: newRunId(), at: new Date().toISOString(), mode: r.mode, world: cleanLine(host.worldName(), 120),
      result: r.result, detail: cleanLine(r.detail, 120), goalsPassed: r.goalsPassed, goalsTotal: r.goalsTotal,
      final: cleanLine(r.final, 120), steps: Math.max(0, Math.round(r.steps)),
      thumb: fieldThumb(host.createRenderer, world, state), starred: false, note: "",
    };
    set(addRun(nb, run));
    if (dlg) renderRuns();
  }

  async function pageInput(): Promise<PageInput> {
    const world = host.world();
    const st = lastRun && lastRun.world === world ? lastRun.state : host.state();
    const flow = findFlowchartExport();
    return {
      notebook: nb,
      projectName: host.projectName(),
      worldName: host.worldName(),
      mode: host.mode(),
      code: host.code(),
      fieldImage: nb.include.path ? fieldPicture(host.createRenderer, world, st) : null,
      flowchartImage: nb.include.flowchart && flow ? await flow() : null,
      activity: host.activity(),
      today: todayText(),
    };
  }

  // ------------------------------------------------------------ dialog
  let runList: HTMLOListElement | null = null;
  let prevFocus: HTMLElement | null = null;

  function close(): void {
    if (!dlg) return;
    dlg.remove(); dlg = null; runList = null;
    prevFocus?.focus?.();
  }

  function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
    return h("label", { class: "nb-f" }, label, input, hint ? h("span", { class: "nb-hint" }, hint) : null);
  }

  function textInput(key: "student" | "date" | "title", max: number, placeholder: string): HTMLInputElement {
    const el = h("input", { type: "text", maxlength: max, autocomplete: "off", spellcheck: key === "title" ? "true" : "false", placeholder });
    el.value = nb[key];
    el.addEventListener("input", () => set({ ...nb, [key]: cleanLine(el.value, max) }));
    return el;
  }

  function renderRuns(): void {
    if (!runList) return;
    runList.innerHTML = "";
    if (!nb.runs.length) {
      runList.append(h("li", { class: "nb-empty" }, "No test runs yet. Press ▶ Run — each run is recorded here."));
      return;
    }
    // Newest first in the dialog.
    nb.runs.map((r, i) => ({ r, n: i + 1 })).reverse().forEach(({ r, n }) => {
      const star = h("button", {
        class: "nb-star", type: "button", "aria-pressed": String(r.starred),
        "aria-label": `Include run ${n} on the page`, title: r.starred ? "On the page (click to remove)" : "Star to put this run on the page",
      }, r.starred ? "★" : "☆");
      star.addEventListener("click", () => {
        set(updateRun(nb, r.id, { starred: !r.starred }));
        renderRuns();
        (runList?.querySelector(`[data-run="${r.id}"] .nb-star`) as HTMLElement | null)?.focus();
      });
      const note = h("input", { type: "text", maxlength: MAX_NOTE, placeholder: "What did you change? e.g. changed the turn to 85°", "aria-label": `Note for run ${n}` });
      note.value = r.note;
      note.addEventListener("input", () => set(updateRun(nb, r.id, { note: note.value })));
      const thumb = r.thumb
        ? h("img", { class: "nb-thumb", src: r.thumb, alt: `Path of run ${n}` })
        : h("div", { class: "nb-thumb nb-thumb-none" }, "no picture");
      const goals = r.goalsTotal ? ` · goals ${r.goalsPassed}/${r.goalsTotal}` : "";
      runList!.append(h("li", { class: r.starred ? "nb-on" : "", "data-run": r.id },
        star, thumb,
        h("div", { class: "nb-rinfo" },
          h("div", { class: "nb-rtop" }, `#${n} · ${runResultText(r)}${goals}`),
          h("div", { class: "nb-rsub" }, `${formatWhen(r.at)} · ${r.final} · ${r.steps} steps`),
          note)));
    });
  }

  function open(): void {
    if (dlg) return;
    prevFocus = document.activeElement as HTMLElement | null;
    const flowAvailable = !!findFlowchartExport();
    const today = todayText();

    const student = textInput("student", MAX_STUDENT, "Your name");
    const date = textInput("date", MAX_DATE, today);
    if (!nb.date) date.value = today;
    date.addEventListener("blur", () => { if (!date.value.trim()) date.value = today; });
    const title = textInput("title", MAX_TITLE, host.projectName());

    const areas = REFLECTIONS.map((q) => {
      const ta = h("textarea", { rows: 2, maxlength: MAX_REFLECTION, "data-q": q.key, "aria-label": q.label });
      ta.value = nb[q.key];
      ta.addEventListener("input", () => set({ ...nb, [q.key]: cleanText(ta.value, MAX_REFLECTION) }));
      return field(q.label, ta);
    });

    const incItems: { key: keyof NotebookInclude; label: string; enabled: boolean; why?: string }[] = [
      { key: "code", label: "Code", enabled: true },
      { key: "path", label: "Path picture", enabled: true },
      { key: "runs", label: "Run log", enabled: true },
      { key: "activity", label: "Activity progress", enabled: !!host.activity(), why: "No guided activity is open" },
      { key: "flowchart", label: "Flowchart", enabled: flowAvailable, why: "No flowchart picture is available" },
    ];
    const inc = h("fieldset", { class: "nb-inc" }, h("legend", {}, "Put on the page"),
      ...incItems.map((it) => {
        const cb = h("input", { type: "checkbox", "data-inc": it.key });
        cb.checked = it.enabled && nb.include[it.key];
        cb.disabled = !it.enabled;
        cb.addEventListener("change", () => set({ ...nb, include: { ...nb.include, [it.key]: cb.checked } }));
        return h("label", { class: it.enabled ? "" : "nb-off", title: it.enabled ? null : it.why ?? null }, cb, it.label);
      }));

    runList = h("ol", { class: "nb-runlist", "aria-label": "Test runs, newest first" });
    renderRuns();

    const printBtn = h("button", { class: "btn btn-primary", type: "button" }, "Print / Save as PDF…");
    printBtn.addEventListener("click", () => void openPrintView());
    const copyBtn = h("button", { class: "btn", type: "button" }, "Copy as text");
    copyBtn.addEventListener("click", () => void copyText());
    const closeBtn = h("button", { class: "btn", type: "button" }, "Close");
    closeBtn.addEventListener("click", close);

    const titleId = "nb-dlg-title";
    const box = h("div", { class: "dlg nb-dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h("h2", { id: titleId }, "Engineering notebook page"),
      h("div", { class: "nb-grid" },
        h("div", { class: "nb-col" },
          h("div", { class: "nb-row" }, field("Your name", student), field("Date", date)),
          field("Project title", title),
          ...areas),
        h("div", { class: "nb-col" },
          h("p", { class: "nb-hint" }, "Star ☆ the runs to put on your page, and add a one-line note to each."),
          runList, inc)),
      h("div", { class: "nb-btns" },
        h("span", { class: "nb-privacy" }, "Your name and notes are saved only in this project file and this browser. Nothing is sent anywhere."),
        closeBtn, copyBtn, printBtn));
    const back = h("div", { class: "dlg-back nb-back" }, box);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    // Keys typed here must not reach the app's shortcuts (Ctrl+Enter = Run, Esc = Stop …).
    back.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") {
        const f = Array.from(box.querySelectorAll<HTMLElement>("button, input:not([disabled]), textarea"));
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      e.stopPropagation();
    });
    document.body.append(back);
    dlg = back;
    (nb.student ? areas[0].querySelector("textarea") as HTMLElement : student).focus();
  }

  // ------------------------------------------------------------ print view
  function closeView(): void {
    view?.remove(); view = null;
    document.body.classList.remove("nb-printing");
    (dlg?.querySelector(".btn-primary") as HTMLElement | null)?.focus();
  }

  async function openPrintView(): Promise<void> {
    nb = enforceBudget(nb);
    const html = buildPageHtml(await pageInput());
    view?.remove();
    const printBtn = h("button", { class: "btn btn-primary", type: "button" }, "🖨 Print / Save as PDF");
    printBtn.addEventListener("click", () => window.print());
    const back = h("button", { class: "btn", type: "button" }, "← Back");
    back.addEventListener("click", closeView);
    const sheet = h("div", { class: "nb-sheet" });
    sheet.innerHTML = html; // built from escaped text by buildPageHtml
    view = h("div", { class: "nb-view", role: "dialog", "aria-modal": "true", "aria-label": "Notebook page preview" },
      h("div", { class: "nb-viewbar" }, back,
        h("p", {}, "To save to Google Drive: press Print, choose “Save as PDF” (or “Save to Google Drive”) as the destination."),
        printBtn),
      sheet);
    view.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeView(); }
      e.stopPropagation();
    });
    document.body.append(view);
    document.body.classList.add("nb-printing");
    printBtn.focus();
  }

  async function copyText(): Promise<boolean> {
    const text = buildText({ ...(await pageInput()), fieldImage: null, flowchartImage: null });
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back below */ }
    if (!ok) {
      const ta = h("textarea", { "aria-hidden": "true", style: "position:fixed;left:-9999px;top:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    toast(ok ? "Copied. Paste it into your Google Doc notebook." : "Couldn't copy — your browser blocked the clipboard.", 3500);
    return ok;
  }

  return {
    data: () => nb,
    load(next) { nb = next ? enforceBudget(next) : emptyNotebook(); lastRun = null; if (dlg) { close(); } },
    record, open, isOpen: () => !!dlg || !!view, pageInput, openPrintView, copyText,
  };
}
