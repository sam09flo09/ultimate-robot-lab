import { describe, expect, it } from "vitest";
import { computeLayout, layoutToCanvas, layoutToWorld } from "./view";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("renderer view math", () => {
  it("null view = whole field fits, centred (unchanged default behaviour)", () => {
    const L = computeLayout(800, 600, 2000, 2000, null);
    const margin = Math.max(6, 600 * 0.025);
    close(L.s, (600 - 2 * margin) / 2000);
    const c = layoutToCanvas(L, 0, 0);
    close(c.px, 400); close(c.py, 300);
    const tl = layoutToCanvas(L, -1000, 1000);
    close(tl.px, L.ox); close(tl.py, L.oy);
  });

  it("zoom 1 centred view is identical to null", () => {
    const a = computeLayout(1024, 700, 3000, 3000, null);
    const b = computeLayout(1024, 700, 3000, 3000, { zoom: 1, cx: 0, cy: 0 });
    close(a.s, b.s); close(a.ox, b.ox); close(a.oy, b.oy);
  });

  it("puts (cx, cy) at the canvas centre and scales by zoom", () => {
    const base = computeLayout(900, 600, 3000, 3000, null);
    const L = computeLayout(900, 600, 3000, 3000, { zoom: 4, cx: 1200, cy: -800 });
    close(L.s, base.s * 4);
    const c = layoutToCanvas(L, 1200, -800);
    close(c.px, 450); close(c.py, 300);
    // +y world is up on screen
    expect(layoutToCanvas(L, 1200, -700).py).toBeLessThan(300);
  });

  it("toWorld / toCanvas round-trip at any zoom", () => {
    for (const view of [null, { zoom: 1, cx: 0, cy: 0 }, { zoom: 2.5, cx: -300, cy: 410 }, { zoom: 6, cx: 1500, cy: -1500 }]) {
      const L = computeLayout(1366, 700, 3000, 2000, view);
      for (const [x, y] of [[0, 0], [-1500, 1000], [123.4, -987.6], [1499, -1]]) {
        const c = layoutToCanvas(L, x, y);
        const w = layoutToWorld(L, c.px, c.py);
        close(w.x, x); close(w.y, y);
      }
      for (const [px, py] of [[0, 0], [683, 350], [1366, 700], [17.5, 640.25]]) {
        const w = layoutToWorld(L, px, py);
        const c = layoutToCanvas(L, w.x, w.y);
        close(c.px, px); close(c.py, py);
      }
    }
  });

  it("ignores junk views", () => {
    const a = computeLayout(500, 500, 2000, 2000, { zoom: NaN, cx: Infinity, cy: 0 });
    const b = computeLayout(500, 500, 2000, 2000, null);
    close(a.s, b.s); close(a.ox, b.ox); close(a.oy, b.oy);
  });
});
