/**
 * Paints the static floor (paint, grid / numbered squares, zones, low-quality wall contact shadows)
 * into one 2D canvas used as a CanvasTexture. Mirrors the look of src/render (2D renderer).
 * Drawing uses "field space" like the 2D renderer: mm, origin at field centre, y DOWN (world (x,y) → (x,-y)).
 */
import type { FloorShape, Vec, Wall, World, Zone } from "../core/types";
import { COLOR_HEX } from "../core/types";
import type { TexLayout } from "./math";
import { gridSquareNumber } from "./math";

const DEEP = "#D6540E";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export interface FloorPaintOptions {
  showZones: boolean;
  /** Draw soft contact shadows under walls (used when real shadows are off). */
  wallShadows: boolean;
}

export function paintFloor(c: CanvasRenderingContext2D, L: TexLayout, world: World, fieldW: number, fieldH: number, o: FloorPaintOptions): void {
  const hw = fieldW / 2;
  const hh = fieldH / 2;
  // one "2D-view CSS pixel" in mm: the 2D view shows the field ~650 px tall
  const px = Math.max(fieldW, fieldH) / 650;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, L.width, L.height);
  c.setTransform(L.ppm, 0, 0, L.ppm, hw * L.ppm, hh * L.ppm);
  c.fillStyle = "#FFFFFF";
  c.fillRect(-hw, -hh, fieldW, fieldH);

  const g = world.gridSize && world.gridSize > 0 ? world.gridSize : 200;
  const bg = world.background ?? "plain";
  if (bg === "numberGrid") numberGrid(c, g, px, hw, hh, fieldW, fieldH);
  else if (bg === "grid") grid(c, g, px, hw, hh);

  for (const f of world.floor) floorShape(c, f);
  if (o.wallShadows) wallShadows(c, world.walls);
  if (o.showZones) for (const z of world.zones) zone(c, z, px);
}

function numberGrid(c: CanvasRenderingContext2D, g: number, px: number, hw: number, hh: number, fieldW: number, fieldH: number) {
  const cols = Math.ceil(fieldW / g - 1e-9);
  const rows = Math.ceil(fieldH / g - 1e-9);
  let family = "sans-serif";
  try { if (document.body) family = getComputedStyle(document.body).fontFamily || family; } catch { /* ignore */ }
  c.font = `${g * (2000 / 42 / 200)}px ${family}`;
  c.textAlign = "left";
  c.textBaseline = "top";
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = -hw + col * g;
      const yTop = hh - (r + 1) * g;
      c.fillStyle = (r + col) % 2 === 0 ? "#FBF6EE" : "#FFFFFF";
      c.fillRect(x, yTop, g, g);
      c.fillStyle = "#9A9186";
      c.fillText(String(gridSquareNumber(r, col, cols)), x + g * (12.5 / 200), yTop + g * (2000 / 180 / 200));
    }
  }
  c.strokeStyle = "#D9CFBF";
  c.lineWidth = px;
  c.beginPath();
  for (let i = 0; i <= cols; i++) { const x = -hw + i * g; c.moveTo(x, -hh); c.lineTo(x, hh); }
  for (let i = 0; i <= rows; i++) { const y = hh - i * g; c.moveTo(-hw, y); c.lineTo(hw, y); }
  c.stroke();
}

function grid(c: CanvasRenderingContext2D, g: number, px: number, hw: number, hh: number) {
  c.strokeStyle = "#EEE7DC";
  c.lineWidth = px;
  c.beginPath();
  for (let x = 0; x <= hw; x += g) { c.moveTo(x, -hh); c.lineTo(x, hh); if (x) { c.moveTo(-x, -hh); c.lineTo(-x, hh); } }
  for (let y = 0; y <= hh; y += g) { c.moveTo(-hw, y); c.lineTo(hw, y); if (y) { c.moveTo(-hw, -y); c.lineTo(hw, -y); } }
  c.stroke();
  c.strokeStyle = "#DDD2C2";
  c.lineWidth = 1.5 * px;
  c.beginPath();
  c.moveTo(0, -hh); c.lineTo(0, hh);
  c.moveTo(-hw, 0); c.lineTo(hw, 0);
  c.stroke();
}

function polyline(c: CanvasRenderingContext2D, pts: Vec[], width: number) {
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x, -pts[0].y, width / 2, 0, Math.PI * 2);
    c.fill();
    return;
  }
  c.beginPath();
  c.moveTo(pts[0].x, -pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, -pts[i].y);
  c.stroke();
}

function floorShape(c: CanvasRenderingContext2D, f: FloorShape) {
  if (f.color === "NONE") return;
  const col = COLOR_HEX[f.color];
  if (f.kind === "rect") {
    c.fillStyle = col;
    c.fillRect(f.x - f.w / 2, -f.y - f.h / 2, f.w, f.h);
  } else if (f.kind === "circle") {
    c.fillStyle = col;
    c.beginPath();
    c.arc(f.x, -f.y, Math.max(0, f.r), 0, Math.PI * 2);
    c.fill();
  } else if (f.points.length) {
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = f.width;
    c.lineJoin = "round";
    c.lineCap = "round";
    polyline(c, f.points, f.width);
  }
}

function wallShadows(c: CanvasRenderingContext2D, walls: Wall[]) {
  c.lineCap = "square";
  c.strokeStyle = "rgba(12,11,10,0.14)";
  for (const w of walls) {
    const t = Math.max(1, w.thickness);
    c.lineWidth = t * 1.6;
    c.beginPath();
    c.moveTo(w.a.x + t * 0.5, -w.a.y + t * 0.6);
    c.lineTo(w.b.x + t * 0.5, -w.b.y + t * 0.6);
    c.stroke();
  }
}

function zone(c: CanvasRenderingContext2D, z: Zone, px: number) {
  c.save();
  c.setLineDash([7 * px, 5 * px]);
  c.lineWidth = 2 * px;
  c.strokeStyle = "rgba(214,84,14,0.9)";
  c.fillStyle = "rgba(255,106,26,0.07)";
  c.beginPath();
  let lx: number;
  let ly: number;
  if (z.kind === "rect") {
    c.rect(z.x - z.w / 2, -z.y - z.h / 2, z.w, z.h);
    lx = z.x - z.w / 2 + 5 * px;
    ly = -z.y - z.h / 2 + 5 * px;
  } else {
    c.arc(z.x, -z.y, Math.max(0, z.r), 0, Math.PI * 2);
    lx = z.x - z.r * 0.7;
    ly = -z.y - z.r * 0.7;
  }
  c.fill();
  c.stroke();
  c.setLineDash([]);
  const label = z.label ?? z.id;
  if (label) {
    const fs = 12 * px;
    c.font = `600 ${fs}px ${MONO}`;
    c.textAlign = "left";
    c.textBaseline = "top";
    const tw = c.measureText(label).width;
    c.fillStyle = "rgba(255,253,249,0.9)";
    c.fillRect(lx - 3 * px, ly - 2 * px, tw + 6 * px, fs + 4 * px);
    c.fillStyle = DEEP;
    c.fillText(label, lx, ly);
  }
  c.restore();
}
