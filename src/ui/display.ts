/**
 * Display options: text size and high contrast. Saved per browser (a convenience only).
 * Applied as data attributes on <html>; styles.css does the rest.
 */
export type TextSize = "normal" | "large" | "larger";
export interface DisplayPrefs { text: TextSize; contrast: boolean; }

const KEY = "robot-lab-display-v1";
const SIZES: TextSize[] = ["normal", "large", "larger"];

export function readDisplay(): DisplayPrefs {
  const d: DisplayPrefs = { text: "normal", contrast: false };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<DisplayPrefs>;
    if (SIZES.includes(raw.text as TextSize)) d.text = raw.text as TextSize;
    d.contrast = raw.contrast === true;
  } catch { /* storage blocked or junk: use defaults */ }
  return d;
}

export function applyDisplay(d: DisplayPrefs): void {
  const root = document.documentElement;
  root.dataset.text = d.text;
  if (d.contrast) root.dataset.contrast = "high"; else delete root.dataset.contrast;
  // Canvas, Blockly and CodeMirror re-measure on resize.
  window.dispatchEvent(new Event("resize"));
}

function save(d: DisplayPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

/** Wire the "Aa" button + popover in index.html. */
export function initDisplayMenu(): void {
  const prefs = readDisplay();
  applyDisplay(prefs);
  const btn = document.getElementById("displayBtn");
  const pop = document.getElementById("displayMenu");
  if (!btn || !pop) return;

  const radios = Array.from(pop.querySelectorAll<HTMLInputElement>('input[name="textSize"]'));
  const contrast = pop.querySelector<HTMLInputElement>("#hiContrast");
  const sync = () => {
    for (const r of radios) r.checked = r.value === prefs.text;
    if (contrast) contrast.checked = prefs.contrast;
  };
  sync();

  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) (radios.find((r) => r.checked) ?? radios[0])?.focus();
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && e.target !== btn) close(); });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); btn.focus(); } });

  for (const r of radios) r.addEventListener("change", () => {
    if (r.checked) { prefs.text = r.value as TextSize; save(prefs); applyDisplay(prefs); }
  });
  contrast?.addEventListener("change", () => { prefs.contrast = contrast.checked; save(prefs); applyDisplay(prefs); });
}
