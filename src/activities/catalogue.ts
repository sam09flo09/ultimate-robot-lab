/** The "Activities" catalogue: built-ins + teacher activities opened in this browser. */
import type { Activity } from "../core/activity";
import { h } from "../ui/dom";
import { loadProgress } from "./progress";

const LEVEL_TEXT: Record<Activity["level"], string> = { starter: "Starter", core: "Core", stretch: "Stretch" };

export interface CatalogueOptions {
  builtIns: Activity[];
  imported: Activity[];
  currentId: string | null;
  onStart: (a: Activity) => void;
  onOpenFile: () => void;
  onRemove: (a: Activity) => void;
}

let openBack: HTMLElement | null = null;

export function isCatalogueOpen(): boolean { return !!openBack; }

export function openCatalogue(o: CatalogueOptions): void {
  openBack?.remove();
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    back.remove(); openBack = null;
    document.removeEventListener("keydown", onKey, true);
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s" || e.key === "o")) { e.preventDefault(); e.stopPropagation(); }
  };

  const card = (a: Activity, teacher: boolean) => {
    const p = loadProgress(a);
    const done = p ? a.steps.filter((s) => p.completed.includes(s.id)).length : 0;
    const total = a.steps.length;
    const finished = done === total;
    const isCurrent = a.id === o.currentId;
    const verb = isCurrent ? "Continue" : finished ? "Review" : done ? "Continue" : "Start";
    return h("li", { class: "act-card" + (finished ? " finished" : "") },
      h("div", { class: "act-card-main" },
        h("div", { class: "act-card-title" }, a.title, teacher ? h("span", { class: "act-tag teacher" }, "Teacher") : null),
        a.summary ? h("p", { class: "act-card-sum" }, a.summary) : null,
        h("div", { class: "act-card-meta" },
          h("span", { class: "act-tag lvl-" + a.level }, LEVEL_TEXT[a.level]),
          h("span", {}, `≈ ${a.minutes} min`),
          h("span", { class: "act-prog", "aria-label": `${done} of ${total} steps done` }, finished ? `✓ ${total}/${total} steps` : `${done}/${total} steps`),
          a.author ? h("span", {}, "by " + a.author) : null),
        a.standards.length ? h("div", { class: "act-stds", "aria-label": "Standards" }, ...a.standards.map((s) => h("span", {}, s))) : null),
      h("div", { class: "act-card-btns" },
        h("button", { class: "btn btn-sm" + (finished ? "" : " btn-primary"), onclick: () => { close(); o.onStart(a); } }, verb),
        teacher ? h("button", { class: "btn btn-sm", title: "Remove from this browser", "aria-label": `Remove ${a.title}`, onclick: () => { o.onRemove(a); close(); openCatalogue({ ...o, imported: o.imported.filter((x) => x.id !== a.id) }); } }, "Remove") : null));
  };

  const list = h("ul", { class: "act-cards" }, ...o.builtIns.map((a) => card(a, false)), ...o.imported.map((a) => card(a, true)));
  if (!o.builtIns.length && !o.imported.length) list.append(h("li", { class: "muted" }, "No activities yet."));
  const box = h("div", { class: "dlg act-cat", role: "dialog", "aria-modal": "true", "aria-labelledby": "actCatTitle" },
    h("div", { class: "act-cat-head" },
      h("h2", { id: "actCatTitle" }, "Activities"),
      h("button", { class: "btn btn-sm", "aria-label": "Close", onclick: close }, "✕")),
    h("p", { class: "muted act-cat-intro" }, "Guided lessons with steps, hints and automatic checks. Your progress is kept in this browser and saved inside your project file."),
    list,
    h("div", { class: "dlg-buttons" },
      h("button", { class: "btn", onclick: () => { close(); o.onOpenFile(); } }, "Open activity file…"),
      h("button", { class: "btn", onclick: close }, "Close")));
  const back = h("div", { class: "dlg-back", onclick: (e: Event) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  openBack = back;
  document.addEventListener("keydown", onKey, true);
  (box.querySelector(".act-card .btn-primary, .act-card .btn") as HTMLElement | null)?.focus();
}
