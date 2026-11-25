/**
 * match: the Match screen — a full-window overlay for two-robot matches (setup → countdown →
 * autonomous → driver control → match over). Opened from the "⚔ Match" top-bar button.
 *
 * Team A = the current project; Team B = a practice bot, a classmate's .robolab file, a mirror of
 * Team A, or nothing. Each team's program runs in its own isolated runner (one hidden frame each), so
 * a runtime error in one team never stops the other. The match always runs at real time (1×).
 */
import type { IsolatedRunner, MatchSim, PlayerInput, Team } from "../../core/match";
import { TEAM_COLOR } from "../../core/match";
import type { CameraMode, Renderer, Renderer3D, RenderOptions } from "../../core/modules";
import type { RobotConfig, SimState } from "../../core/types";
import { createRenderer } from "../../render";
import { createPlayerInput, KEYS_LEFT, KEYS_RIGHT, PLAYER_INPUT_LABEL, type PlayerController } from "../../input";
import { configSummary, isDefaultConfig } from "../../sim/robotConfig";
import { h, esc, setText, toast, isDialogOpen } from "../../ui/dom";
import { cleanName } from "../../ui/files";
import { playSound, soundForSimEvent, unlockAudio } from "../../ui/sound";
import { games, makeMatchSim, makeRunner, practiceBot } from "./engine";
import { endSummaryHtml, scoreboardHtml, winnerOf, type TeamNames } from "./scoreboard";
import {
  MATCH_TEMPLATE, OPPONENT_LABEL, loadOpponentFile, opponentName, opponentRobot, usesCompetition, validateSetup,
  type OpponentChoice, type SetupChoice, type ValidSetup,
} from "./setup";
import { AUTO_RANGE, DRIVER_RANGE, createTimeline, formatClock, type Timeline, type TimelinePhase } from "./timeline";

export interface MatchHost {
  projectName(): string;
  /** Team A's program (the Python the current mode produces). */
  programSource(): string;
  robotConfig(): RobotConfig;
  /** The app's current 2D/3D choice. */
  is3D(): boolean;
  knownWorld(id: string): boolean;
  /** Start a NEW project holding this Python (asks the student first). Resolves true if it did. */
  newProjectFromTemplate(python: string): Promise<boolean>;
  onClose?(): void;
}

export interface MatchScreen {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Test hook: the running match (null when none). */
  debug(): { phase: TimelinePhase; remaining: number; simTime: number; score: { A: number; B: number } | null; paused: boolean } | null;
}

const INPUTS: PlayerInput[] = ["keyboard-left", "keyboard-right", "gamepad-1", "gamepad-2", "touch", "program-only"];
const OPPONENTS: OpponentChoice[] = ["practice-easy", "practice-medium", "file", "mirror", "none"];
const PHASE_TEXT: Record<TimelinePhase, string> = {
  setup: "", countdown: "GET READY", autonomous: "AUTONOMOUS", driver: "DRIVER CONTROL", ended: "MATCH OVER",
};
const LOG_MAX = 300;
const CAMERAS: CameraMode[] = ["orbit", "follow", "overhead"];

function keyMapHtml(kind: PlayerInput): string {
  if (kind === "keyboard-left" || kind === "keyboard-right") {
    const t = kind === "keyboard-left" ? KEYS_LEFT.table : KEYS_RIGHT.table;
    return `<table class="mk-table"><tbody>${t.map((r) => `<tr><td>${esc(r.control)}</td><td><kbd>${esc(r.keys)}</kbd></td></tr>`).join("")}</tbody></table>`;
  }
  if (kind === "gamepad-1" || kind === "gamepad-2") {
    let n = 0;
    try { n = Array.from(navigator.getGamepads?.() ?? []).filter((p) => p && p.connected).length; } catch { /* none */ }
    const want = kind === "gamepad-1" ? 1 : 2;
    return `<p class="mk-note">Sticks and buttons work like the single-player controller. ${n >= want ? `Gamepad ${want} is connected.` : `Plug in ${want === 1 ? "a gamepad" : "a second gamepad"} and press any button on it.`}</p>`;
  }
  if (kind === "touch") return `<p class="mk-note">An on-screen controller appears over the field for this team.</p>`;
  return `<p class="mk-note">Nobody drives: the program runs by itself in both periods.</p>`;
}

export function createMatchScreen(host: MatchHost): MatchScreen {
  // ------------------------------------------------------------ DOM
  const closeBtn = h("button", { class: "btn", type: "button", "aria-label": "Close the match screen" }, "✕ Close");
  const pauseBtn = h("button", { class: "btn btn-pause", type: "button", hidden: true, title: "Pause the match (Esc)" }, "⏸ Pause");
  const stopBtn = h("button", { class: "btn btn-stop", type: "button", hidden: true, title: "End the match now" }, "■ Stop");
  const camSel = h("select", { class: "match-cam", "aria-label": "Camera", hidden: true },
    h("option", { value: "orbit" }, "Look around"), h("option", { value: "follow" }, "Follow robot A"), h("option", { value: "overhead" }, "Overhead"));
  const bar = h("header", { class: "match-bar" },
    h("h2", { id: "matchTitle" }, "⚔ Match"), h("div", { class: "spacer" }), camSel, pauseBtn, stopBtn, closeBtn);

  // setup
  const gameSel = h("select", { id: "matchGame" });
  const rules = h("p", { class: "ms-rules" });
  const preview = h("canvas", { class: "ms-preview", role: "img", "aria-label": "Field preview" });
  const autoIn = h("input", { type: "number", id: "matchAuto", min: AUTO_RANGE[0], max: AUTO_RANGE[1], step: 1 });
  const drvIn = h("input", { type: "number", id: "matchDrv", min: DRIVER_RANGE[0], max: DRIVER_RANGE[1], step: 1 });
  const aBody = h("div", { class: "ms-team-body" });
  const inputSel = (t: Team) => h("select", { id: `matchInput${t}`, "aria-label": `Team ${t} controls` },
    ...INPUTS.map((k) => h("option", { value: k }, PLAYER_INPUT_LABEL[k])));
  const inA = inputSel("A"), inB = inputSel("B");
  inA.value = "keyboard-left"; inB.value = "keyboard-right";
  const mapA = h("div", { class: "ms-keymap" }), mapB = h("div", { class: "ms-keymap" });
  const oppSel = h("select", { id: "matchOpp", "aria-label": "Team B program" }, ...OPPONENTS.map((k) => h("option", { value: k }, OPPONENT_LABEL[k])));
  const fileIn = h("input", { type: "file", accept: ".robolab,application/json", id: "matchFile" });
  const fileRow = h("label", { class: "ms-file", hidden: true }, h("span", {}, "Classmate's project file "), fileIn);
  const fileMsg = h("div", { class: "ms-filemsg", role: "status", "aria-live": "polite" });
  const bBody = h("div", { class: "ms-team-body" });
  const errs = h("div", { class: "ms-errors", role: "alert" });
  const startBtn = h("button", { class: "btn btn-primary ms-start", type: "button" }, "▶ Start match");
  const teamCard = (t: Team, ...kids: Node[]) => h("section", { class: "ms-team", style: `--team:${TEAM_COLOR[t]}`, "aria-label": `Team ${t}` },
    h("h3", {}, h("span", { class: "mt-badge", "aria-hidden": "true" }, t), ` Team ${t} · ${t === "A" ? "red" : "blue"}`), ...kids);
  const setupEl = h("div", { class: "match-setup" },
    h("section", { class: "ms-game", "aria-label": "Game" },
      h("label", { class: "ms-row" }, h("span", { class: "label" }, "Game"), gameSel), rules, preview,
      h("div", { class: "ms-periods" },
        h("label", {}, h("span", {}, "Autonomous (s)"), autoIn),
        h("label", {}, h("span", {}, "Driver control (s)"), drvIn))),
    teamCard("A", aBody, h("label", { class: "ms-row" }, h("span", { class: "label" }, "Controls"), inA), mapA),
    teamCard("B", h("label", { class: "ms-row" }, h("span", { class: "label" }, "Program"), oppSel), fileRow, fileMsg, bBody,
      h("label", { class: "ms-row" }, h("span", { class: "label" }, "Controls"), inB), mapB),
    h("div", { class: "ms-foot" }, errs, startBtn));

  // running
  const scoreEl = h("div", { class: "mt-teams" });
  const phaseEl = h("div", { class: "mc-phase" });
  const clockEl = h("div", { class: "mc-clock", role: "timer", "aria-live": "off" });
  const centre = h("div", { class: "mc-centre" }, phaseEl, clockEl);
  const scoreBar = h("div", { class: "match-score", role: "status" }, scoreEl, centre);
  const canvas2d = h("canvas", { class: "match-canvas", role: "img", "aria-label": "Match field" });
  const canvas3d = h("canvas", { class: "match-canvas", role: "img", "aria-label": "3D match field. Drag to look around.", hidden: true });
  const cdEl = h("div", { class: "match-countdown", hidden: true, "aria-live": "assertive" });
  const banner = h("div", { class: "match-banner", hidden: true, role: "status" });
  const pausedEl = h("div", { class: "match-paused", hidden: true }, "Paused — press Esc or ▶ Resume");
  const touchHost = h("div", { class: "match-touch" });
  const endBody = h("div", { class: "me-body" });
  const rematchBtn = h("button", { class: "btn btn-primary", type: "button" }, "↻ Rematch");
  const backBtn = h("button", { class: "btn", type: "button" }, "Back to setup");
  const endClose = h("button", { class: "btn", type: "button" }, "Close");
  const endCard = h("div", { class: "match-end", hidden: true, role: "dialog", "aria-label": "Match result" },
    h("div", { class: "me-card" }, endBody, h("div", { class: "me-actions" }, rematchBtn, backBtn, endClose)));
  const fieldEl = h("div", { class: "match-field" }, canvas2d, canvas3d, cdEl, banner, pausedEl, touchHost, endCard);
  const logList = { A: h("ol", { class: "log ml-log" }), B: h("ol", { class: "log ml-log" }) };
  const errBox = { A: h("div", { class: "ml-err", hidden: true, role: "alert" }), B: h("div", { class: "ml-err", hidden: true, role: "alert" }) };
  const logHead = { A: h("span", {}), B: h("span", {}) };
  const logPanel = (t: Team) => h("details", { class: "ml-panel", open: true, style: `--team:${TEAM_COLOR[t]}` },
    h("summary", {}, h("span", { class: "mt-badge", "aria-hidden": "true" }, t), " Steps · ", logHead[t]), errBox[t], logList[t]);
  const runEl = h("div", { class: "match-run", hidden: true }, scoreBar, fieldEl, h("div", { class: "match-logs" }, logPanel("A"), logPanel("B")));
  const frameHost = h("div", { class: "match-frames", "aria-hidden": "true" });
  const root = h("div", { class: "match", id: "matchScreen", role: "dialog", "aria-modal": "true", "aria-labelledby": "matchTitle", hidden: true },
    bar, setupEl, runEl, frameHost);
  document.body.append(root);

  // ------------------------------------------------------------ setup state
  const all = games();
  for (const g of all) gameSel.append(h("option", { value: g.id }, g.name));
  let file: SetupChoice["file"] = null;
  let fileWarnings: string[] = [];
  let lastFocus: HTMLElement | null = null;
  let isOpen = false;

  const currentGame = () => all.find((g) => g.id === gameSel.value) ?? all[0] ?? null;
  const choice = (): SetupChoice => ({
    game: currentGame(), autonomousSeconds: Number(autoIn.value), driverSeconds: Number(drvIn.value),
    inputA: inA.value as PlayerInput, inputB: inB.value as PlayerInput, opponent: oppSel.value as OpponentChoice,
    file, programA: safeProgram(),
  });
  function safeProgram(): string { try { return host.programSource(); } catch { return ""; } }

  const previewR = createRenderer(preview);
  function drawPreview(): void {
    const g = currentGame();
    if (!g) return;
    try {
      const s = makeMatchSim(g, { A: host.robotConfig(), B: opponentRobotNow() });
      previewR.resize();
      previewR.draw(g.world, s.robots.A.state, {
        showPath: false, showSensors: false, showZones: true, mainRobotColor: TEAM_COLOR.A,
        extraRobots: [{ state: s.robots.B.state, color: TEAM_COLOR.B, label: "B" }],
      });
    } catch (e) { console.error(e); }
  }
  function opponentRobotNow(): RobotConfig {
    const src = oppSel.value === "file" ? file : null;
    const o = oppSel.value === "mirror" ? { kind: "mirror" as const } : src ?? { kind: "none" as const };
    return opponentRobot(o, host.robotConfig());
  }
  const robotLine = (c: RobotConfig) => isDefaultConfig(c) ? "Standard robot" : configSummary(c);

  function renderTeamA(): void {
    const prog = safeProgram();
    const name = cleanName(host.projectName());
    aBody.replaceChildren(
      h("p", { class: "ms-prog" }, h("span", { class: "label" }, "Program"), h("b", {}, name), h("span", { class: "muted" }, " (this project)")),
      h("p", { class: "ms-robot" }, h("span", { class: "label" }, "Robot"), robotLine(host.robotConfig())),
    );
    if (!usesCompetition(prog)) {
      const tBtn = h("button", { class: "btn btn-sm", type: "button" }, "Start a new project from the template");
      tBtn.addEventListener("click", async () => {
        const did = await host.newProjectFromTemplate(MATCH_TEMPLATE);
        if (did) { renderTeamA(); drawPreview(); refreshErrors(); }
      });
      aBody.append(h("div", { class: "ms-warn" },
        h("p", {}, h("b", {}, "Your program needs competition(autonomous, driver_control). "),
          "Without it, your start(main) program just runs for the whole match, and the switch to driver control doesn't change anything. Here's a template:"),
        h("pre", { class: "ms-tpl" }, MATCH_TEMPLATE.split("\n").filter((l) => !l.startsWith("#")).join("\n").trim()),
        tBtn));
    }
  }
  function renderTeamB(): void {
    const opp = oppSel.value as OpponentChoice;
    fileRow.hidden = opp !== "file";
    if (opp !== "file") fileMsg.replaceChildren();
    const src = validateSetup(choice());
    const name = src.ok ? opponentName(src.setup.opponent, host.projectName()) : opp === "file" ? "—" : OPPONENT_LABEL[opp];
    bBody.replaceChildren(
      h("p", { class: "ms-prog" }, h("span", { class: "label" }, "Name"), h("b", {}, name)),
      h("p", { class: "ms-robot" }, h("span", { class: "label" }, "Robot"), robotLine(opponentRobotNow())));
    inB.disabled = opp === "none";
  }
  function refreshErrors(): void {
    const v = validateSetup(choice());
    errs.replaceChildren(...(v.ok ? [] : v.errors.map((e) => h("p", {}, e))));
    startBtn.disabled = !v.ok || !all.length;
    mapA.innerHTML = keyMapHtml(inA.value as PlayerInput);
    mapB.innerHTML = oppSel.value === "none" ? "" : keyMapHtml(inB.value as PlayerInput);
  }
  function onGame(): void {
    const g = currentGame();
    if (!g) { setText(rules, "No games are available."); return; }
    setText(rules, g.description);
    autoIn.value = String(g.autonomousSeconds);
    drvIn.value = String(g.driverSeconds);
    drawPreview();
    refreshErrors();
  }
  gameSel.addEventListener("change", onGame);
  for (const e of [autoIn, drvIn, inA, inB]) e.addEventListener("change", refreshErrors);
  oppSel.addEventListener("change", () => { renderTeamB(); refreshErrors(); drawPreview(); });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files?.[0];
    file = null; fileWarnings = [];
    if (f) {
      let text = "";
      try { text = await f.text(); } catch { /* unreadable */ }
      const r = loadOpponentFile(text, f.name, host.knownWorld);
      if (r.ok) {
        file = r.source; fileWarnings = r.warnings;
        fileMsg.replaceChildren(h("p", { class: "ms-ok" }, `Loaded ${r.source.name}.`), ...r.warnings.map((w) => h("p", { class: "ms-warn-line" }, w)));
      } else fileMsg.replaceChildren(h("p", { class: "ms-bad" }, r.error));
    } else fileMsg.replaceChildren();
    renderTeamB(); refreshErrors(); drawPreview();
  });
  new ResizeObserver(() => { if (isOpen && !setupEl.hidden) drawPreview(); }).observe(preview);

  // ------------------------------------------------------------ the match
  interface Running {
    setup: ValidSetup;
    sim: MatchSim;
    tl: Timeline;
    runners: Partial<Record<Team, IsolatedRunner>>;
    inputs: PlayerController[];
    names: TeamNames;
    extras: NonNullable<RenderOptions["extraRobots"]>;
    opts: RenderOptions;
    unsub: () => void;
    pending: Record<Team, { text: string; kind: string }[]>;
    counts: Record<Team, number>;
    done: boolean;
  }
  let m: Running | null = null;
  let renderer: Renderer = createRenderer(canvas2d);
  const r2d = renderer;
  let r3d: Renderer3D | null = null;
  let raf = 0;
  let last = 0;
  let scoreTimer = 0;
  let lastScoreKey = "";
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;

  function showBanner(text: string, ms = 2200, cls = ""): void {
    banner.className = "match-banner " + cls;
    setText(banner, text);
    banner.hidden = false;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
  }

  async function setupView(): Promise<void> {
    camSel.hidden = true;
    if (host.is3D()) {
      try {
        const mod = await import("../../render3d");
        if (mod.webglSupported() && !r3d) {
          canvas3d.hidden = false;
          r3d = mod.createRenderer3D(canvas3d, { quality: "high" });
          let cam: CameraMode = "orbit";
          try { const p = JSON.parse(localStorage.getItem("robot-lab-view-v1") || "{}") as { camera?: CameraMode; quality?: string }; if (CAMERAS.includes(p.camera as CameraMode)) cam = p.camera as CameraMode; if (p.quality === "low") r3d.setQuality("low"); } catch { /* defaults */ }
          r3d.setCamera(cam);
          camSel.value = cam;
        }
      } catch (e) { console.error(e); r3d = null; }
    }
    renderer = r3d ?? r2d;
    canvas2d.hidden = !!r3d;
    canvas3d.hidden = !r3d;
    camSel.hidden = !r3d;
    try { renderer.resize(); } catch { /* not laid out yet */ }
  }
  camSel.addEventListener("change", () => { const c = camSel.value as CameraMode; if (CAMERAS.includes(c)) r3d?.setCamera(c); });
  new ResizeObserver(() => { try { renderer.resize(); } catch { /* ignore */ } }).observe(fieldEl);

  function flushLogs(): void {
    if (!m) return;
    for (const t of ["A", "B"] as Team[]) {
      const p = m.pending[t];
      if (!p.length) continue;
      const frag = document.createDocumentFragment();
      for (const e of p.splice(0)) {
        frag.append(h("li", { class: e.kind }, e.text));
        m.counts[t]++;
      }
      logList[t].append(frag);
      while (logList[t].childElementCount > LOG_MAX) logList[t].firstElementChild?.remove();
      logList[t].scrollTop = logList[t].scrollHeight;
      setText(logHead[t], `${m.counts[t]} step${m.counts[t] === 1 ? "" : "s"}`);
    }
  }

  function updateScore(force = false): void {
    if (!m) return;
    let s = { A: 0, B: 0 };
    try { s = m.sim.score(); } catch (e) { console.error(e); }
    const key = s.A + "/" + s.B;
    if (!force && key === lastScoreKey) return;
    lastScoreKey = key;
    scoreEl.innerHTML = scoreboardHtml(m.names, s);
  }

  function updateClock(): void {
    if (!m) return;
    const tl = m.tl;
    setText(phaseEl, PHASE_TEXT[tl.phase]);
    phaseEl.dataset.phase = tl.phase;
    setText(clockEl, tl.phase === "countdown" ? formatClock(m.setup.autonomousSeconds || m.setup.driverSeconds) : formatClock(tl.remaining));
    clockEl.classList.toggle("warn", tl.phase === "driver" && tl.remaining <= 10);
    pauseBtn.textContent = tl.paused ? "▶ Resume" : "⏸ Pause";
    pausedEl.hidden = !tl.paused;
  }

  function frame(): void {
    raf = 0;
    if (!isOpen) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (m && !m.done) {
      try { m.tl.tick(dt); } catch (e) { console.error(e); }
      scoreTimer += dt;
      if (scoreTimer > 0.2) { scoreTimer = 0; updateScore(); }
      updateClock();
    }
    flushLogs();
    if (m) {
      m.extras[0].state = m.sim.robots.B.state;
      try { renderer.draw(m.setup.game.world, m.sim.robots.A.state as SimState, m.opts); } catch (e) { console.error(e); }
    }
    raf = requestAnimationFrame(frame);
  }

  function teamError(t: Team, html: string): void {
    errBox[t].innerHTML = html; // FriendlyError.html is built by the runtime with every value escaped
    errBox[t].hidden = false;
    const d = errBox[t].closest("details");
    if (d) (d as HTMLDetailsElement).open = true;
  }

  async function startMatch(setup: ValidSetup): Promise<void> {
    teardown();
    const robotA = host.robotConfig();
    const robotB = opponentRobot(setup.opponent, robotA);
    let sim: MatchSim;
    try { sim = makeMatchSim(setup.game, { A: robotA, B: robotB }); } catch (e) {
      console.error(e); toast("The match couldn't start. Try again.", 4000); return;
    }
    const programA = safeProgram();
    const sources: Record<Team, string> = {
      A: programA,
      B: setup.opponent.kind === "practice" ? practiceBot(setup.opponent.level)
        : setup.opponent.kind === "file" ? setup.opponent.python
          : setup.opponent.kind === "mirror" ? programA : "",
    };
    const names: TeamNames = { A: cleanName(host.projectName()), B: opponentName(setup.opponent, host.projectName()) };
    const inputs: PlayerController[] = [];
    const runners: Running["runners"] = {};
    const pending: Running["pending"] = { A: [], B: [] };
    // match: each runner loads its own Skulpt in a hidden frame, so wait for both before the countdown
    const make = async (t: Team, kind: PlayerInput): Promise<void> => {
      if (!sources[t].trim()) return;
      const input = createPlayerInput(kind, { touchHost });
      inputs.push(input);
      try {
        runners[t] = await makeRunner({
          controller: sim.robots[t].controller, input, frameHost,
          onLine: () => undefined,
          onLog: (e) => { if (pending[t].length < 400) pending[t].push({ text: (e.line ? `${e.line}: ` : "") + e.text, kind: e.kind }); },
        });
      } catch (e) { console.error(e); teamError(t, `<b>Team ${t}'s program couldn't start.</b>`); }
    };
    await Promise.all([make("A", setup.inputA), make("B", setup.inputB)]);

    const extras: Running["extras"] = [{ state: sim.robots.B.state, color: TEAM_COLOR.B, label: "B" }];
    const unsub = sim.onEvent((_t, e) => { soundForSimEvent(e); });
    const host2 = {
      stepSim: (d: number) => sim.step(d),
      setPhase: (p: Parameters<MatchSim["setPhase"]>[0]) => sim.setPhase(p),
      startRunners: () => {
        for (const t of ["A", "B"] as Team[]) {
          const r = runners[t];
          if (!r) continue;
          void r.run(sources[t]).then((res) => {
            if (!m || m.runners[t] !== r) return;
            if (res.status === "error") { playSound("error"); teamError(t, res.error.html); pending[t].push({ text: `Team ${t}'s program stopped with an error. The other team keeps going.`, kind: "warn" }); }
            else if (res.status === "finished" && !m.done) pending[t].push({ text: "Program finished.", kind: "event" });
          });
        }
      },
      nextPeriod: () => { for (const r of Object.values(runners)) try { r?.nextPeriod(); } catch (e) { console.error(e); } },
      stopRunners: () => { for (const r of Object.values(runners)) try { r?.stop(); } catch (e) { console.error(e); } try { sim.abort(); } catch { /* ignore */ } },
      pauseRunners: () => { for (const r of Object.values(runners)) try { r?.pause(); } catch (e) { console.error(e); } for (const i of inputs) i.release(); },
      resumeRunners: () => { for (const r of Object.values(runners)) try { r?.resume(); } catch (e) { console.error(e); } },
      onCountdown: (n: number) => {
        cdEl.hidden = false;
        cdEl.textContent = n > 0 ? String(n) : "GO!";
        cdEl.classList.toggle("go", n === 0);
        playSound(n > 0 ? "zone" : "start");
        if (n === 0) setTimeout(() => { cdEl.hidden = true; }, 600);
      },
      onPhase: (p: TimelinePhase) => {
        updateClock();
        if (p === "autonomous") showBanner(`AUTONOMOUS · ${formatClock(setup.autonomousSeconds)}`, 1800, "auto");
        else if (p === "driver") {
          playSound("step");
          let extra = "";
          try {
            const s = sim.score();
            if (s.autonomousWinner && setup.game.autonomousBonus > 0 && setup.autonomousSeconds > 0) {
              extra = s.autonomousWinner === "tie" ? ` · Autonomous tied: +${setup.game.autonomousBonus / 2} each`
                : ` · Autonomous bonus: Team ${s.autonomousWinner} +${setup.game.autonomousBonus}`;
            }
          } catch { /* ignore */ }
          showBanner(`DRIVER CONTROL · ${formatClock(setup.driverSeconds)}${extra}`, 2800, "driver");
          updateScore(true);
          focusField();
        } else if (p === "ended") finishMatch();
      },
      onWarning: (sec: number) => { playSound("zone"); if (sec === 10) showBanner("10 seconds left!", 1500, "warn"); },
    };
    const tl = createTimeline({ autonomousSeconds: setup.autonomousSeconds, driverSeconds: setup.driverSeconds }, host2);
    m = {
      setup, sim, tl, runners, inputs, names, extras, unsub, pending, counts: { A: 0, B: 0 }, done: false,
      opts: { showPath: false, showSensors: false, showZones: true, selectedId: null, extraRobots: extras, mainRobotColor: TEAM_COLOR.A },
    };
    // views
    for (const t of ["A", "B"] as Team[]) { logList[t].replaceChildren(); errBox[t].hidden = true; errBox[t].replaceChildren(); setText(logHead[t], runners[t] ? "0 steps" : "no program"); }
    setupEl.hidden = true;
    runEl.hidden = false;
    endCard.hidden = true;
    pauseBtn.hidden = false; stopBtn.hidden = false;
    lastScoreKey = "";
    updateScore(true);
    void setupView().then(() => {
      if (!m || m.tl !== tl) return;
      unlockAudio();
      tl.start();
      updateClock();
      focusField();
    });
  }

  function focusField(): void {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || a.tagName === "SELECT" || a.tagName === "INPUT" || a === startBtn || a === rematchBtn) fieldEl.focus({ preventScroll: true });
  }
  fieldEl.tabIndex = -1;

  function finishMatch(): void {
    if (!m || m.done) return;
    m.done = true;
    pauseBtn.hidden = true; stopBtn.hidden = true;
    for (const i of m.inputs) i.dispose();
    m.inputs.length = 0;
    flushLogs();
    let s;
    try { s = m.sim.score(); } catch (e) { console.error(e); s = { A: 0, B: 0, lines: [], autonomousWinner: null }; }
    scoreEl.innerHTML = scoreboardHtml(m.names, s);
    endBody.innerHTML = endSummaryHtml(m.names, s);
    endCard.hidden = false;
    updateClock();
    setText(clockEl, "0:00");
    playSound(winnerOf(s) === "tie" ? "step" : "success");
    rematchBtn.focus();
  }

  /** Stop and free everything about the current match (keeps the screen open). */
  function teardown(): void {
    if (!m) return;
    const cur = m;
    m = null;
    try { if (cur.tl.phase !== "ended" && cur.tl.phase !== "setup") cur.tl.stop(); } catch (e) { console.error(e); }
    for (const r of Object.values(cur.runners)) { try { r?.stop(); r?.dispose(); } catch (e) { console.error(e); } }
    for (const i of cur.inputs) i.dispose();
    try { cur.sim.abort(); } catch { /* ignore */ }
    cur.unsub();
    cdEl.hidden = true; banner.hidden = true; pausedEl.hidden = true;
  }

  function showSetup(): void {
    teardown();
    runEl.hidden = true;
    setupEl.hidden = false;
    pauseBtn.hidden = true; stopBtn.hidden = true; camSel.hidden = true;
    if (r3d) { try { r3d.dispose(); } catch { /* ignore */ } r3d = null; renderer = r2d; canvas3d.hidden = true; canvas2d.hidden = false; }
    renderTeamA(); renderTeamB(); refreshErrors();
    requestAnimationFrame(drawPreview);
  }

  startBtn.addEventListener("click", () => {
    const v = validateSetup(choice());
    if (!v.ok) { refreshErrors(); return; }
    unlockAudio();
    void startMatch(v.setup);
  });
  pauseBtn.addEventListener("click", () => togglePause());
  stopBtn.addEventListener("click", () => { if (m && !m.done) m.tl.stop(); });
  rematchBtn.addEventListener("click", () => { if (m) { const s = m.setup; void startMatch(s); } });
  backBtn.addEventListener("click", () => showSetup());
  endClose.addEventListener("click", () => screen.close());
  closeBtn.addEventListener("click", () => screen.close());

  function togglePause(): void {
    if (!m || m.done) return;
    if (m.tl.paused) { m.tl.resume(); focusField(); } else m.tl.pause();
    updateClock();
  }

  const onKey = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (isDialogOpen()) return; // a modal question is open
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (m && !m.done && m.tl.phase !== "setup") togglePause();
      else screen.close();
      return;
    }
    // Keep the app's own shortcuts (Ctrl+Enter = Run, Ctrl+S, F8, F10) from acting behind the overlay.
    if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "o" || e.key === "O")) { e.preventDefault(); e.stopPropagation(); }
    if (e.key === "F8" || e.key === "F10") { e.preventDefault(); e.stopPropagation(); }
  };

  const screen: MatchScreen = {
    get isOpen() { return isOpen; },
    open() {
      if (isOpen) return;
      isOpen = true;
      lastFocus = document.activeElement as HTMLElement | null;
      root.hidden = false;
      if (!all.length) setText(rules, "No games are available in this version.");
      if (!gameSel.value && all[0]) gameSel.value = all[0].id;
      onGame();
      showSetup();
      document.addEventListener("keydown", onKey, true);
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
      gameSel.focus();
    },
    close() {
      if (!isOpen) return;
      showSetup();
      isOpen = false;
      root.hidden = true;
      document.removeEventListener("keydown", onKey, true);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      void fileWarnings;
      host.onClose?.();
      lastFocus?.focus?.();
    },
    debug() {
      if (!m) return null;
      let score: { A: number; B: number } | null = null;
      try { const s = m.sim.score(); score = { A: s.A, B: s.B }; } catch { /* ignore */ }
      return { phase: m.tl.phase, remaining: m.tl.remaining, simTime: m.tl.simTime, score, paused: m.tl.paused };
    },
  };
  return screen;
}
