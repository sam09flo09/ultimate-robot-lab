/**
 * match: the match clock as a pure state machine (no DOM, no timers), so it can be tested exactly.
 *
 *   setup → countdown (3-2-1, real time, no sim time) → autonomous → driver → ended
 *
 * The screen calls tick(realDt) every frame. The timeline steps the sim through the host in pieces
 * that never cross a period boundary, so the switch to driver control and the end of the match happen
 * at exactly the right SIM time, whatever the frame rate. Pause freezes everything (no sim steps).
 */
import type { MatchPhase } from "../../core/match";

export type TimelinePhase = "setup" | "countdown" | "autonomous" | "driver" | "ended";

export interface TimelineHost {
  /** Advance the match sim by dt seconds (≤ the dt given to tick). */
  stepSim(dt: number): void;
  setPhase(p: MatchPhase): void;
  /** Start both programs (at GO). */
  startRunners(): void;
  /** End autonomous() and start driver_control() on both runners. */
  nextPeriod(): void;
  stopRunners(): void;
  pauseRunners(): void;
  resumeRunners(): void;
  /** UI cues (optional). */
  onCountdown?(n: number): void;            // 3, 2, 1, then 0 = GO
  onPhase?(p: TimelinePhase): void;
  onWarning?(secondsLeft: number): void;    // 10, 9, ... 1 in the last 10 s of driver control
}

export interface TimelineOptions {
  autonomousSeconds: number;   // 0..30
  driverSeconds: number;       // 30..180
  countdownSeconds?: number;   // default 3
}

export const AUTO_RANGE: [number, number] = [0, 30];
export const DRIVER_RANGE: [number, number] = [30, 180];
export const WARNING_SECONDS = 10;

export function clampPeriod(v: unknown, range: [number, number], fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return Math.min(range[1], Math.max(range[0], fallback));
  return Math.min(range[1], Math.max(range[0], Math.round(n)));
}

export interface Timeline {
  readonly phase: TimelinePhase;
  readonly paused: boolean;
  /** Seconds left in the current period (countdown: real seconds left before GO). */
  readonly remaining: number;
  /** Sim seconds since GO. */
  readonly simTime: number;
  /** 3, 2, 1 during the countdown; 0 otherwise. */
  readonly count: number;
  start(): void;
  tick(realDt: number): void;
  pause(): void;
  resume(): void;
  /** End now (Stop button). */
  stop(): void;
  /** Back to setup (no host calls). */
  reset(): void;
}

/** "1:05", "0:09" — the clock shows whole seconds, rounded up (like a game clock). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function createTimeline(opts: TimelineOptions, host: TimelineHost): Timeline {
  const auto = clampPeriod(opts.autonomousSeconds, AUTO_RANGE, 15);
  const driver = clampPeriod(opts.driverSeconds, DRIVER_RANGE, 60);
  const cdLen = opts.countdownSeconds ?? 3;
  let phase: TimelinePhase = "setup";
  let paused = false;
  let cdLeft = 0;          // real seconds of countdown left
  let simTime = 0;
  let lastWarn = Infinity;

  const go = (p: TimelinePhase) => { phase = p; host.onPhase?.(p); };

  function enterAutonomous(): void {
    host.setPhase("autonomous");
    host.startRunners();
    go("autonomous");
    if (auto <= 0) enterDriver();
  }
  function enterDriver(): void {
    host.setPhase("driver");
    host.nextPeriod();
    go("driver");
  }
  function end(): void {
    if (phase === "ended" || phase === "setup") return;
    const wasPaused = paused;
    paused = false;
    if (phase !== "countdown") {
      if (wasPaused) host.resumeRunners();
      host.stopRunners();
      host.setPhase("ended");
    }
    go("ended");
  }

  const t: Timeline = {
    get phase() { return phase; },
    get paused() { return paused; },
    get simTime() { return simTime; },
    get count() { return phase === "countdown" ? Math.max(1, Math.ceil(cdLeft - 1e-9)) : 0; },
    get remaining() {
      if (phase === "countdown") return cdLeft;
      if (phase === "autonomous") return Math.max(0, auto - simTime);
      if (phase === "driver") return Math.max(0, auto + driver - simTime);
      return 0;
    },
    start() {
      if (phase !== "setup") return;
      simTime = 0; paused = false; lastWarn = Infinity;
      if (cdLen > 0) {
        cdLeft = cdLen;
        go("countdown");
        host.onCountdown?.(Math.ceil(cdLeft));
      } else {
        host.onCountdown?.(0);
        enterAutonomous();
      }
    },
    tick(dt) {
      if (paused || !(dt > 0) || !Number.isFinite(dt)) return;
      if (phase === "countdown") {
        const before = Math.ceil(cdLeft - 1e-9);
        cdLeft -= dt;
        if (cdLeft <= 1e-9) {
          cdLeft = 0;
          host.onCountdown?.(0);
          enterAutonomous();
          return;                        // the countdown's spare time is not sim time
        }
        const now = Math.ceil(cdLeft - 1e-9);
        if (now !== before) host.onCountdown?.(now);
        return;
      }
      let left = dt;
      while (left > 1e-12 && (phase === "autonomous" || phase === "driver")) {
        const boundary = phase === "autonomous" ? auto : auto + driver;
        const room = boundary - simTime;
        const d = Math.min(left, Math.max(0, room));
        if (d > 0) { host.stepSim(d); simTime += d; left -= d; }
        if (simTime >= boundary - 1e-9) {
          simTime = boundary;
          if (phase === "autonomous") enterDriver();
          else { end(); break; }
        }
        if (phase === "driver") {
          const rem = auto + driver - simTime;
          const sec = Math.ceil(rem - 1e-9);
          if (sec <= WARNING_SECONDS && sec >= 1 && sec < lastWarn) { lastWarn = sec; host.onWarning?.(sec); }
        }
      }
    },
    pause() {
      if (paused || (phase !== "autonomous" && phase !== "driver" && phase !== "countdown")) return;
      paused = true;
      if (phase !== "countdown") host.pauseRunners();
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (phase !== "countdown") host.resumeRunners();
    },
    stop() { end(); },
    reset() { phase = "setup"; paused = false; simTime = 0; cdLeft = 0; lastWarn = Infinity; },
  };
  return t;
}
