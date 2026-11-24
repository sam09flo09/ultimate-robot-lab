/**
 * controller: the input hub for driver control (src/input).
 * Merges keyboard + Gamepad API + the on-screen touch controller into one ControllerInput.
 * See docs/API.md "Driver control" for the layout; core/modules.ts for the contract.
 */
import type { ControllerState, InputHub, InputHubOptions, InputSourceKind } from "../core/modules";
import { AXIS_NAMES } from "../core/modules";
import {
  KEY_AXES, KEY_BUTTONS, KEY_RAMP_S, isMappedKey, emptyState, clearState, readPad, mergeInto, type PadLike,
} from "./layout";
import { createTouchPad } from "./touch";

export { KEY_TABLE, knobToAxes, stickValue, isMappedKey } from "./layout";

/** Extra options (tests inject a clock and a fake gamepad list). */
export interface InputHubExtras {
  now?: () => number;                                   // ms
  getGamepads?: () => readonly (PadLike & { id?: string } | null)[];
}

/** The app also asks for gamepad names (Controller tab). */
export interface RobotInputHub extends InputHub {
  /** Names of the connected gamepads (empty when none). */
  gamepads(): string[];
  readonly active: boolean;
  readonly touchShown: boolean;
}

/** Is the keyboard focus somewhere the student types (where keys must not drive the robot)? */
export function isTypingTarget(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  if (!e || typeof e.closest !== "function") return false;
  if (e.isContentEditable) return true;
  const tag = e.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!e.closest(".cm-editor, .blocklyWidgetDiv, .blocklyDropDownDiv, .injectionDiv, .blocklySvg, [contenteditable=''], [contenteditable='true']");
}

export function createInputHub(opts: InputHubOptions & InputHubExtras): RobotInputHub {
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const getPads = opts.getGamepads ?? (() => {
    try { return (nav?.getGamepads?.() ?? []) as readonly (PadLike & { id?: string } | null)[]; } catch { return []; }
  });

  const out = emptyState();         // returned by read() (reused)
  const scratch = emptyState();     // per-source scratch
  const keyState = emptyState();
  const held = new Set<string>();   // KeyboardEvent.code values held down
  const ramp: Record<string, number> = { axis1: 0, axis2: 0, axis3: 0, axis4: 0 }; // float -100..100
  let lastRamp = now();
  let active = false;
  const touch = createTouchPad(opts.touchHost);
  const listeners = new Set<() => void>();
  const changed = () => { for (const cb of Array.from(listeners)) { try { cb(); } catch (e) { console.error(e); } } };

  // ------------------------------------------------------------ keyboard
  const target = opts.keyTarget as EventTarget;
  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (!active || !isMappedKey(e.code)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;      // Ctrl+S etc. stay app shortcuts
    if (isTypingTarget(e.target) || isTypingTarget(typeof document !== "undefined" ? document.activeElement : null)) return;
    e.preventDefault();                                   // arrows must not scroll; letters must not type
    if (!held.has(e.code)) { updateRamp(); held.add(e.code); }
  };
  const onKeyUp = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (!held.has(e.code)) return;
    updateRamp();
    held.delete(e.code);
    if (active) e.preventDefault();
  };
  const releaseAll = () => { held.clear(); for (const a of AXIS_NAMES) ramp[a] = 0; touch.release(); };
  const onVis = () => { if (typeof document !== "undefined" && document.hidden) releaseAll(); };
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);
  const win = typeof window !== "undefined" ? window : undefined;
  win?.addEventListener("blur", releaseAll);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

  /** Moves each keyboard axis toward its target at full-scale-per-KEY_RAMP_S. */
  function updateRamp(): void {
    const t = now();
    const dt = Math.max(0, (t - lastRamp) / 1000);
    lastRamp = t;
    const step = (100 / KEY_RAMP_S) * dt;
    for (const k of KEY_AXES) {
      const target = (held.has(k.plus) ? 100 : 0) - (held.has(k.minus) ? 100 : 0); // opposite keys cancel
      const cur = ramp[k.axis];
      ramp[k.axis] = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
    }
  }

  // ------------------------------------------------------------ gamepad
  let padNames: string[] = [];
  const padChange = () => { refreshPads(); changed(); };
  function refreshPads(): void {
    const names: string[] = [];
    for (const p of getPads()) if (p && p.connected !== false) names.push(cleanPadName(p.id ?? "Gamepad"));
    padNames = names;
  }
  win?.addEventListener("gamepadconnected", padChange);
  win?.addEventListener("gamepaddisconnected", padChange);
  refreshPads();

  // ------------------------------------------------------------ read
  function read(): ControllerState {
    clearState(out);
    if (!active) return out;
    // keyboard
    updateRamp();
    for (const a of AXIS_NAMES) keyState.axes[a] = Math.round(ramp[a]) || 0;
    for (const b in keyState.buttons) keyState.buttons[b as keyof typeof keyState.buttons] = false;
    for (const code of held) { const b = KEY_BUTTONS[code]; if (b) keyState.buttons[b] = true; }
    mergeInto(out, keyState);
    // gamepads (polled: cheap, and Chrome only updates the snapshot when asked)
    const pads = getPads();
    let n = 0;
    for (const p of pads) {
      if (!p || p.connected === false) continue;
      n++;
      clearState(scratch);
      readPad(p, scratch);
      mergeInto(out, scratch);
    }
    if (n !== padNames.length) { refreshPads(); queueMicrotask(changed); } // a pad appeared without an event
    // touch
    if (touch.shown) mergeInto(out, touch.state);
    return out;
  }

  return {
    read,
    get active() { return active; },
    get touchShown() { return touch.shown; },
    setActive(on) {
      on = !!on;
      if (on === active) return;
      active = on;
      held.clear();
      for (const a of AXIS_NAMES) ramp[a] = 0;
      lastRamp = now();
      if (!on) touch.release();
    },
    showTouchControls(show) {
      if (touch.shown === !!show) return;
      touch.show(!!show);
      changed();
    },
    sources() {
      const s: InputSourceKind[] = ["keyboard"];
      if (padNames.length) s.push("gamepad");
      if (touch.shown) s.push("touch");
      return s;
    },
    gamepads: () => padNames.slice(),
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    dispose() {
      target.removeEventListener("keydown", onKeyDown, true);
      target.removeEventListener("keyup", onKeyUp, true);
      win?.removeEventListener("blur", releaseAll);
      win?.removeEventListener("gamepadconnected", padChange);
      win?.removeEventListener("gamepaddisconnected", padChange);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      listeners.clear();
      touch.dispose();
      active = false;
    },
  };
}

/** "Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)" → "Xbox 360 Controller". */
function cleanPadName(id: string): string {
  const s = id.replace(/\s*\((?:STANDARD GAMEPAD|.*Vendor:).*\)\s*$/i, "").replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, "").trim();
  return (s || "Gamepad").slice(0, 40);
}
