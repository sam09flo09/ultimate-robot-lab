/**
 * The printable notebook page (HTML string) and the plain-text version ("Copy as text").
 * Pure functions: everything typed by the student (or read from a file) is escaped here.
 */
import { REFLECTIONS, type NotebookData, type NotebookRun } from "./types";

export interface PageActivity {
  title: string;
  standards: string[];
  steps: { title: string; done: boolean }[];
  current: number;          // index of the step the student is on
}

export interface PageInput {
  notebook: NotebookData;
  projectName: string;
  worldName: string;
  mode: "blocks" | "python" | "flowchart";
  code: string;
  /** Field picture with the path (data URL), or null. */
  fieldImage: string | null;
  /** Flowchart picture (data URL) when the flowchart mode can export one; null = not available. */
  flowchartImage: string | null;
  activity: PageActivity | null;
  /** Today, formatted, used when the notebook's date is blank. */
  today: string;
}

export function escHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only image data URLs may become <img src>. */
const SAFE_IMG = /^data:image\/(png|jpeg|webp|svg\+xml)[;,]/;
const img = (src: string | null, alt: string, cls: string) =>
  src && SAFE_IMG.test(src) ? `<img class="${cls}" src="${escHtml(src)}" alt="${escHtml(alt)}">` : "";

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function todayText(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const RESULT_WORD: Record<NotebookRun["result"], string> = { finished: "Finished", error: "Error", stopped: "Stopped", race: "Race" };
export function runResultText(r: NotebookRun): string {
  const w = RESULT_WORD[r.result] ?? "";
  return r.detail && r.detail !== w ? (r.detail.startsWith(w) ? r.detail : `${w}: ${r.detail}`) : w;
}
const goalsText = (r: NotebookRun) => (r.goalsTotal ? `${r.goalsPassed}/${r.goalsTotal}` : "—");

/** Runs shown on the page: the starred ones (oldest first), numbered by their place in the whole log. */
export function starredRuns(nb: NotebookData): { n: number; run: NotebookRun }[] {
  return nb.runs.map((run, i) => ({ n: i + 1, run })).filter((x) => x.run.starred);
}

const titleOf = (inp: PageInput) => inp.notebook.title || inp.projectName || "My robot project";
const dateOf = (inp: PageInput) => inp.notebook.date || inp.today;
const modeWord = (m: PageInput["mode"]) => (m === "blocks" ? "Blocks (Python made from the blocks)" : m === "flowchart" ? "Flowchart (Python made from the flowchart)" : "Python");

/** Multi-line student text → escaped HTML paragraphs (line breaks kept). */
function paras(s: string): string {
  const t = s.trim();
  if (!t) return `<p class="nb-blank">&nbsp;</p>`;
  return t.split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** The page body (goes inside the print container). Self-contained; styles are in NOTEBOOK_PAGE_CSS. */
export function buildPageHtml(inp: PageInput): string {
  const nb = inp.notebook, inc = nb.include;
  const out: string[] = [];
  out.push(`<article class="nb-page" aria-label="Engineering notebook page">`);
  out.push(`<header class="nb-head">
  <div class="nb-kicker">Engineering notebook · test record</div>
  <h1 class="nb-title">${escHtml(titleOf(inp))}</h1>
  <table class="nb-meta"><tbody>
    <tr><th>Name</th><td class="nb-fill">${escHtml(nb.student) || "&nbsp;"}</td><th>Date</th><td class="nb-fill">${escHtml(dateOf(inp))}</td></tr>
    <tr><th>Project</th><td>${escHtml(inp.projectName)}</td><th>World</th><td>${escHtml(inp.worldName)}</td></tr>
  </tbody></table>
</header>`);

  // Reflection: goal first (it frames everything below), then the rest after the evidence.
  const refl = (keys: typeof REFLECTIONS) => keys.map((r) =>
    `<section class="nb-q"><h2>${escHtml(r.label)}</h2>${paras(nb[r.key])}</section>`).join("");
  out.push(refl(REFLECTIONS.slice(0, 1)));

  if (inc.path && inp.fieldImage) {
    out.push(`<section class="nb-fig"><h2>Field and robot path</h2>${img(inp.fieldImage, `The ${inp.worldName} field with the robot's path`, "nb-field")}
<p class="nb-cap">The line shows where the robot's centre travelled; the robot is drawn where it stopped.</p></section>`);
  }
  if (inc.flowchart && inp.flowchartImage) {
    out.push(`<section class="nb-fig"><h2>Flowchart</h2>${img(inp.flowchartImage, "Flowchart of the program", "nb-flow")}</section>`);
  }
  if (inc.runs) {
    const rows = starredRuns(nb);
    out.push(`<section class="nb-runs"><h2>Test runs</h2>`);
    if (!rows.length) out.push(`<p class="nb-muted">No runs starred. Star runs in the notebook dialog to list them here.</p>`);
    else {
      out.push(`<table class="nb-table"><thead><tr><th>#</th><th>When</th><th>Result</th><th>Goals</th><th>Ended at</th><th>Steps</th><th>Note</th></tr></thead><tbody>`);
      for (const { n, run } of rows) {
        out.push(`<tr><td>${n}</td><td class="nb-nowrap">${escHtml(formatWhen(run.at))}</td><td>${escHtml(runResultText(run))}</td>` +
          `<td>${escHtml(goalsText(run))}</td><td>${escHtml(run.final)}</td><td>${run.steps}</td><td>${escHtml(run.note)}</td></tr>`);
      }
      out.push(`</tbody></table>`);
    }
    out.push(`</section>`);
  }
  if (inc.activity && inp.activity) {
    const a = inp.activity;
    const done = a.steps.filter((s) => s.done).length;
    out.push(`<section class="nb-act"><h2>Activity progress</h2>
<p><b>${escHtml(a.title)}</b> — ${done} of ${a.steps.length} steps completed.</p>
<ol class="nb-steps">${a.steps.map((s, i) => `<li class="${s.done ? "nb-done" : ""}"><span class="nb-box" aria-hidden="true">${s.done ? "✓" : ""}</span>${escHtml(s.title)}${s.done ? '<span class="nb-sr"> (completed)</span>' : i === a.current ? " <i>(current step)</i>" : ""}</li>`).join("")}</ol>
${a.standards.length ? `<p class="nb-std">Standards: ${a.standards.map((t) => `<span>${escHtml(t)}</span>`).join(" ")}</p>` : ""}
</section>`);
  }
  if (inc.code) {
    const lines = inp.code.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    const w = String(lines.length).length;
    out.push(`<section class="nb-code"><h2>Program <span class="nb-muted">· ${escHtml(modeWord(inp.mode))} · ${lines.length} line${lines.length === 1 ? "" : "s"}</span></h2>
<pre class="nb-pre">${lines.map((l, i) => `<span class="nb-ln">${String(i + 1).padStart(w, " ")}</span>${escHtml(l)}`).join("\n")}</pre></section>`);
  }
  out.push(refl(REFLECTIONS.slice(1)));
  out.push(`<section class="nb-sign">
  <div><span>Reviewed by</span><i></i></div><div><span>Date</span><i class="nb-short"></i></div>
</section>
<footer class="nb-foot">Made with Robot Lab</footer>
</article>`);
  return out.join("\n");
}

/** Plain-text summary for students who keep a digital notebook (Google Docs). */
export function buildText(inp: PageInput): string {
  const nb = inp.notebook, inc = nb.include;
  const L: string[] = [];
  const t = titleOf(inp);
  L.push(`ENGINEERING NOTEBOOK — ${t}`);
  L.push(`Name: ${nb.student || "________"}    Date: ${dateOf(inp)}`);
  L.push(`Project: ${inp.projectName}    World: ${inp.worldName}`);
  L.push("");
  const q = (keys: typeof REFLECTIONS) => {
    for (const r of keys) { L.push(r.label); L.push(nb[r.key].trim() || "—"); L.push(""); }
  };
  q(REFLECTIONS.slice(0, 1));
  if (inc.runs) {
    L.push("TEST RUNS");
    const rows = starredRuns(nb);
    if (!rows.length) L.push("(no runs starred)");
    for (const { n, run } of rows) {
      L.push(`#${n}  ${formatWhen(run.at)}  ${runResultText(run)}  goals ${goalsText(run)}  ended ${run.final}  steps ${run.steps}${run.note ? `  — ${run.note}` : ""}`);
    }
    L.push("");
  }
  if (inc.activity && inp.activity) {
    const a = inp.activity;
    L.push(`ACTIVITY: ${a.title} — ${a.steps.filter((s) => s.done).length} of ${a.steps.length} steps completed`);
    a.steps.forEach((s) => L.push(`  [${s.done ? "x" : " "}] ${s.title}`));
    if (a.standards.length) L.push(`  Standards: ${a.standards.join(", ")}`);
    L.push("");
  }
  if (inc.code) {
    L.push(`PROGRAM (${modeWord(inp.mode)})`);
    const lines = inp.code.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    const w = String(lines.length).length;
    lines.forEach((l, i) => L.push(`${String(i + 1).padStart(w, " ")}  ${l}`));
    L.push("");
  }
  q(REFLECTIONS.slice(1));
  L.push("Reviewed by ____________________   Date __________");
  L.push("Made with Robot Lab");
  return L.join("\n");
}

/** Page CSS: black-and-white friendly, A4/Letter, no external fonts. Every selector is under .nb-page. */
export const NOTEBOOK_PAGE_CSS = `
.nb-page{box-sizing:border-box;max-width:780px;margin:0 auto;background:#fff;color:#000;font:11pt/1.45 Georgia,"Times New Roman",serif;padding:28px 34px}
.nb-page *{box-sizing:border-box}
.nb-page h1,.nb-page h2{font-family:Arial,Helvetica,sans-serif;color:#000}
.nb-kicker{font:600 8.5pt Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:4px}
.nb-title{font-size:20pt;margin:8px 0 6px;font-weight:700}
.nb-meta{width:100%;border-collapse:collapse;font:10pt Arial,Helvetica,sans-serif;margin-bottom:10px}
.nb-meta th{text-align:left;width:68px;padding:4px 6px 4px 0;font-weight:700;white-space:nowrap}
.nb-meta td{border-bottom:1px solid #000;padding:4px 8px 2px;min-width:120px}
.nb-page section{margin:12px 0 0}
.nb-page h2{font-size:11.5pt;margin:0 0 4px;font-weight:700;border-bottom:1px solid #777;padding-bottom:2px;break-after:avoid;page-break-after:avoid}
.nb-q p{margin:0 0 6px;white-space:normal;overflow-wrap:anywhere}
.nb-blank{border-bottom:1px dotted #777;min-height:2.6em}
.nb-fig{break-inside:avoid;page-break-inside:avoid;text-align:center}
.nb-field{display:block;margin:4px auto 0;max-width:100%;max-height:118mm;border:1px solid #000}
.nb-flow{display:block;margin:4px auto 0;max-width:100%;max-height:150mm}
.nb-cap{font:8.5pt Arial,Helvetica,sans-serif;color:#333;margin:3px 0 0}
.nb-muted{color:#444;font-weight:400}
.nb-table{width:100%;border-collapse:collapse;font:9pt Arial,Helvetica,sans-serif}
.nb-table th,.nb-table td{border:1px solid #000;padding:3px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.nb-table th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.nb-table tr{break-inside:avoid;page-break-inside:avoid}
.nb-nowrap{white-space:nowrap}
.nb-steps{list-style:none;padding:0;margin:4px 0;columns:2;column-gap:18px;font:9.5pt Arial,Helvetica,sans-serif}
.nb-steps li{break-inside:avoid;margin:0 0 3px;display:flex;gap:6px;align-items:baseline}
.nb-box{display:inline-block;flex:0 0 13px;width:13px;height:13px;border:1px solid #000;font-size:9pt;line-height:12px;text-align:center}
.nb-std{font:8.5pt Arial,Helvetica,sans-serif;margin:4px 0 0}
.nb-std span{display:inline-block;border:1px solid #555;border-radius:3px;padding:0 4px;margin:1px 2px 1px 0}
.nb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.nb-pre{font:8.5pt/1.4 "Courier New",Courier,monospace;border:1px solid #000;padding:6px 8px;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#000;background:#fff}
.nb-ln{display:inline-block;color:#555;border-right:1px solid #999;padding-right:6px;margin-right:8px;user-select:none;white-space:pre}
.nb-sign{display:flex;gap:24px;align-items:flex-end;margin-top:22px !important;font:10pt Arial,Helvetica,sans-serif;break-inside:avoid;page-break-inside:avoid}
.nb-sign div{display:flex;align-items:flex-end;gap:6px;flex:1}
.nb-sign div:last-child{flex:0 0 200px}
.nb-sign i{flex:1;border-bottom:1px solid #000;height:20px}
.nb-foot{margin-top:16px;font:8pt Arial,Helvetica,sans-serif;color:#444;text-align:right;border-top:1px solid #999;padding-top:3px}
`;
