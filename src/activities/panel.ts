/**
 * The student's activity panel, docked above the code editor. It owns the current activity's
 * progress and talks to the app shell only through ActivityHost.
 */
import type { Activity, ActivityProgress, ActivityStep, StepCheckResult } from "../core/activity";
import { h, ask, toast } from "../ui/dom";
import { checkStep, type LastRun } from "./checks";
import { renderRich, renderInline, plainText } from "./markup";
import { newProgress } from "./activityFile";
import { loadProgress, saveProgress, saveCurrentId } from "./progress";
import { playSound } from "../ui/sound";

type Mode = "blocks" | "python";

export interface ActivityHost {
  /** The Python the checks look at (the editor's text, or the Python made from the blocks). */
  getPython(): string;
  getMode(): Mode;
  setMode(m: Mode): void;
  /** Lock the mode toggle (null = unlock). */
  setLock(m: Mode | null): void;
  /** Switch to a step's world. Does nothing when it is already the current world. */
  loadWorld(spec: NonNullable<ActivityStep["world"]>): void;
  /** Python editor holds nothing of the student's own (empty / default template / world starter). */
  isPythonUntouched(): boolean;
  getPythonText(): string;
  setPython(text: string): void;
  isBlocksUntouched(): boolean;
  /** null = blank workspace. Returns false if the blocks couldn't be loaded. */
  setBlocks(state: unknown | null): boolean;
  showMsg(kind: "ok" | "info" | "err", html: string, actions?: { label: string; onClick: () => void; primary?: boolean }[]): void;
  clearMsg(): void;
  celebrate(title: string, text: string): void;
  isRunning(): boolean;
  /** Something worth autosaving changed (progress lives in the project too). */
  changed(): void;
  /** Panel size changed (the editors may need a resize). */
  layout(): void;
}

export interface StartOptions {
  progress?: ActivityProgress | null;
  /** Load the current step's world + starter code (false when restoring a saved project). */
  applyStep?: boolean;
  /** Teacher preview: progress isn't stored. */
  preview?: boolean;
  /** Reviewing someone's turned-in file: progress isn't stored in this browser, but is kept in the project. */
  review?: boolean;
}

const COLLAPSE_KEY = "robot-lab-activity-collapsed-v1";

export interface ActivityPanel {
  start(a: Activity, opts?: StartOptions): void;
  leave(): void;
  readonly active: boolean;
  onRun(r: LastRun): void;
  onCodeChange(): void;
  /** For saving into the .robolab project (null when no activity, or a teacher preview). */
  embed(): { activity: Activity; progress: ActivityProgress } | null;
  state(): { activityId: string; stepId: string; stepIndex: number; passed: boolean; checks: StepCheckResult; completed: string[]; preview: boolean } | null;
  /** Re-check (e.g. after the world changed). */
  refresh(): void;
  /** Called with every completed activity, for the catalogue's ✓ marks. */
  onProgress?: (p: ActivityProgress) => void;
}

export function createActivityPanel(root: HTMLElement, host: ActivityHost): ActivityPanel {
  let act: Activity | null = null;
  let prog: ActivityProgress | null = null;
  let preview = false;
  let review = false;
  let lastRun: LastRun | null = null;
  let result: StepCheckResult | null = null;
  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { /* ignore */ }
  let codeTimer: ReturnType<typeof setTimeout> | null = null;
  let checksEl: HTMLElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;
  let sumEl: HTMLElement | null = null;
  let doneEl: HTMLElement | null = null;

  const step = (): ActivityStep => act!.steps[prog!.stepIndex];
  const persist = () => { if (prog && !preview && !review) { saveProgress(prog); } if (prog) { prog.updatedAt = new Date().toISOString(); host.changed(); } };

  /** The world in force for step i: its own, or the nearest earlier step's. */
  function worldFor(i: number): ActivityStep["world"] {
    for (let k = i; k >= 0; k--) if (act!.steps[k].world) return act!.steps[k].world;
    return undefined;
  }

  const allStarters = () => new Set(act ? act.steps.map((s) => s.starter?.python).filter((x): x is string => !!x) : []);

  function applyStarter(force: boolean): void {
    const st = step().starter;
    const lock = step().lockMode;
    if (!st) { if (lock) host.setMode(lock); return; }
    const target: Mode = lock ?? st.mode;
    let pending = false;
    if (st.python !== undefined) {
      const mine = !host.isPythonUntouched() && !allStarters().has(host.getPythonText());
      if (force || !mine) host.setPython(st.python);
      else if (host.getPythonText() !== st.python) pending = true;
    }
    if (st.mode === "blocks" && st.blocks !== undefined) {
      if (force || host.isBlocksUntouched()) {
        if (!host.setBlocks(st.blocks)) host.showMsg("info", "This step's starter blocks couldn't be loaded.");
      } else pending = true;
    }
    host.setMode(target);
    if (pending) {
      host.showMsg("info", "This step has starter code. Load it? (It replaces the code you have now.)", [
        { label: "Load starter code", primary: true, onClick: () => { applyStarter(true); host.clearMsg(); evaluate(); } },
        { label: "Keep my code", onClick: () => host.clearMsg() },
      ]);
    }
  }

  function enterStep(i: number, apply: boolean): void {
    if (!act || !prog) return;
    prog.stepIndex = Math.max(0, Math.min(act.steps.length - 1, i));
    lastRun = null;
    const s = step();
    host.setLock(s.lockMode ?? null);
    if (apply) {
      const w = worldFor(prog.stepIndex);
      if (w) host.loadWorld(w);
      applyStarter(false);
    } else if (s.lockMode && host.getMode() !== s.lockMode) host.setMode(s.lockMode);
    persist();
    render();
    evaluate();
  }

  function evaluate(): void {
    if (!act || !prog) return;
    const s = step();
    result = checkStep(s, {
      python: host.getPython(), lastRun, quizAnswers: prog.quizAnswers[s.id] ?? [], starterPython: s.starter?.python,
    });
    const wasDone = prog.completed.includes(s.id);
    if (result.passed && !wasDone) {
      prog.completed.push(s.id);
      persist();
      api.onProgress?.(prog);
      stepCelebrate(s);
    }
    paintChecks();
  }

  function stepCelebrate(s: ActivityStep): void {
    const all = act!.steps.every((x) => prog!.completed.includes(x.id));
    root.classList.remove("act-flash"); void root.offsetWidth; root.classList.add("act-flash");
    if (all) { playSound("success"); host.celebrate("Activity complete!", `${act!.title} — all ${act!.steps.length} steps done.`); }
    else { playSound("step"); toast(`Step done: ${plainText(s.title)}`, 2500); }
    if (doneEl) doneEl.hidden = false;
  }

  // ---------------------------------------------------------------- rendering
  function paintChecks(): void {
    if (!act || !prog || !result) return;
    const s = step();
    if (checksEl) {
      checksEl.innerHTML = "";
      for (const it of result.items) {
        checksEl.append(h("li", { class: it.passed ? "pass" : "" },
          h("span", { class: "tick", "aria-hidden": "true" }, it.passed ? "✓" : "✗"),
          h("span", {}, h("span", { html: renderInline(it.label) }), h("span", { class: "sr-only" }, it.passed ? " (done)" : " (not yet)"),
            it.detail && !it.passed ? h("span", { class: "act-detail" }, " — " + it.detail) : null)));
      }
      checksEl.hidden = result.items.length === 0;
    }
    const ok = result.passed || prog.completed.includes(s.id);
    if (nextBtn) nextBtn.disabled = !ok;
    if (nextBtn) nextBtn.title = ok ? "" : "Finish the checklist to go on";
    if (sumEl) {
      const n = result.items.filter((x) => x.passed).length;
      sumEl.textContent = result.items.length ? `${prog.completed.includes(s.id) || result.passed ? "✓" : `${n}/${result.items.length}`}` : prog.completed.includes(s.id) ? "✓" : "";
    }
    if (doneEl) doneEl.hidden = !prog.completed.includes(s.id);
  }

  let renderedStep = "";
  function render(): void {
    const key = act && prog ? act.id + "/" + prog.stepIndex : "";
    const keepScroll = key === renderedStep ? (root.querySelector(".act-body") as HTMLElement | null)?.scrollTop ?? 0 : 0;
    renderedStep = key;
    root.innerHTML = "";
    checksEl = nextBtn = null; sumEl = doneEl = null;
    if (!act || !prog) { root.hidden = true; host.layout(); return; }
    root.hidden = false;
    root.classList.toggle("collapsed", collapsed);
    const s = step();
    const idx = prog.stepIndex, total = act.steps.length;
    const bodyId = "actBody";

    sumEl = h("span", { class: "act-sum", "aria-label": "Checklist" });
    const head = h("div", { class: "act-head" },
      h("button", {
        class: "act-toggle", "aria-expanded": String(!collapsed), "aria-controls": bodyId,
        title: collapsed ? "Show the activity" : "Hide the activity (more room for code)",
        onclick: () => { collapsed = !collapsed; try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ } render(); paintChecks(); },
      }, h("span", { class: "act-caret", "aria-hidden": "true" }, collapsed ? "▸" : "▾"),
        h("span", { class: "act-kicker" }, preview ? "Preview" : review ? "Reviewing" : "Activity"),
        h("span", { class: "act-title" }, act.title),
        h("span", { class: "act-count" }, `Step ${idx + 1} of ${total}`),
        sumEl),
      h("button", { class: "btn btn-sm act-leave", title: "Leave this activity (your progress is kept)", onclick: () => void leaveAsk() }, "Leave"));
    root.append(head);

    const body = h("div", { class: "act-body", id: bodyId });
    body.append(h("h3", { class: "act-step-title" }, s.title));
    if (s.body.trim()) body.append(h("div", { class: "act-text", html: renderRich(s.body) }));
    if (s.lockMode) body.append(h("p", { class: "act-note" }, `This step uses ${s.lockMode === "python" ? "Python" : "Blocks"}.`));

    checksEl = h("ul", { class: "act-checks", "aria-label": "Checklist" });
    body.append(checksEl);

    (s.quiz ?? []).forEach((q, qi) => body.append(renderQuiz(s, qi)));

    // hints
    const shown = Math.min(prog.hintsShown[s.id] ?? 0, s.hints.length);
    if (s.hints.length) {
      const hints = h("div", { class: "act-hints" });
      if (shown) {
        const ol = h("ol", {});
        for (let k = 0; k < shown; k++) ol.append(h("li", { html: renderRich(s.hints[k]) }));
        hints.append(ol);
      }
      if (shown < s.hints.length) {
        hints.append(h("button", {
          class: "btn btn-sm", onclick: () => {
            prog!.hintsShown[s.id] = shown + 1; persist(); render(); paintChecks();
            (root.querySelector(".act-hints li:last-child") as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
          },
        }, shown ? `Show another hint (${s.hints.length - shown} left)` : "Show a hint"));
      }
      body.append(hints);
    }
    doneEl = h("div", { class: "act-done", role: "status" }, h("b", {}, "Step complete! "), s.done ? h("div", { html: renderRich(s.done) }) : idx < total - 1 ? "Press Next." : "");
    body.append(doneEl);

    nextBtn = h("button", { class: "btn btn-sm btn-primary", onclick: () => next() }, idx < total - 1 ? "Next ›" : "Finish") as HTMLButtonElement;
    body.append(h("div", { class: "act-nav" },
      h("button", { class: "btn btn-sm", disabled: idx === 0, onclick: () => go(idx - 1) }, "‹ Back"),
      h("button", { class: "btn btn-sm", title: "Put this step's starter code and world back", onclick: () => void restartStep() }, "Start this step over"),
      h("span", { class: "spacer" }),
      nextBtn));
    root.append(body);
    body.scrollTop = keepScroll;
    host.layout();
  }

  function plainOneLine(t: string): string { return t.replace(/\s*\n\s*/g, " "); }

  function renderQuiz(s: ActivityStep, qi: number): HTMLElement {
    const q = s.quiz![qi];
    const answers = prog!.quizAnswers[s.id] ?? [];
    const chosen = typeof answers[qi] === "number" ? answers[qi] : -1;
    const name = `actq-${s.id}-${qi}`;
    const fs = h("fieldset", { class: "act-quiz" });
    fs.append(h("legend", { html: renderInline(plainOneLine(q.prompt)) }));
    if (q.code) fs.append(h("pre", { class: "act-code" }, q.code));
    q.choices.forEach((c, ci) => {
      const id = `${name}-${ci}`;
      const input = h("input", { type: "radio", name, id, value: String(ci) }) as HTMLInputElement;
      input.checked = ci === chosen;
      input.addEventListener("change", () => {
        const arr = (prog!.quizAnswers[s.id] ??= s.quiz!.map(() => -1));
        while (arr.length < s.quiz!.length) arr.push(-1);
        arr[qi] = ci;
        persist();
        render();
        evaluate();
        (document.getElementById(id) as HTMLElement | null)?.focus();
      });
      const cls = chosen >= 0 && ci === chosen ? (ci === q.answer ? "right" : "wrong") : "";
      fs.append(h("label", { class: "act-choice " + cls, for: id }, input, h("span", { html: renderInline(c) })));
    });
    if (chosen >= 0) {
      const right = chosen === q.answer;
      fs.append(h("div", { class: "act-explain " + (right ? "right" : "wrong"), role: "status" },
        h("b", {}, right ? "Correct. " : "Not quite. "), h("span", { html: renderInline(plainOneLine(q.explain || (right ? "" : "Try another answer."))) })));
    }
    return fs;
  }

  // ---------------------------------------------------------------- navigation
  function go(i: number): void {
    if (!act || host.isRunning()) return;
    host.clearMsg();
    enterStep(i, true);
  }

  function next(): void {
    if (!act || !prog || host.isRunning()) return;
    const s = step();
    if (!prog.completed.includes(s.id) && !result?.passed) return;
    if (prog.stepIndex < act.steps.length - 1) { go(prog.stepIndex + 1); return; }
    const all = act.steps.every((x) => prog!.completed.includes(x.id));
    if (all) host.celebrate("Activity complete!", `${act.title} — all ${act.steps.length} steps done.`);
    else {
      const left = act.steps.filter((x) => !prog!.completed.includes(x.id)).map((x) => `“${x.title}”`).join(", ");
      host.showMsg("info", `Almost there! Still to finish: ${left.replace(/[<>&]/g, "")}. Use <b>Back</b> to get to them.`);
    }
  }

  async function restartStep(): Promise<void> {
    if (!act || host.isRunning()) return;
    const c = await ask("Start this step over", "<p>Put this step's starter code and playground back? The code you have now will be replaced.</p>",
      [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Start over", kind: "danger" }]);
    if (c !== "ok" || !act) return;
    lastRun = null;
    const w = worldFor(prog!.stepIndex);
    if (w) host.loadWorld(w);
    const st = step().starter;
    if (st) applyStarter(true);
    else { host.setPython(""); host.setBlocks(null); }
    render(); evaluate();
  }

  async function leaveAsk(): Promise<void> {
    const c = await ask("Leave activity", "<p>Leave this activity? Your progress is kept, so you can continue later from <b>Activities</b>. Your code stays in the editor.</p>",
      [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Leave activity", kind: "primary" }]);
    if (c === "ok") api.leave();
  }

  const api: ActivityPanel = {
    get active() { return !!act; },
    start(a, opts = {}) {
      act = a;
      preview = !!opts.preview;
      review = !preview && !!opts.review;
      prog = opts.progress && opts.progress.activityId === a.id ? opts.progress : (preview ? null : loadProgress(a)) ?? newProgress(a);
      prog.stepIndex = Math.max(0, Math.min(a.steps.length - 1, prog.stepIndex));
      if (!preview && !review) { saveCurrentId(a.id); saveProgress(prog); }
      enterStep(prog.stepIndex, opts.applyStep !== false);
    },
    leave() {
      if (!act) return;
      if (!preview && !review && prog) saveProgress(prog);
      if (!preview && !review) saveCurrentId(null);
      act = null; prog = null; lastRun = null; result = null; preview = false; review = false;
      host.setLock(null);
      render();
      host.changed();
    },
    onRun(r) { if (!act) return; lastRun = r; evaluate(); },
    onCodeChange() {
      if (!act) return;
      if (codeTimer) clearTimeout(codeTimer);
      codeTimer = setTimeout(() => { codeTimer = null; evaluate(); }, 400);
    },
    embed() { return act && prog && !preview ? { activity: act, progress: { ...prog } } : null; },
    state() {
      if (!act || !prog || !result) return null;
      return { activityId: act.id, stepId: step().id, stepIndex: prog.stepIndex, passed: result.passed, checks: result, completed: [...prog.completed], preview };
    },
    refresh() { if (act) evaluate(); },
  };
  render();
  return api;
}
