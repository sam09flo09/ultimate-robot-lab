/**
 * controller: the on-screen controller (two joysticks + the 12 buttons), for touch Chromebooks.
 * Multi-touch through pointer events with pointer capture, so two thumbs work at once; a mouse works too.
 * The overlay itself ignores pointers (pointer-events: none) — only the sticks and buttons take them,
 * so the 3D view can still be dragged between them.
 */
import type { ButtonName, ControllerState } from "../core/modules";
import { emptyState, clearState, knobToAxes } from "./layout";

export interface TouchPad {
  readonly el: HTMLElement;
  readonly state: ControllerState;
  show(on: boolean): void;
  readonly shown: boolean;
  /** Let go of everything (window blur, deactivate). */
  release(): void;
  dispose(): void;
}

function el(tag: string, cls: string, attrs: Record<string, string> = {}, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

export function createTouchPad(host: HTMLElement): TouchPad {
  const state = emptyState();
  const root = el("div", "tpad", { role: "group", "aria-label": "On-screen controller" });
  root.hidden = true;
  const cleanups: (() => void)[] = [];

  const btn = (name: ButtonName, label: string, cls = ""): HTMLElement => {
    const b = el("button", "tpad-btn " + cls, { type: "button", tabindex: "-1", "data-b": name, "aria-label": label.length <= 2 ? `Button ${label}` : label }, label);
    let pid: number | null = null;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      pid = e.pointerId;
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic events have no active pointer */ }
      state.buttons[name] = true; b.classList.add("on");
    };
    const up = (e: PointerEvent) => {
      if (pid !== null && e.pointerId !== pid) return;
      pid = null; state.buttons[name] = false; b.classList.remove("on");
    };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("lostpointercapture", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  };

  const stick = (side: "left" | "right"): HTMLElement => {
    const s = el("div", "tpad-stick", { "data-stick": side, "aria-label": side === "left" ? "Left stick" : "Right stick", role: "img" });
    const knob = el("div", "tpad-knob");
    s.append(knob);
    const [ax, ay] = side === "left" ? (["axis4", "axis3"] as const) : (["axis1", "axis2"] as const);
    let pid: number | null = null;
    let cx = 0, cy = 0, r = 1;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      const v = knobToAxes(e.clientX - cx, e.clientY - cy, r);
      state.axes[ax] = v.x; state.axes[ay] = v.y;
      knob.style.transform = `translate(${v.kx.toFixed(1)}px, ${v.ky.toFixed(1)}px)`;
    };
    const down = (e: PointerEvent) => {
      if (pid !== null) return;
      e.preventDefault();
      pid = e.pointerId;
      try { s.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const rect = s.getBoundingClientRect();
      cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2;
      r = Math.max(10, rect.width * 0.32);
      s.classList.add("on");
      move(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = null;
      state.axes[ax] = 0; state.axes[ay] = 0;
      knob.style.transform = "";
      s.classList.remove("on");
    };
    s.addEventListener("pointerdown", down);
    s.addEventListener("pointermove", move);
    s.addEventListener("pointerup", up);
    s.addEventListener("pointercancel", up);
    s.addEventListener("lostpointercapture", up);
    cleanups.push(() => { pid = null; knob.style.transform = ""; s.classList.remove("on"); });
    return s;
  };

  // left half: L1 L2 / d-pad + left stick ; right half: R1 R2 / right stick + X Y A B diamond
  const dpad = el("div", "tpad-cross tpad-dpad");
  dpad.append(btn("buttonUp", "▲", "up"), btn("buttonLeft", "◀", "left"), btn("buttonRight", "▶", "right"), btn("buttonDown", "▼", "down"));
  for (const b of Array.from(dpad.children)) b.setAttribute("aria-label", `Button ${(b as HTMLElement).dataset.b!.slice(6)}`);
  const face = el("div", "tpad-cross tpad-face");
  face.append(btn("buttonX", "X", "up"), btn("buttonY", "Y", "left"), btn("buttonA", "A", "right"), btn("buttonB", "B", "down"));
  const shL = el("div", "tpad-shoulders");
  shL.append(btn("buttonL1", "L1"), btn("buttonL2", "L2"));
  const shR = el("div", "tpad-shoulders");
  shR.append(btn("buttonR1", "R1"), btn("buttonR2", "R2"));
  const left = el("div", "tpad-side tpad-left");
  const lrow = el("div", "tpad-row");
  lrow.append(dpad, stick("left"));
  left.append(shL, lrow);
  const right = el("div", "tpad-side tpad-right");
  const rrow = el("div", "tpad-row");
  rrow.append(stick("right"), face);
  right.append(shR, rrow);
  root.append(left, right);
  host.append(root);

  const release = () => {
    clearState(state);
    for (const c of cleanups) c();
    root.querySelectorAll(".tpad-btn.on").forEach((b) => b.classList.remove("on"));
  };

  return {
    el: root, state,
    get shown() { return !root.hidden; },
    show(on) { if (!on) release(); root.hidden = !on; },
    release,
    dispose() { release(); root.remove(); },
  };
}
