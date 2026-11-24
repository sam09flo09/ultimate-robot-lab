/**
 * builder: 2D drawing of the parts a Robot Builder design changes. Drawn in the robot's local
 * frame (front = −y, units mm, robot centred at 0,0). The default robot draws nothing extra,
 * so it looks exactly as before.
 */
import type { RobotConfig } from "../core/types";

/** Wheel length along the robot, as a fraction of the default wheel (100 mm → 0.64 × size). */
export function wheelLength(size: number, cfg: RobotConfig | undefined): number {
  const wd = cfg ? cfg.wheelDiameter : 100;
  return Math.min(size * 0.92, size * 0.64 * (wd / 100));
}

/** Motor housings (4-motor robots), gear badge (geared robots), sensor mount (offset sensors). */
export function drawRobotParts(
  c: CanvasRenderingContext2D, size: number, cfg: RobotConfig | undefined, stalled: boolean, px: number,
): void {
  const h = size / 2;
  if (stalled) {
    // wheels spinning in place: short orange slip arcs beside each wheel
    c.strokeStyle = "rgba(255,106,26,0.9)";
    c.lineWidth = Math.max(1.5 * px, size * 0.025);
    c.lineCap = "round";
    const t = (typeof performance !== "undefined" ? performance.now() : 0) / 90;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const y = -size * 0.3 + ((k * size * 0.3 + (t * size * 0.06)) % (size * 0.6));
        c.beginPath();
        c.moveTo(sx * (h + size * 0.12), y);
        c.lineTo(sx * (h + size * 0.2), y + size * 0.06);
        c.stroke();
      }
    }
  }
  if (!cfg) return;
  if (cfg.motors === 4) {
    c.fillStyle = "#6B635A";
    const mw = size * 0.16, mh = size * 0.2;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      c.fillRect(sx * (h - size * 0.12) - mw / 2, sy * size * 0.26 - mh / 2, mw, mh);
    }
  }
  if (cfg.gearRatio !== 1) {
    // a small cog on the back of the body: orange = torque gearing, blue = speed gearing
    const r = size * 0.1, cy = size * 0.26;
    c.fillStyle = cfg.gearRatio > 1 ? "#FF6A1A" : "#2F6FD6";
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? r : r * 1.3;
      if (i === 0) c.moveTo(Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else c.lineTo(Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.fillStyle = "#1F1C19";
    c.beginPath();
    c.arc(0, cy, r * 0.4, 0, Math.PI * 2);
    c.fill();
  }
  if (cfg.sensorOffset !== 0) {
    c.fillStyle = "#2F6FD6";
    c.strokeStyle = "#FFFFFF";
    c.lineWidth = Math.max(px, size * 0.015);
    c.beginPath();
    c.arc(cfg.sensorOffset, -h + size * 0.02, size * 0.045, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
}
