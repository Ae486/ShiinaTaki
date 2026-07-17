/**
 * INPUT:  the current interaction inputs — whether a drag is active, whether the left button is down, whether the
 *         cursor is over an interactive UI element (bubble/panel — element-level), and whether the character's
 *         opaque body is under the cursor.
 * OUTPUT: whether the pet window should ignore cursor events (pass clicks through) this tick.
 * POS:    ui/windows/pet — the pure click-through toggle formula, unit-tested; the use-click-through hook applies
 *         it each cursor poll and calls setIgnoreCursorEvents only on a change. Framework-free.
 */

export type ClickThroughInputs = {
  dragging: boolean;
  buttonDown: boolean;
  // The cursor is over a marked interactive element ([data-keep-interactive]: bubble, panel). Element-level, not
  // window-level: an OPEN panel no longer forces the whole window interactive — only its own rect does (B-test 4).
  overUi: boolean;
  opaque: boolean;
};

/**
 * Pass clicks through only when the pointer is over empty space AND nothing needs the window interactive: a drag, a
 * held button, or hovering an interactive UI element all keep the window interactive — so a press that began on the
 * character never drops through mid-move, and the bubble/panel (which sit over transparent pixels) stay clickable
 * while everything AROUND them still passes through.
 */
export function shouldIgnoreCursor(inputs: ClickThroughInputs): boolean {
  return !inputs.dragging && !inputs.buttonDown && !inputs.overUi && !inputs.opaque;
}
