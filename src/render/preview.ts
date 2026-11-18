/** Manual preview for the renderer: `npx vite` then open /src/render/preview.html */
import type { SimState, Vec, World } from "../core/types";
import { PLAYGROUNDS } from "../worlds";
import { createRenderer, type RobotLabRenderer } from "./index";

function selectableId(w: World): string | null {
  return w.walls[0]?.id ?? w.objects[0]?.id ?? w.zones[0]?.id ?? w.floor[0]?.id ?? "start";
}

function fakeState(w: World): SimState {
  const objects = w.objects.map((o) => ({ ...o }));
  const strokes = w.hardware?.pen
    ? [{ color: "BLUE" as const, width: 8, points: [] as Vec[] }]
    : [];
  return {
    time: 0,
    robot: { ...w.start },
    robotSize: 140,
    objects,
    carrying: w.hardware?.magnet && objects.length ? objects[objects.length - 1].id : null,
    penDown: !!w.hardware?.pen,
    penColor: "BLUE",
    strokes,
    path: [{ x: w.start.x, y: w.start.y }],
    wallHits: 0,
    bumperPressed: false,
    distanceRay: null,
    visitedZones: [],
  };
}

interface Item { world: World; state: SimState; r: RobotLabRenderer; canvas: HTMLCanvasElement; info: HTMLElement; t: number }

const grid = document.getElementById("grid")!;
const items: Item[] = [];
for (const world of PLAYGROUNDS) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h2></h2><p class="d"></p><canvas></canvas><div class="info">hover the field</div>`;
  card.querySelector("h2")!.textContent = `${world.name} — ${world.id} (${world.width}×${world.height})`;
  card.querySelector(".d")!.textContent = world.description ?? "";
  grid.appendChild(card);
  const canvas = card.querySelector("canvas")!;
  const info = card.querySelector(".info") as HTMLElement;
  const r = createRenderer(canvas);
  const item: Item = { world, state: fakeState(world), r, canvas, info, t: 0 };
  items.push(item);
  canvas.addEventListener("pointermove", (e) => {
    const p = r.toWorld(e.offsetX, e.offsetY);
    const back = r.toCanvas(p.x, p.y);
    info.textContent = `x ${Math.round(p.x)}  y ${Math.round(p.y)}   (round trip ${back.px.toFixed(1)}, ${back.py.toFixed(1)})`;
  });
  canvas.addEventListener("click", () => { big.world = world; big.state = fakeState(world); big.t = 0; });
}

const bigCanvas = document.getElementById("big") as HTMLCanvasElement;
const big: Item = {
  world: PLAYGROUNDS[0], state: fakeState(PLAYGROUNDS[0]), r: createRenderer(bigCanvas), canvas: bigCanvas,
  info: document.createElement("div"), t: 0,
};
items.push(big);

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Drive the fake robot along a gentle curve from the start pose; record path + pen stroke + ray. */
function advance(it: Item, dt: number) {
  it.t += dt;
  const st = it.state;
  const turnRate = 40 * Math.sin(it.t * 0.6); // deg/s, wanders left and right
  st.robot.heading = (st.robot.heading + turnRate * dt + 360) % 360;
  const v = 120; // mm/s
  const h = (st.robot.heading * Math.PI) / 180;
  const half = it.world.width / 2 - 110;
  const halfY = it.world.height / 2 - 110;
  st.robot.x = Math.max(-half, Math.min(half, st.robot.x + Math.sin(h) * v * dt));
  st.robot.y = Math.max(-halfY, Math.min(halfY, st.robot.y + Math.cos(h) * v * dt));
  st.time = it.t;
  const last = st.path[st.path.length - 1];
  if (Math.hypot(last.x - st.robot.x, last.y - st.robot.y) > 15) {
    st.path.push({ x: st.robot.x, y: st.robot.y });
    if (st.strokes.length) st.strokes[0].points.push({ x: st.robot.x, y: st.robot.y });
  }
  if (it.t > 24) { it.state = fakeState(it.world); it.t = 0; return; }
  const from = { x: st.robot.x + Math.sin(h) * 70, y: st.robot.y + Math.cos(h) * 70 };
  const len = 250 + 150 * Math.sin(it.t);
  st.distanceRay = { from, to: { x: from.x + Math.sin(h) * len, y: from.y + Math.cos(h) * len }, hit: len < 360 };
  st.bumperPressed = Math.sin(it.t * 1.3) > 0.9;
}

let lastT = performance.now();
let frames = 0;
let fpsT = lastT;
const fpsEl = document.getElementById("fps")!;

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const animate = $("animate").checked;
  for (const it of items) {
    if (animate) advance(it, dt);
    it.r.draw(it.world, $("nullstate").checked ? null : it.state, {
      showPath: $("path").checked,
      showSensors: $("sensors").checked,
      showZones: $("zones").checked,
      selectedId: $("select").checked ? selectableId(it.world) : null,
    });
  }
  frames++;
  if (now - fpsT > 1000) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps (${items.length} canvases)`;
    frames = 0;
    fpsT = now;
  }
  requestAnimationFrame(frame);
}

function resizeAll() { for (const it of items) it.r.resize(); }
window.addEventListener("resize", resizeAll);
resizeAll();
requestAnimationFrame(frame);

// Expose for quick console checks: also render a null-state frame (level-editor mode) on demand.
(window as unknown as { __preview: unknown }).__preview = {
  items,
  drawNull(i = 0) {
    const it = items[i];
    it.r.draw(it.world, null, { showPath: false, showSensors: false, showZones: true, selectedId: "start" });
  },
};
