// Workspace helpers that work both headless (tests) and in the injected editor.
import * as Blockly from "blockly";
import { HAT_TYPE, registerBlocks } from "./definitions";

const ORPHAN = "ORPHANED_BLOCK"; // same reason id Blockly.Events.disableOrphans uses
const ROOTS = new Set([HAT_TYPE, "procedures_defnoreturn", "procedures_defreturn"]);

/** Exactly one non-deletable "when started" hat. */
export function ensureHat(ws: Blockly.Workspace): Blockly.Block {
  registerBlocks();
  const hats = ws.getBlocksByType(HAT_TYPE, true);
  for (const extra of hats.slice(1)) extra.dispose(true);
  let hat = hats[0];
  if (!hat) {
    hat = Blockly.serialization.blocks.append({ type: HAT_TYPE, x: 40, y: 40 }, ws, { recordUndo: false });
  }
  hat.setDeletable(false);
  return hat;
}

/** Greys out (disables) every block that isn't under the hat or a My Blocks definition. */
export function refreshOrphans(ws: Blockly.Workspace): void {
  for (const b of ws.getAllBlocks(false)) {
    const root = b.getRootBlock();
    const orphan = !ROOTS.has(root.type) && !!(root.previousConnection || root.outputConnection);
    if (orphan !== b.hasDisabledReason(ORPHAN)) b.setDisabledReason(orphan, ORPHAN);
  }
}

export function saveState(ws: Blockly.Workspace): unknown {
  return Blockly.serialization.workspaces.save(ws);
}

/** Loads a saved workspace; null/garbage gives a fresh workspace with just the hat. */
export function loadState(ws: Blockly.Workspace, state: unknown): void {
  registerBlocks();
  const ok = !!state && typeof state === "object" && !Array.isArray(state);
  Blockly.Events.disable();
  try {
    ws.clear();
    if (ok) {
      try {
        Blockly.serialization.workspaces.load(state as Record<string, unknown>, ws, { recordUndo: false });
      } catch (err) {
        console.warn("[blocks] could not load saved blocks, starting fresh", err);
        ws.clear();
      }
    }
    ensureHat(ws);
    refreshOrphans(ws);
  } finally {
    Blockly.Events.enable();
  }
  ws.clearUndo();
}
