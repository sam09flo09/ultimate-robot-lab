/**
 * Teacher authoring: a plain form for writing an activity. The draft is autosaved in this browser;
 * "Preview" runs it as a student would and "Save activity" writes a .robolab-activity file.
 */
import type { Activity, ActivityStep, CodeCheck, RunCheck, QuizQuestion } from "../core/activity";
import type { World } from "../core/types";
import { h, ask } from "../ui/dom";
import { defaultLabel, CODE_CHECK_KINDS, RUN_CHECK_KINDS } from "./checks";
import { plainText } from "./markup";
import { sanitizeActivity, cleanId } from "./activityFile";
import { loadDraft, saveDraft } from "./progress";

type Check = CodeCheck | RunCheck;
type Kind = Check["kind"];

export interface AuthorHost {
  playgrounds: { id: string; name: string }[];
  /** The world in the level editor right now (validated), or null if it isn't available. */
  getLevelWorld(): World | null;
  preview(a: Activity): void;
  save(a: Activity): Promise<void>;
  /** Pick a .robolab-activity file to edit. */
  open(): Promise<Activity | null>;
}

const KIND_NAMES: Record<Kind, string> = {
  usesCall: "Code uses a command", usesLoop: "Code uses a loop", usesIf: "Code uses if", definesFunction: "Code defines a function",
  assignsVariable: "Code sets a variable", definesConstant: "Code defines a CONSTANT", hasComment: "Code has comments",
  readsSensor: "Code reads a sensor", printsOutput: "Code prints", maxLines: "Code is short (max lines)",
  goalsComplete: "Run: all challenge goals done", ranWithoutError: "Run: no errors", endsInSquare: "Run: ends in square (number grid)",
  logContains: "Run: printed text",
};

function blankCheck(kind: Kind): Check {
  switch (kind) {
    case "usesCall": return { kind, name: "drivetrain.drive_for", label: "" };
    case "maxLines": return { kind, lines: 12, label: "" };
    case "endsInSquare": return { kind, square: 1, label: "" };
    case "logContains": return { kind, text: "", label: "" };
    default: return { kind, label: "" } as Check;
  }
}

const blankStep = (n: number): ActivityStep => ({ id: `step-${n}`, title: `Step ${n}`, body: "", checks: [], hints: [] });

export function blankActivity(): Activity {
  return {
    format: "robot-lab-activity", version: 1, id: "t-my-activity", title: "My activity", summary: "", level: "core", minutes: 30,
    standards: [], steps: [{ ...blankStep(1), world: { playground: "number-grid" }, starter: { mode: "python", python: "def main():\n    pass\n\nstart(main)\n" } }],
  };
}

const CHEATSHEET = "Markup: blank line = new paragraph · **bold** · `code` · lines starting with \"- \" make a list · ```python … ``` on their own lines make a code block.";

export function createActivityAuthor(root: HTMLElement, host: AuthorHost): { dispose(): void; getActivity(): Activity } {
  let draft: Activity = blankActivity();
  const saved = loadDraft();
  if (saved) { try { draft = sanitizeActivity(saved, { teacher: true }).activity; } catch { /* keep blank */ } }
  let sel = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const touch = () => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; saveDraft(draft); }, 500); };

  // ---------------------------------------------------------------- field helpers
  let uid = 0;
  const field = (label: string, input: HTMLElement, hint?: string) => {
    const id = "af" + (++uid);
    input.id = id;
    return h("div", { class: "af-field" }, h("label", { for: id }, label), input, hint ? h("div", { class: "af-hint" }, hint) : null);
  };
  const text = (value: string, onInput: (v: string) => void, o: { rows?: number; mono?: boolean; placeholder?: string; max?: number } = {}) => {
    const el = o.rows
      ? h("textarea", { rows: o.rows, class: o.mono ? "mono" : "", placeholder: o.placeholder ?? null, spellcheck: o.mono ? "false" : "true" }) as HTMLTextAreaElement
      : h("input", { type: "text", placeholder: o.placeholder ?? null, maxlength: o.max ?? null }) as HTMLInputElement;
    el.value = value;
    el.addEventListener("input", () => { onInput(el.value); touch(); });
    return el;
  };
  const num = (value: number | undefined, onInput: (v: number | undefined) => void, min = 0, max = 10000) => {
    const el = h("input", { type: "number", min, max, step: 1 }) as HTMLInputElement;
    el.value = value === undefined ? "" : String(value);
    el.addEventListener("input", () => { const n = Number(el.value); onInput(el.value === "" || !Number.isFinite(n) ? undefined : Math.min(max, Math.max(min, Math.round(n)))); touch(); });
    return el;
  };
  const select = (opts: [string, string][], value: string, onChange: (v: string) => void) => {
    const el = h("select", {}, ...opts.map(([v, t]) => h("option", { value: v }, t))) as HTMLSelectElement;
    el.value = value;
    el.addEventListener("change", () => { onChange(el.value); touch(); });
    return el;
  };
  const check = (label: string, value: boolean, onChange: (v: boolean) => void) => {
    const el = h("input", { type: "checkbox" }) as HTMLInputElement;
    el.checked = value;
    el.addEventListener("change", () => { onChange(el.checked); touch(); });
    return h("label", { class: "check" }, el, " " + label);
  };
  const btn = (label: string, onclick: () => void, o: { cls?: string; title?: string; disabled?: boolean; aria?: string } = {}) =>
    h("button", { type: "button", class: "btn btn-sm " + (o.cls ?? ""), title: o.title ?? null, disabled: !!o.disabled, "aria-label": o.aria ?? null, onclick }, label);

  const rerender = () => { const y = root.scrollTop; render(); root.scrollTop = y; touch(); };

  // ---------------------------------------------------------------- render
  function render(): void {
    root.innerHTML = "";
    const bar = h("div", { class: "af-bar" },
      btn("▶ Preview as a student", () => preview(), { cls: "btn-primary" }),
      btn("Save activity", () => void save()),
      btn("Open activity…", () => void open()),
      btn("New activity", () => void reset()),
      btn("How to share", () => void share()),
      h("span", { class: "af-hint" }, "Your draft is kept in this browser as you type."));

    const meta = h("section", { class: "af-meta" },
      field("Activity title", text(draft.title, (v) => { draft.title = v; }, { max: 120 })),
      field("One-line summary (shown in the catalogue)", text(draft.summary, (v) => { draft.summary = v; }, { max: 300 })),
      h("div", { class: "af-row" },
        field("Level", select([["starter", "Starter"], ["core", "Core"], ["stretch", "Stretch"]], draft.level, (v) => { draft.level = v as Activity["level"]; })),
        field("Minutes", num(draft.minutes, (v) => { draft.minutes = v ?? 30; }, 1, 600)),
        field("Your name (optional, no email)", text(draft.author ?? "", (v) => { draft.author = v.trim() ? v : undefined; }, { max: 80 }))),
      field("Standards (comma separated)", text(draft.standards.join(", "), (v) => { draft.standards = v.split(",").map((s) => s.trim()).filter(Boolean); }, { placeholder: "e.g. TEKS (d)(5)(A), YouScience Std 5 Obj 3.2" })));

    sel = Math.max(0, Math.min(draft.steps.length - 1, sel));
    const stepList = h("ol", { class: "af-steps", "aria-label": "Steps" });
    draft.steps.forEach((s, i) => {
      stepList.append(h("li", { class: i === sel ? "sel" : "" },
        h("button", { type: "button", class: "af-step-pick", "aria-current": i === sel ? "true" : null, onclick: () => { sel = i; rerender(); } },
          h("span", { class: "n" }, String(i + 1)), plainText(s.title) || `Step ${i + 1}`),
        h("span", { class: "af-step-tools" },
          btn("▲", () => { move(i, -1); }, { disabled: i === 0, aria: `Move step ${i + 1} up` }),
          btn("▼", () => { move(i, 1); }, { disabled: i === draft.steps.length - 1, aria: `Move step ${i + 1} down` }),
          btn("✕", () => void removeStep(i), { disabled: draft.steps.length === 1, aria: `Remove step ${i + 1}` }))));
    });
    const steps = h("aside", { class: "af-side" }, h("p", { class: "label" }, "Steps"), stepList,
      btn("+ Add step", () => { draft.steps.push(blankStep(draft.steps.length + 1)); sel = draft.steps.length - 1; rerender(); }));

    root.append(bar, meta, h("div", { class: "af-main" }, steps, renderStep(draft.steps[sel], sel)));
  }

  function renderStep(s: ActivityStep, i: number): HTMLElement {
    const box = h("section", { class: "af-step", "aria-label": `Step ${i + 1}` });
    box.append(h("h3", {}, `Step ${i + 1}`));
    box.append(field("Step title", text(s.title, (v) => { s.title = v; const b = root.querySelector(".af-steps li.sel .af-step-pick"); if (b) b.lastChild!.textContent = plainText(v) || `Step ${i + 1}`; }, { max: 120 })));
    box.append(field("Instructions", text(s.body, (v) => { s.body = v; }, { rows: 6 }), CHEATSHEET));

    // world
    const worldVal = !s.world ? "" : "playground" in s.world ? "pg:" + s.world.playground : "custom";
    const worldOpts: [string, string][] = [["", i === 0 ? "(the student's current playground)" : "(same as the previous step)"],
      ...host.playgrounds.map((p) => ["pg:" + p.id, p.name] as [string, string])];
    if (worldVal === "custom" || host.getLevelWorld()) worldOpts.push(["custom", s.world && "custom" in s.world ? `Custom level: ${s.world.custom.name}` : "Use the level I'm editing"]);
    const wSel = select(worldOpts, worldVal, (v) => {
      if (!v) delete s.world;
      else if (v.startsWith("pg:")) s.world = { playground: v.slice(3) };
      else { const w = host.getLevelWorld(); if (w) s.world = { custom: { ...w, id: "custom" } }; }
      rerender();
    });
    const worldRow = h("div", { class: "af-row" }, field("Playground for this step", wSel));
    if (s.world && "custom" in s.world) {
      worldRow.append(h("div", { class: "af-field" }, h("span", { class: "af-hint" }, "Embedded copy of a level."),
        btn("Copy the level editor's level again", () => { const w = host.getLevelWorld(); if (w) { s.world = { custom: { ...w, id: "custom" } }; rerender(); } }, { disabled: !host.getLevelWorld() })));
    }
    box.append(worldRow);

    // starter + lock
    box.append(h("div", { class: "af-row" },
      field("Lock coding mode", select([["", "No — students may switch"], ["python", "Python only"], ["blocks", "Blocks only"]], s.lockMode ?? "", (v) => {
        if (v === "python" || v === "blocks") s.lockMode = v; else delete s.lockMode;
      }))));
    box.append(field("Starter Python (put in the editor when the step starts, if the student hasn't written their own code)",
      text(s.starter?.python ?? "", (v) => {
        if (v.trim()) s.starter = { ...(s.starter ?? {}), mode: "python", python: v };
        else delete s.starter;
      }, { rows: 5, mono: true, placeholder: "def main():\n    pass\n\nstart(main)" })));

    // checks
    const checks = h("div", { class: "af-group" }, h("p", { class: "label" }, "Automatic checks (all must pass)"));
    s.checks.forEach((c, ci) => checks.append(renderCheck(s, c, ci)));
    const add = select([["", "+ Add a check…"], ...[...CODE_CHECK_KINDS, ...RUN_CHECK_KINDS].map((k) => [k, KIND_NAMES[k]] as [string, string])], "", (v) => {
      if (v) { s.checks.push(blankCheck(v as Kind)); rerender(); }
    });
    add.setAttribute("aria-label", "Add a check");
    checks.append(add);
    box.append(checks);

    // quiz
    const quiz = h("div", { class: "af-group" }, h("p", { class: "label" }, "Quiz questions (all must be answered correctly)"));
    (s.quiz ?? []).forEach((q, qi) => quiz.append(renderQuestion(s, q, qi)));
    quiz.append(btn("+ Add a question", () => {
      (s.quiz ??= []).push({ prompt: "Question?", choices: ["Answer A", "Answer B"], answer: 0, explain: "" });
      rerender();
    }));
    box.append(quiz);

    // hints + done
    box.append(field("Hints (one per line, revealed one at a time)", text(s.hints.join("\n"), (v) => { s.hints = v.split("\n").map((x) => x.trim()).filter(Boolean); }, { rows: 3 })));
    box.append(field("Message when the step is complete (optional)", text(s.done ?? "", (v) => { if (v.trim()) s.done = v; else delete s.done; }, { max: 300 })));
    return box;
  }

  function renderCheck(s: ActivityStep, c: Check, ci: number): HTMLElement {
    const row = h("div", { class: "af-check" }, h("b", {}, KIND_NAMES[c.kind]));
    const fields = h("div", { class: "af-row" });
    const any = c as unknown as Record<string, unknown>;
    switch (c.kind) {
      case "usesCall":
        fields.append(field("Command", text(c.name, (v) => { c.name = v.replace(/\s+/g, ""); }, { placeholder: "drivetrain.drive_for", max: 80 })),
          field("At least", num(c.min, (v) => { if (v) c.min = v; else delete any.min; }, 1, 100)));
        break;
      case "usesLoop":
        fields.append(field("Loop", select([["any", "for or while"], ["for", "for"], ["while", "while"]], c.loop ?? "any", (v) => { c.loop = v as "for" | "while" | "any"; })));
        break;
      case "usesIf":
        fields.append(check("must have an else", !!c.withElse, (v) => { if (v) c.withElse = true; else delete any.withElse; }));
        break;
      case "definesFunction":
        fields.append(field("Not counting (comma separated)", text((c.besides ?? ["main"]).join(", "), (v) => { c.besides = v.split(",").map((x) => x.trim()).filter(Boolean); })));
        break;
      case "assignsVariable":
        fields.append(field("Variable name (optional)", text(c.name ?? "", (v) => { if (v.trim()) c.name = v.trim(); else delete any.name; }, { max: 60 })));
        break;
      case "hasComment":
        fields.append(field("At least", num(c.min, (v) => { if (v) c.min = v; else delete any.min; }, 1, 100)));
        break;
      case "maxLines":
        fields.append(field("Max lines", num(c.lines, (v) => { c.lines = v ?? 12; }, 1, 1000)));
        break;
      case "endsInSquare":
        fields.append(field("Square", num(c.square, (v) => { c.square = v ?? 1; }, 1, 10000)));
        break;
      case "logContains":
        fields.append(field("Text", text(c.text, (v) => { c.text = v; }, { max: 200 })));
        break;
    }
    fields.append(field("Checklist label (optional)", text(c.label, (v) => { c.label = v; }, { placeholder: defaultLabel(c), max: 300 })));
    row.append(fields, btn("✕", () => { s.checks.splice(ci, 1); rerender(); }, { aria: "Remove this check", cls: "af-x" }));
    return row;
  }

  function renderQuestion(s: ActivityStep, q: QuizQuestion, qi: number): HTMLElement {
    const box = h("div", { class: "af-check" }, h("b", {}, `Question ${qi + 1}`));
    const answerSel = () => select(q.choices.map((c, k) => [String(k), `${k + 1}. ${c.slice(0, 40)}`] as [string, string]), String(q.answer), (v) => { q.answer = Number(v); });
    const answerHost = h("div", {}, field("Correct answer", answerSel()));
    box.append(h("div", { class: "af-col" },
      field("Question", text(q.prompt, (v) => { q.prompt = v; }, { max: 2000 })),
      field("Code shown above the choices (optional)", text(q.code ?? "", (v) => { if (v.trim()) q.code = v; else delete q.code; }, { rows: 3, mono: true })),
      field("Choices (one per line, 2 to 8)", text(q.choices.join("\n"), (v) => {
        q.choices = v.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);
        if (q.answer >= q.choices.length) q.answer = 0;
        answerHost.innerHTML = ""; answerHost.append(field("Correct answer", answerSel()));
      }, { rows: 3 })),
      answerHost,
      field("Explanation (shown after answering)", text(q.explain, (v) => { q.explain = v; }, { max: 2000 }))));
    box.append(btn("✕", () => { s.quiz!.splice(qi, 1); if (!s.quiz!.length) delete s.quiz; rerender(); }, { aria: "Remove this question", cls: "af-x" }));
    return box;
  }

  // ---------------------------------------------------------------- actions
  function move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || j >= draft.steps.length) return;
    [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]];
    sel = j;
    rerender();
  }
  async function removeStep(i: number): Promise<void> {
    const c = await ask("Remove step", `<p>Remove step ${i + 1}? This can't be undone.</p>`, [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Remove", kind: "danger" }]);
    if (c !== "ok") return;
    draft.steps.splice(i, 1);
    sel = Math.min(sel, draft.steps.length - 1);
    rerender();
  }
  /** The draft as students will get it (validated exactly like an opened file). */
  function finished(): Activity | null {
    const copy: Activity = JSON.parse(JSON.stringify(draft));
    copy.id = "t-" + (cleanId(copy.title).replace(/^t-/, "") || "activity");
    copy.steps.forEach((s, i) => { s.id = cleanId(s.id) || `step-${i + 1}`; s.checks = s.checks.filter((c) => c.kind !== "usesCall" || c.name); });
    try { return sanitizeActivity(copy, { teacher: true }).activity; }
    catch (e) { void ask("Can't use this activity yet", `<p>${String((e as Error).message).replace(/[<>&]/g, "")}</p>`, [{ id: "ok", label: "OK", kind: "primary" }]); return null; }
  }
  function preview(): void { const a = finished(); if (a) host.preview(a); }
  async function save(): Promise<void> { const a = finished(); if (a) await host.save(a); }
  async function open(): Promise<void> {
    const a = await host.open();
    if (!a) return;
    draft = JSON.parse(JSON.stringify(a)); sel = 0; rerender();
  }
  async function reset(): Promise<void> {
    const c = await ask("New activity", "<p>Start a new, empty activity? The current draft will be cleared (save it first if you want to keep it).</p>",
      [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Start new", kind: "danger" }]);
    if (c !== "ok") return;
    draft = blankActivity(); sel = 0; rerender();
  }
  function share(): void {
    void ask("Share an activity", `
      <p><b>1.</b> Press <b>Save activity</b> to make a <code>.robolab-activity</code> file.</p>
      <p><b>2.</b> In Google Classroom, attach that file from Drive to an assignment (“Students can view file”).</p>
      <p><b>3.</b> Students download it and use <b>File → Open activity…</b> (or <b>Activities → Open activity file…</b>).</p>
      <p><b>4.</b> They save their work with <b>File → Save</b>: the <code>.robolab</code> file they turn in records which steps they finished.</p>
      <p class="muted">Nothing is uploaded anywhere by Robot Lab.</p>`, [{ id: "ok", label: "Got it", kind: "primary" }]);
  }

  render();
  return {
    dispose() { if (saveTimer) { clearTimeout(saveTimer); saveDraft(draft); } root.innerHTML = ""; },
    getActivity: () => draft,
  };
}
