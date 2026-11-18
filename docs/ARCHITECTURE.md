# Robot Lab — Architecture

Goal: an original, offline-capable classroom robot simulator for student Chromebooks
(a self-made alternative to VEXcode VR). Blocks + Python, 2D top-down, sensors, several playgrounds,
teacher-made challenges, pen + magnet. No accounts: students save `.robolab` files to Drive and turn
them in through Google Classroom. No student data leaves the browser.

Reference implementation: `docs/reference/Grid Robot Sim.html` (the original single-file sim; its
friendly-error wording, line highlighting and step log are the behaviour to keep).

## Stack
Vite 8 + TypeScript (strict), no UI framework. Blockly 13 (blocks), CodeMirror 6 (Python editor),
Skulpt (Python in the browser, loaded from `public/vendor/skulpt.bundle.js` + `skulpt-stdlib.js`
as classic `<script>` tags, exposing global `Sk`). vite-plugin-pwa for offline install. Vitest for tests.
Hosted as a static site (GitHub Pages or any static host).

## Performance budget (Chromebooks: weak CPUs, 4 GB RAM, 1366×768 screens)
- 60 fps target, must stay usable at 30 fps. Renderer draws static layers (floor, walls, grid) to an
  offscreen canvas once per world and blits it each frame.
- Sim step is O(walls + objects) per tick; fixed substep of 1/120 s.
- Layout must fit 1366×768 with no page scroll; also 1280×800 and touch (some Chromebooks are tablets).

## Data flow
```
            ┌──────────── src/main.ts + src/ui (app shell) ────────────┐
            │  rAF loop: sim.step(realDt * speed); renderer.draw(...)   │
 blocks ──► python source ──► runtime (Skulpt) ──► RobotController ──► sim ──► SimState ──► renderer
 (Blockly)    or CodeMirror        awaits promises      (sim/)          goals ──► UI "challenge complete"
```
- Time only advances in `sim.step`. Controller promises resolve inside `step`. So Speed (0.5×/1×/2.5×)
  is just a multiplier on dt, and runs are deterministic for a given dt sequence.
- The app loop must keep stepping when the tab is hidden (rAF pauses) — fall back to setTimeout,
  as the original `nextFrame()` did.
- Stop: `runner.stop()` + `sim.abort()`. Reset: `sim.reset()`.

## Folder ownership (one owner per folder; do not edit other folders — ask the integrator)
| folder | owner | public entry |
|---|---|---|
| `src/core/` | integrator | `types.ts`, `modules.ts` (contracts) |
| `src/sim/` | sim agent | `createSim(world)` |
| `src/render/` + `src/worlds/` | render/worlds agent | `createRenderer(canvas)`, `PLAYGROUNDS` |
| `src/runtime/` | python agent | `createPythonRunner(opts)` |
| `src/blocks/` | blocks agent | `createBlocksEditor(host, opts)` |
| `src/editor/` | level-editor agent | `createLevelEditor(host, opts)` |
| `src/ui/`, `src/main.ts`, `index.html`, `public/icons` | app-shell agent | — |

Each agent may add tests as `*.test.ts` inside its own folder. Do not add npm dependencies;
if one is truly needed, say so in the final report.

## Design language
Carry over the original sim's look: cream/paper background, ink text, orange accent
(`--cream #FDF9F2 --ink #0C0B0A --orange #FF6A1A --deep #D6540E --sand #E9E0D2 --paper #FFFDF9`),
mono labels, large tap targets (≥40 px). Original art only — no VEX logos, robot likenesses or
playground names from other products.
