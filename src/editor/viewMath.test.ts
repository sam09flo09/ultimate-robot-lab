import { describe, expect, it } from "vitest";
import { clampView, FIT_VIEW, MAX_ZOOM, panBy, viewWithAnchor, wheelZoomFactor } from "./viewMath";
import { computeLayout, layoutToCanvas, layoutToWorld } from "../render/view";

describe("editor view math", () => {
  it("clamps zoom to 1–6× and snaps to fit at 1×", () => {
    expect(clampView({ zoom: 0.2, cx: 500, cy: 500 }, 3000, 3000)).toEqual(FIT_VIEW);
    expect(clampView({ zoom: 99, cx: 0, cy: 0 }, 3000, 3000).zoom).toBe(MAX_ZOOM);
  });

  it("keeps the canvas centre over the field (never panned fully off-screen)", () => {
    expect(clampView({ zoom: 3, cx: 9000, cy: -9000 }, 3000, 2000)).toEqual({ zoom: 3, cx: 1500, cy: -1000 });
    expect(clampView({ zoom: 3, cx: 100, cy: 200 }, 3000, 2000)).toEqual({ zoom: 3, cx: 100, cy: 200 });
  });

  it("zooming about a point keeps the world point under it fixed", () => {
    const W = 1000, H = 700, F = 3000;
    const v0 = { zoom: 2, cx: 300, cy: -200 };
    const L0 = computeLayout(W, H, F, F, v0);
    const at = { px: 820, py: 130 };
    const anchor = layoutToWorld(L0, at.px, at.py);
    const v1 = viewWithAnchor(5, anchor, at, { px: W / 2, py: H / 2 }, L0.s / v0.zoom);
    const L1 = computeLayout(W, H, F, F, v1);
    const c = layoutToCanvas(L1, anchor.x, anchor.y);
    expect(Math.abs(c.px - at.px)).toBeLessThan(1e-6);
    expect(Math.abs(c.py - at.py)).toBeLessThan(1e-6);
    expect(L1.s / L0.s).toBeCloseTo(2.5, 9);
  });

  it("panning moves content with the pointer", () => {
    const W = 800, H = 600, F = 3000;
    const v0 = { zoom: 3, cx: 0, cy: 0 };
    const L0 = computeLayout(W, H, F, F, v0);
    const p = layoutToCanvas(L0, 250, 250);
    const L1 = computeLayout(W, H, F, F, panBy(v0, 40, -25, L0.s));
    const q = layoutToCanvas(L1, 250, 250);
    expect(q.px - p.px).toBeCloseTo(40, 9);
    expect(q.py - p.py).toBeCloseTo(-25, 9);
  });

  it("wheel up zooms in, wheel down zooms out", () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(-3, 1, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-10, 0, true)).toBeGreaterThan(wheelZoomFactor(-10, 0, false));
  });
});
