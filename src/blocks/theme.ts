// Robot Lab block colours and Blockly theme.
// Our own palette, chosen to sit on the cream/ink/orange app design (docs/ARCHITECTURE.md).
import * as Blockly from "blockly";

export const PALETTE = {
  start: "#D6540E",      // deep orange — the "when started" hat
  drive: "#E9772E",      // warm orange
  sensing: "#2C8C99",    // teal
  controller: "#3B62C4", // royal blue (driver control)
  pen: "#6E5BC4",        // violet
  magnet: "#B8432F",     // brick
  arm: "#3F7F6A",        // pine (arm and claw)
  looks: "#B04A84",      // plum
  control: "#C9921B",    // mustard
  operators: "#4E9550",  // leaf green
  variables: "#8A6440",  // walnut
  myblocks: "#566A8E",   // slate
} as const;

type StyleKey = keyof typeof PALETTE;

function style(c: string): Blockly.Theme.BlockStyle {
  return { colourPrimary: c, colourSecondary: lighten(c, 0.35), colourTertiary: darken(c, 0.22), hat: "" };
}

function mix(hex: string, target: number, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * amt));
  return "#" + ch.map((v) => v.toString(16).padStart(2, "0")).join("");
}
const lighten = (h: string, a: number) => mix(h, 255, a);
const darken = (h: string, a: number) => mix(h, 0, a);

const blockStyles: Record<string, Partial<Blockly.Theme.BlockStyle>> = {};
const categoryStyles: Record<string, Blockly.Theme.CategoryStyle> = {};
for (const k of Object.keys(PALETTE) as StyleKey[]) {
  blockStyles[`rl_${k}`] = style(PALETTE[k]);
  categoryStyles[`rl_${k}_cat`] = { colour: PALETTE[k] };
}
blockStyles["rl_start"] = { ...style(PALETTE.start), hat: "cap" };
// Built-in Blockly blocks use these style names; map them onto our palette.
blockStyles["logic_blocks"] = style(PALETTE.operators);
blockStyles["math_blocks"] = style(PALETTE.operators);
blockStyles["text_blocks"] = style(PALETTE.operators);
blockStyles["loop_blocks"] = style(PALETTE.control);
blockStyles["list_blocks"] = style(PALETTE.variables);
blockStyles["variable_blocks"] = style(PALETTE.variables);
blockStyles["variable_dynamic_blocks"] = style(PALETTE.variables);
blockStyles["procedure_blocks"] = style(PALETTE.myblocks);
blockStyles["colour_blocks"] = style(PALETTE.looks);
// Plain values (number/text) read as neutral "slots", whatever block they sit in.
blockStyles["rl_value"] = { colourPrimary: "#F3EBDD", colourSecondary: "#FFFDF9", colourTertiary: "#B8AA95", hat: "" };
blockStyles["hat_blocks"] = { ...style(PALETTE.start), hat: "cap" };

let theme: Blockly.Theme | null = null;
export function robotLabTheme(): Blockly.Theme {
  if (theme) return theme;
  theme = Blockly.Theme.defineTheme("robot-lab", {
    name: "robot-lab",
    base: Blockly.Themes.Classic,
    blockStyles: blockStyles as Record<string, Blockly.Theme.BlockStyle>,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: "#FDF9F2",
      toolboxBackgroundColour: "#F3EBDD",
      toolboxForegroundColour: "#0C0B0A",
      flyoutBackgroundColour: "#E9E0D2",
      flyoutForegroundColour: "#0C0B0A",
      flyoutOpacity: 0.97,
      scrollbarColour: "#C9BCA8",
      scrollbarOpacity: 0.7,
      insertionMarkerColour: "#0C0B0A",
      insertionMarkerOpacity: 0.25,
      selectedGlowColour: "#0C0B0A",
    },
    fontStyle: { family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", weight: "600", size: 13 },
    startHats: true,
  });
  return theme;
}

/** Renderer overrides: bigger, touch-friendly blocks (Chromebook tablets). */
export const RENDERER_OVERRIDES: Record<string, unknown> = {
  MIN_BLOCK_HEIGHT: 40,
  MEDIUM_PADDING: 8,
  MEDIUM_LARGE_PADDING: 10,
  LARGE_PADDING: 14,
  CORNER_RADIUS: 10,
  NOTCH_WIDTH: 18,
  NOTCH_HEIGHT: 5,
  NOTCH_OFFSET_LEFT: 18,
  TAB_HEIGHT: 18,
  TAB_WIDTH: 9,
  FIELD_BORDER_RECT_HEIGHT: 26,
  FIELD_DROPDOWN_BORDER_RECT_HEIGHT: 26,
  FIELD_BORDER_RECT_RADIUS: 6,
  FIELD_BORDER_RECT_X_PADDING: 8,
  EMPTY_INLINE_INPUT_HEIGHT: 28,
  EMPTY_INLINE_INPUT_PADDING: 22,
  STATEMENT_INPUT_PADDING_LEFT: 24,
  EMPTY_STATEMENT_INPUT_HEIGHT: 28,
  BETWEEN_STATEMENT_PADDING_Y: 6,
};
