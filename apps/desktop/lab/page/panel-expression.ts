/**
 * INPUT:  PanelDeps and the costume's expression names.
 * OUTPUT: expression selection and Set/Reset/Sample controls, with a narrowly labeled parameter probe.
 * POS:    experimental / lab — not in production path.
 */

import { button, note, type PanelDeps, row, section, select, setOptions } from "./controls.ts";
import { createExpressionActions } from "./expression-actions.ts";

export function mountPanelExpression({ host, scene, log }: PanelDeps): void {
  const root = section(host, "Expression");
  const expressionSelect = select([]);
  row(root, "expression", expressionSelect);
  const probeNote = document.createElement("div");
  const actions = createExpressionActions(scene, log, (text) => { probeNote.textContent = text; });
  row(
    root,
    "",
    button("Set", () => void actions.set(expressionSelect.value)),
    button("Reset", () => actions.reset()),
    button("Sample now", () => actions.sample()),
  );
  note(root).append(probeNote);
  scene.onModel((ctx) => setOptions(expressionSelect, ctx.facts.expressions));
}
