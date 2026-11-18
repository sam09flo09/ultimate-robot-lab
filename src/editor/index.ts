/**
 * Teacher level editor — public entry (see core/modules.ts LevelEditor).
 *   createLevelEditor(host, { world, onChange, onTest })
 * Pure helpers for .robolab-level files are re-exported from ./levelFile.
 */
import type { LevelEditor, LevelEditorOptions } from "../core/modules";
import { createRenderer } from "../render";
import { mountLevelEditor } from "./editor";

export function createLevelEditor(host: HTMLElement, opts: LevelEditorOptions): LevelEditor {
  return mountLevelEditor(host, opts, createRenderer);
}

export { toLevelFile, parseLevelFile, newBlankWorld, levelFileText, sanitizeWorld, LEVEL_EXTENSION } from "./levelFile";
export { validateWorld, type Issue } from "./validate";
