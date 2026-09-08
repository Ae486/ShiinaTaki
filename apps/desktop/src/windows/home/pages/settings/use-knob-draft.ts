/**
 * INPUT:  the latest knob entry/readiness and explicit save callback from the Settings owner.
 * OUTPUT: useKnobDraft() — retained edit state plus focus, composition and deliberate conflict actions.
 * POS:    Home Settings — React field adapter; the controller guards async draft ownership independently of reads.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createKnobDraftController, initialKnobDraft, type KnobDraftInput } from "./knob-draft-controller.ts";

export function useKnobDraft(input: KnobDraftInput) {
  const [state, setState] = useState(() => initialKnobDraft(input.entry));
  const [controller] = useState(() => createKnobDraftController(input, setState));
  useLayoutEffect(() => controller.update(input), [controller, input.entry, input.connectionReady, input.onSave]);
  useEffect(() => () => controller.retire(), [controller]);
  const events = useMemo(() => ({
    change: (draft: string) => controller.change(draft),
    focus: () => controller.focus(),
    blur: () => controller.blur(),
    compositionStart: () => controller.compositionStart(),
    compositionEnd: (draft: string) => controller.compositionEnd(draft),
    commit: () => { void controller.save(); },
  }), [controller]);
  return {
    state, events,
    conflicted: state.dirty && state.latest !== state.baseline,
    useLatest: () => controller.useLatest(),
    save: () => { void controller.save(true); },
  };
}
