/**
 * Pure layout / view math for the renderer (no DOM, unit-tested in view.test.ts).
 *
 * Canvas space: CSS px, origin top-left, y down. World space: mm, origin at the field centre, y up.
 */

/** Zoom/pan. zoom 1 = the whole field fits; (cx, cy) = world mm shown at the canvas centre. */
export interface View { zoom: number; cx: number; cy: number }

/** s = CSS px per mm; (ox, oy) = CSS px of the field's left / top edge. */
export interface Layout { s: number; ox: number; oy: number; fieldW: number; fieldH: number }

/** Fit the field into the canvas with a small margin, then apply the optional view. */
export function computeLayout(cssW: number, cssH: number, fieldW: number, fieldH: number, view: View | null): Layout {
  const w = cssW > 0 ? cssW : 1;
  const h = cssH > 0 ? cssH : 1;
  const margin = Math.max(6, Math.min(w, h) * 0.025);
  let s = Math.min((w - 2 * margin) / fieldW, (h - 2 * margin) / fieldH);
  if (!(s > 0)) s = Math.min(w / fieldW, h / fieldH) || 0.01;
  if (!view) return { s, ox: (w - fieldW * s) / 2, oy: (h - fieldH * s) / 2, fieldW, fieldH };
  const zoom = view.zoom > 0 && Number.isFinite(view.zoom) ? view.zoom : 1;
  const cx = Number.isFinite(view.cx) ? view.cx : 0;
  const cy = Number.isFinite(view.cy) ? view.cy : 0;
  s *= zoom;
  // world (cx, cy) lands on the canvas centre
  return { s, ox: w / 2 - (cx + fieldW / 2) * s, oy: h / 2 - (fieldH / 2 - cy) * s, fieldW, fieldH };
}

export function layoutToWorld(L: Layout, px: number, py: number): { x: number; y: number } {
  return { x: (px - L.ox) / L.s - L.fieldW / 2, y: L.fieldH / 2 - (py - L.oy) / L.s };
}

export function layoutToCanvas(L: Layout, x: number, y: number): { px: number; py: number } {
  return { px: L.ox + (x + L.fieldW / 2) * L.s, py: L.oy + (L.fieldH / 2 - y) * L.s };
}
