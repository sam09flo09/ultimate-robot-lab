/**
 * Manual test page: `npx vite` then open /src/editor/preview.html
 * Uses the real renderer from src/render if it exists, otherwise the editor's fallback renderer.
 */
import type { Renderer } from "../core/modules";
import type { World } from "../core/types";
import { mountLevelEditor, type RendererFactory } from "./editor";
import { createFallbackRenderer } from "./fallbackRenderer";
import { newBlankWorld } from "./levelFile";

function sampleWorld(): World {
  const w = newBlankWorld();
  w.name = "Sample: deliver the disk";
  w.description = "Push the red disk into zone A without touching the walls.";
  w.walls.push({ id: "wall1", a: { x: -600, y: 0 }, b: { x: 400, y: 0 }, thickness: 20 });
  w.floor.push({ kind: "line", id: "paint1", points: [{ x: 0, y: -700 }, { x: 0, y: -300 }, { x: 600, y: -300 }], width: 25, color: "BLACK" });
  w.objects.push({ id: "obj1", shape: "disk", x: 600, y: -100, size: 100, color: "RED", movable: true, pickable: false });
  w.zones.push({ id: "zone1", kind: "rect", x: 600, y: 600, w: 400, h: 400, label: "A" });
  w.goals.push({ type: "objectsInZone", zone: "zone1", count: 1, color: "RED" }, { type: "noWallHits" });
  return w;
}

async function pickRenderer(): Promise<{ factory: RendererFactory; name: string }> {
  const mods = import.meta.glob("../render/index.ts");
  const load = mods["../render/index.ts"];
  if (load) {
    try {
      const m = (await load()) as { createRenderer?: (c: HTMLCanvasElement) => Renderer };
      if (typeof m.createRenderer === "function") return { factory: m.createRenderer, name: "src/render" };
    } catch (e) {
      console.warn("[editor preview] real renderer failed to load, using fallback", e);
    }
  }
  return { factory: createFallbackRenderer, name: "fallback" };
}

void (async () => {
  const { factory, name } = await pickRenderer();
  console.info(`[editor preview] renderer: ${name}`);
  const host = document.getElementById("host")!;
  const editor = mountLevelEditor(host, {
    world: sampleWorld(),
    onChange: (w) => console.debug("[editor preview] onChange", w),
    onTest: (w) => {
      console.info("[editor preview] onTest", w);
      alert(`Test this level: "${w.name}" — ${w.walls.length} walls, ${w.objects.length} objects, ${w.goals.length} goals.\n(Full world logged to the console.)`);
    },
  }, factory);
  (window as unknown as { editor: unknown }).editor = editor;
})();
