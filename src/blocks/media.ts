// Offline media for Blockly. Blockly loads its trashcan/zoom sprite from `pathToMedia + "sprites.svg"`
// (default: a CDN, which breaks offline). We point pathToMedia at a data: URI so the appended
// file name becomes a harmless URL fragment. The sprite keeps Blockly's sprite-sheet layout
// (trash at y 32..92, zoom controls at y 92..124) but is drawn in Robot Lab colours.
const C = "#7A6E60";
const SPRITES = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="124">
<g fill="${C}"><path d="M2,41v6h42v-6h-10.5l-3-3h-15l-3,3z"/><rect width="36" height="20" x="5" y="50"/><rect width="36" height="42" x="5" y="50" rx="6"/></g>
<g fill="none" stroke="${C}" stroke-width="2.5" stroke-linecap="round">
<circle r="11.5" cx="16" cy="108"/><circle r="4.3" cx="16" cy="108" fill="${C}" stroke-width="0"/>
<path d="M28,108h3M1,108h3M16,120v3M16,93v3"/>
<circle r="14" cx="48" cy="108"/><path d="M48,101.6v12.8M41.6,108h12.8"/>
<circle r="14" cx="80" cy="108"/><path d="M73.6,108h12.8"/></g></svg>`;

export const MEDIA_PATH = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SPRITES) + "#";
