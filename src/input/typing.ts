/** Is the keyboard focus somewhere the student types (where keys must not drive the robot)? */
export function isTypingTarget(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  if (!e || typeof e.closest !== "function") return false;
  if (e.isContentEditable) return true;
  const tag = e.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!e.closest(".cm-editor, .blocklyWidgetDiv, .blocklyDropDownDiv, .injectionDiv, .blocklySvg, [contenteditable=''], [contenteditable='true']");
}
