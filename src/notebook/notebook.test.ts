// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { emptyNotebook, addRun, capRuns, enforceBudget, sanitizeNotebook, updateRun, notebookSize, isEmptyNotebook, cleanThumb } from "./data";
import { buildPageHtml, buildText, type PageInput } from "./page";
import { findFlowchartExport, toImageUrl } from "./capture";
import { createNotebook } from "./ui";
import { MAX_RUNS, MAX_NOTE, MAX_REFLECTION, MAX_STUDENT, NOTEBOOK_BUDGET, type NotebookRun, type NotebookData } from "./types";
import { parseFileText } from "../ui/files";

const thumb = (n: number) => "data:image/jpeg;base64," + "A".repeat(n);
let idn = 0;
function run(p: Partial<NotebookRun> = {}): NotebookRun {
  return {
    id: "r" + idn++, at: "2026-11-24T10:00:00.000Z", mode: "python", world: "Number Grid", result: "finished", detail: "Finished",
    goalsPassed: 1, goalsTotal: 2, final: "square 7, facing right", steps: 4, thumb: null, starred: false, note: "", ...p,
  };
}
function input(nb: NotebookData, p: Partial<PageInput> = {}): PageInput {
  return {
    notebook: nb, projectName: "Maze bot", worldName: "Number Grid", mode: "python",
    code: "def main():\n    drivetrain.drive_for(FORWARD, 200, MM)\n\nstart(main)\n",
    fieldImage: "data:image/png;base64,AAAA", flowchartImage: null, activity: null, today: "2026-11-24", ...p,
  };
}
const HOSTILE = `<img src=x onerror=alert(1)><script>alert("x")</script>"'&`;

describe("run log", () => {
  it("caps at MAX_RUNS, dropping the oldest un-starred runs first", () => {
    let nb = emptyNotebook();
    const first = run({ starred: true, note: "keep me" });
    nb = addRun(nb, first);
    for (let i = 0; i < 30; i++) nb = addRun(nb, run({ note: "n" + i }));
    expect(nb.runs.length).toBe(MAX_RUNS);
    expect(nb.runs[0].id).toBe(first.id);           // starred oldest survives
    expect(nb.runs[nb.runs.length - 1].note).toBe("n29");
    expect(nb.runs.some((r) => r.note === "n0")).toBe(false);
  });
  it("drops the oldest run when every run is starred", () => {
    const runs = Array.from({ length: 22 }, (_, i) => run({ starred: true, note: String(i) }));
    const out = capRuns(runs);
    expect(out.length).toBe(MAX_RUNS);
    expect(out[0].note).toBe("2");
  });
  it("keeps the notebook under the budget by dropping the oldest thumbnails first", () => {
    let nb = emptyNotebook();
    for (let i = 0; i < 20; i++) nb = addRun(nb, run({ thumb: thumb(30_000), note: "n" + i, starred: i === 0 }));
    expect(notebookSize(nb)).toBeLessThanOrEqual(NOTEBOOK_BUDGET);
    // the newest runs keep their pictures; the oldest un-starred lost theirs; starred #0 kept longest
    expect(nb.runs[19].thumb).not.toBeNull();
    expect(nb.runs[1].thumb).toBeNull();
    expect(nb.runs[0].thumb).not.toBeNull();
    expect(nb.runs.length).toBe(20);
  });
  it("enforceBudget with a tiny budget never throws and shrinks", () => {
    let nb = emptyNotebook();
    for (let i = 0; i < 5; i++) nb = addRun(nb, run({ thumb: thumb(1000) }), 1e9);
    const small = enforceBudget(nb, 2000);
    expect(notebookSize(small)).toBeLessThanOrEqual(2000);
    expect(small.runs.every((r) => r.thumb === null)).toBe(true);
  });
  it("updateRun stars and notes, cleaning the note", () => {
    let nb = addRun(emptyNotebook(), run({ id: "abc" }));
    nb = updateRun(nb, "abc", { starred: true, note: "line1\nline2" + "x".repeat(500) });
    expect(nb.runs[0].starred).toBe(true);
    expect(nb.runs[0].note).not.toContain("\n");
    expect(nb.runs[0].note.length).toBeLessThanOrEqual(MAX_NOTE);
  });
});

describe("validation of untrusted notebook data", () => {
  it("returns null for missing data and warns on junk", () => {
    expect(sanitizeNotebook(undefined)).toBeNull();
    const w: string[] = [];
    expect(sanitizeNotebook("nope", w)).toBeNull();
    expect(w.length).toBe(1);
  });
  it("caps lengths, entries and thumbnail sizes; rejects non-image thumbnails", () => {
    const raw = {
      student: "A".repeat(500) + "\u0000\n", date: 42, title: { x: 1 }, goal: "g".repeat(10_000), tried: ["x"], happened: "ok\r\nline",
      include: { code: "yes", path: false },
      runs: [
        ...Array.from({ length: 100 }, (_, i) => ({ id: "same", at: "t", result: "evil", goalsPassed: 999, goalsTotal: 3, steps: -5, thumb: thumb(10), note: "n" + i, starred: "true" })),
        { id: "<b>", thumb: "javascript:alert(1)" },
        { id: "big", thumb: thumb(60_000) },
        { id: "svg", thumb: "data:image/svg+xml;base64,PHN2Zz4=" },
        null, 7, "str",
      ],
      __proto__pollute: { a: 1 },
    };
    const nb = sanitizeNotebook(JSON.parse(JSON.stringify(raw)))!;
    expect(nb.student.length).toBe(MAX_STUDENT);
    expect(nb.date).toBe("");
    expect(nb.title).toBe("");
    expect(nb.goal.length).toBe(MAX_REFLECTION);
    expect(nb.tried).toBe("");
    expect(nb.happened).toBe("ok\nline");
    expect(nb.include.code).toBe(true);  // non-boolean → default
    expect(nb.include.path).toBe(false);
    expect(nb.runs.length).toBe(MAX_RUNS);
    const ids = new Set(nb.runs.map((r) => r.id));
    expect(ids.size).toBe(nb.runs.length); // duplicate ids re-numbered
    for (const r of nb.runs) {
      expect(["finished", "error", "stopped", "race"]).toContain(r.result);
      expect(r.goalsPassed).toBeLessThanOrEqual(r.goalsTotal);
      expect(r.steps).toBeGreaterThanOrEqual(0);
      expect(r.starred).toBe(false);
      expect(r.id).toMatch(/^[A-Za-z0-9_-]+$/);
      if (r.thumb) expect(r.thumb).toMatch(/^data:image\/(png|jpeg|webp);base64,/);
    }
    expect(nb.runs.find((r) => r.id === "big")?.thumb).toBeNull();
    expect(nb.runs.find((r) => r.id === "svg")?.thumb).toBeNull();
    expect(cleanThumb("data:image/png;base64,AAA=\"><script>")).toBeNull();
    expect(notebookSize(nb)).toBeLessThanOrEqual(NOTEBOOK_BUDGET);
  });
  it("parseFileText validates the notebook and round-trips it", () => {
    let nb = emptyNotebook();
    nb = { ...nb, student: "Ana", goal: "Reach square 7" };
    nb = addRun(nb, run({ starred: true, note: "changed the turn to 85°", thumb: thumb(100) }));
    const project = { format: "robot-lab-project", version: 1, name: "P", mode: "python", python: "x", blocks: null, worldId: "custom",
      customWorld: { id: "custom", name: "W", width: 2000, height: 2000, walls: [], floor: [], zones: [], objects: [], goals: [], start: { x: 0, y: 0, heading: 0 } },
      savedAt: "", notebook: nb };
    const o = parseFileText(JSON.stringify(project), () => true);
    expect(o.kind).toBe("project");
    if (o.kind !== "project") return;
    expect(o.project.notebook?.student).toBe("Ana");
    expect(o.project.notebook?.runs[0].note).toBe("changed the turn to 85°");
    expect(o.project.notebook?.runs[0].thumb).toBe(thumb(100));
    const bad = parseFileText(JSON.stringify({ ...project, notebook: [1, 2] }), () => true);
    expect(bad.kind === "project" && bad.project.notebook).toBeNull();
    expect(bad.warnings.some((w) => /notebook/i.test(w))).toBe(true);
  });
  it("isEmptyNotebook", () => {
    expect(isEmptyNotebook(null)).toBe(true);
    expect(isEmptyNotebook(emptyNotebook())).toBe(true);
    expect(isEmptyNotebook({ ...emptyNotebook(), goal: "x" })).toBe(false);
  });
});

describe("page HTML", () => {
  const parse = (html: string) => new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");

  it("escapes everything the student typed", () => {
    let nb: NotebookData = { ...emptyNotebook(), student: HOSTILE, title: HOSTILE, date: HOSTILE, goal: HOSTILE, tried: HOSTILE, happened: HOSTILE, next: HOSTILE };
    nb = addRun(nb, run({ starred: true, note: HOSTILE, final: HOSTILE, detail: HOSTILE, world: HOSTILE }));
    const html = buildPageHtml(input(nb, {
      projectName: HOSTILE, worldName: HOSTILE, code: HOSTILE + "\n</pre><script>bad()</script>",
      activity: { title: HOSTILE, standards: [HOSTILE], steps: [{ title: HOSTILE, done: true }], current: 0 },
    }));
    const doc = parse(html);
    expect(doc.querySelectorAll("script").length).toBe(0);
    expect(doc.querySelectorAll("[onerror]").length).toBe(0);
    // the only image is our field picture
    expect(Array.from(doc.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(["data:image/png;base64,AAAA"]);
    expect(doc.body.textContent).toContain(`<script>alert("x")</script>`);
    expect(doc.querySelector(".nb-title")!.textContent).toBe(HOSTILE);
  });
  it("only accepts image data URLs as pictures", () => {
    const html = buildPageHtml(input(emptyNotebook(), { fieldImage: "javascript:alert(1)", flowchartImage: `data:image/png;base64,A" onload="x` }));
    const doc = parse(html);
    for (const i of Array.from(doc.querySelectorAll("img"))) {
      expect(i.getAttribute("src")).toMatch(/^data:image\//);
      expect(i.hasAttribute("onload")).toBe(false);
    }
    expect(html).not.toContain("javascript:");
  });
  it("has header, numbered code, starred runs only, reflections, signature and footer", () => {
    let nb: NotebookData = { ...emptyNotebook(), student: "Ana", goal: "Reach 7", next: "Use a loop" };
    nb = addRun(nb, run({ note: "first try" }));
    nb = addRun(nb, run({ starred: true, note: "changed the turn to 85°", result: "error", detail: "NameError on line 4" }));
    const doc = parse(buildPageHtml(input(nb)));
    expect(doc.querySelector(".nb-meta")!.textContent).toContain("Ana");
    expect(doc.querySelector(".nb-meta")!.textContent).toContain("2026-11-24");
    expect(doc.querySelectorAll(".nb-ln").length).toBe(4);
    const rows = doc.querySelectorAll(".nb-table tbody tr");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("changed the turn to 85°");
    expect(rows[0].textContent).toContain("Error: NameError on line 4");
    expect(rows[0].querySelector("td")!.textContent).toBe("2"); // numbered by place in the whole log
    expect(doc.body.textContent).toContain("Reach 7");
    expect(doc.body.textContent).toContain("Use a loop");
    expect(doc.querySelector(".nb-sign")!.textContent).toContain("Reviewed by");
    expect(doc.querySelector(".nb-foot")!.textContent).toBe("Made with Robot Lab");
  });
  it("include checkboxes control what is on the page and in the text", () => {
    let nb: NotebookData = addRun(emptyNotebook(), run({ starred: true, note: "NOTE-1" }));
    const act = { title: "Squares", standards: ["TEKS (d)(1)"], steps: [{ title: "Step A", done: true }, { title: "Step B", done: false }], current: 1 };
    const all = buildPageHtml(input(nb, { activity: act, flowchartImage: "data:image/png;base64,BBBB" }));
    expect(all).toContain("nb-code"); expect(all).toContain("nb-field"); expect(all).toContain("NOTE-1");
    expect(all).toContain("TEKS (d)(1)"); expect(all).toContain("nb-flow");
    nb = { ...nb, include: { code: false, path: false, runs: false, activity: false, flowchart: false } };
    const none = buildPageHtml(input(nb, { activity: act, flowchartImage: "data:image/png;base64,BBBB" }));
    for (const s of ["nb-code", "nb-field", "NOTE-1", "TEKS", "nb-flow", "drive_for"]) expect(none).not.toContain(s);
    expect(none).toContain("Reviewed by");
    const t1 = buildText(input({ ...nb, include: { code: true, path: true, runs: true, activity: true, flowchart: true } }, { activity: act }));
    const t0 = buildText(input(nb, { activity: act }));
    for (const s of ["NOTE-1", "drive_for", "TEKS (d)(1)", "[x] Step A"]) { expect(t1).toContain(s); expect(t0).not.toContain(s); }
  });
});

describe("text export", () => {
  it("is plain text with the header, runs, numbered code and reflections", () => {
    let nb: NotebookData = { ...emptyNotebook(), student: "Ana <b>", title: "Maze", goal: "Reach 7\nfast", happened: "It turned too far" };
    nb = addRun(nb, run({ starred: true, note: "changed the turn to 85°" }));
    const t = buildText(input(nb));
    expect(t.split("\n")[0]).toBe("ENGINEERING NOTEBOOK — Maze");
    expect(t).toContain("Name: Ana <b>");          // plain text: not escaped
    expect(t).toContain("What was the goal?\nReach 7\nfast");
    expect(t).toContain("#1  ");
    expect(t).toContain("goals 1/2");
    expect(t).toContain("— changed the turn to 85°");
    expect(t).toMatch(/^1  def main\(\):$/m);
    expect(t).toContain("What would you do next?\n—");
    expect(t).toContain("Reviewed by ____");
    expect(t).not.toContain("data:image");
  });
  it("uses today when no date was typed", () => {
    expect(buildText(input(emptyNotebook()))).toContain("Date: 2026-11-24");
  });
});

describe("flowchart export probe", () => {
  it("is absent unless the flowchart mode exposes one", async () => {
    expect(findFlowchartExport({})).toBeNull();
    const f = findFlowchartExport({ __robotLabFlowchart: { exportSvg: () => "<svg xmlns='http://www.w3.org/2000/svg'/>" } });
    expect(f).not.toBeNull();
    expect(await f!()).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const g = findFlowchartExport({ __robotLabFlowchart: { exportImage: async () => "data:image/png;base64,AA" } });
    expect(await g!()).toBe("data:image/png;base64,AA");
    const bad = findFlowchartExport({ __robotLabFlowchart: { exportImage: () => { throw new Error("x"); } } });
    expect(await bad!()).toBeNull();
    expect(toImageUrl("javascript:1")).toBeNull();
  });
});

describe("notebook dialog", () => {
  function host() {
    const changed = vi.fn();
    const world = { id: "w", name: "Grid", width: 2000, height: 2000, walls: [], floor: [], zones: [], objects: [], goals: [], start: { x: 0, y: 0, heading: 0 } };
    const nbc = createNotebook({
      createRenderer: () => { throw new Error("no canvas in jsdom"); },
      world: () => world as never, worldName: () => "Grid", state: () => null,
      projectName: () => "Proj", mode: () => "python", code: () => "print(1)\n", activity: () => null, changed,
    });
    return { nbc, changed };
  }
  it("records runs, stars them, saves reflections and include choices", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { nbc, changed } = host();
    for (let i = 0; i < 3; i++) nbc.record({ mode: "python", result: "finished", detail: "Finished", goalsPassed: 0, goalsTotal: 1, final: "x 0, y 0, facing up", steps: i });
    expect(nbc.data().runs.length).toBe(3);
    nbc.open();
    expect(nbc.isOpen()).toBe(true);
    const stars = document.querySelectorAll<HTMLButtonElement>(".nb-star");
    expect(stars.length).toBe(3);
    stars[0].click(); // newest first
    expect(nbc.data().runs[2].starred).toBe(true);
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-q="goal"]')!;
    ta.value = HOSTILE; ta.dispatchEvent(new Event("input"));
    expect(nbc.data().goal).toBe(HOSTILE);
    const codeBox = document.querySelector<HTMLInputElement>('input[data-inc="code"]')!;
    codeBox.checked = false; codeBox.dispatchEvent(new Event("change"));
    expect(nbc.data().include.code).toBe(false);
    // activity + flowchart are unavailable here → disabled
    expect(document.querySelector<HTMLInputElement>('input[data-inc="activity"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[data-inc="flowchart"]')!.disabled).toBe(true);
    expect(changed).toHaveBeenCalled();
    await nbc.openPrintView();
    const page = document.querySelector(".nb-view .nb-page")!;
    expect(page).not.toBeNull();
    expect(page.querySelector("script")).toBeNull();
    expect(page.querySelector(".nb-code")).toBeNull(); // code unticked
    expect(page.querySelectorAll(".nb-table tbody tr").length).toBe(1);
    expect(document.body.classList.contains("nb-printing")).toBe(true);
    document.querySelector<HTMLElement>(".nb-viewbar .btn")!.click(); // Back
    expect(document.querySelector(".nb-view")).toBeNull();
    nbc.load(null);
    expect(nbc.data().runs.length).toBe(0);
    expect(nbc.isOpen()).toBe(false);
  });
});
