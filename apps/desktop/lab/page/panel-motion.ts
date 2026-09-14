/**
 * INPUT:  PanelDeps; scene.onModel for the costume's motion groups and face set.
 * OUTPUT: mountPanelMotion(deps): group / index / priority / loop, channel (primary | parallel 0-2), "ignore face set"
 *         (+ "also ignore eye-open (declared mult)") toggles, Play / Stop all / Invalidate cached motion
 *         buttons wired to motion-actions; a note summarising the costume's face set.
 * POS:    experimental / lab — not in production path; never keeps a Live2DModel beyond scene.current.
 */

import { MotionPriority } from "untitled-pixi-live2d-engine";

import { isDeclaredMult } from "../scene/face-params.ts";
import type { LayeredMotionRequest } from "../scene/layered-motion.ts";
import { button, checkbox, note, type PanelDeps, row, section, select, setOptions } from "./controls.ts";
import { createMotionActions, type MotionSelection } from "./motion-actions.ts";

const PRIORITIES = [
  { value: String(MotionPriority.IDLE), label: "IDLE (1)" },
  { value: String(MotionPriority.NORMAL), label: "NORMAL (2)" },
  { value: String(MotionPriority.FORCE), label: "FORCE (3)" },
];
const CHANNELS = [
  { value: "primary", label: "primary" },
  { value: "0", label: "parallel 1  [0]" },
  { value: "1", label: "parallel 2  [1]" },
  { value: "2", label: "parallel 3  [2]" },
];

export function mountPanelMotion({ host, scene, log }: PanelDeps): void {
  const root = section(host, "Motion");
  const toggles = { loop: false, ignoreFace: false, ignoreEyeOpenMult: false };

  const indexSelect = select([]);
  const groupSelect = select([], (group) => setOptions(indexSelect, indexOptions(scene.current?.facts.motionGroups[group] ?? 0)));
  const prioritySelect = select(PRIORITIES);
  prioritySelect.value = String(MotionPriority.NORMAL);
  const channelSelect = select(CHANNELS);

  const read = (): MotionSelection | null =>
    scene.current === null || groupSelect.value === ""
      ? null
      : {
          ...toggles,
          group: groupSelect.value,
          index: Number(indexSelect.value),
          priority: Number(prioritySelect.value) as LayeredMotionRequest["priority"],
          channel: channelSelect.value === "primary" ? "primary" : Number(channelSelect.value),
        };
  const actions = createMotionActions(scene, log, read);

  row(root, "group", groupSelect);
  row(root, "index", indexSelect);
  row(root, "priority", prioritySelect);
  row(root, "channel", channelSelect);
  row(root, "", checkbox("loop", (on) => (toggles.loop = on)).root);
  row(root, "", checkbox("ignore face set (expression-declared ids)", (on) => (toggles.ignoreFace = on)).root);
  row(root, "", checkbox("also ignore eye-open (declared mult) - C2 only", (on) => (toggles.ignoreEyeOpenMult = on)).root);
  row(root, "", button("Play", () => void actions.play()), button("Stop all", actions.stopAll), button("Invalidate cached motion", actions.invalidate));
  const faceNote = note(root);

  scene.onModel((ctx) => {
    setOptions(groupSelect, Object.keys(ctx.facts.motionGroups));
    groupSelect.dispatchEvent(new Event("change"));
    const mult = ctx.facts.faceSet.filter(isDeclaredMult).map((p) => p.id);
    const loopMode = ctx.facts.generation === "cubism2" ? "lab finish-event replay; expression writes are set" : "native; numeric Blend runs as add";
    faceNote.textContent = `face set: ${ctx.facts.faceSet.length} ids (${mult.length} declared mult: ${mult.join(", ") || "none"}); loop: ${loopMode}`;
  });
}

function indexOptions(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(i));
}
