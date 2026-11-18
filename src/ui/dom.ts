/** Tiny DOM helpers for the app shell (no framework). */

export function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** h("button", {class: "x", onclick: fn}, "text", child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") e.className = String(v);
    else if (k === "html") e.innerHTML = String(v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

/** Set text only when it changed (cheap per-frame updates). */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

// ---------------------------------------------------------------- modal dialog

export interface DialogButton { id: string; label: string; kind?: "primary" | "danger" | "plain"; }

let dialogOpen: HTMLElement | null = null;

/** Accessible modal. Resolves with the chosen button id, or "cancel" (Esc / backdrop). */
export function ask(title: string, bodyHtml: string, buttons: DialogButton[]): Promise<string> {
  return new Promise((resolve) => {
    dialogOpen?.remove();
    const prevFocus = document.activeElement as HTMLElement | null;
    const titleId = "dlg-title-" + Math.random().toString(36).slice(2);
    const close = (id: string) => {
      back.remove(); dialogOpen = null;
      document.removeEventListener("keydown", onKey, true);
      prevFocus?.focus?.();
      resolve(id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close("cancel"); }
      if (e.key === "Tab") { // simple focus trap
        const f = Array.from(box.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const row = h("div", { class: "dlg-buttons" },
      ...buttons.map((b) => h("button", { class: "btn " + (b.kind === "primary" ? "btn-primary" : b.kind === "danger" ? "btn-danger" : ""), onclick: () => close(b.id) }, b.label)));
    const box = h("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h("h2", { id: titleId }, title), h("div", { class: "dlg-body", html: bodyHtml }), row);
    const back = h("div", { class: "dlg-back", onclick: (e: Event) => { if (e.target === back) close("cancel"); } }, box);
    document.body.appendChild(back);
    dialogOpen = back;
    document.addEventListener("keydown", onKey, true);
    (row.querySelector(".btn-primary") as HTMLElement | null ?? row.querySelector("button") as HTMLElement | null)?.focus();
  });
}

export function isDialogOpen(): boolean { return !!dialogOpen; }

// ---------------------------------------------------------------- popover menus

/** Wire a button to toggle a popover panel. Closes on outside click / Esc / item click. */
export function popover(btn: HTMLElement, panel: HTMLElement): { close: () => void } {
  const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => {
    document.querySelectorAll<HTMLElement>(".pop").forEach((p) => { if (p !== panel) p.hidden = true; });
    panel.hidden = false; btn.setAttribute("aria-expanded", "true");
    (panel.querySelector("[aria-checked='true'], button:not([disabled])") as HTMLElement | null)?.focus();
  };
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden ? open() : close(); });
  document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target as Node)) close(); });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); btn.focus(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const i = items.indexOf(document.activeElement as HTMLElement);
      const n = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      n?.focus(); e.preventDefault();
    }
  });
  panel.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button")) close(); });
  return { close };
}

// ---------------------------------------------------------------- toast

export function toast(text: string, ms = 3500): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const t = h("div", { class: "toast", role: "status" }, text);
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
}
