/**
 * INPUT:  the current interaction inputs — whether a drag is active, whether the left button is down, whether the
 *         chat bubble is open, and whether the character's opaque body is under the cursor.
 * OUTPUT: whether the pet window should ignore cursor events (pass clicks through) this tick.
 * POS:    ui/windows/pet — the pure click-through toggle formula, unit-tested; the use-click-through hook applies
 *         it each cursor poll and calls setIgnoreCursorEvents only on a change. Framework-free.
 */

export type ClickThroughInputs = {
  dragging: boolean;
  buttonDown: boolean;
  bubbleOpen: boolean;
  opaque: boolean;
};

/**
 * Pass clicks through only when the pointer is over empty space AND nothing needs the window interactive: a drag, a
 * held button, or an open bubble all force the window to stay interactive — so a press that began on the character
 * never drops through mid-move, and the bubble's input (which may sit over transparent pixels) stays clickable.
 */
export function shouldIgnoreCursor(inputs: ClickThroughInputs): boolean {
  return !inputs.dragging && !inputs.buttonDown && !inputs.bubbleOpen && !inputs.opaque;
}
