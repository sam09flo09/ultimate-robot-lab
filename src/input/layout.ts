/**
 * controller: the keyboard layout (docs/API.md "Keyboard layout") and the standard gamepad mapping.
 * Pure data + pure functions, so they can be tested without a DOM.
 */
import type { AxisName, ButtonName, ControllerState } from "../core/modules";
import { AXIS_NAMES, BUTTON_NAMES } from "../core/modules";

/** A keyboard axis: the key that pushes it to +100 and the one that pushes it to -100. */
export interface KeyAxis { axis: AxisName; plus: string; minus: string; }

/** KeyboardEvent.code values (layout-independent: the physical key, whatever the language). */
export const KEY_AXES: KeyAxis[] = [
  { axis: "axis3", plus: "KeyW", minus: "KeyS" },        // left stick up/down
  { axis: "axis4", plus: "KeyD", minus: "KeyA" },        // left stick right/left
  { axis: "axis2", plus: "ArrowUp", minus: "ArrowDown" },   // right stick up/down
  { axis: "axis1", plus: "ArrowRight", minus: "ArrowLeft" }, // right stick right/left
];

export const KEY_BUTTONS: Record<string, ButtonName> = {
  KeyI: "buttonX", KeyJ: "buttonY", KeyL: "buttonA", KeyK: "buttonB",
  KeyQ: "buttonL1", KeyZ: "buttonL2", KeyE: "buttonR1", KeyC: "buttonR2",
  KeyT: "buttonUp", KeyG: "buttonDown", KeyF: "buttonLeft", KeyH: "buttonRight",
};

const AXIS_KEYS = new Set(KEY_AXES.flatMap((a) => [a.plus, a.minus]));
/** True for every key the controller uses (these are the only keys whose default is prevented). */
export function isMappedKey(code: string): boolean {
  return AXIS_KEYS.has(code) || code in KEY_BUTTONS;
}

/** Rows for the on-screen keyboard table (help + Controller tab). */
export const KEY_TABLE: { control: string; keys: string }[] = [
  { control: "Left stick (axis3 up/down, axis4 left/right)", keys: "W / S, A / D" },
  { control: "Right stick (axis2 up/down, axis1 left/right)", keys: "↑ / ↓, ← / →" },
  { control: "Buttons X, Y, A, B", keys: "I, J, L, K" },
  { control: "L1 / L2, R1 / R2", keys: "Q / Z, E / C" },
  { control: "Up / Down / Left / Right buttons", keys: "T / G / F / H" },
];

/** Time for a held key to take its axis from 0 to full (seconds). */
export const KEY_RAMP_S = 0.12;
/** Gamepad stick deadband (fraction of full travel). */
export const DEADBAND = 0.08;

export function emptyState(): ControllerState {
  const axes = {} as Record<AxisName, number>;
  for (const a of AXIS_NAMES) axes[a] = 0;
  const buttons = {} as Record<ButtonName, boolean>;
  for (const b of BUTTON_NAMES) buttons[b] = false;
  return { axes, buttons };
}

export function clearState(s: ControllerState): void {
  for (const a of AXIS_NAMES) s.axes[a] = 0;
  for (const b of BUTTON_NAMES) s.buttons[b] = false;
}

/** -1..1 stick value → integer -100..100 with a deadband (rescaled so it starts at 0 at the edge). */
export function stickValue(v: number, deadband = DEADBAND): number {
  if (!Number.isFinite(v)) return 0;
  const m = Math.abs(v);
  if (m < deadband) return 0;
  const out = Math.min(1, (m - deadband) / (1 - deadband)) * 100;
  return Math.round(v < 0 ? -out : out);
}

/** Standard-mapping button index → controller button. 0..3 = bottom/right/left/top face buttons. */
export const PAD_BUTTONS: [number, ButtonName][] = [
  [0, "buttonA"], [1, "buttonB"], [2, "buttonX"], [3, "buttonY"],
  [4, "buttonL1"], [6, "buttonL2"], [5, "buttonR1"], [7, "buttonR2"],
  [12, "buttonUp"], [13, "buttonDown"], [14, "buttonLeft"], [15, "buttonRight"],
];

export interface PadLike {
  connected?: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** Reads one gamepad (standard mapping) INTO `out` (which should start cleared for this pad). */
export function readPad(p: PadLike, out: ControllerState): void {
  const ax = p.axes;
  out.axes.axis4 = stickValue(ax[0] ?? 0);
  out.axes.axis3 = -stickValue(ax[1] ?? 0) || 0;  // the Gamepad API has +y = down; up is + here
  out.axes.axis1 = stickValue(ax[2] ?? 0);
  out.axes.axis2 = -stickValue(ax[3] ?? 0) || 0;
  for (const [i, name] of PAD_BUTTONS) {
    const b = p.buttons[i];
    if (!b) continue;
    // triggers (6, 7) are analogue: count them past half-way; other buttons use `pressed`
    out.buttons[name] = i === 6 || i === 7 ? (Number.isFinite(b.value) ? b.value > 0.5 : !!b.pressed) : !!b.pressed;
  }
}

/** Merge `src` into `into`: the largest-magnitude axis wins, a button is pressed if pressed anywhere. */
export function mergeInto(into: ControllerState, src: ControllerState): void {
  for (const a of AXIS_NAMES) if (Math.abs(src.axes[a]) > Math.abs(into.axes[a])) into.axes[a] = src.axes[a];
  for (const b of BUTTON_NAMES) if (src.buttons[b]) into.buttons[b] = true;
}

/** Joystick knob math: pointer offset from the stick centre (CSS px, y down) → knob position
 *  (clamped to the ring) and axes (x right +, y up +), integers -100..100. */
export function knobToAxes(dx: number, dy: number, radius: number, deadband = 0.06): { x: number; y: number; kx: number; ky: number } {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0, kx: 0, ky: 0 };
  const d = Math.hypot(dx, dy);
  const k = d > radius ? radius / d : 1;
  const kx = dx * k, ky = dy * k;
  const nx = kx / radius, ny = ky / radius;
  const val = (n: number) => (Math.abs(n) < deadband ? 0 : Math.round(Math.max(-1, Math.min(1, n)) * 100));
  return { x: val(nx) || 0, y: val(-ny) || 0, kx, ky };
}
