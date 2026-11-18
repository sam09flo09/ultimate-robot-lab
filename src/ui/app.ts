/**
 * Robot Lab app shell: wires sim + renderer + runtime + blocks + level editor to the page.
 * Owns the animation loop, run/stop/reset, files, autosave, tabs, help and teacher mode.
 */
import type { World, Sim, SimEvent, ColorName } from "../core/types";
import { COLOR_HEX } from "../core/types";
import type { Renderer, PythonRunner, BlocksEditor, LevelEditor, ProjectFile, RunResult } from "../core/modules";
import {
  createSim, createRenderer, PLAYGROUNDS, getPlayground, createPythonRunner, createBlocksEditor, createLevelEditor,
  sanitizeWorld, newBlankWorld,
} from "./modules";
import { $, esc, h, setText, ask, isDialogOpen, popover, toast } from "./dom";
import { createPythonEditor, type PythonEditor } from "./pythonEditor";
import {
  parseFileText, pickFile, saveText, download, toLevelJson, cleanName, fileStem,
  readAutosave, writeAutosave, readLevelDraft, writeLevelDraft, debounce, PROJECT_EXT, LEVEL_EXT,
  type AutosaveData,
} from "./files";
import { squareText, facingText, goalText, starterFor, DEFAULT_TEMPLATE } from "./status";
import { HELP_HTML } from "./help";

type Mode = "blocks" | "python";
type MsgKind = "ok" | "info" | "err";
type FileHandle = Parameters<typeof saveText>[0]["handle"];

const PREFS_KEY = "robot-lab-prefs-v1";
const MAX_LOG = 800;
const MAX_SCREEN_LINES = 300;

function deepCopy<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

function blankWorld(): World {
  return { ...newBlankWorld(), id: "custom" };
}

export function startApp(): void {
  // ------------------------------------------------------------ elements
  const app = $("app");
  const canvas = $("field") as HTMLCanvasElement;
  const fieldBox = $("fieldBox");
  const msgEl = $("msg");
  const logEl = $("log");
  const screenEl = $("screen");
  const goalsBox = $("goalsBox");
  const runBtn = $("runBtn") as HTMLButtonElement;
  const stopBtn = $("stopBtn") as HTMLButtonElement;
  const resetBtn = $("resetBtn") as HTMLButtonElement;
  const projName = $("projName") as HTMLInputElement;
  const worldBtn = $("worldBtn") as HTMLButtonElement;
  const worldMenu = $("worldMenu");
  const modeBlocksBtn = $("modeBlocks") as HTMLButtonElement;
  const modePythonBtn = $("modePython") as HTMLButtonElement;
  const showCodeBtn = $("showCodeBtn") as HTMLButtonElement;
  const codeDrawer = $("codeDrawer");
  const restoreBtn = $("restoreBtn") as HTMLButtonElement;
  const mRestore = $("mRestore") as HTMLButtonElement;
  const autoReset = $("autoReset") as HTMLInputElement;
  const showPath = $("showPath") as HTMLInputElement;
  const showSensors = $("showSensors") as HTMLInputElement;
  const speedBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-speed]"));
  const tiles = {
    squareBox: $("tSquareBox"), square: $("tSquare"), facing: $("tFacing"), pos: $("tPos"),
    dist: $("tDist"), bump: $("tBump"), front: $("tFront"), down: $("tDown"),
  };

  // ------------------------------------------------------------ prefs
  const prefs = { speed: 1, showPath: true, showSensors: true, autoReset: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch { /* ignore */ }
  if (![0.5, 1, 2.5].includes(prefs.speed)) prefs.speed = 1;
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };
  autoReset.checked = !!prefs.autoReset; showPath.checked = !!prefs.showPath; showSensors.checked = !!prefs.showSensors;

  // ------------------------------------------------------------ core state
  const playgrounds: World[] = PLAYGROUNDS.length ? PLAYGROUNDS : [blankWorld()];
  const knownWorld = (id: string) => id === "custom" || !!getPlayground(id);
  let world: World = playgrounds[0];
  let worldId = world.id;
  let customWorld: World | null = null;
  let sim!: Sim;
  let runner!: PythonRunner;
  let unsubSim: (() => void) | null = null;
  let mode: Mode = "blocks";
  let running = false;
  let speed = prefs.speed;
  let needDraw = true;
  let celebrated = false;
  let lastWallLog = -10;
  let fileHandle: FileHandle = null;
  let levelHandle: FileHandle = null;
  let pendingLine = 0, shownLine = -1;
  let pendingLogs: { line: number; text: string; kind: string }[] = [];
  let pendingScreen: string[] | null = null;
  const screenLines: string[] = [""];
  let lastGoalsKey = "";
  const previous = readAutosave(knownWorld); // last session's project, offered via "Restore last project"

  const renderer: Renderer = createRenderer(canvas);

  // ------------------------------------------------------------ editors
  // Autosave on every change — but never overwrite the last session's project with an untouched
  // fresh one before the student has had the chance to press "Restore last project".
  let protectPrevious = true;
  const scheduleAutosave = debounce(() => {
    if (protectPrevious && previous && isFreshProject()) return;
    protectPrevious = false;
    writeAutosave(snapshot());
  }, 800);

  const pyEditor: PythonEditor = createPythonEditor($("pyHost"), {
    doc: starterFor(world), label: "Python code",
    onChange: () => { if (!running) pyEditor.mark(0, "run"); scheduleAutosave(); },
    onRun: () => void run(),
  });

  let genEditor: PythonEditor | null = null;
  const refreshGenerated = debounce(() => { if (genEditor && !codeDrawer.hidden) genEditor.setText(safeGetPython()); }, 250);

  const hw = (w: World) => ({ pen: !!w.hardware?.pen, magnet: !!w.hardware?.magnet });
  const blocks: BlocksEditor = createBlocksEditor($("blocksHost"), {
    hardware: hw(world),
    onChange: () => {
      if (!running) { safe(() => blocks.highlightLine(0)); genEditor?.mark(0, "run"); }
      scheduleAutosave(); refreshGenerated();
    },
  });
  const blankBlocksState: unknown = safe(() => deepCopy(blocks.getState())) ?? null;
  const blankBlocksPython = safeGetPython();

  function safe<T>(fn: () => T): T | undefined {
    try { return fn(); } catch (e) { console.error(e); return undefined; }
  }
  function safeGetPython(): string {
    return safe(() => blocks.getPython()) ?? "";
  }

  // ------------------------------------------------------------ sim / runner
  function buildSim(): void {
    unsubSim?.();
    sim = createSim(world);
    runner = createPythonRunner({
      controller: sim.controller,
      onLine: (line) => { pendingLine = line; },
      onLog: (e) => { pendingLogs.push(e); },
      onScreen: (op) => {
        if (op.kind === "clear") { screenLines.length = 0; screenLines.push(""); }
        else if (op.kind === "newline") screenLines.push("");
        else screenLines[screenLines.length - 1] += op.text;
        while (screenLines.length > MAX_SCREEN_LINES) screenLines.shift();
        pendingScreen = screenLines;
      },
    });
    unsubSim = sim.onEvent(onSimEvent);
    celebrated = false;
  }

  function onSimEvent(e: SimEvent): void {
    switch (e.type) {
      case "wallHit":
        if (e.time - lastWallLog > 0.5) pendingLogs.push({ line: 0, text: "The robot hit a wall.", kind: "warn" });
        lastWallLog = e.time;
        break;
      case "pickedUp": pendingLogs.push({ line: 0, text: `Magnet picked up ${e.objectId}.`, kind: "event" }); break;
      case "dropped": pendingLogs.push({ line: 0, text: `Magnet dropped ${e.objectId}.`, kind: "event" }); break;
      case "zoneEntered": {
        const z = world.zones.find((q) => q.id === e.zoneId);
        pendingLogs.push({ line: 0, text: `Entered ${z?.label || e.zoneId}.`, kind: "event" });
        lastGoalsKey = "";
        break;
      }
      case "goalsComplete": celebrate(e.time); break;
    }
  }

  // ------------------------------------------------------------ canvas sizing + loop
  /** The renderer fits the field (with its aspect ratio) inside the CSS-sized canvas. */
  function fitCanvas(): void {
    const r = fieldBox.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    safe(() => renderer.resize());
    needDraw = true;
  }
  new ResizeObserver(() => { fitCanvas(); safe(() => blocks.resize()); }).observe(fieldBox);
  new ResizeObserver(() => safe(() => blocks.resize())).observe($("blocksHost"));

  let last = performance.now();
  let statusTimer = 0, goalsTimer = 0;
  function frame(): void {
    const now = performance.now();
    let realDt = Math.max(0, (now - last) / 1000);
    last = now;
    if (running) {
      if (document.hidden) {
        // rAF is paused: we are on the timer fallback (which Chrome throttles). Catch up in ≤0.1 s chunks.
        realDt = Math.min(realDt, 2);
        while (realDt > 1e-6) { const d = Math.min(0.1, realDt); safe(() => sim.step(d * speed)); realDt -= d; }
      } else {
        safe(() => sim.step(Math.min(0.1, realDt) * speed));
      }
      needDraw = true;
    }
    if (needDraw && !document.hidden) {
      needDraw = false;
      safe(() => renderer.draw(world, sim.state, { showPath: showPath.checked, showSensors: showSensors.checked, showZones: true, selectedId: null }));
    }
    flushOutput();
    statusTimer += realDt; goalsTimer += realDt;
    if (!running || statusTimer > 0.1) { if (running || statusDirty) { updateStatus(); statusDirty = false; } statusTimer = 0; }
    if (goalsTimer > 0.25) { goalsTimer = 0; if (running) renderGoals(); }
    schedule();
  }
  let statusDirty = true;
  function schedule(): void {
    let done = false;
    const once = () => { if (done) return; done = true; frame(); };
    requestAnimationFrame(once);
    if (running) setTimeout(once, 50); // keeps the run going when the tab is hidden (as the original nextFrame did)
  }
  function redraw(): void { needDraw = true; statusDirty = true; }

  // ------------------------------------------------------------ output (log / screen / highlight)
  function flushOutput(): void {
    if (pendingLine !== shownLine && running) {
      shownLine = pendingLine;
      if (mode === "python") pyEditor.mark(shownLine, "run");
      else { safe(() => blocks.highlightLine(shownLine)); genEditor?.mark(shownLine, "run"); }
    }
    if (pendingLogs.length) {
      const empty = logEl.querySelector(".empty");
      empty?.remove();
      const frag = document.createDocumentFragment();
      for (const e of pendingLogs.slice(-MAX_LOG)) {
        const li = h("li", { class: e.kind === "step" ? "" : e.kind });
        if (e.line) li.append(h("span", { class: "ln" }, `Line ${e.line}: `));
        li.append(String(e.text));
        frag.appendChild(li);
      }
      pendingLogs = [];
      logEl.appendChild(frag);
      while (logEl.childElementCount > MAX_LOG) logEl.firstElementChild?.remove();
      const p = logEl.parentElement!;
      p.scrollTop = p.scrollHeight;
    }
    if (pendingScreen) {
      screenEl.textContent = pendingScreen.join("\n");
      pendingScreen = null;
      const p = screenEl.parentElement!;
      p.scrollTop = p.scrollHeight;
      markTabDot("tabScreen");
    }
  }
  function clearOutput(): void {
    logEl.innerHTML = "";
    logEl.append(h("li", { class: "empty" }, "Press Run. Each statement that runs is listed here, in order."));
    pendingLogs = [];
    screenLines.length = 0; screenLines.push("");
    screenEl.textContent = "";
    pendingScreen = null;
    document.querySelector("#tabScreen .dot")?.setAttribute("hidden", "");
  }
  function clearHighlights(): void {
    pyEditor.mark(0, "run"); genEditor?.mark(0, "run"); safe(() => blocks.highlightLine(0));
    shownLine = -1; pendingLine = 0;
  }

  // ------------------------------------------------------------ messages
  function showMsg(kind: MsgKind, html: string, actions: { label: string; onClick: () => void; primary?: boolean }[] = []): void {
    msgEl.className = "msg " + kind;
    msgEl.innerHTML = html;
    if (actions.length) {
      msgEl.append(h("div", { class: "msg-actions" }, ...actions.map((a) =>
        h("button", { class: "btn btn-sm" + (a.primary ? " btn-primary" : ""), onclick: a.onClick }, a.label))));
    }
  }
  function clearMsg(): void { msgEl.className = "msg"; msgEl.innerHTML = ""; }

  // ------------------------------------------------------------ status tiles + goals
  const colorTile = (el: HTMLElement, c: ColorName) => {
    const sw = el.querySelector("i") as HTMLElement, sp = el.querySelector("span") as HTMLElement;
    const bg = c === "NONE" ? "transparent" : COLOR_HEX[c] ?? "transparent";
    if (sw.style.background !== bg) sw.style.background = bg;
    setText(sp, c === "NONE" ? "none" : c.toLowerCase());
  };
  function updateStatus(): void {
    const st = sim.state, c = sim.controller;
    if (world.background === "numberGrid") {
      setText(tiles.squareBox.firstElementChild as HTMLElement, "Square");
      setText(tiles.square, squareText(world, st.robot.x, st.robot.y));
    } else {
      setText(tiles.squareBox.firstElementChild as HTMLElement, "Time");
      setText(tiles.square, st.time.toFixed(1) + " s");
    }
    setText(tiles.facing, facingText(world, st.robot.heading));
    setText(tiles.pos, `x ${Math.round(st.robot.x)}, y ${Math.round(st.robot.y)}`);
    safe(() => {
      const d = c.distanceMM();
      setText(tiles.dist, d >= 3000 ? "nothing" : `${Math.round(d)} mm`);
      const b = c.bumperPressed();
      setText(tiles.bump, b ? "pressed" : "not pressed");
      tiles.bump.classList.toggle("on", b);
      colorTile(tiles.front, c.frontColor());
      colorTile(tiles.down, c.downColor());
    });
  }

  function renderGoals(): void {
    const results = safe(() => sim.evaluateGoals()) ?? [];
    const key = worldId + "|" + world.name + "|" + results.map((r) => (r.passed ? 1 : 0) + r.detail).join("|");
    if (key === lastGoalsKey) return;
    const changed = lastGoalsKey !== "" && lastGoalsKey.split("|")[0] === worldId;
    lastGoalsKey = key;
    goalsBox.innerHTML = "";
    goalsBox.append(h("h3", {}, world.name));
    if (world.description) goalsBox.append(h("p", { class: "desc" }, world.description));
    if (!results.length) {
      goalsBox.append(h("p", { class: "empty" }, "This playground has no challenge goals. Explore freely!"));
      return;
    }
    const ul = h("ul", { "aria-label": "Challenge goals" });
    for (const r of results) {
      ul.append(h("li", { class: r.passed ? "pass" : "" },
        h("span", { class: "tick", "aria-hidden": "true" }, r.passed ? "✓" : ""),
        h("div", {}, h("div", {}, goalText(r.goal, world), h("span", { class: "sr-only" }, r.passed ? " (done)" : " (not done yet)")),
          r.detail ? h("div", { class: "gd" }, r.detail) : null)));
    }
    goalsBox.append(ul);
    const n = results.filter((r) => r.passed).length;
    if (n === results.length) goalsBox.append(h("div", { class: "done" }, "All goals complete!"));
    if (changed) markTabDot("tabGoals");
  }

  function celebrate(time: number): void {
    if (celebrated) return;
    celebrated = true;
    lastGoalsKey = ""; renderGoals();
    setText($("celText"), `${world.name} — done in ${time.toFixed(1)} s of robot time.`);
    $("celebrate").hidden = false;
    ($("celClose") as HTMLButtonElement).focus({ preventScroll: true });
  }
  $("celClose").addEventListener("click", () => { $("celebrate").hidden = true; });

  // ------------------------------------------------------------ tabs
  const tabIds = ["tabLog", "tabScreen", "tabGoals"];
  function selectTab(id: string, focus = false): void {
    for (const t of tabIds) {
      const b = $(t), on = t === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute("aria-controls")!).hidden = !on;
      if (on) { b.querySelector(".dot")?.setAttribute("hidden", ""); if (focus) b.focus(); }
    }
    if (id === "tabGoals") { lastGoalsKey = ""; renderGoals(); }
  }
  function markTabDot(id: string): void {
    const b = $(id);
    if (b.getAttribute("aria-selected") !== "true") b.querySelector(".dot")?.removeAttribute("hidden");
  }
  tabIds.forEach((id, i) => {
    const b = $(id);
    b.addEventListener("click", () => selectTab(id));
    b.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectTab(tabIds[(i + (e.key === "ArrowRight" ? 1 : tabIds.length - 1)) % tabIds.length], true);
      }
    });
  });

  // ------------------------------------------------------------ running
  function setRunning(on: boolean): void {
    running = on;
    app.classList.toggle("is-running", on);
    runBtn.disabled = on; stopBtn.disabled = !on; resetBtn.disabled = on;
    worldBtn.disabled = on; modeBlocksBtn.disabled = on; modePythonBtn.disabled = on;
    for (const id of ["mNew", "mOpen", "mTeacher"]) ($(id) as HTMLButtonElement).disabled = on;
    pyEditor.setReadOnly(on);
    safe(() => blocks.setReadOnly(on));
    if (on) { last = performance.now(); schedule(); }
  }

  function resetRobot(): void {
    if (running) return;
    safe(() => sim.reset());
    celebrated = false; lastWallLog = -10;
    $("celebrate").hidden = true;
    lastGoalsKey = ""; renderGoals();
    redraw();
  }

  async function run(): Promise<void> {
    if (running || isDialogOpen() || !$("teacher").hidden) return;
    if (typeof (window as unknown as { Sk?: unknown }).Sk === "undefined") {
      showMsg("err", "The Python engine did not load. Reload the page (it works offline once it has loaded one time).");
      return;
    }
    const src = mode === "blocks" ? safeGetPython() : pyEditor.getText();
    if (mode === "blocks" && genEditor && !codeDrawer.hidden) genEditor.setText(src);
    clearMsg(); clearOutput(); clearHighlights();
    if (autoReset.checked) resetRobot();
    celebrated = false; $("celebrate").hidden = true;
    setRunning(true);
    let result: RunResult;
    try {
      result = await runner.run(src);
    } catch (e) {
      console.error(e);
      result = { status: "error", error: { line: 0, type: "InternalError", raw: String(e), html: "<b>Something went wrong inside Robot Lab.</b><br>Press Reset and try again." } };
    }
    safe(() => sim.abort()); // nothing keeps moving after the program ends
    setRunning(false);
    flushOutput();
    redraw();
    lastGoalsKey = ""; renderGoals();
    finishMessage(result);
  }

  function finishMessage(r: RunResult): void {
    if (r.status === "stopped") { clearHighlights(); showMsg("info", "Program stopped."); return; }
    if (r.status === "error") {
      const line = r.error.line;
      clearHighlights();
      if (mode === "python") pyEditor.mark(line, "err");
      else { safe(() => blocks.highlightLine(line)); genEditor?.mark(line, "err"); }
      const note = mode === "blocks" && line
        ? `<br><span style="opacity:.85">Line numbers are in the Python made from your blocks — press <b>Show code</b> to see it.</span>` : "";
      showMsg("err", r.error.html + note);
      return;
    }
    clearHighlights();
    const st = sim.state;
    const where = world.background === "numberGrid"
      ? `in <b>square ${esc(squareText(world, st.robot.x, st.robot.y))}</b>`
      : `at <b>x ${Math.round(st.robot.x)}, y ${Math.round(st.robot.y)}</b>`;
    if (!r.startCalled) {
      showMsg("info", "Program finished, but <code>main()</code> never started. Is <code>start(main)</code> still on the last line, not indented?");
      return;
    }
    if (r.steps === 0) {
      showMsg("info", mode === "python"
        ? "Program finished. No statements moved the robot. Delete <code>pass</code> and add your statements inside <code>main()</code>."
        : "Program finished. No blocks moved the robot. Snap some motion blocks under the start block.");
      return;
    }
    let extra = "";
    const goals = safe(() => sim.evaluateGoals()) ?? [];
    if (goals.length) {
      const n = goals.filter((g) => g.passed).length;
      if (n === goals.length) { extra = " <b>Challenge complete!</b>"; celebrate(st.time); }
      else extra = ` Challenge: <b>${n} of ${goals.length}</b> goals done — see the Challenge tab.`;
    }
    showMsg("ok", `Program finished. The robot ended ${where}, facing ${esc(facingText(world, st.robot.heading))}.${extra}`);
  }

  function stop(): void {
    if (!running) return;
    safe(() => runner.stop());
    safe(() => sim.abort());
  }

  runBtn.addEventListener("click", () => void run());
  stopBtn.addEventListener("click", stop);
  resetBtn.addEventListener("click", () => { resetRobot(); clearOutput(); clearMsg(); clearHighlights(); });

  speedBtns.forEach((b) => b.addEventListener("click", () => {
    speed = Number(b.dataset.speed) || 1;
    speedBtns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    prefs.speed = speed; savePrefs();
  }));
  speedBtns.forEach((x) => x.setAttribute("aria-checked", String(Number(x.dataset.speed) === speed)));
  autoReset.addEventListener("change", () => { prefs.autoReset = autoReset.checked; savePrefs(); });
  showPath.addEventListener("change", () => { prefs.showPath = showPath.checked; savePrefs(); redraw(); });
  showSensors.addEventListener("change", () => { prefs.showSensors = showSensors.checked; savePrefs(); redraw(); });

  // ------------------------------------------------------------ worlds
  function renderWorldMenu(): void {
    worldMenu.innerHTML = "";
    const items: { id: string; w: World }[] = playgrounds.map((w) => ({ id: w.id, w }));
    if (customWorld) items.push({ id: "custom", w: customWorld });
    for (const it of items) {
      worldMenu.append(h("button", {
        role: "menuitemradio", "aria-checked": String(it.id === worldId), title: it.w.description || null,
        onclick: () => void chooseWorld(it.id),
      }, h("b", {}, (it.id === "custom" ? "Challenge: " : "") + it.w.name), it.w.description ? h("span", {}, it.w.description) : null));
    }
    setText($("worldName"), (worldId === "custom" ? "Challenge: " : "") + world.name);
    worldBtn.title = world.description || "Choose a playground";
  }
  popover(worldBtn, worldMenu);

  function isPythonUnchanged(prev: World): boolean {
    const t = pyEditor.getText();
    return t.trim() === "" || t === starterFor(prev) || t === DEFAULT_TEMPLATE;
  }

  /** Switch world. Rebuilds sim + runner, renderer cache, blocks hardware. */
  function setWorld(w: World, id: string, opts: { offerStarter: boolean }): void {
    const prev = world;
    const unchanged = isPythonUnchanged(prev);
    world = w; worldId = id;
    buildSim();
    lastGoalsKey = "";
    $("celebrate").hidden = true;
    safe(() => blocks.setHardware(hw(w)));
    safe(() => renderer.invalidate());
    fitCanvas();
    redraw();
    renderWorldMenu();
    renderGoals();
    clearOutput(); clearMsg(); clearHighlights();
    const parts = [`${w.width} × ${w.height} mm`];
    if (w.background !== "plain" && w.gridSize) parts.push(`each square ${w.gridSize} mm`);
    if (w.hardware?.pen) parts.push("pen");
    if (w.hardware?.magnet) parts.push("magnet");
    setText($("worldMeta"), `${w.name} · ${parts.join(" · ")}`);
    if (!opts.offerStarter) return;
    const starter = starterFor(w);
    if (unchanged) {
      if (pyEditor.getText() !== starter) pyEditor.setText(starter);
    } else if (w.starter?.python && pyEditor.getText() !== starter) {
      showMsg("info", `<b>${esc(w.name)}</b> has starter code. Load it into the Python editor? (It replaces what's there now.)`, [
        { label: "Load starter code", primary: true, onClick: () => { pyEditor.setText(starter); clearMsg(); if (mode === "blocks") void setMode("python", false); } },
        { label: "Keep my code", onClick: clearMsg },
      ]);
    }
    scheduleAutosave();
  }

  async function chooseWorld(id: string): Promise<void> {
    if (running || id === worldId) return;
    const w = id === "custom" ? customWorld : getPlayground(id);
    if (!w) return;
    setWorld(w, id, { offerStarter: true });
  }

  // ------------------------------------------------------------ mode
  function applyModeUI(): void {
    app.dataset.mode = mode;
    modeBlocksBtn.setAttribute("aria-checked", String(mode === "blocks"));
    modePythonBtn.setAttribute("aria-checked", String(mode === "python"));
    $("blocksHost").hidden = mode !== "blocks";
    $("pyHost").hidden = mode !== "python";
    showCodeBtn.hidden = mode !== "blocks";
    if (mode !== "blocks") { codeDrawer.hidden = true; showCodeBtn.setAttribute("aria-expanded", "false"); }
    setText($("codeLabel"), `Your program · ${mode === "blocks" ? "Blocks" : "Python"}`);
    if (mode === "blocks") requestAnimationFrame(() => safe(() => blocks.resize()));
  }

  async function setMode(m: Mode, offerConvert: boolean): Promise<void> {
    if (running || m === mode) return;
    if (m === "python" && offerConvert) {
      const gen = safeGetPython();
      if (gen && gen !== blankBlocksPython && gen !== pyEditor.getText()) {
        const choice = await ask("Switch to Python",
          `<p>Do you want to copy the Python made from your blocks into the Python editor?</p>
           <p><b>Converting is one-way:</b> changes you make in Python will not go back into blocks.
           Your blocks stay safe in Blocks mode.${isPythonUnchanged(world) ? "" : " Converting replaces the code in the Python editor now."}</p>`,
          [{ id: "cancel", label: "Cancel" }, { id: "switch", label: "Just switch" }, { id: "convert", label: "Convert to Python", kind: "primary" }]);
        if (choice === "cancel") return;
        if (choice === "convert") pyEditor.setText(gen);
      }
    }
    mode = m;
    clearHighlights();
    applyModeUI();
    if (m === "python") pyEditor.focus();
    scheduleAutosave();
  }
  modeBlocksBtn.addEventListener("click", () => void setMode("blocks", true));
  modePythonBtn.addEventListener("click", () => void setMode("python", true));

  showCodeBtn.addEventListener("click", () => {
    const open = codeDrawer.hidden;
    codeDrawer.hidden = !open;
    showCodeBtn.setAttribute("aria-expanded", String(open));
    setText(showCodeBtn, open ? "Hide code" : "Show code");
    if (open) {
      if (!genEditor) genEditor = createPythonEditor($("genHost"), { doc: "", readOnly: true, label: "Python made from your blocks (read-only)" });
      genEditor.setText(safeGetPython());
    }
    requestAnimationFrame(() => safe(() => blocks.resize()));
  });

  // ------------------------------------------------------------ project snapshot / load
  function snapshot(): AutosaveData {
    return { project: currentProject(), pythonText: pyEditor.getText(), blocksState: safe(() => blocks.getState()) ?? null };
  }
  function currentProject(): ProjectFile {
    return {
      format: "robot-lab-project", version: 1,
      name: cleanName(projName.value),
      mode,
      python: mode === "blocks" ? safeGetPython() : pyEditor.getText(),
      blocks: mode === "blocks" ? safe(() => blocks.getState()) ?? null : null,
      worldId,
      customWorld: worldId === "custom" ? customWorld : null,
      savedAt: new Date().toISOString(),
    };
  }

  function loadProject(p: ProjectFile, extra: { pythonText?: string; blocksState?: unknown } = {}): string[] {
    const warnings: string[] = [];
    if (running) stop();
    let w: World | undefined;
    if (p.worldId === "custom" && p.customWorld) { customWorld = p.customWorld; w = customWorld; }
    else w = getPlayground(p.worldId);
    const id = w ? p.worldId : playgrounds[0].id;
    setWorld(w ?? playgrounds[0], id, { offerStarter: false });
    projName.value = cleanName(p.name); updateTitle();
    pyEditor.setText(extra.pythonText ?? (p.mode === "python" ? p.python : starterFor(world)));
    const bs = extra.blocksState !== undefined ? extra.blocksState : p.blocks;
    try { blocks.setState(bs ?? blankBlocksState); }
    catch (e) {
      console.error(e);
      safe(() => blocks.setState(blankBlocksState));
      if (p.mode === "blocks") {
        warnings.push("The blocks in this file couldn't be loaded, so the Python made from them was put in the Python editor.");
        if (p.python) pyEditor.setText(p.python);
        p = { ...p, mode: "python" };
      }
    }
    mode = p.mode;
    applyModeUI();
    renderWorldMenu();
    scheduleAutosave();
    return warnings;
  }

  function updateTitle(): void { document.title = `${cleanName(projName.value)} · Robot Lab`; }
  projName.addEventListener("input", () => { updateTitle(); scheduleAutosave(); });
  projName.addEventListener("change", () => { projName.value = cleanName(projName.value); updateTitle(); });
  projName.addEventListener("keydown", (e) => { if (e.key === "Enter") projName.blur(); });

  // ------------------------------------------------------------ files
  popover($("fileBtn"), $("fileMenu"));

  async function newProject(): Promise<void> {
    if (running) return;
    const c = await ask("New project", "<p>Start a new project? What's in the editor now will be cleared. Save first if you want to keep it.</p>",
      [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Start new project", kind: "danger" }]);
    if (c !== "ok") return;
    fileHandle = null;
    projName.value = "My robot project"; updateTitle();
    pyEditor.setText(starterFor(world));
    safe(() => blocks.setState(blankBlocksState));
    resetRobot(); clearOutput(); clearMsg(); clearHighlights();
    scheduleAutosave();
  }

  async function openFile(): Promise<void> {
    if (running) return;
    let f: { name: string; text: string } | null;
    try { f = await pickFile(`${PROJECT_EXT},${LEVEL_EXT},.json,application/json`); }
    catch (e) { showMsg("err", esc((e as Error).message)); return; }
    if (!f) return;
    let opened;
    try { opened = parseFileText(f.text, knownWorld); }
    catch (e) { showMsg("err", `<b>Couldn't open ${esc(f.name)}.</b><br>${esc((e as Error).message)}`); return; }
    if (opened.kind === "project") {
      const warnings = loadProject(opened.project).concat(opened.warnings);
      fileHandle = null;
      showMsg(warnings.length ? "info" : "ok", `Opened <b>${esc(opened.project.name)}</b>.` + warnings.map((w) => "<br>" + esc(w)).join(""));
    } else {
      const lw = opened.level.world;
      const hasStarter = !!lw.starter?.python?.trim();
      const p: ProjectFile = {
        format: "robot-lab-project", version: 1, name: cleanName(lw.name), mode: hasStarter ? "python" : mode,
        python: starterFor(lw), blocks: null, worldId: "custom", customWorld: { ...lw, id: "custom" }, savedAt: "",
      };
      loadProject(p, { pythonText: starterFor(lw), blocksState: blankBlocksState });
      fileHandle = null;
      selectTab("tabGoals");
      showMsg("ok", `Challenge loaded: <b>${esc(lw.name)}</b>. Read the goals in the <b>Challenge</b> tab, then write your program.` +
        (hasStarter ? " Your teacher's starter code is in the Python editor." : "") +
        ` When you're done, use <b>File → Save</b> and turn in the <code>${PROJECT_EXT}</code> file.` +
        (opened.warnings.length ? `<br><span style="opacity:.85">${opened.warnings.map(esc).join("<br>")}</span>` : ""));
    }
  }

  async function saveProject(forcePicker: boolean): Promise<void> {
    const p = currentProject();
    const name = fileStem(p.name) + PROJECT_EXT;
    const r = await saveText({ text: JSON.stringify(p, null, 2), suggestedName: name, mime: "application/json", ext: PROJECT_EXT, description: "Robot Lab project", handle: fileHandle, forcePicker });
    if (!r.ok) return;
    fileHandle = r.handle;
    writeAutosave(snapshot());
    toast(r.how === "picker" ? `Saved ${r.fileName ?? name}` : `Downloaded ${name} — upload it to Drive or attach it in Classroom.`, 4500);
  }

  function exportPy(): void {
    const src = mode === "blocks" ? safeGetPython() : pyEditor.getText();
    download(new Blob([src], { type: "text/x-python" }), fileStem(projName.value).replace(/\s+/g, "_") + ".py");
  }

  $("mNew").addEventListener("click", () => void newProject());
  $("mOpen").addEventListener("click", () => void openFile());
  $("mSave").addEventListener("click", () => void saveProject(false));
  $("mSaveAs").addEventListener("click", () => void saveProject(true));
  $("mExport").addEventListener("click", exportPy);

  // ------------------------------------------------------------ restore last project
  function isFreshProject(): boolean {
    return isPythonUnchanged(world) && safeGetPython() === blankBlocksPython && cleanName(projName.value) === "My robot project";
  }
  async function restore(): Promise<void> {
    if (!previous || running) return;
    if (!isFreshProject()) {
      const c = await ask("Restore last project", "<p>Bring back the project last worked on in this browser? What's in the editor now will be replaced.</p>",
        [{ id: "cancel", label: "Cancel" }, { id: "ok", label: "Restore", kind: "primary" }]);
      if (c !== "ok") return;
    }
    const warnings = loadProject(previous.project, { pythonText: previous.pythonText, blocksState: previous.blocksState });
    restoreBtn.hidden = true; mRestore.hidden = true;
    showMsg("ok", `Restored <b>${esc(previous.project.name)}</b>.` + warnings.map((w) => "<br>" + esc(w)).join(""));
  }
  const previousIsBlank = !!previous && cleanName(previous.project.name) === "My robot project" &&
    [DEFAULT_TEMPLATE, "", ...playgrounds.map(starterFor)].includes(previous.pythonText) &&
    (previous.project.mode === "python" || previous.project.python === blankBlocksPython);
  if (previous && !previousIsBlank) {
    restoreBtn.hidden = false; mRestore.hidden = false;
    restoreBtn.title = `Bring back “${previous.project.name}” from this browser`;
  }
  restoreBtn.addEventListener("click", () => void restore());
  mRestore.addEventListener("click", () => void restore());

  // ------------------------------------------------------------ help
  const helpPanel = $("helpPanel"), helpBtn = $("helpBtn");
  $("helpBody").innerHTML = HELP_HTML;
  const setHelp = (open: boolean) => {
    helpPanel.hidden = !open; helpBtn.setAttribute("aria-expanded", String(open));
    if (open) ($("helpClose") as HTMLElement).focus(); else helpBtn.focus();
  };
  helpBtn.addEventListener("click", () => setHelp(helpPanel.hidden));
  $("helpClose").addEventListener("click", () => setHelp(false));

  // ------------------------------------------------------------ teacher mode
  const teacher = $("teacher");
  let levelEditor: LevelEditor | null = null;
  const saveDraft = debounce((w: World) => writeLevelDraft(w), 600);

  function openTeacher(): void {
    if (running) return;
    teacher.hidden = false;
    if (!levelEditor) {
      const start = readLevelDraft() ?? deepCopy(customWorld ?? { ...world, id: "custom" });
      try {
        levelEditor = createLevelEditor($("teacherHost"), { world: start, onChange: (w) => saveDraft(w), onTest: (w) => testLevel(w) });
      } catch (e) {
        console.error(e);
        $("teacherHost").textContent = "The challenge maker couldn't start. Reload the page and try again.";
      }
    }
    ($("tClose") as HTMLElement).focus();
  }
  function closeTeacher(): void { teacher.hidden = true; ($("fileBtn") as HTMLElement).focus(); requestAnimationFrame(fitCanvas); }

  function checkedLevel(): World | null {
    if (!levelEditor) return null;
    return safe(() => sanitizeWorld(levelEditor!.getWorld()).world) ?? null;
  }

  function testLevel(raw: World): void {
    const w: World = { ...sanitizeWorld(raw).world, id: "custom" };
    customWorld = w;
    teacher.hidden = true;
    setWorld(w, "custom", { offerStarter: true });
    selectTab("tabGoals");
    requestAnimationFrame(fitCanvas);
    toast("Testing your level. Open File → Teacher again to keep editing.", 4500);
  }

  $("mTeacher").addEventListener("click", openTeacher);
  $("tClose").addEventListener("click", closeTeacher);
  $("tTest").addEventListener("click", () => { const w = checkedLevel(); if (w) testLevel(w); });
  $("tSave").addEventListener("click", async () => {
    const w = checkedLevel();
    if (!w) return;
    const name = fileStem(w.name) + LEVEL_EXT;
    const r = await saveText({ text: toLevelJson(w), suggestedName: name, mime: "application/json", ext: LEVEL_EXT, description: "Robot Lab challenge", handle: levelHandle });
    if (!r.ok) return;
    levelHandle = r.handle;
    toast(r.how === "picker" ? `Saved ${r.fileName ?? name}` : `Downloaded ${name}`, 4000);
  });
  $("tShare").addEventListener("click", () => {
    void ask("Share as a challenge", `
      <p><b>1.</b> Press <b>Save level</b> to make a <code>${LEVEL_EXT}</code> file (it holds the field, the goals and your starter code).</p>
      <p><b>2.</b> In Google Classroom, create an assignment and attach that file from Drive (choose “Students can view file”).</p>
      <p><b>3.</b> Students download it, open Robot Lab and use <b>File → Open</b>. It starts a new project on your challenge with your starter code.</p>
      <p><b>4.</b> They press <b>File → Save</b> and turn in their <code>${PROJECT_EXT}</code> file. Open it here to see their code and run it on the same challenge.</p>
      <p class="muted">Nothing is uploaded anywhere by Robot Lab — files only move through Drive and Classroom.</p>`,
      [{ id: "ok", label: "Got it", kind: "primary" }]);
  });

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isDialogOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const inTeacher = !teacher.hidden;
    if (mod && e.key === "Enter" && !inTeacher) { e.preventDefault(); void run(); }
    else if (e.key === "Escape") {
      if (running) { e.preventDefault(); stop(); }
      else if (!helpPanel.hidden) setHelp(false);
      else if (!$("celebrate").hidden) $("celebrate").hidden = true;
    }
    else if (mod && (e.key === "s" || e.key === "S") && !inTeacher) { e.preventDefault(); void saveProject(e.shiftKey); }
    else if (mod && (e.key === "o" || e.key === "O") && !inTeacher) { e.preventDefault(); void openFile(); }
  });
  window.addEventListener("pagehide", () => scheduleAutosave.flush());
  document.addEventListener("visibilitychange", () => { if (document.hidden) scheduleAutosave.flush(); else redraw(); });

  // ------------------------------------------------------------ boot
  setWorld(world, worldId, { offerStarter: false });
  pyEditor.setText(starterFor(world));
  mode = previous?.project.mode ?? "blocks";
  applyModeUI();
  clearOutput();
  updateTitle();
  schedule();

  // Test hook (for automated checks; harmless for students).
  (window as unknown as Record<string, unknown>).__robotLab = {
    run, stop, reset: resetRobot, setMode: (m: Mode) => setMode(m, false),
    setCode: (s: string) => pyEditor.setText(s), project: currentProject,
    load: (text: string) => { const o = parseFileText(text, knownWorld); if (o.kind === "project") loadProject(o.project); return o.kind; },
    state: () => ({ running, mode, worldId, robot: { ...sim.state.robot }, msg: msgEl.textContent, log: Array.from(logEl.children).map((l) => l.textContent) }),
    speed: (v: number) => { speed = v; },
  };
}
