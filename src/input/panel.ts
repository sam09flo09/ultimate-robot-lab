/**
 * controller: the Controller tab — a live picture of the controller (stick dots, axis numbers,
 * lit buttons), the keyboard layout and the gamepad status. update() is cheap (text/class/transform
 * changes only when something changed), the app calls it ~15×/s while the tab is showing.
 */
import type { AxisName, ButtonName, ControllerState } from "../core/modules";
import { AXIS_NAMES, BUTTON_NAMES } from "../core/modules";
import { KEY_TABLE } from "./layout";

export interface ControllerPanel {
  update(s: ControllerState, info: { gamepads: string[]; touch: boolean; running: boolean }): void;
}

const BTN_LABEL: Record<ButtonName, string> = {
  buttonL1: "L1", buttonL2: "L2", buttonR1: "R1", buttonR2: "R2",
  buttonUp: "▲", buttonDown: "▼", buttonLeft: "◀", buttonRight: "▶",
  buttonX: "X", buttonY: "Y", buttonA: "A", buttonB: "B",
};

export function keyTableHtml(): string {
  return `<table class="ref-table ctl-keys"><thead><tr><th>Control</th><th>Keys</th></tr></thead><tbody>${
    KEY_TABLE.map((r) => `<tr><td>${r.control}</td><td><kbd>${r.keys}</kbd></td></tr>`).join("")}</tbody></table>`;
}

export function createControllerPanel(host: HTMLElement): ControllerPanel {
  host.innerHTML = `
    <div class="ctl-pic" aria-hidden="true">
      <div class="ctl-sh"><span class="ctl-b" data-b="buttonL1">L1</span><span class="ctl-b" data-b="buttonL2">L2</span>
        <span class="ctl-gap"></span><span class="ctl-b" data-b="buttonR1">R1</span><span class="ctl-b" data-b="buttonR2">R2</span></div>
      <div class="ctl-main">
        <div class="ctl-col">
          <div class="ctl-stick"><i data-s="left"></i></div>
          <div class="ctl-cross">${["buttonUp", "buttonLeft", "buttonRight", "buttonDown"].map((b) => `<span class="ctl-b" data-b="${b}">${BTN_LABEL[b as ButtonName]}</span>`).join("")}</div>
        </div>
        <div class="ctl-col">
          <div class="ctl-stick"><i data-s="right"></i></div>
          <div class="ctl-cross">${["buttonX", "buttonY", "buttonA", "buttonB"].map((b) => `<span class="ctl-b" data-b="${b}">${BTN_LABEL[b as ButtonName]}</span>`).join("")}</div>
        </div>
      </div>
    </div>
    <dl class="ctl-axes">${AXIS_NAMES.map((a) => `<div><dt>${a}</dt><dd data-a="${a}">0</dd></div>`).join("")}</dl>
    <p class="ctl-pressed" aria-live="off">Pressed: <span data-pressed>none</span></p>
    <p class="ctl-pad" data-pad></p>
    <p class="ctl-hint muted" data-hint></p>
    <h4 class="ctl-h">Keyboard</h4>
    ${keyTableHtml()}
    <p class="muted ctl-note">Click the playground (not the code) so the keys drive. Esc stops the program.</p>`;
  const btnEls = new Map<ButtonName, HTMLElement>();
  host.querySelectorAll<HTMLElement>(".ctl-b").forEach((e) => btnEls.set(e.dataset.b as ButtonName, e));
  const axisEls = new Map<AxisName, HTMLElement>();
  host.querySelectorAll<HTMLElement>("[data-a]").forEach((e) => axisEls.set(e.dataset.a as AxisName, e));
  const dotL = host.querySelector<HTMLElement>('[data-s="left"]')!;
  const dotR = host.querySelector<HTMLElement>('[data-s="right"]')!;
  const pressedEl = host.querySelector<HTMLElement>("[data-pressed]")!;
  const padEl = host.querySelector<HTMLElement>("[data-pad]")!;
  const hintEl = host.querySelector<HTMLElement>("[data-hint]")!;
  const set = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  const lastDot = { left: "", right: "" };
  const place = (dot: HTMLElement, side: "left" | "right", x: number, y: number) => {
    // ring is 72 px with a 16 px dot: 26 px of travel keeps the dot inside the circle
    const t = `translate(${(x * 0.26).toFixed(0)}px, ${(-y * 0.26).toFixed(0)}px)`;
    if (lastDot[side] !== t) { dot.style.transform = t; lastDot[side] = t; }
  };

  return {
    update(s, info) {
      for (const a of AXIS_NAMES) set(axisEls.get(a)!, String(s.axes[a]));
      place(dotL, "left", s.axes.axis4, s.axes.axis3);
      place(dotR, "right", s.axes.axis1, s.axes.axis2);
      const pressed: string[] = [];
      for (const b of BUTTON_NAMES) {
        const on = s.buttons[b];
        const e = btnEls.get(b)!;
        if (e.classList.contains("on") !== on) e.classList.toggle("on", on);
        if (on) pressed.push(b);
      }
      set(pressedEl, pressed.length ? pressed.join(", ") : "none");
      set(padEl, info.gamepads.length
        ? `🎮 Gamepad: ${info.gamepads.join(", ")}`
        : "No gamepad — plug one in and press a button");
      set(hintEl, info.running
        ? "Your program is running: these are the values it reads."
        : "Try the keys now — the picture shows what your program would read." + (info.touch ? " The on-screen controller works too." : ""));
    },
  };
}
