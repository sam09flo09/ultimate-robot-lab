// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createPlayerInput, KEYS_LEFT, KEYS_RIGHT, halfKeys, nthPad, type PlayerController } from "./player";
import { KEY_TABLE } from "./layout";
import type { PadLike } from "./layout";

let t = 0;
const made: PlayerController[] = [];
const mk = (...a: Parameters<typeof createPlayerInput>) => { const p = createPlayerInput(a[0], { now: () => t, ...a[1] }); made.push(p); return p; };
afterEach(() => { for (const p of made.splice(0)) p.dispose(); t = 0; document.body.innerHTML = ""; });

function key(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}
function pad(id: string, axes: number[], pressed: number[] = []): PadLike & { id: string } {
  return { id, connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) };
}

describe("keyboard halves", () => {
  it("share no keys", () => {
    const l = halfKeys(KEYS_LEFT), r = halfKeys(KEYS_RIGHT);
    expect(new Set(l).size).toBe(l.length);
    expect(new Set(r).size).toBe(r.length);
    for (const k of l) expect(r).not.toContain(k);
  });
  it("each half covers all four axes and the A B X Y L1 L2 R1 R2 buttons", () => {
    for (const h of [KEYS_LEFT, KEYS_RIGHT]) {
      expect(h.axes.map((a) => a.axis).sort()).toEqual(["axis1", "axis2", "axis3", "axis4"]);
      expect(Object.values(h.buttons).sort()).toEqual(["buttonA", "buttonB", "buttonL1", "buttonL2", "buttonR1", "buttonR2", "buttonX", "buttonY"]);
    }
  });
  it("left: W/S axis3, A/D axis4, R/F axis2, Q/E axis1, Z X C V, 1 2 3 4", () => {
    const p = mk("keyboard-left");
    key("keydown", "KeyW"); key("keydown", "KeyA"); key("keydown", "KeyR"); key("keydown", "KeyQ");
    t += 500;
    expect(p.read().axes).toEqual({ axis3: 100, axis4: -100, axis2: 100, axis1: -100 });
    for (const [c, b] of [["KeyZ", "buttonA"], ["KeyX", "buttonB"], ["KeyC", "buttonX"], ["KeyV", "buttonY"],
      ["Digit1", "buttonL1"], ["Digit2", "buttonL2"], ["Digit3", "buttonR1"], ["Digit4", "buttonR2"]] as const) {
      key("keydown", c); expect(p.read().buttons[b]).toBe(true);
      key("keyup", c); expect(p.read().buttons[b]).toBe(false);
    }
  });
  it("right: arrows axis2/axis1, I/K axis3, J/L axis4, N M , . and 7 8 9 0", () => {
    const p = mk("keyboard-right");
    key("keydown", "ArrowDown"); key("keydown", "ArrowRight"); key("keydown", "KeyI"); key("keydown", "KeyJ");
    t += 500;
    expect(p.read().axes).toEqual({ axis2: -100, axis1: 100, axis3: 100, axis4: -100 });
    for (const [c, b] of [["KeyN", "buttonA"], ["KeyM", "buttonB"], ["Comma", "buttonX"], ["Period", "buttonY"],
      ["Digit7", "buttonL1"], ["Digit8", "buttonL2"], ["Digit9", "buttonR1"], ["Digit0", "buttonR2"]] as const) {
      key("keydown", c); expect(p.read().buttons[b]).toBe(true);
      key("keyup", c); expect(p.read().buttons[b]).toBe(false);
    }
  });
  it("the two players don't see each other's keys", () => {
    const l = mk("keyboard-left"), r = mk("keyboard-right");
    key("keydown", "KeyW"); key("keydown", "ArrowUp"); t += 500;
    expect(l.read().axes.axis3).toBe(100);
    expect(l.read().axes.axis2).toBe(0);
    expect(r.read().axes.axis2).toBe(100);
    expect(r.read().axes.axis3).toBe(0);
  });
  it("leaves app shortcuts alone (Ctrl/⌘ combos, Esc, F8, F10)", () => {
    mk("keyboard-left"); mk("keyboard-right");
    expect(key("keydown", "KeyS", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("keydown", "KeyO", { metaKey: true }).defaultPrevented).toBe(false);
    for (const c of ["Escape", "F8", "F10", "Enter", "Tab", "Space"]) expect(key("keydown", c).defaultPrevented).toBe(false);
    for (const k of [...halfKeys(KEYS_LEFT), ...halfKeys(KEYS_RIGHT)]) expect(["Escape", "F8", "F10", "Enter", "Tab"]).not.toContain(k);
  });
  it("ignores keys while typing in a field", () => {
    const p = mk("keyboard-left");
    const inp = document.createElement("input");
    document.body.append(inp);
    inp.focus();
    inp.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true, cancelable: true }));
    t += 500;
    expect(p.read().axes.axis3).toBe(0);
  });
  it("the single-player table is unchanged (W A S D + arrows)", () => {
    expect(KEY_TABLE[0].keys).toBe("W / S, A / D");
  });
});

describe("gamepads", () => {
  it("picks the first / second CONNECTED pad, skipping empty slots", () => {
    const a = pad("A", [0, -1, 0, 0]), b = pad("B", [0, 1, 0, 0], [0]);
    const pads = [null, a, { ...pad("gone", [0, 0, 0, 0]), connected: false }, b];
    expect(nthPad(pads, 0)).toBe(a);
    expect(nthPad(pads, 1)).toBe(b);
    expect(nthPad(pads, 2)).toBeNull();
    const p1 = mk("gamepad-1", { getGamepads: () => pads }), p2 = mk("gamepad-2", { getGamepads: () => pads });
    expect(p1.read().axes.axis3).toBe(100);
    expect(p1.read().buttons.buttonA).toBe(false);
    expect(p2.read().axes.axis3).toBe(-100);
    expect(p2.read().buttons.buttonA).toBe(true);
  });
  it("reads zeros when that pad isn't connected", () => {
    const p2 = mk("gamepad-2", { getGamepads: () => [pad("only", [0, -1, 0, 0])] });
    expect(p2.read().axes.axis3).toBe(0);
  });
});

describe("touch and program-only", () => {
  it("touch shows its own on-screen controller and removes it on dispose", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const p = createPlayerInput("touch", { touchHost: host });
    expect(host.querySelector(".tpad")).not.toBeNull();
    expect(p.touchEl?.hidden).toBe(false);
    p.dispose();
    expect(host.querySelector(".tpad")).toBeNull();
  });
  it("program-only is always zero", () => {
    const p = mk("program-only");
    key("keydown", "KeyW"); t += 500;
    expect(Object.values(p.read().axes).every((v) => v === 0)).toBe(true);
    expect(Object.values(p.read().buttons).some(Boolean)).toBe(false);
  });
});
