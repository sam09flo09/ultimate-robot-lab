/**
 * 2D / 3D view switching for the playground.
 * The 3D renderer (src/render3d, Three.js) is loaded only when 3D is first turned on,
 * so the 2D app stays quick to open. If 3D is too slow on a Chromebook it drops to low
 * quality, then falls back to 2D.
 */
import type { Renderer, Renderer3D, CameraMode, Quality } from "../core/modules";
import { toast } from "./dom";

export type ViewMode = "2d" | "3d";
export interface ViewPrefs { view: ViewMode; camera: CameraMode; quality: Quality; }

const KEY = "robot-lab-view-v1";
const CAMERAS: CameraMode[] = ["orbit", "follow", "overhead"];

function readPrefs(): ViewPrefs {
  const p: ViewPrefs = { view: "2d", camera: "orbit", quality: "high" };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<ViewPrefs>;
    if (raw.view === "3d") p.view = "3d";
    if (CAMERAS.includes(raw.camera as CameraMode)) p.camera = raw.camera as CameraMode;
    if (raw.quality === "low") p.quality = "low";
  } catch { /* defaults */ }
  return p;
}
function savePrefs(p: ViewPrefs): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

export interface ViewSwitcher {
  /** The renderer currently on screen. */
  readonly renderer: Renderer;
  readonly is3D: boolean;
  /** Call once per animation frame, after drawing (watches 3D speed). */
  tick(dtSeconds: number, hidden: boolean): void;
  /** World changed: rebuild both renderers' caches. */
  invalidate(): void;
}

export function createViewSwitcher(o: {
  canvas2d: HTMLCanvasElement;
  canvas3d: HTMLCanvasElement;
  renderer2d: Renderer;
  /** Called after switching: the app should resize the active renderer and redraw. */
  onSwitch: () => void;
}): ViewSwitcher {
  const prefs = readPrefs();
  let r3d: Renderer3D | null = null;
  let active: Renderer = o.renderer2d;
  let loading = false;
  let watch = 0;           // seconds of 3D frames watched since the last quality change
  let slowFor = 0;         // seconds in a row the 3D view has been slow

  const viewBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-view]"));
  const camSel = document.getElementById("cameraSel") as HTMLSelectElement | null;
  const camReset = document.getElementById("cameraReset") as HTMLButtonElement | null;
  const camBox = document.getElementById("cameraBox");

  function paint(): void {
    const on = active !== o.renderer2d;
    for (const b of viewBtns) b.setAttribute("aria-checked", String(b.dataset.view === (on ? "3d" : "2d")));
    if (camBox) camBox.hidden = !on;
    if (camSel) camSel.value = prefs.camera;
    o.canvas2d.hidden = on;
    o.canvas3d.hidden = !on;
  }

  async function to3D(): Promise<void> {
    if (r3d || loading) return;
    loading = true;
    try {
      const mod = await import("../render3d");
      if (!mod.webglSupported()) {
        toast("3D isn't available on this device, so the playground stays in 2D.", 5000);
        prefs.view = "2d"; savePrefs(prefs); return;
      }
      o.canvas3d.hidden = false;          // must be visible to measure its size
      const made: Renderer3D = mod.createRenderer3D(o.canvas3d, { quality: prefs.quality });
      made.setCamera(prefs.camera);
      r3d = made;
      active = made;
      watch = 0; slowFor = 0;
      prefs.view = "3d"; savePrefs(prefs);
    } catch (e) {
      console.error(e);
      r3d = null; active = o.renderer2d;
      toast("3D couldn't start, so the playground stays in 2D.", 5000);
      prefs.view = "2d"; savePrefs(prefs);
    } finally {
      loading = false;
      paint();
      o.onSwitch();
    }
  }

  function to2D(remember = true): void {
    if (r3d) { try { r3d.dispose(); } catch (e) { console.error(e); } }
    r3d = null;
    active = o.renderer2d;
    if (remember) { prefs.view = "2d"; savePrefs(prefs); }
    paint();
    o.onSwitch();
  }

  for (const b of viewBtns) b.addEventListener("click", () => { if (b.dataset.view === "3d") void to3D(); else to2D(); });
  camSel?.addEventListener("change", () => {
    const c = camSel.value as CameraMode;
    if (!CAMERAS.includes(c)) return;
    prefs.camera = c; savePrefs(prefs);
    r3d?.setCamera(c);
  });
  camReset?.addEventListener("click", () => r3d?.resetCamera());

  paint();
  if (prefs.view === "3d") void to3D();

  return {
    get renderer() { return active; },
    get is3D() { return active !== o.renderer2d; },
    invalidate() { try { o.renderer2d.invalidate(); } catch { /* ignore */ } try { r3d?.invalidate(); } catch { /* ignore */ } },
    tick(dt, hidden) {
      if (!r3d || hidden) return;
      watch += dt;
      if (watch < 3) return;                       // let it warm up after a switch
      const ms = r3d.frameMs();
      slowFor = ms > 45 ? slowFor + dt : 0;        // under ~22 fps
      if (slowFor < 2) return;
      slowFor = 0; watch = 0;
      if (prefs.quality === "high") {
        prefs.quality = "low"; savePrefs(prefs);
        r3d.setQuality("low");
        toast("3D was running slowly, so it switched to simpler graphics.", 5000);
      } else {
        to2D(false);                               // keep "3d" saved? No: a slow device should open in 2D next time
        prefs.view = "2d"; savePrefs(prefs);
        toast("3D is too slow on this Chromebook, so the playground switched back to 2D.", 6000);
      }
    },
  };
}
