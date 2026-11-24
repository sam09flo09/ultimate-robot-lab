// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInputHub, isTypingTarget, type RobotInputHub } from "./index";
import { knobToAxes, stickValue, readPad, mergeInto, emptyState, isMappedKey, type PadLike } from "./layout";

let t = 0;
let pads: (PadLike & { id?: string } | null)[] = [];
let hub: RobotInputHub;
let touchHost: HTMLElement;

function key(type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function pad(axes: number[], pressed: number[] = [], values: Record<number, number> = {}): PadLike & { id: string } {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) }));
  return { id: "Test pad (STANDARD GAMEPAD Vendor: 1234 Product: 5678)", connected: true, axes, buttons };
}

beforeEach(() => {
  t = 0; pads = [];
  document.body.innerHTML = "";
  touchHost = document.createElement("div");
  document.body.append(touchHost);
  hub = createInputHub({ keyTarget: window, touchHost, now: () => t, getGamepads: () => pads });
  hub.setActive(true);
});
afterEach(() => hub.dispose());

describe("keyboard", () => {
  it("maps the API.md layout (after the ramp)", () => {
    key("keydown", "KeyW"); key("keydown", "KeyD"); key("keydown", "ArrowDown"); key("keydown", "ArrowLeft");
    t += 500;
    const s = hub.read();
    expect(s.axes).toEqual({ axis3: 100, axis4: 100, axis2: -100, axis1: -100 });
    for (const [code, b] of [["KeyI", "buttonX"], ["KeyJ", "buttonY"], ["KeyL", "buttonA"], ["KeyK", "buttonB"],
      ["KeyQ", "buttonL1"], ["KeyZ", "buttonL2"], ["KeyE", "buttonR1"], ["KeyC", "buttonR2"],
      ["KeyT", "buttonUp"], ["KeyG", "buttonDown"], ["KeyF", "buttonLeft"], ["KeyH", "buttonRight"]] as const) {
      key("keydown", code);
      expect(hub.read().buttons[b]).toBe(true);
      key("keyup", code);
      expect(hub.read().buttons[b]).toBe(false);
    }
  });
  it("S and A are negative", () => {
    key("keydown", "KeyS"); key("keydown", "KeyA"); t += 1000;
    expect(hub.read().axes).toMatchObject({ axis3: -100, axis4: -100 });
  });
  it("opposite keys cancel", () => {
    key("keydown", "KeyW"); key("keydown", "KeyS"); t += 1000;
    expect(hub.read().axes.axis3).toBe(0);
    key("keyup", "KeyS"); t += 1000;
    expect(hub.read().axes.axis3).toBe(100);
  });
  it("ramps to full in ~120 ms and back down on release", () => {
    key("keydown", "ArrowUp");
    t += 30; expect(hub.read().axes.axis2).toBe(25);
    t += 30; expect(hub.read().axes.axis2).toBe(50);
    t += 100; expect(hub.read().axes.axis2).toBe(100);
    key("keyup", "ArrowUp");
    t += 60; expect(hub.read().axes.axis2).toBe(50);
    t += 100; expect(hub.read().axes.axis2).toBe(0);
  });
  it("prevents default only for mapped keys", () => {
    expect(key("keydown", "ArrowUp").defaultPrevented).toBe(true);
    expect(key("keydown", "KeyW").defaultPrevented).toBe(true);
    expect(key("keydown", "KeyP").defaultPrevented).toBe(false);
    expect(key("keydown", "Escape").defaultPrevented).toBe(false);
    expect(key("keydown", "Space").defaultPrevented).toBe(false);
    expect(isMappedKey("KeyR")).toBe(false);
  });
  it("ignores keys with Ctrl / Cmd / Alt (app shortcuts)", () => {
    const e = key("keydown", "KeyS", { ctrlKey: true }); t += 500;
    expect(e.defaultPrevented).toBe(false);
    expect(hub.read().axes.axis3).toBe(0);
  });
  it("ignores keys while typing in an input, textarea, contenteditable, CodeMirror or Blockly", () => {
    const input = document.createElement("input");
    const ta = document.createElement("textarea");
    const ce = document.createElement("div"); ce.setAttribute("contenteditable", "true");
    const cm = document.createElement("div"); cm.className = "cm-editor"; const cmc = document.createElement("div"); cm.append(cmc);
    const bl = document.createElement("div"); bl.className = "injectionDiv"; const blc = document.createElement("div"); bl.append(blc);
    document.body.append(input, ta, ce, cm, bl);
    for (const el of [input, ta, ce, cmc, blc]) {
      const e = key("keydown", "KeyW", {}, el); t += 500;
      expect(e.defaultPrevented).toBe(false);
      expect(hub.read().axes.axis3).toBe(0);
      key("keyup", "KeyW", {}, el);
    }
    expect(isTypingTarget(document.body)).toBe(false);
    // focused editor counts even if the event targets the window
    input.focus();
    key("keydown", "KeyW"); t += 500;
    expect(hub.read().axes.axis3).toBe(0);
  });
  it("releases everything on window blur and when the page is hidden", () => {
    key("keydown", "KeyW"); key("keydown", "KeyL"); t += 500;
    expect(hub.read().axes.axis3).toBe(100);
    window.dispatchEvent(new Event("blur"));
    const s = hub.read();
    expect(s.axes.axis3).toBe(0); expect(s.buttons.buttonA).toBe(false);
    key("keydown", "KeyW"); t += 500;
    expect(hub.read().axes.axis3).toBe(100);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    expect(hub.read().axes.axis3).toBe(0);
  });
  it("inactive = all zeros and keys are not captured", () => {
    key("keydown", "KeyW"); t += 500;
    pads = [pad([0, 0, 0.9, 0], [0])];
    hub.setActive(false);
    const s = hub.read();
    expect(Object.values(s.axes).every((v) => v === 0)).toBe(true);
    expect(Object.values(s.buttons).some(Boolean)).toBe(false);
    const e = key("keydown", "ArrowUp"); t += 500;
    expect(e.defaultPrevented).toBe(false);
    hub.setActive(true);
    pads = [];
    expect(hub.read().axes.axis2).toBe(0); // the press while inactive was not remembered
  });
});

describe("gamepad", () => {
  it("maps the standard layout (left stick → axis4/axis3 with up = +, right → axis1/axis2)", () => {
    pads = [pad([0.5, -1, -1, 0.5])];
    const s = hub.read();
    expect(s.axes.axis4).toBe(stickValue(0.5));
    expect(s.axes.axis3).toBe(100);
    expect(s.axes.axis1).toBe(-100);
    expect(s.axes.axis2).toBe(-stickValue(0.5));
  });
  it("maps face buttons, shoulders, triggers (> 0.5) and the d-pad", () => {
    const out = emptyState();
    readPad(pad([0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 12, 13, 14, 15], { 6: 0.4, 7: 0.6 }), out);
    expect(out.buttons).toMatchObject({ buttonA: true, buttonB: true, buttonX: true, buttonY: true, buttonL1: true, buttonR1: true,
      buttonL2: false, buttonR2: true, buttonUp: true, buttonDown: true, buttonLeft: true, buttonRight: true });
  });
  it("has an 8% deadband", () => {
    expect(stickValue(0.07)).toBe(0);
    expect(stickValue(-0.079)).toBe(0);
    expect(stickValue(0.09)).toBeGreaterThan(0);
    expect(stickValue(1)).toBe(100);
    expect(stickValue(-1)).toBe(-100);
    pads = [pad([0.05, -0.05, 0.02, 0.07])];
    expect(Object.values(hub.read().axes).every((v) => v === 0)).toBe(true);
  });
  it("reports connected pads, fires onChange on connect events", () => {
    let n = 0;
    hub.onChange(() => n++);
    expect(hub.sources()).toEqual(["keyboard"]);
    pads = [pad([0, 0, 0, 0])];
    window.dispatchEvent(new Event("gamepadconnected"));
    expect(n).toBe(1);
    expect(hub.sources()).toContain("gamepad");
    expect(hub.gamepads()).toEqual(["Test pad"]);
    pads = [null];
    window.dispatchEvent(new Event("gamepaddisconnected"));
    expect(hub.sources()).not.toContain("gamepad");
  });
});

describe("merge", () => {
  it("largest magnitude wins; buttons OR together", () => {
    key("keydown", "KeyW"); t += 500;            // axis3 +100 from keys
    pads = [pad([0, 0, 0.3, -0.5], [1])];          // axis1 ≈ 24, axis2 ≈ 46, B
    let s = hub.read();
    expect(s.axes.axis3).toBe(100);
    expect(s.axes.axis2).toBe(stickValue(0.5));
    expect(s.buttons.buttonB).toBe(true);
    key("keydown", "ArrowLeft"); t += 500;       // axis1 -100 beats +24
    s = hub.read();
    expect(s.axes.axis1).toBe(-100);
    const a = emptyState(), b = emptyState();
    a.axes.axis1 = 40; b.axes.axis1 = -60; b.buttons.buttonX = true;
    mergeInto(a, b);
    expect(a.axes.axis1).toBe(-60); expect(a.buttons.buttonX).toBe(true);
  });
  it("read() reuses one object and returns integers", () => {
    key("keydown", "KeyD"); t += 37;
    const s1 = hub.read(); t += 11;
    const s2 = hub.read();
    expect(s1).toBe(s2);
    for (const v of Object.values(s2.axes)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("touch", () => {
  it("knob math: clamps to the ring, y up is +, small deadband", () => {
    expect(knobToAxes(0, 0, 50)).toEqual({ x: 0, y: 0, kx: 0, ky: 0 });
    expect(knobToAxes(50, 0, 50)).toMatchObject({ x: 100, y: 0 });
    expect(knobToAxes(0, -25, 50)).toMatchObject({ x: 0, y: 50 });
    const far = knobToAxes(300, 400, 50);   // 500 px away along 3-4-5
    expect(far).toMatchObject({ x: 60, y: -80 });
    expect(Math.hypot(far.kx, far.ky)).toBeCloseTo(50);
    expect(knobToAxes(2, 1, 50)).toMatchObject({ x: 0, y: 0 });
    expect(knobToAxes(NaN, 1, 50).x).toBe(0);
  });
  it("two pointers at once: a stick and a button", () => {
    hub.showTouchControls(true);
    expect(hub.sources()).toContain("touch");
    const stick = touchHost.querySelector<HTMLElement>('[data-stick="left"]')!;
    stick.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
    const btnA = touchHost.querySelector<HTMLElement>('[data-b="buttonA"]')!;
    const pe = (type: string, id: number, x = 0, y = 0) => new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true });
    stick.dispatchEvent(pe("pointerdown", 1, 50, 18));   // straight up, 32 px = full
    btnA.dispatchEvent(pe("pointerdown", 2));
    let s = hub.read();
    expect(s.axes.axis3).toBe(100); expect(s.axes.axis4).toBe(0); expect(s.buttons.buttonA).toBe(true);
    stick.dispatchEvent(pe("pointermove", 1, 66, 50));   // right, half
    s = hub.read();
    expect(s.axes.axis4).toBe(50); expect(s.axes.axis3).toBe(0);
    stick.dispatchEvent(pe("pointermove", 2, 0, 100));   // another pointer's move is ignored
    expect(hub.read().axes.axis4).toBe(50);
    btnA.dispatchEvent(pe("pointerup", 2));
    s = hub.read();
    expect(s.buttons.buttonA).toBe(false); expect(s.axes.axis4).toBe(50);
    stick.dispatchEvent(pe("pointerup", 1));
    expect(hub.read().axes.axis4).toBe(0);
  });
  it("hidden touch controls don't count and don't take pointers", () => {
    hub.showTouchControls(true);
    const btnA = touchHost.querySelector<HTMLElement>('[data-b="buttonA"]')!;
    btnA.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 3, bubbles: true }));
    hub.showTouchControls(false);
    expect(hub.read().buttons.buttonA).toBe(false);
    expect((touchHost.firstElementChild as HTMLElement).hidden).toBe(true);
  });
});
