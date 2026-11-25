/**
 * match: per-player controllers for two-robot matches on ONE Chromebook.
 * Each player gets their own ControllerInput: the left or right half of the keyboard, the first or
 * second connected gamepad, the on-screen controller, or nothing (program-only).
 *
 * The two keyboard halves share no keys (tested), and none of them is an app shortcut
 * (Ctrl/⌘ combinations, Esc, F8, F10 are left alone).
 */
import type { ButtonName, ControllerInput, ControllerState } from "../core/modules";
import { AXIS_NAMES } from "../core/modules";
import type { PlayerInput } from "../core/match";
import { KEY_RAMP_S, clearState, emptyState, readPad, type KeyAxis, type PadLike } from "./layout";
import { createTouchPad, type TouchPad } from "./touch";
import { isTypingTarget } from "./typing";

export interface KeyHalf {
  axes: KeyAxis[];
  buttons: Record<string, ButtonName>;
  /** Rows for the setup screen's key map. */
  table: { control: string; keys: string }[];
}

/** Left hand: W/S, A/D (left stick) and R/F, Q/E (right stick), so tank and arcade both work. */
export const KEYS_LEFT: KeyHalf = {
  axes: [
    { axis: "axis3", plus: "KeyW", minus: "KeyS" },
    { axis: "axis4", plus: "KeyD", minus: "KeyA" },
    { axis: "axis2", plus: "KeyR", minus: "KeyF" },
    { axis: "axis1", plus: "KeyE", minus: "KeyQ" },
  ],
  buttons: {
    KeyZ: "buttonA", KeyX: "buttonB", KeyC: "buttonX", KeyV: "buttonY",
    Digit1: "buttonL1", Digit2: "buttonL2", Digit3: "buttonR1", Digit4: "buttonR2",
  },
  table: [
    { control: "Left stick ↕ (axis3)", keys: "W / S" },
    { control: "Left stick ↔ (axis4)", keys: "A / D" },
    { control: "Right stick ↕ (axis2)", keys: "R / F" },
    { control: "Right stick ↔ (axis1)", keys: "Q / E" },
    { control: "Buttons A B X Y", keys: "Z X C V" },
    { control: "L1 L2 R1 R2", keys: "1 2 3 4" },
  ],
};

/** Right hand: the arrows (right stick) and I/K, J/L (left stick). */
export const KEYS_RIGHT: KeyHalf = {
  axes: [
    { axis: "axis2", plus: "ArrowUp", minus: "ArrowDown" },
    { axis: "axis1", plus: "ArrowRight", minus: "ArrowLeft" },
    { axis: "axis3", plus: "KeyI", minus: "KeyK" },
    { axis: "axis4", plus: "KeyL", minus: "KeyJ" },
  ],
  buttons: {
    KeyN: "buttonA", KeyM: "buttonB", Comma: "buttonX", Period: "buttonY",
    Digit7: "buttonL1", Digit8: "buttonL2", Digit9: "buttonR1", Digit0: "buttonR2",
  },
  table: [
    { control: "Left stick ↕ (axis3)", keys: "I / K" },
    { control: "Left stick ↔ (axis4)", keys: "J / L" },
    { control: "Right stick ↕ (axis2)", keys: "↑ / ↓" },
    { control: "Right stick ↔ (axis1)", keys: "← / →" },
    { control: "Buttons A B X Y", keys: "N M , ." },
    { control: "L1 L2 R1 R2", keys: "7 8 9 0" },
  ],
};

/** Every KeyboardEvent.code a half uses. */
export function halfKeys(h: KeyHalf): string[] {
  return h.axes.flatMap((a) => [a.plus, a.minus]).concat(Object.keys(h.buttons));
}

export const PLAYER_INPUT_LABEL: Record<PlayerInput, string> = {
  "keyboard-left": "Keyboard (left hand)",
  "keyboard-right": "Keyboard (right hand)",
  "gamepad-1": "Gamepad 1",
  "gamepad-2": "Gamepad 2",
  touch: "On-screen controller",
  "program-only": "No driver (program only)",
};

export interface PlayerInputOptions {
  keyTarget?: Window | HTMLElement;
  /** Where the on-screen controller goes ("touch"). Default document.body. */
  touchHost?: HTMLElement;
  now?: () => number;
  getGamepads?: () => readonly (PadLike | null)[];
}

export type PlayerController = ControllerInput & {
  dispose(): void;
  readonly kind: PlayerInput;
  /** "touch" only: the on-screen controller element (null otherwise). */
  readonly touchEl: HTMLElement | null;
  /** Let go of everything (pause, window blur). */
  release(): void;
};

/** The n-th (0-based) CONNECTED gamepad, skipping empty slots. */
export function nthPad(pads: readonly (PadLike | null)[], n: number): PadLike | null {
  let k = 0;
  for (const p of pads) {
    if (!p || p.connected === false) continue;
    if (k === n) return p;
    k++;
  }
  return null;
}

export function createPlayerInput(kind: PlayerInput, opts: PlayerInputOptions = {}): PlayerController {
  const out = emptyState();
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const getPads = opts.getGamepads ?? (() => {
    try { return (nav?.getGamepads?.() ?? []) as readonly (PadLike | null)[]; } catch { return []; }
  });
  const cleanups: (() => void)[] = [];
  let read: () => ControllerState = () => out;
  let release = () => { /* nothing held */ };
  let touch: TouchPad | null = null;

  if (kind === "keyboard-left" || kind === "keyboard-right") {
    const half = kind === "keyboard-left" ? KEYS_LEFT : KEYS_RIGHT;
    const mapped = new Set(halfKeys(half));
    const held = new Set<string>();
    const ramp: Record<string, number> = { axis1: 0, axis2: 0, axis3: 0, axis4: 0 };
    let lastRamp = now();
    const updateRamp = () => {
      const t = now();
      const dt = Math.max(0, (t - lastRamp) / 1000);
      lastRamp = t;
      const step = (100 / KEY_RAMP_S) * dt;
      for (const k of half.axes) {
        const target = (held.has(k.plus) ? 100 : 0) - (held.has(k.minus) ? 100 : 0);
        const cur = ramp[k.axis];
        ramp[k.axis] = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
      }
    };
    const target = (opts.keyTarget ?? window) as EventTarget;
    const onDown = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (!mapped.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target) || isTypingTarget(typeof document !== "undefined" ? document.activeElement : null)) return;
      e.preventDefault();
      if (!held.has(e.code)) { updateRamp(); held.add(e.code); }
    };
    const onUp = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (!held.has(e.code)) return;
      updateRamp();
      held.delete(e.code);
      e.preventDefault();
    };
    release = () => { held.clear(); for (const a of AXIS_NAMES) ramp[a] = 0; };
    const onVis = () => { if (typeof document !== "undefined" && document.hidden) release(); };
    target.addEventListener("keydown", onDown, true);
    target.addEventListener("keyup", onUp, true);
    if (typeof window !== "undefined") window.addEventListener("blur", release);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    cleanups.push(() => {
      target.removeEventListener("keydown", onDown, true);
      target.removeEventListener("keyup", onUp, true);
      if (typeof window !== "undefined") window.removeEventListener("blur", release);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    });
    read = () => {
      updateRamp();
      for (const a of AXIS_NAMES) out.axes[a] = Math.round(ramp[a]) || 0;
      for (const b in out.buttons) out.buttons[b as ButtonName] = false;
      for (const code of held) { const b = half.buttons[code]; if (b) out.buttons[b] = true; }
      return out;
    };
  } else if (kind === "gamepad-1" || kind === "gamepad-2") {
    const index = kind === "gamepad-1" ? 0 : 1;
    read = () => {
      clearState(out);
      const p = nthPad(getPads(), index);
      if (p) readPad(p, out);
      return out;
    };
  } else if (kind === "touch") {
    touch = createTouchPad(opts.touchHost ?? document.body);
    touch.show(true);
    const t = touch;
    release = () => t.release();
    read = () => t.state;
    cleanups.push(() => t.dispose());
  }
  // "program-only": always all zeros

  return {
    kind,
    get touchEl() { return touch ? touch.el : null; },
    read: () => read(),
    release: () => release(),
    dispose() { release(); for (const c of cleanups.splice(0)) c(); clearState(out); read = () => out; },
  };
}
