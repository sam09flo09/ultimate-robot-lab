/**
 * Race UI for the app shell: the race clock overlaid on the field, the 3-2-1-GO countdown,
 * lock-step stepping during a race run, and the race panel in the Challenge tab.
 * The app calls into this from a few clearly marked `race` spots in src/ui/app.ts.
 */
import type { RobotController, Sim, World } from "../core/types";
import { h, ask, setText, esc } from "../ui/dom";
import { createRaceTracker, formatRaceTime, getRace, medalFor, MEDAL_TEXT, type Medal, type RaceInfo, type RaceTracker } from "./race";
import { createLockstep, trackController, type Lockstep, type TrackedController } from "./lockstep";
import { SUBSTEP } from "../sim";
import { loadRecord, raceKey, recordRun, resetBest, type RaceRecord } from "./storage";

export interface RaceOutcome {
  finished: boolean;
  time: number | null;
  medal: Medal | null;
  newBest: boolean;
  previousBest: number | null;
  par: number | null;
}

export interface RaceUi {
  /** True when the current world is a race. */
  readonly active: boolean;
  /** True from "GO" until the run ends. */
  readonly racing: boolean;
  setWorld(world: World, worldId: string): void;
  /** Wrap the runner's controller (call when building the sim for a race world). */
  wrap(c: RobotController): RobotController;
  /** 3-2-1-GO. Resolves true at GO (immediately when skip), false if cancelled. Sim time does not move. */
  countdown(skip?: boolean): Promise<boolean>;
  cancelCountdown(): void;
  /** The program is about to start (robot already reset). `onFinish` is called once when the race is won. */
  begin(sim: Sim, onFinish: () => void): void;
  /** Frame loop: add realDt * speed of sim time (run in lock-step). */
  advance(dt: number): void;
  /** The program ended (any way). Records the result. Returns the outcome, or null when no race run was going. */
  end(): RaceOutcome | null;
  /** Robot reset (not running): clock back to zero. */
  reset(): void;
  /** Per frame: refresh the clock. */
  tick(): void;
  /** Race section for the Challenge tab (null when not a race). */
  panel(onChange: () => void): HTMLElement | null;
  outcomeHtml(o: RaceOutcome): string;
}

const COUNT_STEPS: [string, number][] = [["3", 400], ["2", 400], ["1", 400], ["GO!", 300]];

export function createRaceUi(fieldBox: HTMLElement): RaceUi {
  let world: World | null = null;
  let info: RaceInfo | null = null;
  let key = "";
  let sim: Sim | null = null;
  let tracked: TrackedController | null = null;
  let tracker: RaceTracker | null = null;
  let lock: Lockstep | null = null;
  let racing = false;
  let programDone = true;
  let finishCb: (() => void) | null = null;
  let last: RaceOutcome | null = null;
  let record: RaceRecord = { best: null, runs: [] };

  // ---- HUD (on the field, above both canvases)
  const clock = h("div", { class: "race-clock", "aria-hidden": "true" }, "00:00.00");
  const sub = h("div", { class: "race-sub" });
  const result = h("div", { class: "race-result", role: "status", "aria-live": "polite" });
  const hud = h("div", { class: "race-hud", id: "raceHud", hidden: true }, h("div", { class: "race-k" }, "Race time"), clock, sub, result);
  const cdText = h("div", { class: "race-cd-n" });
  const cd = h("div", { class: "race-countdown", hidden: true, title: "Click or press a key to skip" }, cdText, h("div", { class: "race-cd-skip" }, "click to skip"));
  fieldBox.append(hud, cd);

  let cdCancel: ((go: boolean) => void) | null = null;

  function subText(): void {
    const parts: string[] = [];
    parts.push(`Best ${record.best !== null ? formatRaceTime(record.best) : "--:--.--"}`);
    if (info?.par) parts.push(`Par ${formatRaceTime(info.par)}`);
    if (info && info.laps > 1) parts.push(`Lap ${Math.min(info.laps, (tracker?.lap ?? 0) + 1)}/${info.laps}`);
    setText(sub, parts.join(" · "));
  }

  function showResult(o: RaceOutcome | null): void {
    result.className = "race-result";
    result.replaceChildren();
    if (!o) return;
    if (!o.finished) { result.classList.add("dnf"); result.append("Did not finish"); return; }
    if (o.medal) result.append(h("span", { class: `race-medal ${o.medal}` }, MEDAL_TEXT[o.medal]));
    if (o.newBest) result.append(h("span", { class: "race-new" }, "New best!"));
    if (!o.medal && !o.newBest) result.append("Finished");
  }

  const ui: RaceUi = {
    get active() { return info !== null; },
    get racing() { return racing; },

    setWorld(w, worldId) {
      ui.cancelCountdown();
      lock?.cancel();
      racing = false; last = null;
      world = w;
      info = getRace(w);
      hud.hidden = !info;
      if (!info) return;
      key = raceKey(w, worldId);
      record = loadRecord(key);
      setText(clock, formatRaceTime(0));
      clock.classList.remove("done");
      showResult(null);
      subText();
    },

    wrap(c) {
      tracked = trackController(c);
      return tracked.controller;
    },

    countdown(skip = false) {
      if (skip || !info) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let i = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (go: boolean) => {
          if (timer) clearTimeout(timer);
          document.removeEventListener("keydown", onKey, true);
          cd.removeEventListener("pointerdown", onSkip);
          cd.hidden = true;
          cdCancel = null;
          resolve(go);
        };
        const onSkip = (e: Event) => { e.preventDefault(); done(true); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") return; e.preventDefault(); e.stopPropagation(); done(true); };
        const next = () => {
          if (i >= COUNT_STEPS.length) { done(true); return; }
          const [t, ms] = COUNT_STEPS[i++];
          cdText.textContent = t;
          cdText.classList.toggle("go", t === "GO!");
          cdText.style.animation = "none"; void cdText.offsetWidth; cdText.style.animation = "";
          timer = setTimeout(next, ms);
        };
        cdCancel = done;
        cd.hidden = false;
        document.addEventListener("keydown", onKey, true);
        cd.addEventListener("pointerdown", onSkip);
        showResult(null);
        next();
      });
    },

    cancelCountdown() { cdCancel?.(false); },

    begin(s, onFinish) {
      if (!info || !world) return;
      sim = s;
      tracker = createRaceTracker(world, info);
      tracker.reset(s.state);
      finishCb = onFinish;
      racing = true; programDone = false; last = null;
      clock.classList.remove("done");
      showResult(null);
      lock?.cancel();
      const t = tracked;
      lock = createLockstep({
        step: () => {
          if (!sim || !tracker) return;
          sim.step(SUBSTEP);
          if (tracker.update(sim.state)) { lock?.cancel(); const cb = finishCb; finishCb = null; cb?.(); }
        },
        canAdvance: () => programDone || (t ? t.pending() > 0 : true) || !(sim?.controller.isDone() ?? true),
      });
      subText();
    },

    advance(dt) {
      if (racing && lock && !tracker?.finished) lock.advance(dt);
    },

    end() {
      programDone = true;
      lock?.cancel();
      if (!racing || !info || !tracker) return null;
      racing = false;
      const time = tracker.finishTime;
      let o: RaceOutcome;
      if (time === null) {
        o = { finished: false, time: null, medal: null, newBest: false, previousBest: record.best, par: info.par };
      } else {
        const r = recordRun(key, time);
        record = r.record;
        o = { finished: true, time, medal: medalFor(time, info.par), newBest: r.newBest, previousBest: r.previousBest, par: info.par };
      }
      last = o;
      clock.classList.toggle("done", o.finished);
      if (time !== null) setText(clock, formatRaceTime(time));
      showResult(o);
      subText();
      return o;
    },

    reset() {
      if (!info || racing) return;
      last = null;
      tracker = null;
      setText(clock, formatRaceTime(0));
      clock.classList.remove("done");
      showResult(null);
      subText();
    },

    tick() {
      if (!info) return;
      if (racing && sim && tracker) {
        setText(clock, formatRaceTime(tracker.finishTime ?? sim.state.time));
        subText();
      }
    },

    panel(onChange) {
      if (!info || !world) return null;
      const zl = (id: string) => world!.zones.find((z) => z.id === id)?.label || id;
      const box = h("section", { class: "race-panel", "aria-label": "Race" });
      box.append(h("h4", {}, info.laps > 1 ? `Race · ${info.laps} laps` : "Race"));
      const route = info.checkpoints.length ? `${info.checkpoints.map(zl).join(" → ")} → ${zl(info.finishZone)}` : zl(info.finishZone);
      box.append(h("p", { class: "race-route" }, `Route: ${route}`));
      if (info.par) {
        box.append(h("p", { class: "race-par" },
          h("span", { class: "race-medal gold" }, "Gold"), ` ≤ ${formatRaceTime(info.par)}  `,
          h("span", { class: "race-medal silver" }, "Silver"), ` ≤ ${formatRaceTime(info.par * 1.25)}  `,
          h("span", { class: "race-medal bronze" }, "Bronze"), " slower"));
      }
      box.append(h("ul", { class: "race-rules", "aria-label": "Fair-play rules" },
        h("li", {}, "Time starts when your program starts, and is robot time — the Speed buttons don't change it."),
        h("li", {}, "The robot always goes back to the start before a race run (Reset before run is on)."),
        info.checkpoints.length ? h("li", {}, "Pass every checkpoint in order, then cross the finish.") : null));
      box.append(h("p", { class: "race-best" }, "Best: ", h("b", {}, record.best !== null ? formatRaceTime(record.best) : "no time yet"),
        record.best !== null && medalFor(record.best, info.par) ? h("span", { class: `race-medal ${medalFor(record.best, info.par)}` }, MEDAL_TEXT[medalFor(record.best, info.par)!]) : null));
      if (record.runs.length) {
        const tb = h("table", { class: "race-hist" }, h("caption", {}, `Last ${record.runs.length} finished run${record.runs.length > 1 ? "s" : ""}`));
        for (const r of record.runs.slice().reverse()) {
          const m = medalFor(r.t, info.par);
          const d = new Date(r.at);
          tb.append(h("tr", {}, h("td", {}, formatRaceTime(r.t)), h("td", {}, m ? MEDAL_TEXT[m] : ""),
            h("td", { class: "muted" }, `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)));
        }
        box.append(tb);
      }
      if (last && !last.finished) box.append(h("p", { class: "race-dnf" }, "Last run: did not finish."));
      box.append(h("button", {
        class: "btn btn-sm", type: "button",
        onclick: async () => {
          const c = await ask("Reset best times", "<p>Forget the best time and run history saved in this browser?</p>",
            [{ id: "cancel", label: "Cancel" }, { id: "all", label: "All races" }, { id: "this", label: "This race", kind: "danger" }]);
          if (c === "cancel" || !c) return;
          resetBest(c === "all" ? undefined : key);
          record = loadRecord(key);
          subText();
          onChange();
        },
      }, "Reset best times"));
      return box;
    },

    outcomeHtml(o) {
      if (!o.finished || o.time === null) return "<b>Did not finish.</b> The program ended before the robot crossed the finish.";
      let s = `<b>Finished in ${formatRaceTime(o.time)}</b> (robot time).`;
      if (o.medal) s += ` ${MEDAL_TEXT[o.medal]} medal${o.par ? ` — par ${formatRaceTime(o.par)}` : ""}.`;
      if (o.newBest) s += o.previousBest !== null ? ` <b>New best!</b> (was ${formatRaceTime(o.previousBest)})` : " <b>New best!</b>";
      else if (o.previousBest !== null) s += ` Best is still ${esc(formatRaceTime(o.previousBest))}.`;
      return s;
    },
  };
  return ui;
}
