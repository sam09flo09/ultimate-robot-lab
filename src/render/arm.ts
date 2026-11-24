/**
 * arm: 2D drawing of platforms, raised/stacked objects and the arm + claw (top view).
 * Field space as in render/index.ts: mm, y down (a world point (x, y) is drawn at (x, -y)).
 * No allocation per frame (one reused index array for the z-sorted objects).
 */
import type { ArmState, ColorName, Platform, WorldObject } from "../core/types";
import { COLOR_HEX } from "../core/types";

const DEG = Math.PI / 180;
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const INK = "#0C0B0A";
const ARM_LIFT = 300;   // keep in step with sim/arm.ts
const CLAW_HOLD = 60;

const zOf = (o: WorldObject) => (typeof o.z === "number" && o.z > 0 ? o.z : 0);

export function platformFill(c: ColorName | undefined): string {
  return !c || c === "NONE" ? "#C9B79C" : COLOR_HEX[c];
}

/** Raised blocks with a drop shadow (longer for taller platforms) and a height label. Static layer. */
export function drawPlatforms(c: CanvasRenderingContext2D, platforms: readonly Platform[] | undefined, px: number): void {
  if (!platforms || !platforms.length) return;
  for (const p of platforms) {
    const x = p.x - p.w / 2, y = -p.y - p.h / 2;
    const off = Math.min(60, p.height * 0.12);
    c.fillStyle = "rgba(12,11,10,0.22)";
    c.fillRect(x + off * 0.6, y + off, p.w, p.h);
    // side face (gives the block some depth)
    c.fillStyle = "#6F6458";
    c.fillRect(x, y + p.h - Math.min(p.h * 0.25, 4 + p.height * 0.06), p.w, Math.min(p.h * 0.25, 4 + p.height * 0.06));
    c.fillStyle = platformFill(p.color);
    c.fillRect(x, y, p.w, p.h - Math.min(p.h * 0.25, 4 + p.height * 0.06));
    c.lineWidth = 2 * px;
    c.strokeStyle = INK;
    c.strokeRect(x, y, p.w, p.h);
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 3 * px;
    c.strokeRect(x + 5 * px, y + 5 * px, p.w - 10 * px, p.h * 0.75 - 10 * px);
    const label = `▲ ${Math.round(p.height)} mm`;
    const fs = 11 * px;
    c.font = `600 ${fs}px ${MONO}`;
    c.textAlign = "left";
    c.textBaseline = "top";
    const tw = c.measureText(label).width;
    c.fillStyle = "rgba(12,11,10,0.78)";
    c.fillRect(x + 4 * px, y + 4 * px, tw + 8 * px, fs + 5 * px);
    c.fillStyle = "#FFFDF9";
    c.fillText(label, x + 8 * px, y + 6.5 * px);
  }
}

const order: number[] = [];

/**
 * Draw objects that are up on a platform or a stack (z > 0), lowest first, each with a shadow offset by
 * its height, a height badge and — for stacks — concentric outlines plus a count. Floor objects are drawn
 * by the caller. `skipId` (the held object) is left for drawHeld.
 */
export function drawRaisedObjects(
  c: CanvasRenderingContext2D, objects: readonly WorldObject[], skipId: string | null, px: number,
  drawObject: (c: CanvasRenderingContext2D, o: WorldObject, px: number) => void,
): void {
  order.length = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (zOf(o) <= 0 || o.id === skipId) continue;
    let k = order.length;
    order.push(i);
    while (k > 0 && zOf(objects[order[k - 1]]) > zOf(o)) { order[k] = order[k - 1]; k--; }
    order[k] = i;
  }
  for (let n = 0; n < order.length; n++) {
    const o = objects[order[n]];
    // how many objects is it sitting on?
    let below = 0;
    for (let j = 0; j < objects.length; j++) {
      const b = objects[j];
      if (b === o || b.id === skipId || zOf(b) >= zOf(o)) continue;
      const r = b.size / 2;
      if (Math.abs(b.x - o.x) <= r && Math.abs(b.y - o.y) <= r) below++;
    }
    raised(c, o, below + 1, px, drawObject);
  }
}

function raised(
  c: CanvasRenderingContext2D, o: WorldObject, level: number, px: number,
  drawObject: (c: CanvasRenderingContext2D, o: WorldObject, px: number) => void,
): void {
  const z = zOf(o);
  const off = Math.min(50, z * 0.1);
  const h = o.size / 2;
  // cast shadow on what is below
  c.fillStyle = "rgba(12,11,10,0.16)";
  c.beginPath();
  if (o.shape === "disk") c.arc(o.x + off * 0.6, -o.y + off, h, 0, Math.PI * 2);
  else c.rect(o.x + off * 0.6 - h, -o.y + off - h, o.size, o.size);
  c.fill();
  // stack: concentric outlines, one per object underneath
  if (level > 1) {
    c.strokeStyle = "rgba(12,11,10,0.55)";
    c.lineWidth = 1.5 * px;
    for (let k = 1; k < level && k < 6; k++) {
      const g = h + k * 5 * px;
      c.beginPath();
      if (o.shape === "disk") c.arc(o.x, -o.y, g, 0, Math.PI * 2);
      else c.rect(o.x - g, -o.y - g, 2 * g, 2 * g);
      c.stroke();
    }
  }
  drawObject(c, o, px);
  badge(c, o.x + h * 0.55, -o.y - h * 0.55, level > 1 ? `×${level}` : `↑${Math.round(z)}`, px);
}

function badge(c: CanvasRenderingContext2D, x: number, y: number, text: string, px: number): void {
  const fs = 10 * px;
  c.font = `700 ${fs}px ${MONO}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const w = c.measureText(text).width + 7 * px;
  c.fillStyle = INK;
  c.beginPath();
  c.arc(x - w / 2 + fs * 0.55, y, fs * 0.65, Math.PI / 2, Math.PI * 1.5);
  c.arc(x + w / 2 - fs * 0.55, y, fs * 0.65, -Math.PI / 2, Math.PI / 2);
  c.closePath();
  c.fill();
  c.fillStyle = "#FFFDF9";
  c.fillText(text, x, y + 0.5 * px);
}

/**
 * The arm seen from above: a bar from the top of the robot to the claw, darker and wider the higher it
 * is (and its shadow falls further away), the claw's two jaws (open or closed), and the angle.
 * Draw the held object (with drawHeld) between drawArm(...,"arm") and drawArm(...,"jaws").
 */
export function drawArm(
  c: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number,
  arm: ArmState | undefined, part: "arm" | "jaws", px: number,
): void {
  const angle = arm ? arm.angle : 0;
  const lift = Math.sin(angle * DEG);          // 0 (down) .. 1 (up)
  const closed = arm ? arm.clawClosed : false;
  const h = size / 2;
  const tip = -(h + CLAW_HOLD);
  c.save();
  c.translate(x, -y);
  c.rotate(heading * DEG);
  if (part === "arm") {
    const sh = lift * ARM_LIFT * 0.12;
    const w = 14 + lift * 6;
    // shadow on the floor
    c.fillStyle = `rgba(12,11,10,${0.12 + lift * 0.08})`;
    c.fillRect(-w / 2 + sh * 0.6, -h * 0.2 + sh, w, tip + h * 0.2);
    // tower on the robot
    c.fillStyle = "#2B5C4C";
    c.fillRect(-16, -h * 0.35, 32, 22);
    // the arm bar
    c.globalAlpha = 0.65 + lift * 0.35;
    c.fillStyle = "#3F7F6A";
    c.fillRect(-w / 2, tip, w, -tip - h * 0.2);
    c.strokeStyle = INK;
    c.lineWidth = 1.5 * px;
    c.strokeRect(-w / 2, tip, w, -tip - h * 0.2);
    // lift marks: one tick per 15°
    c.strokeStyle = "rgba(255,253,249,0.8)";
    c.beginPath();
    for (let a = 15; a <= angle + 0.01; a += 15) {
      const ty = -h * 0.2 + (tip + h * 0.2) * (a / 90);
      c.moveTo(-w / 2 + 2, ty); c.lineTo(w / 2 - 2, ty);
    }
    c.stroke();
    c.globalAlpha = 1;
    // angle label beside the tower
    const fs = 10 * px;
    c.rotate(-heading * DEG);
    c.font = `700 ${fs}px ${MONO}`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = "#2B5C4C";
    c.fillText(`${Math.round(angle)}°`, h * 0.75, -h * 0.75);
  } else {
    // jaws: two bars either side of the claw centre
    const gap = closed ? 26 : 40;
    const jl = 44;
    c.fillStyle = closed ? "#FF6A1A" : "#A7AFB8";
    c.strokeStyle = INK;
    c.lineWidth = 1.5 * px;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      c.fillRect(s * gap - 4, tip - jl / 2, 8, jl);
      c.strokeRect(s * gap - 4, tip - jl / 2, 8, jl);
    }
    c.fillStyle = "#2B5C4C";
    c.fillRect(-gap - 4, tip + jl / 2 - 6, 2 * gap + 8, 8);
  }
  c.restore();
}

/** The held object, with a shadow offset by its height and a height badge. */
export function drawHeld(
  c: CanvasRenderingContext2D, o: WorldObject, px: number,
  drawObject: (c: CanvasRenderingContext2D, o: WorldObject, px: number) => void,
): void {
  raised(c, o, 1, px, drawObject);
}
