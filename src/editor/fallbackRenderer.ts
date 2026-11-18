/**
 * Minimal Renderer used ONLY by the editor preview page and tests, for when src/render isn't ready.
 * The real app uses createRenderer from "../render". Same contract (core/modules.ts Renderer).
 */
import type { Renderer, RenderOptions } from "../core/modules";
import type { SimState, World } from "../core/types";
import { COLOR_HEX } from "../core/types";

export function createFallbackRenderer(canvas: HTMLCanvasElement): Renderer {
  let cssW = 1, cssH = 1, dpr = 1;
  let scale = 0.3, ox = 0, oy = 0;
  let lastW = 2000, lastH = 2000;

  const fit = (w: number, h: number) => {
    lastW = w; lastH = h;
    const m = 16;
    scale = Math.max(0.01, Math.min((cssW - 2 * m) / w, (cssH - 2 * m) / h));
    ox = cssW / 2; oy = cssH / 2;
  };

  const r: Renderer = {
    invalidate() { /* no cache */ },
    resize() {
      dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      cssW = Math.max(1, canvas.clientWidth || canvas.width);
      cssH = Math.max(1, canvas.clientHeight || canvas.height);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      fit(lastW, lastH);
    },
    toWorld(px, py) {
      return { x: (px - ox) / scale, y: -(py - oy) / scale };
    },
    toCanvas(x, y) {
      return { px: ox + x * scale, py: oy - y * scale };
    },
    draw(world: World, state: SimState | null, opts: RenderOptions) {
      fit(world.width, world.height);
      const ctx = canvas.getContext?.("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#E9E0D2";
      ctx.fillRect(0, 0, cssW, cssH);
      const P = (x: number, y: number) => r.toCanvas(x, y);
      const tl = P(-world.width / 2, world.height / 2);
      const fw = world.width * scale, fh = world.height * scale;
      ctx.fillStyle = "#FFFDF9";
      ctx.fillRect(tl.px, tl.py, fw, fh);
      if (world.background !== "plain") {
        const g = world.gridSize ?? 200;
        ctx.strokeStyle = "rgba(12,11,10,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -world.width / 2; x <= world.width / 2 + 0.1; x += g) {
          const a = P(x, world.height / 2), b = P(x, -world.height / 2);
          ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
        }
        for (let y = -world.height / 2; y <= world.height / 2 + 0.1; y += g) {
          const a = P(-world.width / 2, y), b = P(world.width / 2, y);
          ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py);
        }
        ctx.stroke();
      }
      const sel = opts.selectedId ?? null;
      for (const f of world.floor) {
        ctx.fillStyle = ctx.strokeStyle = COLOR_HEX[f.color];
        if (f.kind === "rect") {
          const c = P(f.x - f.w / 2, f.y + f.h / 2);
          ctx.fillRect(c.px, c.py, f.w * scale, f.h * scale);
        } else if (f.kind === "circle") {
          const c = P(f.x, f.y);
          ctx.beginPath(); ctx.arc(c.px, c.py, f.r * scale, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.lineWidth = f.width * scale; ctx.lineCap = ctx.lineJoin = "round";
          ctx.beginPath();
          f.points.forEach((p, i) => { const c = P(p.x, p.y); if (i) ctx.lineTo(c.px, c.py); else ctx.moveTo(c.px, c.py); });
          ctx.stroke();
        }
      }
      if (opts.showZones) {
        ctx.setLineDash([6, 4]);
        for (const z of world.zones) {
          ctx.strokeStyle = z.id === sel ? "#FF6A1A" : "#D6540E";
          ctx.lineWidth = z.id === sel ? 3 : 2;
          ctx.fillStyle = "rgba(255,106,26,0.08)";
          ctx.beginPath();
          if (z.kind === "rect") { const c = P(z.x - z.w / 2, z.y + z.h / 2); ctx.rect(c.px, c.py, z.w * scale, z.h * scale); }
          else { const c = P(z.x, z.y); ctx.arc(c.px, c.py, z.r * scale, 0, Math.PI * 2); }
          ctx.fill(); ctx.stroke();
          if (z.label) {
            const c = P(z.x, z.y);
            ctx.fillStyle = "#D6540E"; ctx.font = "12px ui-monospace, monospace"; ctx.textAlign = "center";
            ctx.fillText(z.label, c.px, c.py + 4);
          }
        }
        ctx.setLineDash([]);
      }
      ctx.lineCap = "round";
      for (const w of world.walls) {
        const a = P(w.a.x, w.a.y), b = P(w.b.x, w.b.y);
        ctx.strokeStyle = w.id === sel ? "#FF6A1A" : "#0C0B0A";
        ctx.lineWidth = Math.max(2, w.thickness * scale);
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      }
      ctx.lineCap = "butt";
      for (const o of state?.objects ?? world.objects) {
        const c = P(o.x, o.y);
        ctx.fillStyle = COLOR_HEX[o.color];
        ctx.strokeStyle = o.id === sel ? "#FF6A1A" : "#0C0B0A";
        ctx.lineWidth = o.id === sel ? 3 : 1.5;
        ctx.beginPath();
        if (o.shape === "disk") ctx.arc(c.px, c.py, (o.size / 2) * scale, 0, Math.PI * 2);
        else {
          ctx.save(); ctx.translate(c.px, c.py); ctx.rotate(((o.rotation ?? 0) * Math.PI) / 180);
          const s = o.size * scale; ctx.rect(-s / 2, -s / 2, s, s); ctx.restore();
        }
        ctx.fill(); ctx.stroke();
      }
      const pose = state?.robot ?? world.start;
      const rs = (state?.robotSize ?? 140) * scale;
      const c = P(pose.x, pose.y);
      if (sel === "start") {
        ctx.strokeStyle = "#FF6A1A"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(c.px, c.py, rs * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(c.px, c.py);
      ctx.rotate((pose.heading * Math.PI) / 180);
      ctx.fillStyle = "#0C0B0A";
      ctx.fillRect(-rs / 2, -rs / 2, rs, rs);
      ctx.fillStyle = "#FF6A1A";
      ctx.beginPath(); ctx.moveTo(0, -rs / 2 + 2); ctx.lineTo(rs / 4, 0); ctx.lineTo(-rs / 4, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#0C0B0A"; ctx.lineWidth = 3;
      ctx.strokeRect(tl.px, tl.py, fw, fh);
    },
  };
  r.resize();
  return r;
}
