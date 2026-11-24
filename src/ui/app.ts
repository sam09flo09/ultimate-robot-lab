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
// activities (guided lessons) — src/activities
import type { Activity } from "../core/activity";
import { createActivityPanel, type ActivityPanel } from "../activities/panel";
import { openCatalogue, isCatalogueOpen } from "../activities/catalogue";
import { createActivityAuthor } from "../activities/author";
import { toActivityFile } from "../activities/activityFile";
import { BUILT_INS, getBuiltIn } from "../activities/builtins";
import { loadImported, saveImported, removeImported, loadCurrentId, clearProgress, loadProgress } from "../activities/progress";
import { ACTIVITY_EXT } from "./files";
import { createViewSwitcher } from "./view3d";
import { playSound, soundForSimEvent, unlockAudio } from "./sound";
import { createGradingPanel, type GradingPanel } from "../grading/panel"; // grading
import type { VarView } from "../core/modules"; // debugger
import { renderVariables } from "../debug/panel"; // debugger
import { createRaceUi } from "../race/ui"; // race
import { createInputHub } from "../input"; // controller
import { createControllerPanel } from "../input/panel"; // controller

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
  const pauseBtn = $("pauseBtn") as HTMLButtonElement; // debugger
  const stepBtn = $("stepBtn") as HTMLButtonElement;   // debugger
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
  // debugger: paused-line highlight + Variables panel
  let shownPaused = false, debugUIKey = "";
  let pendingVars: VarView[] | null = null, lastVars: VarView[] | null = null, varsTimer = 0;
  let pendingLogs: { line: number; text: string; kind: string }[] = [];
  let pendingScreen: string[] | null = null;
  const screenLines: string[] = [""];
  let lastGoalsKey = "";
  // activities
  let activity: ActivityPanel | null = null;
  let lockedMode: Mode | null = null;
  const runPrints: string[] = [];
  const previous = readAutosave(knownWorld); // last session's project, offered via "Restore last project"

  const renderer2d: Renderer = createRenderer(canvas);
  // 2D / 3D view: `view.renderer` is whichever one is on screen.
  const view = createViewSwitcher({
    canvas2d: canvas, canvas3d: $("field3d") as HTMLCanvasElement, renderer2d,
    onSwitch: () => { fitCanvas(); needDraw = true; },
  });
  const race = createRaceUi(fieldBox); // race: clock overlay, countdown, lock-step stepping, Challenge-tab panel
  // controller: driver-control input (keyboard + gamepad + on-screen touch controller), one hub for the app
  const touchHost = h("div", { class: "touch-host", id: "touchHost" });
  fieldBox.append(touchHost);
  fieldBox.tabIndex = -1; // controller: runs move keyboard focus here so the keys drive the robot
  const hub = createInputHub({ keyTarget: window, touchHost });
  let driverRun = false; // controller: this run has read the controller → real speed, chip, touch pad
  const runSpeed = () => (driverRun ? 1 : speed); // controller: driver programs always run at 1×

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
    doc: starterFor(world), label: "Python code", assist: true, // debugger: autocomplete + hover help
    onChange: () => { if (!running) pyEditor.mark(0, "run"); scheduleAutosave(); activity?.onCodeChange(); },
    onRun: () => void run(),
  });

  let genEditor: PythonEditor | null = null;
  const refreshGenerated = debounce(() => { if (genEditor && !codeDrawer.hidden) genEditor.setText(safeGetPython()); }, 250);

  const hw = (w: World) => ({ pen: !!w.hardware?.pen, magnet: !!w.hardware?.magnet });
  const blocks: BlocksEditor = createBlocksEditor($("blocksHost"), {
    hardware: hw(world),
    onChange: () => {
      if (!running) { safe(() => blocks.highlightLine(0)); genEditor?.mark(0, "run"); }
      scheduleAutosave(); refreshGenerated(); activity?.onCodeChange();
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
      controller: race.active ? race.wrap(sim.controller) : sim.controller, // race: counts pending motions for lock-step
      onLine: (line) => { pendingLine = line; },
      onLog: (e) => { pendingLogs.push(e); if (e.kind === "print" && runPrints.length < 500) runPrints.push(String(e.text)); },
      onScreen: (op) => {
        if (op.kind === "clear") { screenLines.length = 0; screenLines.push(""); }
        else if (op.kind === "newline") screenLines.push("");
        else screenLines[screenLines.length - 1] += op.text;
        while (screenLines.length > MAX_SCREEN_LINES) screenLines.shift();
        pendingScreen = screenLines;
      },
      onPause: (info) => { pendingLine = info.line; pendingVars = info.vars; }, // debugger
      input: hub, onControllerUsed: () => onControllerUsed(), // controller
    });
    unsubSim = sim.onEvent(onSimEvent);
    celebrated = false;
  }

  function onSimEvent(e: SimEvent): void {
    soundForSimEvent(e); // sound
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
      case "goalsComplete": if (!race.active) celebrate(e.time); break; // race: the race finish celebrates instead
    }
  }

  // ------------------------------------------------------------ canvas sizing + loop
  /** The renderer fits the field (with its aspect ratio) inside the CSS-sized canvas. */
  function fitCanvas(): void {
    const r = fieldBox.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    safe(() => view.renderer.resize());
    needDraw = true;
  }
  new ResizeObserver(() => { fitCanvas(); safe(() => blocks.resize()); }).observe(fieldBox);
  new ResizeObserver(() => safe(() => blocks.resize())).observe($("blocksHost"));

  let last = performance.now();
  let statusTimer = 0, goalsTimer = 0;
  function frame(): void {
    const now = performance.now();
    let realDt = Math.max(0, (now - last) / 1000);
    const frameDt = realDt;
    last = now;
    // The 3D camera can move on its own (follow mode, dragging), so 3D redraws every frame.
    if (view.is3D) needDraw = true;
    // debugger: the sim (and the race clock) are frozen while the program is paused
    if (running && !runner.paused && race.active) {
      // race: lock-step substeps so the finish time doesn't depend on speed or frame rate
      race.advance(Math.min(document.hidden ? 2 : 0.1, realDt) * runSpeed()); // controller: runSpeed
      needDraw = true;
    } else if (running && !runner.paused) {
      if (document.hidden) {
        // rAF is paused: we are on the timer fallback (which Chrome throttles). Catch up in ≤0.1 s chunks.
        realDt = Math.min(realDt, 2);
        while (realDt > 1e-6) { const d = Math.min(0.1, realDt); safe(() => sim.step(d * runSpeed())); realDt -= d; } // controller: runSpeed
      } else {
        safe(() => sim.step(Math.min(0.1, realDt) * runSpeed())); // controller: runSpeed
      }
      needDraw = true;
    }
    if (needDraw && !document.hidden) {
      needDraw = false;
      safe(() => view.renderer.draw(world, sim.state, { showPath: showPath.checked, showSensors: showSensors.checked, showZones: true, selectedId: null }));
    }
    safe(() => view.tick(Math.min(frameDt, 0.5), document.hidden));
    race.tick(); // race
    flushOutput();
    statusTimer += realDt; goalsTimer += realDt;
    if (!running || statusTimer > 0.1) { if (running || statusDirty) { updateStatus(); statusDirty = false; } statusTimer = 0; }
    if (goalsTimer > 0.25) { goalsTimer = 0; if (running) renderGoals(); }
    // debugger: live variables ~4×/s while running (only when the tab is showing)
    varsTimer += frameDt;
    if (running && !runner.paused && varsTimer > 0.25 && !$("panelVars").hidden) { varsTimer = 0; pendingVars = safe(() => runner.variables()) ?? null; }
    tickControllerPanel(frameDt); // controller: Controller tab live picture
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
    const isPaused = running && runner.paused; // debugger: paused line gets its own colour
    if ((pendingLine !== shownLine || isPaused !== shownPaused) && running) {
      shownLine = pendingLine; shownPaused = isPaused;
      const kind = isPaused ? "paused" : "run";
      if (mode === "python") pyEditor.mark(shownLine, kind);
      else { safe(() => blocks.highlightLine(shownLine)); genEditor?.mark(shownLine, kind); }
    }
    syncDebugUI();
    if (pendingVars) { lastVars = pendingVars; renderVariables($("varsBox"), pendingVars, { running, paused: isPaused }); pendingVars = null; }
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
    lastVars = null; renderVariables($("varsBox"), null, { running: false, paused: false }); // debugger
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
    shownLine = -1; pendingLine = 0; shownPaused = false;
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
    const racePanel = race.panel(() => { lastGoalsKey = ""; renderGoals(); }); // race
    if (racePanel) goalsBox.append(racePanel);
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
    playSound("success"); // sound
    lastGoalsKey = ""; renderGoals();
    setText($("celTitle"), "Challenge complete!");
    setText($("celText"), `${world.name} — done in ${time.toFixed(1)} s of robot time.`);
    $("celebrate").hidden = false;
    ($("celClose") as HTMLButtonElement).focus({ preventScroll: true });
  }
  $("celClose").addEventListener("click", () => { $("celebrate").hidden = true; });

  // ------------------------------------------------------------ tabs
  const tabIds = ["tabLog", "tabScreen", "tabGoals", "tabVars", "tabCtl"]; // debugger: + Variables; controller: + Controller
  function selectTab(id: string, focus = false): void {
    for (const t of tabIds) {
      const b = $(t), on = t === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      $(b.getAttribute("aria-controls")!).hidden = !on;
      if (on) { b.querySelector(".dot")?.setAttribute("hidden", ""); if (focus) b.focus(); }
    }
    if (id === "tabGoals") { lastGoalsKey = ""; renderGoals(); }
    if (id === "tabVars" && running) pendingVars = safe(() => runner.variables()) ?? null; // debugger
    syncController(); // controller: the hub listens while the Controller tab is open
  }
  function markTabDot(id: string): void {
    const b = $(id);
    if (b.getAttribute("aria-selected") !== "true") b.querySelector(".dot")?.removeAttribute("hidden");
  }
  tabIds.forEach((id, i) => {
    const b = $(id);
    b.addEventListener("click", () => selectTab(id));
    b.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return; // controller: arrows are driving keys while the hub is listening
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
    debugUIKey = ""; syncDebugUI(); // debugger
    worldBtn.disabled = on; modeBlocksBtn.disabled = on || !!lockedMode; modePythonBtn.disabled = on || !!lockedMode;
    ($("actBtn") as HTMLButtonElement).disabled = on;
    for (const id of ["mNew", "mOpen", "mTeacher"]) ($(id) as HTMLButtonElement).disabled = on;
    pyEditor.setReadOnly(on);
    safe(() => blocks.setReadOnly(on));
    if (!on) endDriverRun(); // controller
    syncController(); // controller
    if (on) { last = performance.now(); schedule(); }
  }

  function resetRobot(): void {
    if (running) return;
    safe(() => sim.reset());
    race.reset(); // race
    celebrated = false; lastWallLog = -10;
    $("celebrate").hidden = true;
    lastGoalsKey = ""; renderGoals();
    redraw();
  }

  // debugger: stepThrough starts paused; race: countdown:false skips 3-2-1-GO (so does stepping through)
  async function run(runOpts: { stepThrough?: boolean; countdown?: boolean } = {}): Promise<void> {
    if (running || isDialogOpen() || isCatalogueOpen() || !$("teacher").hidden || grading?.busy) return; // grading: Skulpt is global
    if (typeof (window as unknown as { Sk?: unknown }).Sk === "undefined") {
      showMsg("err", "The Python engine did not load. Reload the page (it works offline once it has loaded one time).");
      return;
    }
    const src = mode === "blocks" ? safeGetPython() : pyEditor.getText();
    if (mode === "blocks" && genEditor && !codeDrawer.hidden) genEditor.setText(src);
    clearMsg(); clearOutput(); clearHighlights();
    unlockAudio(); playSound("start"); // sound
    if (autoReset.checked || race.active) resetRobot(); // race: always reset before a race run
    celebrated = false; $("celebrate").hidden = true;
    setRunning(true);
    focusField(); // controller: keys drive the robot, not the (read-only) editor
    runPrints.length = 0;
    if (race.active) { // race: 3-2-1-GO (no sim time passes), then start the clock with the program
      const go = await race.countdown(runOpts.countdown === false || !!runOpts.stepThrough);
      if (!go || !running) { setRunning(false); showMsg("info", "Race cancelled."); return; }
      race.begin(sim, () => { safe(() => runner.stop()); safe(() => sim.abort()); });
    }
    let result: RunResult;
    try {
      result = await runner.run(src, { startPaused: !!runOpts.stepThrough }); // debugger: Step through
    } catch (e) {
      console.error(e);
      result = { status: "error", error: { line: 0, type: "InternalError", raw: String(e), html: "<b>Something went wrong inside Robot Lab.</b><br>Press Reset and try again." } };
    }
    safe(() => sim.abort()); // nothing keeps moving after the program ends
    const raceOut = race.end(); // race
    setRunning(false);
    flushOutput();
    redraw();
    lastGoalsKey = ""; renderGoals();
    if (raceOut?.finished) { // race
      playSound("success"); // sound
      clearHighlights();
      showMsg("ok", race.outcomeHtml(raceOut));
      setText($("celTitle"), raceOut.newBest ? "New best!" : "Finished!");
      setText($("celText"), $("msg").textContent ?? "");
      $("celebrate").hidden = false;
      ($("celClose") as HTMLButtonElement).focus({ preventScroll: true });
    } else if (raceOut && result.status !== "error") {
      clearHighlights();
      showMsg("info", race.outcomeHtml(raceOut) + (result.status === "stopped" ? " (Program stopped.)" : ""));
    } else finishMessage(result);
    if (activity?.active) {
      const goals = safe(() => sim.evaluateGoals()) ?? [];
      const st = sim.state;
      const sq = world.background === "numberGrid" ? parseInt(squareText(world, st.robot.x, st.robot.y), 10) : NaN;
      activity.onRun({
        result, goalsAllPassed: goals.length > 0 && goals.every((g) => g.passed),
        finalSquare: Number.isFinite(sq) ? sq : null,
        output: [...runPrints, ...screenLines.filter((l) => l !== "")],
      });
    }
  }

  function finishMessage(r: RunResult): void {
    if (r.status === "stopped") { clearHighlights(); showMsg("info", "Program stopped."); return; }
    if (r.status === "error") {
      playSound("error"); // sound
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
    if (goals.length && !race.active) { // race: the race result replaces the goals summary
      const n = goals.filter((g) => g.passed).length;
      if (n === goals.length) { extra = " <b>Challenge complete!</b>"; celebrate(st.time); }
      else extra = ` Challenge: <b>${n} of ${goals.length}</b> goals done — see the Challenge tab.`;
    }
    showMsg("ok", `Program finished. The robot ended ${where}, facing ${esc(facingText(world, st.robot.heading))}.${extra}`);
  }

  function stop(): void {
    if (!running) return;
    race.cancelCountdown(); // race
    safe(() => runner.stop());
    safe(() => sim.abort());
  }

  runBtn.addEventListener("click", () => void run());
  stopBtn.addEventListener("click", stop);

  // ------------------------------------------------------------ debugger: pause / continue / step
  /** Shows ▶ Run + ⤵ Step when idle, ⏸ Pause while running, ▶ Continue + ⤵ Step while paused. */
  function syncDebugUI(): void {
    const paused = running && runner.paused;
    const key = `${running}|${paused}`;
    if (key === debugUIKey) return;
    debugUIKey = key;
    app.classList.toggle("is-paused", paused);
    runBtn.hidden = running;
    pauseBtn.hidden = !running;
    setText(pauseBtn, paused ? "▶ Continue" : "⏸ Pause");
    pauseBtn.title = paused ? "Carry on running (F8)" : "Pause on the next line (F8)";
    pauseBtn.classList.toggle("btn-run", paused);
    stepBtn.hidden = running && !paused;
    stepBtn.disabled = false;
    stepBtn.title = running ? "Run the next line, then pause again (F10)" : "Step through: start paused on the first line, then press Step for each line (F10)";
    if (!running) { shownPaused = false; if (lastVars) renderVariables($("varsBox"), lastVars, { running: false, paused: false }); }
  }
  function togglePause(): void {
    if (!running) { void run(); return; }
    if (runner.paused) runner.resume(); else runner.pause();
    syncDebugUI();
  }
  function stepOnce(): void {
    if (!running) { selectTab("tabVars"); void run({ stepThrough: true }); return; }
    runner.step();
    syncDebugUI();
  }
  pauseBtn.addEventListener("click", togglePause);
  stepBtn.addEventListener("click", stepOnce);
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
    race.setWorld(w, id); // race (before buildSim: the runner's controller is wrapped for races)
    autoReset.disabled = race.active; autoReset.checked = race.active || !!prefs.autoReset;
    autoReset.parentElement!.title = race.active ? "Races always start from a reset robot" : "";
    buildSim();
    lastGoalsKey = "";
    $("celebrate").hidden = true;
    safe(() => blocks.setHardware(hw(w)));
    view.invalidate();
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
      activity: activity?.embed() ?? null,
    };
  }

  function loadProject(p: ProjectFile, extra: { pythonText?: string; blocksState?: unknown; activityReview?: boolean } = {}): string[] {
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
    if (p.activity) activity?.start(p.activity.activity, { progress: p.activity.progress, applyStep: false, review: !!extra.activityReview });
    else if (activity?.active) activity.leave();
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
    try { f = await pickFile(`${PROJECT_EXT},${LEVEL_EXT},${ACTIVITY_EXT},.json,application/json`); }
    catch (e) { showMsg("err", esc((e as Error).message)); return; }
    if (!f) return;
    let opened;
    try { opened = parseFileText(f.text, knownWorld); }
    catch (e) { showMsg("err", `<b>Couldn't open ${esc(f.name)}.</b><br>${esc((e as Error).message)}`); return; }
    if (opened.kind === "activity") {
      startImported(opened.activity, opened.warnings);
    } else if (opened.kind === "project") {
      // A teacher opening a student's file must not overwrite the teacher's own progress here.
      let activityReview = false;
      const pa = opened.project.activity;
      if (pa) {
        const local = loadProgress(pa.activity);
        const same = !!local && local.stepIndex === pa.progress.stepIndex
          && [...local.completed].sort().join("|") === [...pa.progress.completed].sort().join("|");
        if (local && !same) {
          const choice = await ask("This file has its own activity progress",
            `<p><b>${esc(opened.project.name)}</b> is at a different point in <b>${esc(pa.activity.title)}</b> than this Chromebook.</p>
             <p><b>Just look</b> shows the file's progress without changing yours (use this when checking a student's work).
             <b>Continue from this file</b> replaces the progress saved here.</p>`,
            [{ id: "review", label: "Just look", kind: "primary" }, { id: "continue", label: "Continue from this file" }]);
          activityReview = choice !== "continue";
        }
      }
      const warnings = loadProject(opened.project, { activityReview }).concat(opened.warnings);
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
  let grading: GradingPanel | null = null; // grading (src/grading)
  let levelEditor: LevelEditor | null = null;
  const saveDraft = debounce((w: World) => writeLevelDraft(w), 600);

  function openTeacher(): void {
    if (running) return;
    teacher.hidden = false;
    if (!levelEditor) {
      const start = readLevelDraft() ?? deepCopy(customWorld ?? { ...world, id: "custom" });
      try {
        levelEditor = createLevelEditor($("teacherHost"), { world: start, embedded: true, onChange: (w) => saveDraft(w), onTest: (w) => testLevel(w) });
      } catch (e) {
        console.error(e);
        $("teacherHost").textContent = "The challenge maker couldn't start. Reload the page and try again.";
      }
    }
    ($("tClose") as HTMLElement).focus();
  }
  function closeTeacher(): void { grading?.cancel(); /* grading */ teacher.hidden = true; ($("fileBtn") as HTMLElement).focus(); requestAnimationFrame(fitCanvas); }

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

  // ------------------------------------------------------------ activities (guided lessons, src/activities)
  const modeTitles = { blocks: modeBlocksBtn.title, python: modePythonBtn.title };
  function setLock(m: Mode | null): void {
    lockedMode = m;
    modeBlocksBtn.disabled = running || !!m; modePythonBtn.disabled = running || !!m;
    const why = m ? `This activity step uses ${m === "python" ? "Python" : "Blocks"}.` : "";
    modeBlocksBtn.title = why || modeTitles.blocks;
    modePythonBtn.title = why || modeTitles.python;
    $("modeBlocks").parentElement!.classList.toggle("locked", !!m);
  }
  function sameWorld(a: World, b: World): boolean {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  activity = createActivityPanel($("activityHost"), {
    getPython: () => (mode === "blocks" ? safeGetPython() : pyEditor.getText()),
    getMode: () => mode,
    setMode: (m) => { if (m !== mode) void setMode(m, false); },
    setLock,
    loadWorld: (spec) => {
      if (running) return;
      if ("playground" in spec) {
        const w = getPlayground(spec.playground);
        if (!w) { showMsg("info", `This step uses a playground (<b>${esc(spec.playground)}</b>) that isn't in this version of Robot Lab.`); return; }
        if (worldId === w.id) { resetRobot(); return; }
        setWorld(w, w.id, { offerStarter: false });
      } else {
        const w: World = { ...sanitizeWorld(spec.custom).world, id: "custom" };
        if (worldId === "custom" && customWorld && sameWorld(customWorld, w)) { resetRobot(); return; }
        customWorld = w;
        setWorld(w, "custom", { offerStarter: false });
      }
    },
    isPythonUntouched: () => isPythonUnchanged(world),
    getPythonText: () => pyEditor.getText(),
    setPython: (t) => pyEditor.setText(t),
    isBlocksUntouched: () => safeGetPython() === blankBlocksPython,
    setBlocks: (st) => {
      try { blocks.setState(st ?? blankBlocksState); return true; }
      catch (e) { console.error(e); safe(() => blocks.setState(blankBlocksState)); return false; }
    },
    showMsg, clearMsg,
    celebrate: (title, text) => {
      setText($("celTitle"), title); setText($("celText"), text);
      $("celebrate").hidden = false;
      ($("celClose") as HTMLButtonElement).focus({ preventScroll: true });
    },
    isRunning: () => running,
    changed: () => scheduleAutosave(),
    layout: () => requestAnimationFrame(() => safe(() => blocks.resize())),
  });

  const findActivity = (id: string): Activity | undefined => getBuiltIn(id) ?? loadImported().find((a) => a.id === id);
  function startActivity(a: Activity, opts: { preview?: boolean } = {}): void {
    if (running) return;
    activity!.start(a, { preview: opts.preview, applyStep: true });
  }
  function startImported(a: Activity, warnings: string[] = []): void {
    if (!saveImported(a)) warnings.push("This browser couldn't keep a copy of the activity, so open the file again next time.");
    startActivity(a);
    toast(`Activity: ${a.title}`, 3000);
    if (warnings.length) showMsg("info", `Opened the activity <b>${esc(a.title)}</b>.` + warnings.map((w) => "<br>" + esc(w)).join(""));
  }
  function showCatalogue(): void {
    if (running) return;
    openCatalogue({
      builtIns: BUILT_INS, imported: loadImported(), currentId: activity?.state()?.preview ? null : activity?.state()?.activityId ?? null,
      onStart: (a) => startActivity(a),
      onOpenFile: () => void openActivityFile(),
      onRemove: (a) => { removeImported(a.id); clearProgress(a.id); if (activity?.state()?.activityId === a.id) activity.leave(); },
    });
  }
  async function openActivityFile(): Promise<void> {
    if (running) return;
    let f: { name: string; text: string } | null;
    try { f = await pickFile(`${ACTIVITY_EXT},${PROJECT_EXT},${LEVEL_EXT},.json,application/json`); }
    catch (e) { showMsg("err", esc((e as Error).message)); return; }
    if (!f) return;
    let opened;
    try { opened = parseFileText(f.text, knownWorld); }
    catch (e) { showMsg("err", `<b>Couldn't open ${esc(f.name)}.</b><br>${esc((e as Error).message)}`); return; }
    if (opened.kind !== "activity") { showMsg("err", `<b>${esc(f.name)}</b> isn't an activity file. Use <b>File → Open…</b> for projects and challenges.`); return; }
    startImported(opened.activity, opened.warnings);
  }
  $("actBtn").addEventListener("click", showCatalogue);
  $("mOpenAct").addEventListener("click", () => void openActivityFile());

  // teacher: Level / Activity switch + authoring form
  let author: ReturnType<typeof createActivityAuthor> | null = null;
  let actHandle: FileHandle = null;
  function teacherTab(which: "level" | "activity" | "grade"): void {
    const act = which === "activity";
    const grade = which === "grade"; // grading
    $("tTabLevel").setAttribute("aria-checked", String(which === "level"));
    $("tTabAct").setAttribute("aria-checked", String(act));
    $("tTabGrade").setAttribute("aria-checked", String(grade));
    $("teacherHost").hidden = which !== "level"; $("teacherActHost").hidden = !act; $("teacherGradeHost").hidden = !grade;
    for (const id of ["tTest", "tSave", "tShare"]) $(id).hidden = which !== "level";
    setText($("teacherTitle"), grade ? "Teacher · Grading" : act ? "Teacher · Activity maker" : "Teacher · Challenge maker");
    if (grade) { openGrading(); return; }
    if (act && !author) {
      author = createActivityAuthor($("teacherActHost"), {
        playgrounds: playgrounds.map((w) => ({ id: w.id, name: w.name })),
        getLevelWorld: () => checkedLevel() ?? readLevelDraft(),
        preview: (a) => {
          closeTeacher();
          startActivity(a, { preview: true });
          toast("Previewing your activity as a student. Open File → Teacher to keep editing.", 4500);
        },
        save: async (a) => {
          const name = fileStem(a.title) + ACTIVITY_EXT;
          const r = await saveText({ text: toActivityFile(a), suggestedName: name, mime: "application/json", ext: ACTIVITY_EXT, description: "Robot Lab activity", handle: actHandle });
          if (!r.ok) return;
          actHandle = r.handle;
          toast(r.how === "picker" ? `Saved ${r.fileName ?? name}` : `Downloaded ${name}`, 4000);
        },
        open: async () => {
          let f: { name: string; text: string } | null;
          try { f = await pickFile(`${ACTIVITY_EXT},.json,application/json`); } catch { return null; }
          if (!f) return null;
          try {
            const o = parseFileText(f.text, knownWorld);
            if (o.kind === "activity") { actHandle = null; return o.activity; }
            throw new Error("That isn't an activity file.");
          } catch (e) {
            void ask("Couldn't open the activity", `<p>${esc((e as Error).message)}</p>`, [{ id: "ok", label: "OK", kind: "primary" }]);
            return null;
          }
        },
      });
    }
  }
  $("tTabLevel").addEventListener("click", () => teacherTab("level"));
  $("tTabAct").addEventListener("click", () => teacherTab("activity"));

  // ------------------------------------------------------------ grading (src/grading): grade many turned-in files
  function openGrading(): void {
    if (!grading) {
      grading = createGradingPanel($("teacherGradeHost"), {
        isMainRunning: () => running,
        openProject: (p, fileName) => {
          closeTeacher();
          const warnings = loadProject(p, { activityReview: true });
          fileHandle = null;
          showMsg("info", `Reviewing <b>${esc(p.name)}</b> (${esc(fileName)}). Your own activity progress isn't changed.` + warnings.map((w) => "<br>" + esc(w)).join(""));
        },
      });
    }
    grading.focus();
  }
  $("tTabGrade").addEventListener("click", () => teacherTab("grade"));

  // ------------------------------------------------------------ controller (driver control, src/input)
  const driveChip = $("driveChip"), padToggle = $("padToggle") as HTMLButtonElement, panelCtl = $("panelCtl");
  const ctlPanel = createControllerPanel($("ctlBox"));
  const TOUCH_KEY = "robot-lab-touchpad-v1";
  let touchPref: "on" | "off" | null = null; // null = automatic (show on touch screens during driver runs)
  try { const v = localStorage.getItem(TOUCH_KEY); if (v === "on" || v === "off") touchPref = v; } catch { /* ignore */ }
  const touchDevice = (() => {
    try { return matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0; } catch { return false; }
  })();
  const speedTitles = speedBtns.map((b) => b.title);
  let hintShown = false, ctlTimer = 0;
  const SOURCE_NAMES = { keyboard: "Keyboard", gamepad: "Gamepad", touch: "Touch" } as const;

  /** Hub listens while a program runs or the Controller tab is open; touch pad + chip follow the run. */
  function syncController(): void {
    hub.setActive(running || !panelCtl.hidden);
    const showTouch = touchPref === "on" || (touchPref !== "off" && driverRun && touchDevice);
    hub.showTouchControls(showTouch);
    padToggle.setAttribute("aria-pressed", String(showTouch));
    padToggle.title = showTouch ? "Hide the on-screen controller" : "Show on-screen controller";
    driveChip.hidden = !(running && driverRun);
    if (!driveChip.hidden) setText(driveChip, "🎮 Driving · " + hub.sources().map((s) => SOURCE_NAMES[s]).join(" + "));
  }
  hub.onChange(syncController);

  function onControllerUsed(): void {
    if (driverRun || !running) return;
    driverRun = true;
    for (const b of speedBtns) { b.disabled = true; b.title = "Driver programs run at real speed"; }
    $("speedSeg").title = "Driver programs run at real speed";
    if (!hintShown) { hintShown = true; toast("Drive with W A S D and the arrow keys — press Esc to stop", 5000); }
    focusField();
    syncController();
  }
  function endDriverRun(): void {
    if (!driverRun) return;
    driverRun = false;
    speedBtns.forEach((b, i) => { b.disabled = false; b.title = speedTitles[i]; });
    $("speedSeg").title = "";
  }
  /** Move keyboard focus off the code editor (and off the now-hidden Run button) onto the playground. */
  function focusField(): void {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || a === runBtn || a.hidden || a.closest(".col-code")) {
      fieldBox.focus({ preventScroll: true });
    }
  }
  padToggle.addEventListener("click", () => {
    touchPref = hub.touchShown ? "off" : "on";
    try { localStorage.setItem(TOUCH_KEY, touchPref); } catch { /* ignore */ }
    syncController();
  });
  /** Controller tab: live picture ~15×/s while it is showing (called from the frame loop). */
  function tickControllerPanel(dt: number): void {
    if (panelCtl.hidden) return;
    ctlTimer += dt;
    if (ctlTimer < 1 / 15) return;
    ctlTimer = 0;
    ctlPanel.update(hub.read(), { gamepads: hub.gamepads(), touch: hub.touchShown, running });
  }

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
    // debugger: F8 continue/pause, F10 step
    else if (e.key === "F8" && !inTeacher) { e.preventDefault(); togglePause(); }
    else if (e.key === "F10" && !inTeacher) { e.preventDefault(); stepOnce(); }
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

  // activities: continue the activity that was open before a reload
  {
    const curId = loadCurrentId();
    const cur = curId ? findActivity(curId) : undefined;
    if (cur && previous?.project.activity?.activity.id === cur.id) {
      loadProject(previous.project, { pythonText: previous.pythonText, blocksState: previous.blocksState });
      restoreBtn.hidden = true; mRestore.hidden = true;
    } else if (cur) {
      activity.start(cur, { applyStep: !previous || previousIsBlank });
    }
  }

  // Test hook (for automated checks; harmless for students).
  (window as unknown as Record<string, unknown>).__robotLab = {
    run: () => run({ countdown: false }), // race: automated runs skip the countdown
    stop, reset: resetRobot, setMode: (m: Mode) => setMode(m, false),
    setCode: (s: string) => pyEditor.setText(s), project: currentProject,
    load: (text: string) => { const o = parseFileText(text, knownWorld); if (o.kind === "project") loadProject(o.project); return o.kind; },
    state: () => ({ running, mode, worldId, robot: { ...sim.state.robot }, msg: msgEl.textContent, log: Array.from(logEl.children).map((l) => l.textContent) }),
    speed: (v: number) => { speed = v; },
    // debugger
    pause: () => runner.pause(), resume: () => runner.resume(), step: stepOnce, paused: () => running && runner.paused,
    variables: () => safe(() => runner.variables()) ?? [],
    // activities
    startActivity: (id: string) => { const a = findActivity(id); if (a) startActivity(a); return !!a; },
    activityState: () => activity?.state() ?? null,
    // controller
    controller: () => hub.read(), controllerUsed: () => onControllerUsed(),
    driving: () => ({ driverRun, speed: runSpeed(), sources: hub.sources(), touch: hub.touchShown, active: hub.active }),
  };
}
