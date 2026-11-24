/**
 * Test helpers (used only by *.test.ts): load the vendored Skulpt into the test global scope,
 * and a fake RobotController that records calls.
 */
import bundle from "../../public/vendor/skulpt.bundle.js?raw";
import stdlib from "../../public/vendor/skulpt-stdlib.js?raw";
import type { RobotController, ColorName } from "../core/types";
import type { RunnerOptions, ControllerInput, ControllerState } from "../core/modules";
import { AXIS_NAMES, BUTTON_NAMES } from "../core/modules";

export function loadSkulpt(): void {
  const g = globalThis as any;
  if (g.Sk) return;
  if (!g.window) g.window = g;
  (0, eval)(bundle);
  (0, eval)(stdlib);
}

export interface FakeState {
  calls: string[];
  pen: boolean;
  magnet: boolean;
  bumperAfter: number;   // bumperPressed() returns true after this many reads
  bumperReads: number;
  color: ColorName;
  /** when set, motion promises never resolve until resolvePending/rejectPending is called */
  hold: boolean;
  pending: { resolve: () => void; reject: (e: Error) => void }[];
  heading: number;
  timer: number;
}

export function fakeController(over: Partial<FakeState> = {}): { ctl: RobotController; st: FakeState } {
  const st: FakeState = {
    calls: [], pen: true, magnet: true, bumperAfter: Infinity, bumperReads: 0, color: "RED",
    hold: false, pending: [], heading: 0, timer: 1.5, ...over,
  };
  const later = (name: string): Promise<void> => {
    st.calls.push(name);
    return new Promise<void>((resolve, reject) => {
      if (st.hold) st.pending.push({ resolve, reject });
      else setTimeout(resolve, 0);
    });
  };
  const rec = (name: string) => { st.calls.push(name); };
  const ctl: RobotController = {
    driveFor: (d, mm) => later(`driveFor(${d},${mm})`),
    turnFor: (d, deg) => later(`turnFor(${d},${deg})`),
    turnToHeading: (deg) => later(`turnToHeading(${deg})`),
    drive: (d) => rec(`drive(${d})`),
    turn: (d) => rec(`turn(${d})`),
    stop: () => rec("stop()"),
    setDriveVelocity: (p) => rec(`setDriveVelocity(${p})`),
    setTurnVelocity: (p) => rec(`setTurnVelocity(${p})`),
    setHeading: (deg) => rec(`setHeading(${deg})`),
    heading: () => st.heading,
    rotation: () => 450.123,
    isDone: () => true,
    wait: (s) => later(`wait(${s})`),
    distanceMM: () => 254,
    distanceFound: () => true,
    frontColor: () => st.color,
    frontNear: () => false,
    frontBrightness: () => 42.4,
    downColor: () => "BLACK",
    downBrightness: () => 7,
    bumperPressed: () => { st.bumperReads++; return st.bumperReads > st.bumperAfter; },
    positionX: () => -900,
    positionY: () => 127,
    timer: () => st.timer,
    resetTimer: () => rec("resetTimer()"),
    penDown: (down) => { rec(`penDown(${down})`); return st.pen; },
    setPenColor: (c) => { rec(`setPenColor(${c})`); return st.pen; },
    magnet: (on) => { rec(`magnet(${on})`); return st.magnet; },
    setWheelVelocities: (l, r) => { rec(`wheels(${l},${r})`); },
    armAvailable: () => false,
    armSpinTo: () => Promise.resolve(),
    armSpin: () => undefined,
    setArmVelocity: () => undefined,
    armAngle: () => 0,
    claw: () => Promise.resolve(),
    clawHolding: () => false,

  };
  return { ctl, st };
}

export interface Recorded {
  lines: number[];
  logs: { line: number; text: string; kind: string }[];
  screen: unknown[];
}

export function recorder(ctl: RobotController): { opts: RunnerOptions; rec: Recorded } {
  const rec: Recorded = { lines: [], logs: [], screen: [] };
  return {
    rec,
    opts: {
      controller: ctl,
      onLine: (l) => rec.lines.push(l),
      onLog: (e) => rec.logs.push(e),
      onScreen: (op) => rec.screen.push(op),
    },
  };
}

/** A controller input whose state tests change between waits (driver-control programs). */
export function fakeInput(): { input: ControllerInput; state: ControllerState; reads: () => number } {
  const state: ControllerState = {
    axes: Object.fromEntries(AXIS_NAMES.map((a) => [a, 0])) as ControllerState["axes"],
    buttons: Object.fromEntries(BUTTON_NAMES.map((b) => [b, false])) as ControllerState["buttons"],
  };
  let n = 0;
  return { state, input: { read: () => { n++; return state; } }, reads: () => n };
}
