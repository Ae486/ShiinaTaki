/**
 * INPUT: current profile state and generation-bound read/write actions.
 * OUTPUT: stable editor actions with local draft and pending/result presentation.
 * POS: Settings React adapter; no secret values leave the editor except explicit save/test input.
 */
import { useLayoutEffect, useState } from "react";
import type { ModelProfileForm } from "@taki/shared";
import { createProfileEditor, type ProfileEditorInput, type ProfileEditorState } from "./model-profile-editor-controller.ts";

export function useModelProfileEditor(input: ProfileEditorInput) {
  const [controller] = useState(() => createProfileEditor(input, (next) => setState(next)));
  const [state, setState] = useState<ProfileEditorState>(() => controller.snapshot());
  useLayoutEffect(() => { controller.update(input); }, [controller, input]);
  useLayoutEffect(() => () => controller.update({ ...input, client: null, fresh: false }), [controller]);
  return { state, change: (patch: Partial<ModelProfileForm>) => controller.change(patch),
    focus: (value: boolean) => controller.focus(value), compose: (value: boolean) => controller.compose(value),
    save: () => void controller.save(), reset: () => void controller.save(true),
    test: () => void controller.test(), useLatest: () => controller.useLatest(), keepEdits: () => controller.keepEdits() };
}
