/**
 * Robot Lab renderer (Canvas 2D).
 *
 * Two layers:
 *  - a STATIC layer (background, floor paint, walls, zones) drawn once to an offscreen canvas and
 *    rebuilt only when the world object identity, canvas size, DPR or showZones changes;
 *  - a DYNAMIC layer drawn every frame on top: pen strokes, path, objects, distance ray, robot,
 *    carried object, editor selection.
 *
 * Drawing happens in "field space": millimetres, origin at the field centre, y pointing DOWN
 * (screen-style). A world point (x, y) is drawn at (x, -y). Headings are clockwise, so a
 * heading h maps directly to ctx.rotate(+h). This keeps the robot drawing identical to the
 * original sim (front = local -y).
 *
 * The canvas must be sized by CSS (e.g. width/height 100%); call resize() whenever that size changes.
 */
import type { ColorName, FloorShape, SimState, Wall, World, WorldObject, Zone } from "../core/types";
import { COLOR_HEX } from "../core/types";
import type { RenderOptions, Renderer } from "../core/modules";

const INK = "#0C0B0A";
const ORANGE = "#FF6A1A";
const DEEP = "#D6540E";
const CREAM = "#FDF9F2";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const DEG = Math.PI / 180;
const DEFAULT_ROBOT = 140;

export interface RobotLabRenderer extends Renderer {
  /** Force the static layer to rebuild on the next draw (use after mutating a world in place). */
  invalidate(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): RobotLabRenderer {
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d") as CanvasRenderingContext2D;

  // layout (CSS px)
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let fieldW = 2000;
  let fieldH = 2000;
  let s = 1; // CSS px per mm
  let ox = 0; // CSS px of field's left edge
  let oy = 0; // CSS px of field's top edge
  let sized = false;

  // static cache key
  let cacheWorld: World | null = null;
  let cacheZones = false;
  let dirty = true;

  // reusable dash arrays (in mm, refreshed by layout())
  const dashZone = [0, 0];
  const dashRay = [0, 0];
  const dashSel = [0, 0];
  const noDash: number[] = [];

  function layout() {
    const w = cssW > 0 ? cssW : 1;
    const h = cssH > 0 ? cssH : 1;
    const margin = Math.max(6, Math.min(w, h) * 0.025);
    s = Math.min((w - 2 * margin) / fieldW, (h - 2 * margin) / fieldH);
    if (!(s > 0)) s = Math.min(w / fieldW, h / fieldH) || 0.01;
    ox = (w - fieldW * s) / 2;
    oy = (h - fieldH * s) / 2;
    dashZone[0] = 7 / s; dashZone[1] = 5 / s;
    dashRay[0] = 5 / s; dashRay[1] = 4 / s;
    dashSel[0] = 6 / s; dashSel[1] = 4 / s;
  }

  function resize() {
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2.5));
    cssW = canvas.clientWidth || canvas.width / dpr;
    cssH = canvas.clientHeight || canvas.height / dpr;
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    if (layer.width !== pw) layer.width = pw;
    if (layer.height !== ph) layer.height = ph;
    sized = true;
    layout();
    dirty = true;
  }

  /** Field-space transform: mm, origin at field centre, y down. */
  function toField(c: CanvasRenderingContext2D) {
    const k = dpr * s;
    c.setTransform(k, 0, 0, k, dpr * (ox + (fieldW / 2) * s), dpr * (oy + (fieldH / 2) * s));
  }

  // ------------------------------------------------------------ static layer

  function buildStatic(world: World, showZones: boolean) {
    const c = lctx;
    const px = 1 / s; // one CSS pixel in mm
    const hw = fieldW / 2;
    const hh = fieldH / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = CREAM;
    c.fillRect(0, 0, layer.width, layer.height);

    toField(c);
    // soft drop shadow under the board
    c.fillStyle = "rgba(12,11,10,0.07)";
    c.fillRect(-hw + 4 * px, -hh + 5 * px, fieldW, fieldH);
    c.fillStyle = "#FFFFFF";
    c.fillRect(-hw, -hh, fieldW, fieldH);

    c.save();
    c.beginPath();
    c.rect(-hw, -hh, fieldW, fieldH);
    c.clip();

    const g = world.gridSize && world.gridSize > 0 ? world.gridSize : 200;
    const bg = world.background ?? "plain";
    if (bg === "numberGrid") drawNumberGrid(c, g, px);
    else if (bg === "grid") drawGrid(c, g, px);

    for (const f of world.floor) drawFloor(c, f);
    drawWalls(c, world.walls);
    c.restore();

    // border (the implicit solid wall)
    c.strokeStyle = INK;
    c.lineWidth = 3 * px;
    // drawn just outside the field so it never covers the edge squares' numbers
    c.strokeRect(-hw - 1.5 * px, -hh - 1.5 * px, fieldW + 3 * px, fieldH + 3 * px);

    if (showZones) for (const z of world.zones) drawZone(c, z, px);
  }

  function drawNumberGrid(c: CanvasRenderingContext2D, g: number, px: number) {
    const hw = fieldW / 2;
    const hh = fieldH / 2;
    const cols = Math.ceil(fieldW / g - 1e-9);
    const rows = Math.ceil(fieldH / g - 1e-9);
    let family = "sans-serif";
    try {
      if (document.body) family = getComputedStyle(document.body).fontFamily || family;
    } catch { /* ignore */ }
    // Original: font W/42 px on a 2000 mm board = 0.238 of a 200 mm square; offsets W/160, W/180.
    c.font = `${g * (2000 / 42 / 200)}px ${family}`;
    c.textAlign = "left";
    c.textBaseline = "top";
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const n = r * cols + col + 1;
        const x = -hw + col * g;
        const yTop = hh - (r + 1) * g; // field-space y of the square's top edge
        c.fillStyle = (r + col) % 2 === 0 ? "#FBF6EE" : "#FFFFFF";
        c.fillRect(x, yTop, g, g);
        c.fillStyle = "#9A9186";
        c.fillText(String(n), x + g * (12.5 / 200), yTop + g * (2000 / 180 / 200));
      }
    }
    c.strokeStyle = "#D9CFBF";
    c.lineWidth = px;
    c.beginPath();
    for (let i = 0; i <= cols; i++) { const x = -hw + i * g; c.moveTo(x, -hh); c.lineTo(x, hh); }
    for (let i = 0; i <= rows; i++) { const y = hh - i * g; c.moveTo(-hw, y); c.lineTo(hw, y); }
    c.stroke();
  }

  function drawGrid(c: CanvasRenderingContext2D, g: number, px: number) {
    const hw = fieldW / 2;
    const hh = fieldH / 2;
    c.strokeStyle = "#EEE7DC";
    c.lineWidth = px;
    c.beginPath();
    // lines are anchored at the field centre so the axes always fall on a line
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

  function drawFloor(c: CanvasRenderingContext2D, f: FloorShape) {
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

  function drawWalls(c: CanvasRenderingContext2D, walls: Wall[]) {
    if (!walls.length) return;
    c.lineCap = "square";
    c.lineJoin = "miter";
    // pass 1: shadows, pass 2: bodies, pass 3: top highlight
    for (let pass = 0; pass < 3; pass++) {
      for (const w of walls) {
        const t = Math.max(1, w.thickness);
        let dx = 0;
        let dy = 0;
        if (pass === 0) { c.strokeStyle = "rgba(12,11,10,0.16)"; c.lineWidth = t; dx = t * 0.22; dy = t * 0.3; }
        else if (pass === 1) { c.strokeStyle = "#35302B"; c.lineWidth = t; }
        else { c.strokeStyle = "rgba(255,253,249,0.16)"; c.lineWidth = t * 0.32; dx = -t * 0.12; dy = -t * 0.14; }
        c.beginPath();
        c.moveTo(w.a.x + dx, -w.a.y + dy);
        c.lineTo(w.b.x + dx, -w.b.y + dy);
        c.stroke();
      }
    }
  }

  function drawZone(c: CanvasRenderingContext2D, z: Zone, px: number) {
    c.save();
    c.setLineDash(dashZone);
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
    c.setLineDash(noDash);
    const label = z.label ?? z.id;
    if (label) {
      const fs = 11 * px;
      c.font = `600 ${fs}px ${MONO}`;
      c.textAlign = "left";
      c.textBaseline = "top";
      const tw = c.measureText(label).width;
      c.fillStyle = "rgba(255,253,249,0.88)";
      c.fillRect(lx - 3 * px, ly - 2 * px, tw + 6 * px, fs + 4 * px);
      c.fillStyle = DEEP;
      c.fillText(label, lx, ly);
    }
    c.restore();
  }

  // ------------------------------------------------------------ shared helpers

  function polyline(c: CanvasRenderingContext2D, pts: { x: number; y: number }[], width: number) {
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

  function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ------------------------------------------------------------ dynamic layer

  /** Object drawn centred at the current origin (field space, already rotated for boxes). */
  function objectShape(c: CanvasRenderingContext2D, o: WorldObject, px: number) {
    const col = o.color === "NONE" ? "#C9C0B3" : COLOR_HEX[o.color];
    const h = o.size / 2;
    if (o.shape === "disk") {
      c.fillStyle = "rgba(12,11,10,0.18)";
      c.beginPath(); c.arc(h * 0.12, h * 0.16, h, 0, Math.PI * 2); c.fill();
      c.fillStyle = col;
      c.beginPath(); c.arc(0, 0, h, 0, Math.PI * 2); c.fill();
      c.lineWidth = Math.max(1.5 * px, o.size * 0.05);
      c.strokeStyle = "rgba(12,11,10,0.6)";
      c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = o.size * 0.05;
      c.beginPath(); c.arc(0, 0, h * 0.62, 0, Math.PI * 2); c.stroke();
      if (o.pickable) {
        c.fillStyle = "#A7AFB8";
        c.beginPath(); c.arc(0, 0, h * 0.2, 0, Math.PI * 2); c.fill();
      }
    } else {
      c.fillStyle = "rgba(12,11,10,0.18)";
      c.fillRect(-h + h * 0.12, -h + h * 0.16, o.size, o.size);
      c.fillStyle = col;
      c.fillRect(-h, -h, o.size, o.size);
      c.lineWidth = Math.max(1.5 * px, o.size * 0.05);
      c.strokeStyle = o.movable ? "rgba(12,11,10,0.6)" : INK;
      c.strokeRect(-h, -h, o.size, o.size);
      c.strokeStyle = "rgba(255,255,255,0.4)";
      c.lineWidth = o.size * 0.04;
      c.strokeRect(-h * 0.6, -h * 0.6, h * 1.2, h * 1.2);
      if (o.pickable) {
        c.fillStyle = "#A7AFB8";
        c.fillRect(-h * 0.2, -h * 0.2, h * 0.4, h * 0.4);
      }
    }
  }

  function drawObject(c: CanvasRenderingContext2D, o: WorldObject, px: number) {
    c.save();
    c.translate(o.x, -o.y);
    if (o.shape === "box" && o.rotation) c.rotate(o.rotation * DEG);
    objectShape(c, o, px);
    c.restore();
  }

  function drawRobot(
    c: CanvasRenderingContext2D,
    x: number, y: number, heading: number, size: number,
    hw: { pen?: boolean; magnet?: boolean },
    penDown: boolean, penColor: ColorName, bumper: boolean, carrying: boolean, px: number,
  ) {
    const h = size / 2;
    c.save();
    c.translate(x, -y);
    c.rotate(heading * DEG);
    // shadow
    c.fillStyle = "rgba(12,11,10,0.2)";
    roundRect(c, -h + size * 0.05, -h + size * 0.07, size, size, size * 0.18);
    c.fill();
    // wheels (as the original), with tread marks
    c.fillStyle = "#3A3631";
    c.fillRect(-h - size * 0.08, -size * 0.32, size * 0.12, size * 0.64);
    c.fillRect(h - size * 0.04, -size * 0.32, size * 0.12, size * 0.64);
    c.strokeStyle = "#5A534B";
    c.lineWidth = Math.max(px, size * 0.015);
    c.beginPath();
    for (let i = -3; i <= 3; i++) {
      const ty = i * size * 0.09;
      c.moveTo(-h - size * 0.08, ty); c.lineTo(-h + size * 0.04, ty);
      c.moveTo(h - size * 0.04, ty); c.lineTo(h + size * 0.08, ty);
    }
    c.stroke();
    // body
    c.fillStyle = INK;
    roundRect(c, -h, -h, size, size, size * 0.18);
    c.fill();
    c.fillStyle = "#1F1C19";
    roundRect(c, -h + size * 0.1, -h + size * 0.1, size * 0.8, size * 0.8, size * 0.12);
    c.fill();
    // bumper bar on the front edge
    const bw = size * 0.72;
    const bh = size * 0.07;
    if (bumper) {
      c.fillStyle = "rgba(255,106,26,0.35)";
      roundRect(c, -bw / 2 - size * 0.06, -h - bh - size * 0.07, bw + size * 0.12, bh + size * 0.12, size * 0.06);
      c.fill();
    }
    c.fillStyle = bumper ? ORANGE : "#4A443D";
    roundRect(c, -bw / 2, -h - bh * 0.6, bw, bh, bh / 2);
    c.fill();
    // front arrow (as the original)
    c.fillStyle = ORANGE;
    c.beginPath();
    c.moveTo(0, -size * 0.4);
    c.lineTo(size * 0.24, -size * 0.02);
    c.lineTo(-size * 0.24, -size * 0.02);
    c.closePath();
    c.fill();
    // magnet: a small steel horseshoe at the front
    if (hw.magnet) {
      const mw = size * 0.24;
      const mh = size * 0.11;
      const my = -h - bh * 0.6 - mh * 0.75;
      c.fillStyle = carrying ? "#FF8A47" : "#A7AFB8";
      roundRect(c, -mw / 2, my, mw, mh, mh * 0.35);
      c.fill();
      c.fillStyle = "#D63B2F";
      c.fillRect(-mw / 2, my, mw * 0.22, mh * 0.45);
      c.fillRect(mw / 2 - mw * 0.22, my, mw * 0.22, mh * 0.45);
    }
    // pen holder on the back half of the body
    if (hw.pen) {
      const pr = size * 0.085;
      const py = size * 0.22;
      c.beginPath();
      c.arc(0, py, pr, 0, Math.PI * 2);
      if (penDown) {
        c.fillStyle = penColor === "NONE" ? "#9A9186" : COLOR_HEX[penColor];
        c.fill();
        c.lineWidth = Math.max(1.5 * px, size * 0.025);
        c.strokeStyle = "#FFFDF9";
        c.stroke();
      } else {
        c.lineWidth = Math.max(1.5 * px, size * 0.025);
        c.strokeStyle = "#8A8279";
        c.stroke();
      }
    }
    c.restore();
  }

  function drawCarried(c: CanvasRenderingContext2D, o: WorldObject, x: number, y: number, heading: number, size: number, px: number) {
    c.save();
    c.translate(x, -y);
    c.rotate(heading * DEG);
    c.translate(0, -(size / 2 + o.size / 2 + size * 0.06));
    objectShape(c, o, px);
    c.restore();
  }

  function selectionOutline(c: CanvasRenderingContext2D, world: World, id: string, robotX: number, robotY: number, robotSize: number, px: number): boolean {
    const pad = 6 * px;
    for (const w of world.walls) {
      if (w.id === id) {
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(w.a.x, -w.a.y);
        c.lineTo(w.b.x, -w.b.y);
        c.lineWidth = w.thickness + 2 * pad;
        c.strokeStyle = "rgba(255,106,26,0.35)";
        c.stroke();
        c.lineWidth = 2 * px;
        c.strokeStyle = ORANGE;
        c.stroke();
        // endpoint handles
        c.fillStyle = ORANGE;
        c.beginPath(); c.arc(w.a.x, -w.a.y, 4 * px, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(w.b.x, -w.b.y, 4 * px, 0, Math.PI * 2); c.fill();
        return true;
      }
    }
    for (const o of world.objects) {
      if (o.id === id) {
        c.save();
        c.translate(o.x, -o.y);
        c.beginPath();
        if (o.shape === "box") {
          if (o.rotation) c.rotate(o.rotation * DEG);
          c.rect(-o.size / 2 - pad, -o.size / 2 - pad, o.size + 2 * pad, o.size + 2 * pad);
        } else c.arc(0, 0, o.size / 2 + pad, 0, Math.PI * 2);
        c.restore();
        return true;
      }
    }
    for (const z of world.zones) {
      if (z.id === id) {
        c.beginPath();
        if (z.kind === "rect") c.rect(z.x - z.w / 2 - pad, -z.y - z.h / 2 - pad, z.w + 2 * pad, z.h + 2 * pad);
        else c.arc(z.x, -z.y, z.r + pad, 0, Math.PI * 2);
        return true;
      }
    }
    for (const f of world.floor) {
      if (f.id === id) {
        if (f.kind === "line") {
          if (!f.points.length) return false;
          c.lineJoin = "round";
          c.lineCap = "round";
          c.lineWidth = f.width + 2 * pad;
          c.strokeStyle = "rgba(255,106,26,0.35)";
          polyline(c, f.points, f.width + 2 * pad);
          c.fillStyle = ORANGE;
          for (let i = 0; i < f.points.length; i++) {
            c.beginPath(); c.arc(f.points[i].x, -f.points[i].y, 3 * px, 0, Math.PI * 2); c.fill();
          }
          return true;
        }
        c.beginPath();
        if (f.kind === "rect") c.rect(f.x - f.w / 2 - pad, -f.y - f.h / 2 - pad, f.w + 2 * pad, f.h + 2 * pad);
        else c.arc(f.x, -f.y, f.r + pad, 0, Math.PI * 2);
        return true;
      }
    }
    if (id === "start" || id === "robot") {
      c.beginPath();
      c.arc(robotX, -robotY, robotSize * 0.75 + pad, 0, Math.PI * 2);
      return true;
    }
    return false;
  }

  function draw(world: World, state: SimState | null, opts: RenderOptions) {
    if (!sized) resize();
    if (world.width !== fieldW || world.height !== fieldH) {
      fieldW = world.width > 0 ? world.width : 2000;
      fieldH = world.height > 0 ? world.height : 2000;
      layout();
      dirty = true;
    }
    const showZones = !!opts.showZones;
    if (dirty || world !== cacheWorld || showZones !== cacheZones) {
      buildStatic(world, showZones);
      cacheWorld = world;
      cacheZones = showZones;
      dirty = false;
    }
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(layer, 0, 0);
    toField(c);
    const px = 1 / s;

    const robot = state ? state.robot : world.start;
    const size = state && state.robotSize > 0 ? state.robotSize : DEFAULT_ROBOT;
    const objects = state ? state.objects : world.objects;
    const carryingId = state ? state.carrying : null;
    const hw = world.hardware ?? {};

    // path breadcrumb (original style), under the pen ink so drawings stay visible
    if (opts.showPath && state && state.path.length) {
      const p = state.path;
      c.strokeStyle = "rgba(214,84,14,0.75)";
      c.lineWidth = Math.max(fieldW, fieldH) / 220;
      c.lineJoin = "round";
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(p[0].x, -p[0].y);
      for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, -p[i].y);
      c.lineTo(robot.x, -robot.y);
      c.stroke();
    }

    // pen strokes
    if (state && state.strokes.length) {
      c.lineJoin = "round";
      c.lineCap = "round";
      for (let i = 0; i < state.strokes.length; i++) {
        const st = state.strokes[i];
        if (!st.points.length || st.color === "NONE") continue;
        c.strokeStyle = COLOR_HEX[st.color];
        c.fillStyle = c.strokeStyle;
        c.lineWidth = st.width > 0 ? st.width : 8;
        polyline(c, st.points, c.lineWidth);
      }
    }

    // objects
    let carried: WorldObject | null = null;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (carryingId !== null && o.id === carryingId) { carried = o; continue; }
      drawObject(c, o, px);
    }

    // distance ray
    if (opts.showSensors && state && state.distanceRay) {
      const r = state.distanceRay;
      c.setLineDash(dashRay);
      c.lineCap = "butt";
      c.lineWidth = 1.5 * px;
      c.strokeStyle = "rgba(47,111,214,0.55)";
      c.beginPath();
      c.moveTo(r.from.x, -r.from.y);
      c.lineTo(r.to.x, -r.to.y);
      c.stroke();
      c.setLineDash(noDash);
      c.beginPath();
      c.arc(r.to.x, -r.to.y, (r.hit ? 4.5 : 3) * px, 0, Math.PI * 2);
      if (r.hit) {
        c.fillStyle = "#2F6FD6";
        c.fill();
        c.lineWidth = 1.5 * px;
        c.strokeStyle = "#FFFFFF";
        c.stroke();
      } else {
        c.lineWidth = 1.5 * px;
        c.strokeStyle = "rgba(47,111,214,0.55)";
        c.stroke();
      }
    }

    drawRobot(
      c, robot.x, robot.y, robot.heading, size, hw,
      state ? state.penDown : false, state ? state.penColor : "BLACK",
      state ? state.bumperPressed : false, carried !== null, px,
    );
    if (carried) drawCarried(c, carried, robot.x, robot.y, robot.heading, size, px);

    // editor selection
    if (opts.selectedId) {
      c.save();
      if (selectionOutline(c, world, opts.selectedId, robot.x, robot.y, size, px)) {
        c.setLineDash(dashSel);
        c.lineWidth = 2 * px;
        c.strokeStyle = ORANGE;
        c.stroke();
      }
      c.restore();
    }
  }

  return {
    draw,
    resize,
    invalidate() { dirty = true; },
    toWorld(px: number, py: number) {
      return { x: (px - ox) / s - fieldW / 2, y: fieldH / 2 - (py - oy) / s };
    },
    toCanvas(x: number, y: number) {
      return { px: ox + (x + fieldW / 2) * s, py: oy + (fieldH / 2 - y) * s };
    },
  };
}
