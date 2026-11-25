// Robot Lab blocks editor (Blockly 13). Public entry: createBlocksEditor(host, opts).
import * as Blockly from "blockly";
import type { BlocksEditor, BlocksOptions } from "../core/modules";
import { AUTO_HAT_TYPE, DRIVER_HAT_TYPE, HAT_TYPE, registerBlocks } from "./definitions";
import { generateProgram, type GeneratedProgram } from "./generator";
import { MEDIA_PATH } from "./media";
import { RENDERER_OVERRIDES, robotLabTheme } from "./theme";
import { buildToolbox, searchableBlocks } from "./toolbox";
import { ensureHat, loadState, refreshOrphans, saveState } from "./workspace";

export { generateProgram } from "./generator";
export { HAT_TYPE } from "./definitions";

const CSS = `
.rl-blocks{position:relative;width:100%;height:100%;overflow:hidden;background:#FDF9F2}
.rl-blocks-ws{position:absolute;inset:0}
.rl-blocks-search{position:absolute;top:10px;right:14px;z-index:20;display:flex;align-items:center;gap:6px;
  background:#FFFDF9;border:2px solid #E9E0D2;border-radius:10px;padding:0 6px 0 10px;height:42px;
  box-shadow:0 1px 3px rgba(12,11,10,.08)}
.rl-blocks-search:focus-within{border-color:#FF6A1A}
.rl-blocks-search input{border:0;outline:0;background:transparent;font:600 14px/1 ui-monospace,Menlo,Consolas,monospace;
  color:#0C0B0A;width:150px;height:38px}
.rl-blocks-search button{border:0;background:transparent;font-size:18px;color:#0C0B0A;min-width:32px;height:32px;cursor:pointer;border-radius:6px}
.rl-blocks-search button:hover{background:#E9E0D2}
.rl-blocks.rl-ro .rl-blocks-search,.rl-blocks.rl-ro .blocklyToolbox{opacity:.45;pointer-events:none}
.rl-blocks .blocklyToolbox{font-family:ui-monospace,Menlo,Consolas,monospace;}
.rl-blocks .blocklyToolboxCategory{min-height:44px;display:flex;align-items:center;padding-right:10px}
.rl-blocks .blocklyTreeRow,.rl-blocks .blocklyToolboxCategoryContainer{min-height:44px}
.rl-blocks .blocklyToolboxCategoryLabel,.rl-blocks .blocklyTreeLabel{font-size:14px;font-weight:700;color:#0C0B0A}
.blocklyToolboxDelete,.blocklyToolboxDelete .blocklyToolboxCategoryLabel{cursor:not-allowed!important}
.blocklyToolboxGrab{cursor:grabbing!important}
.rl-blocks .blocklyHighlighted>.blocklyPath{stroke:#FF6A1A!important;stroke-width:4px!important;filter:drop-shadow(0 0 6px rgba(255,106,26,.85))}
.rl-blocks .blocklyFlyoutLabelText{font-family:ui-monospace,Menlo,Consolas,monospace;fill:#0C0B0A;font-size:13px;font-weight:700}
`;
let cssAdded = false;
function addCss() {
  if (cssAdded || typeof document === "undefined") return;
  cssAdded = true;
  const el = document.createElement("style");
  el.textContent = CSS;
  document.head.appendChild(el);
}

let rendererRegistered = false;
function registerRenderer() {
  if (rendererRegistered) return;
  rendererRegistered = true;
  // Our own renderer name so overrides don't leak into other Blockly users on the page.
  class RobotLabRenderer extends Blockly.thrasos.Renderer {}
  try { Blockly.blockRendering.register("robot-lab", RobotLabRenderer); } catch { /* already */ }
}

export function createBlocksEditor(host: HTMLElement, opts: BlocksOptions): BlocksEditor {
  registerBlocks();
  registerRenderer();
  addCss();

  let hardware = { ...opts.hardware };
  const root = document.createElement("div");
  root.className = "rl-blocks";
  const wsDiv = document.createElement("div");
  wsDiv.className = "rl-blocks-ws";
  root.appendChild(wsDiv);

  // ---- toolbox search
  const search = document.createElement("label");
  search.className = "rl-blocks-search";
  search.innerHTML = `<span aria-hidden="true">&#9906;</span><input type="text" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="find a block" aria-label="Find a block"><button type="button" aria-label="Clear search" hidden>&times;</button>`;
  const input = search.querySelector("input")!;
  const clearBtn = search.querySelector("button")!;
  root.appendChild(search);
  host.appendChild(root);

  const ws = Blockly.inject(wsDiv, {
    toolbox: buildToolbox(hardware),
    theme: robotLabTheme(),
    renderer: "robot-lab",
    rendererOverrides: RENDERER_OVERRIDES,
    trashcan: true,
    sounds: false,
    media: MEDIA_PATH,
    maxInstances: { [HAT_TYPE]: 1, [AUTO_HAT_TYPE]: 1, [DRIVER_HAT_TYPE]: 1 }, // match: one of each hat
    grid: { spacing: 32, length: 4, colour: "#E9E0D2", snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.95, maxScale: 2.2, minScale: 0.45, scaleSpeed: 1.15, pinch: true },
    move: { scrollbars: true, drag: true, wheel: false },
    oneBasedIndex: true,
  });

  let suppress = 0;
  let dirty = true;
  let program: GeneratedProgram | null = null;
  const current = () => {
    if (dirty || !program) { program = generateProgram(ws); dirty = false; }
    return program;
  };

  ws.addChangeListener(Blockly.Events.disableOrphans);
  ws.addChangeListener((e: Blockly.Events.Abstract) => {
    if (e.isUiEvent) return;
    dirty = true;
    if (suppress === 0) opts.onChange();
  });

  /** Scroll so the top-left of the program sits just inside the visible area. */
  const frameStart = () => {
    const tops = ws.getTopBlocks(true);
    if (!tops.length) return;
    const xy = tops.reduce((a, b) => {
      const p = b.getRelativeToSurfaceXY();
      return { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y) };
    }, { x: Infinity, y: Infinity });
    const s = ws.scale;
    ws.scroll(-(xy.x * s) + 24, -(xy.y * s) + 40);
  };
  loadState(ws, null);
  frameStart();

  // ---- search behaviour
  const showMatches = () => {
    const q = input.value.trim().toLowerCase();
    clearBtn.hidden = q === "";
    const toolbox = ws.getToolbox() as Blockly.Toolbox | null;
    const flyout = toolbox?.getFlyout();
    if (!toolbox || !flyout) return;
    if (!q) { flyout.hide(); return; }
    const terms = q.split(/\s+/);
    const hits = searchableBlocks(hardware).filter((b) => terms.every((t) => b.words.includes(t))).map((b) => b.item);
    toolbox.clearSelection();
    flyout.show({ kind: "flyoutToolbox", contents: hits.length ? hits : [{ kind: "label", text: "No blocks match" }] } as unknown as Blockly.utils.toolbox.FlyoutDefinition);
  };
  input.addEventListener("input", showMatches);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { input.value = ""; showMatches(); input.blur(); } });
  clearBtn.addEventListener("click", () => { input.value = ""; showMatches(); input.focus(); });
  ws.addChangeListener((e: Blockly.Events.Abstract) => {
    if (e.type === Blockly.Events.TOOLBOX_ITEM_SELECT && input.value) { input.value = ""; clearBtn.hidden = true; }
  });

  let highlighted: string | null = null;
  const editor: BlocksEditor = {
    getPython: () => current().code,
    getState: () => saveState(ws),
    setState(state: unknown) {
      suppress++;
      try { loadState(ws, state); } finally { suppress--; }
      frameStart();
      dirty = true;
      highlighted = null;
    },
    highlightLine(line: number) {
      const map = current().lineMap;
      const id = line > 0 ? map[line - 1] ?? null : null;
      if (id === highlighted) return;
      highlighted = id && ws.getBlockById(id) ? id : null;
      ws.highlightBlock(highlighted);
    },
    setHardware(hw) {
      if (hw.pen === hardware.pen && hw.magnet === hardware.magnet && !!hw.arm === !!hardware.arm) return; // arm
      hardware = { ...hw };
      ws.updateToolbox(buildToolbox(hardware));
      if (input.value) showMatches();
    },
    setReadOnly(ro: boolean) {
      if (ro) { input.value = ""; showMatches(); (ws.getToolbox() as Blockly.Toolbox | null)?.clearSelection(); }
      ws.setIsReadOnly(ro);
      root.classList.toggle("rl-ro", ro);
    },
    resize() { Blockly.svgResize(ws); },
    dispose() {
      ws.dispose();
      root.remove();
    },
  };
  return editor;
}

// Re-export for app/test convenience.
export { ensureHat, loadState, refreshOrphans, saveState };
