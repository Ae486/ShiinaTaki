/**
 * INPUT:  the Speech section, its actions/fields and the scene for view re-application on costume loads.
 * OUTPUT: mouth mode / pose preview / model view selects; locks the lip-sync sliders while the engine-default arm is selected.
 * POS:    experimental / lab - not in production path; plain DOM, no automation hooks or raw parameter ids.
 */

import type { LabScene } from "../scene/lab-scene.ts";
import { MOUTH_ARMS } from "../scene/mouth-arm-ranges.ts";
import type { MouthMode } from "../scene/mouth-control.ts";
import type { MouthPreview } from "../scene/mouth-profile.ts";
import { applyModelView, MODEL_VIEWS, type ModelView, type ScreenSize } from "../scene/model-view.ts";
import { row, select } from "./controls.ts";
import type { SpeechActions } from "./speech-actions.ts";
import type { SpeechFields } from "./speech-fields.ts";

export interface MouthControlDeps {
  actions: SpeechActions;
  fields: SpeechFields;
  scene: LabScene;
  screen: () => ScreenSize;
}

const POSE_PREVIEWS: readonly MouthPreview[] = ["off", "closed", "a", "e", "i", "o", "u"];
/** Starting point for the tuned arm: full-weight native lip-sync so amplitude is not capped by the 0.4 default. */
const TUNED_PRESET_WEIGHT = 1;

export function mountMouthControls(root: HTMLElement, deps: MouthControlDeps): () => void {
  const { actions, fields, scene } = deps;
  const pose = select(POSE_PREVIEWS, (value) => {
    actions.previewPose(value as MouthPreview);
    // A pending native load refuses the preview; the select must show the pose actually in effect.
    pose.value = actions.snapshot().custom.preview;
  });
  const mode = select(MOUTH_ARMS, (value) => {
    const next = value as MouthMode;
    pose.value = "off";
    lockSliders(fields, next);
    if (next === "native-tuned") presetTuned(fields);
    actions.setMouthMode(next);
  });
  mode.value = "native";
  lockSliders(fields, "native");
  let view: ModelView = "full";
  const applyView = (): void => { if (scene.current !== null) applyModelView(scene.current.model, view, deps.screen()); };
  const viewSelect = select(MODEL_VIEWS, (value) => { view = value as ModelView; applyView(); });
  for (const [label, el] of [["mouth mode", mode], ["pose preview", pose], ["model view", viewSelect]] as const) {
    el.setAttribute("aria-label", label);
    row(root, label, el);
  }
  // The production loader re-centres every loaded model; the chosen framing must survive a costume switch.
  return scene.onModel(applyView);
}

function lockSliders(fields: SpeechFields, mode: MouthMode): void {
  const locked = mode === "native";
  fields.gain.disabled = locked;
  fields.weight.disabled = locked;
}

function presetTuned(fields: SpeechFields): void {
  fields.weight.value = String(TUNED_PRESET_WEIGHT);
  // Route through the same input listener the user's edits take so the actions see one configure path.
  fields.weight.dispatchEvent(new Event("input"));
}
