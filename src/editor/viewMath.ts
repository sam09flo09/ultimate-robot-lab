/**
 * Pure zoom/pan math for the level editor canvas (no DOM). See Renderer.setView in core/modules.ts:
 * zoom 1 = whole field fits; (cx, cy) = world mm shown at the canvas centre.
 */
import type { Vec } from "../core/types";

export interface EditorView { zoom: number; cx: number; cy: number }

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const FIT_VIEW: EditorView = { zoom: 1, cx: 0, cy: 0 };

/** Zoom in [MIN_ZOOM, MAX_ZOOM]; the canvas centre must stay over the field, so the field can never
 *  be panned entirely off-screen (at worst a field edge sits at the centre of the canvas).
 *  At the minimum zoom the view is always "fit" (centred). */
export function clampView(v: EditorView, fieldW: number, fieldH: number): EditorView {
  const zoom = Number.isFinite(v.zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom)) : 1;
  if (zoom <= MIN_ZOOM) return { ...FIT_VIEW };
  const hw = Math.max(0, fieldW / 2), hh = Math.max(0, fieldH / 2);
  const cx = Number.isFinite(v.cx) ? Math.min(hw, Math.max(-hw, v.cx)) : 0;
  const cy = Number.isFinite(v.cy) ? Math.min(hh, Math.max(-hh, v.cy)) : 0;
  return { zoom, cx, cy };
}

/**
 * The view at `zoom` that puts world point `anchor` under canvas point `at`.
 * `baseScale` = CSS px per mm at zoom 1; `centre` = canvas centre in CSS px.
 * Used for zoom-around-cursor and for two-finger pinch + pan.
 */
export function viewWithAnchor(zoom: number, anchor: Vec, at: { px: number; py: number }, centre: { px: number; py: number }, baseScale: number): EditorView {
  const s = baseScale * zoom;
  return { zoom, cx: anchor.x - (at.px - centre.px) / s, cy: anchor.y + (at.py - centre.py) / s };
}

/** Pan by a screen-pixel delta (content follows the pointer). */
export function panBy(v: EditorView, dpx: number, dpy: number, scale: number): EditorView {
  return { zoom: v.zoom, cx: v.cx - dpx / scale, cy: v.cy + dpy / scale };
}

/** Zoom factor for one wheel event. ctrl+wheel (trackpad pinch) is more sensitive per unit. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const dy = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = ctrlKey ? 0.01 : 0.002;
  return Math.exp(-Math.max(-300, Math.min(300, dy)) * k);
}
