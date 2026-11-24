/** debugger: the Variables tab (right rail). Plain DOM; never throws. */
import type { VarView } from "../core/modules";

let lastKey = "";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** `vars` null = nothing to show yet (before a run). */
export function renderVariables(host: HTMLElement, vars: VarView[] | null, state: { running: boolean; paused: boolean }): void {
  try {
    const key = JSON.stringify([vars, state.paused, state.running]);
    if (key === lastKey && host.childElementCount) return;
    lastKey = key;
    host.textContent = "";
    if (!vars) {
      host.append(el("p", "empty",
        "Your variables show up here while the program runs. Press ⤵ Step to go one line at a time and watch them change."));
      return;
    }
    if (state.paused) host.append(el("p", "vars-note", "Paused — these are the values right now."));
    else if (!state.running) host.append(el("p", "vars-note vars-done", "The values when the program ended."));
    if (!vars.length) {
      host.append(el("p", "empty", "No variables yet. Make one with a line like  count = 0"));
      return;
    }
    const groups: [string, VarView[]][] = [
      ["In this function", vars.filter((v) => v.scope === "local")],
      ["Whole program (global)", vars.filter((v) => v.scope === "global")],
    ];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      const table = el("table", "vars-table");
      table.setAttribute("aria-label", title);
      const cap = el("caption", "", title);
      table.append(cap);
      const tb = el("tbody", "");
      for (const v of list) {
        const tr = el("tr", "");
        const name = el("th", "vn", v.name);
        name.scope = "row";
        const val = el("td", "vv", v.value);
        val.title = `${v.name} is a ${v.type}: ${v.value}`;
        const ty = el("td", "vt", v.type);
        tr.append(name, val, ty);
        tb.append(tr);
      }
      table.append(tb);
      host.append(table);
    }
  } catch (e) {
    console.error(e);
  }
}
