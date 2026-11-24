/**
 * Pictures for the notebook: the field + robot path drawn with the normal 2D renderer on an
 * offscreen canvas (never on screen), and an optional flowchart picture if the flowchart mode
 * exposes an export function at runtime.
 */
import type { World, SimState } from "../core/types";
import type { Renderer } from "../core/modules";
import { THUMB_PX, MAX_THUMB } from "./types";

export type RendererFactory = (canvas: HTMLCanvasElement) => Renderer;

/** Draw world + state (with path) into a canvas whose longest side is `longest` px. */
export function renderField(make: RendererFactory, world: World, state: SimState | null, longest: number): HTMLCanvasElement | null {
  try {
    const w = world.width > 0 ? world.width : 2000, hgt = world.height > 0 ? world.height : 2000;
    const k = longest / Math.max(w, hgt);
    const canvas = document.createElement("canvas");
    // A small margin around the field (the renderer fits the field inside the canvas).
    canvas.width = Math.max(16, Math.round(w * k));
    canvas.height = Math.max(16, Math.round(hgt * k));
    const r = make(canvas);
    r.resize();
    r.draw(world, state, { showPath: true, showSensors: false, showZones: true, selectedId: null });
    return canvas;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Small JPEG thumbnail data URL (≤ THUMB_PX, ≤ MAX_THUMB chars), or null. */
export function fieldThumb(make: RendererFactory, world: World, state: SimState | null): string | null {
  const c = renderField(make, world, state, THUMB_PX);
  if (!c) return null;
  try {
    for (const q of [0.6, 0.45, 0.3]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.startsWith("data:image/jpeg;base64,") && url.length <= MAX_THUMB) return url;
    }
  } catch { /* tainted / unsupported */ }
  return null;
}

/** High-resolution field picture for printing (PNG data URL), or null. */
export function fieldPicture(make: RendererFactory, world: World, state: SimState | null, longest = 1600): string | null {
  const c = renderField(make, world, state, longest);
  if (!c) return null;
  try { return c.toDataURL("image/png"); } catch { return null; }
}

type AnyFn = (...a: unknown[]) => unknown;
/**
 * The flowchart mode (another part of Robot Lab) may expose a picture export. We look for it at
 * runtime and skip the flowchart when there is none. Accepts an image data URL or SVG markup
 * (or a Promise of either).
 */
export function findFlowchartExport(win: unknown = typeof window !== "undefined" ? window : undefined): (() => Promise<string | null>) | null {
  const w = win as Record<string, unknown> | undefined;
  if (!w) return null;
  const cands: [unknown, string][] = [];
  for (const host of ["__robotLabFlowchart", "robotLabFlowchart"]) {
    const o = w[host] as Record<string, unknown> | undefined;
    if (o && typeof o === "object") for (const m of ["exportImage", "toDataURL", "exportPng", "exportSvg", "toSvg"]) cands.push([o, m]);
  }
  const rl = w.__robotLab as Record<string, unknown> | undefined;
  if (rl && typeof rl === "object") for (const m of ["flowchartImage", "exportFlowchart"]) cands.push([rl, m]);
  for (const [o, m] of cands) {
    const fn = (o as Record<string, unknown>)[m];
    if (typeof fn !== "function") continue;
    return async () => {
      try { return toImageUrl(await (fn as AnyFn).call(o)); } catch { return null; }
    };
  }
  return null;
}

/** Normalise an export result to an image data URL (or null). */
export function toImageUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(s)) return s;
  if (s.startsWith("<svg")) return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
  return null;
}
