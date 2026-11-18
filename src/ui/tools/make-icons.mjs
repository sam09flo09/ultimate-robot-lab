#!/usr/bin/env node
/**
 * Draws the Robot Lab app icons (original art) with no dependencies:
 *   public/icons/icon-192.png, icon-512.png, icon.svg
 * Run: node src/ui/tools/make-icons.mjs
 *
 * The art: an orange tile with a top-down robot (ink body, two wheels, cream heading arrow)
 * and a dashed path trail. Content stays inside the central 80% so it also works as a maskable icon.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../public/icons");
mkdirSync(out, { recursive: true });

const C = { orange: [255, 106, 26], ink: [12, 11, 10], wheel: [58, 54, 49], cream: [253, 249, 242], trail: [255, 225, 201] };

// Shapes in a 0..100 design space, painted in order.
const inRoundRect = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r), dy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) <= r;
};
const inTri = (x, y, [ax, ay], [bx, by], [cx, cy]) => {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
function shade(x, y, full) {
  let col = null;
  if (full || inRoundRect(x, y, 50, 50, 100, 100, 22)) col = C.orange;
  if (!col) return null;
  // dashed trail coming in from bottom-left
  for (let i = 0; i < 3; i++) if (inRoundRect(x, y, 22 + i * 0, 86 - i * 11, 6, 7, 3)) col = C.trail;
  if (inRoundRect(x, y, 30, 62, 7, 6, 3) || inRoundRect(x, y, 40, 62, 7, 6, 3)) col = C.trail;
  // wheels
  if (inRoundRect(x, y, 32, 46, 9, 30, 3.5) || inRoundRect(x, y, 78, 46, 9, 30, 3.5)) col = C.wheel;
  // body
  if (inRoundRect(x, y, 55, 46, 40, 40, 8)) col = C.ink;
  // heading arrow
  if (inTri(x, y, [55, 31], [66, 50], [44, 50])) col = C.orange;
  if (inRoundRect(x, y, 55, 57, 14, 4, 2)) col = C.cream;
  return col;
}

function png(size, full) {
  const SS = 4, raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = ((px + (sx + 0.5) / SS) / size) * 100, y = ((py + (sy + 0.5) / SS) / size) * 100;
        const c = shade(x, y, full);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync(resolve(out, "icon-192.png"), png(192, false));
writeFileSync(resolve(out, "icon-512.png"), png(512, false));
writeFileSync(resolve(out, "icon-maskable-512.png"), png(512, true));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#FF6A1A"/>
  <g fill="#FFE1C9"><rect x="19" y="82.5" width="6" height="7" rx="3"/><rect x="19" y="71.5" width="6" height="7" rx="3"/><rect x="19" y="60.5" width="6" height="7" rx="3"/><rect x="26.5" y="59" width="7" height="6" rx="3"/><rect x="36.5" y="59" width="7" height="6" rx="3"/></g>
  <g fill="#3A3631"><rect x="27.5" y="31" width="9" height="30" rx="3.5"/><rect x="73.5" y="31" width="9" height="30" rx="3.5"/></g>
  <rect x="35" y="26" width="40" height="40" rx="8" fill="#0C0B0A"/>
  <path d="M55 31 L66 50 L44 50 Z" fill="#FF6A1A"/>
  <rect x="48" y="55" width="14" height="4" rx="2" fill="#FDF9F2"/>
</svg>
`;
writeFileSync(resolve(out, "icon.svg"), svg);
console.log("icons written to", out);
