/** Manual preview for the 3D renderer: `npx vite` then open /src/render3d/preview.html.
 *  Drives the REAL sim with a scripted sequence and draws the same state with the 2D renderer beside it. */
import type { CameraMode, Quality } from "../core/modules";
import type { Sim, World } from "../core/types";
import { createSim } from "../sim";
import { PLAYGROUNDS } from "../worlds";
import { createRenderer } from "../render";
import { createRenderer3D, webglSupported } from "./index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const c3 = $<HTMLCanvasElement>("c3");
const c2 = $<HTMLCanvasElement>("c2");
const log = $("log");
const stats = $("stats");

let quality: Quality = "high";
let r3 = createRenderer3D(c3, { quality });
const r2 = createRenderer(c2);
let world: World = PLAYGROUNDS[0];
let sim: Sim = createSim(world);
let gen = 0;

const sel = $<HTMLSelectElement>("world");
for (const w of PLAYGROUNDS) {
  const o = document.createElement("option");
  o.value = w.id;
  o.textContent = `${w.name} (${w.width}×${w.height})`;
  sel.appendChild(o);
}
sel.onchange = () => loadWorld(PLAYGROUNDS.find((w) => w.id === sel.value) ?? PLAYGROUNDS[0]);

async function script(s: Sim, w: World, my: number) {
  const c = s.controller;
  const alive = () => my === gen;
  c.setDriveVelocity(50);
  c.setTurnVelocity(40);
  const pen = !!w.hardware?.pen;
  const colors = ["BLUE", "RED", "GREEN", "ORANGE"] as const;
  if (pen) { c.setPenColor("BLUE"); c.penDown(true); }
  if (w.hardware?.magnet) {
    // colour-depot: grab the red disk ahead and carry it toward the red bin
    await c.driveFor("FORWARD", 220);
    c.magnet(true);
    await c.turnFor("LEFT", 25);
    await c.driveFor("FORWARD", 700);
    await c.turnFor("RIGHT", 60);
    await c.driveFor("FORWARD", 200);
    c.magnet(false);
    await c.driveFor("REVERSE", 250);
  }
  for (let i = 0; i < 4 && alive(); i++) {
    if (pen) c.setPenColor(colors[i]);
    await c.driveFor("FORWARD", 400);
    await c.turnFor("RIGHT", 90);
  }
  await c.turnFor("LEFT", 30);
  await c.driveFor("FORWARD", 3000); // runs into something: bumper flash
  await c.wait(0.8);
  await c.driveFor("REVERSE", 250);
  await c.turnFor("LEFT", 120);
  await c.wait(1);
}

function startScript() {
  const my = ++gen;
  const s = sim;
  const loop = () => {
    script(s, world, my).then(() => {
      if (my !== gen) return;
      s.reset();
      loop();
    }).catch(() => { /* STOPPED */ });
  };
  loop();
}

function loadWorld(w: World) {
  sim.abort();
  world = w;
  sim = createSim(w);
  startScript();
}

function setCam(m: CameraMode) {
  r3.setCamera(m);
  document.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) => b.classList.toggle("on", b.dataset.cam === m));
}
document.querySelectorAll<HTMLButtonElement>("[data-cam]").forEach((b) => { b.onclick = () => setCam(b.dataset.cam as CameraMode); });
$("reset").onclick = () => r3.resetCamera();
$("quality").onclick = () => {
  quality = quality === "high" ? "low" : "high";
  r3.setQuality(quality);
  $("quality").textContent = `Quality: ${quality}`;
};
$("restart").onclick = () => { sim.abort(); sim.reset(); startScript(); };
$("stress").onclick = () => stress(20);

function opts() {
  return {
    showPath: ($("path") as HTMLInputElement).checked,
    showSensors: ($("sensors") as HTMLInputElement).checked,
    showZones: ($("zones") as HTMLInputElement).checked,
  };
}

function stress(n: number) {
  const cam = r3.camera;
  const errors: string[] = [];
  const infos: string[] = [];
  for (let i = 0; i < n; i++) {
    try {
      r3.dispose();
      r3 = createRenderer3D(c3, { quality: i % 2 ? "low" : "high" });
      r3.draw(world, sim.state, opts());
      const d = r3.debugInfo();
      if (i === 0 || i === n - 1) infos.push(`#${i + 1}: geo ${d.geometries} tex ${d.textures} prog ${d.programs}`);
    } catch (e) {
      errors.push(String(e));
    }
  }
  r3.dispose();
  r3 = createRenderer3D(c3, { quality });
  setCam(cam);
  const msg = `stress ×${n}: ${errors.length ? "ERRORS " + errors.join("; ") : "ok"} — ${infos.join(" | ")}`;
  log.textContent = msg;
  console.log(msg);
  return { errors, infos };
}

let last = performance.now();
let statT = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (($("run") as HTMLInputElement).checked) sim.step(dt);
  const o = opts();
  r3.draw(world, sim.state, o);
  r2.draw(world, sim.state, o);
  if (now - statT > 250) {
    statT = now;
    const d = r3.debugInfo();
    stats.textContent = `frameMs ${r3.frameMs().toFixed(2)} · calls ${d.calls} · tris ${d.triangles} · geo ${d.geometries} tex ${d.textures} prog ${d.programs}`;
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => { r3.resize(); r2.resize(); });
if (!webglSupported()) log.textContent = "WebGL2 not supported";
setCam("orbit");
r3.resize();
r2.resize();
startScript();
requestAnimationFrame(frame);

(window as unknown as { __p: unknown }).__p = {
  get r3() { return r3; }, r2, get sim() { return sim; }, get world() { return world; }, stress, setCam, loadWorld,
  PLAYGROUNDS,
  /** Compare the on-screen direction of the robot's heading in the 3D overhead view and the 2D view. */
  headingCheck() {
    const p = sim.state.robot;
    const h = (p.heading * Math.PI) / 180;
    const fx = p.x + Math.sin(h) * 100, fy = p.y + Math.cos(h) * 100;
    const a3 = r3.toCanvas(p.x, p.y), b3 = r3.toCanvas(fx, fy);
    const a2 = r2.toCanvas(p.x, p.y), b2 = r2.toCanvas(fx, fy);
    const ang3 = Math.atan2(b3.py - a3.py, b3.px - a3.px) * 180 / Math.PI;
    const ang2 = Math.atan2(b2.py - a2.py, b2.px - a2.px) * 180 / Math.PI;
    const back = r3.toWorld(a3.px, a3.py);
    return { heading: p.heading, ang3, ang2, roundTrip: { x: back.x - p.x, y: back.y - p.y } };
  },
};
