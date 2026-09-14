/**
 * INPUT:  PanelDeps; scene.onModel / onBeforeDispose to re-attach or drop the hold overlay across costume switches.
 * OUTPUT: mountPanelParams(deps): param id input (C3 datalist from facts.paramIds; C2 curated defaults), value slider
 *         (±1 / ±30, step 0.1), hook position, write mode and a Hold checkbox — while held an overlay at the chosen hook
 *         writes the value every frame and the scene's sampler tracks that id for the readout.
 * POS:    experimental / lab — not in production path; holds desired state only, never a Live2DModel.
 */

import { HOOK_POSITIONS, type HookPosition } from "../scene/frame-hooks.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import type { WriteMode } from "../scene/param-access.ts";
import { applySlider, checkbox, type LogLine, type PanelDeps, row, section, select, slider, textInput } from "./controls.ts";

// Cubism 2 exposes no parameter enumeration; these are the ids every BanG Dream C2 costume is known to carry.
const C2_DEFAULT_IDS = [
  "PARAM_ANGLE_X",
  "PARAM_ANGLE_Y",
  "PARAM_ANGLE_Z",
  "PARAM_BODY_ANGLE_X",
  "PARAM_EYE_L_OPEN",
  "PARAM_EYE_R_OPEN",
  "PARAM_MOUTH_OPEN_Y",
  "PARAM_MOUTH_FORM_01",
  "PARAM_BREATH",
  "PARAM_BROW_L_Y",
];
const DATALIST_ID = "lab-param-ids";
const WRITE_MODES: WriteMode[] = ["set", "add", "mult"];

interface HoldState {
  id: string;
  value: number;
  position: HookPosition;
  mode: WriteMode;
  held: boolean;
}

interface HoldBinder {
  /** Re-reads state and (re)installs the overlay on the given model context; null just detaches. */
  attach(ctx: ModelContext | null): void;
  /** The scene's sampler follows the held id. */
  track(): void;
  /** The hooks registry is being disposed; forget the overlay without touching it. */
  drop(): void;
}

export function mountPanelParams({ host, scene, log }: PanelDeps): void {
  const root = section(host, "Parameter hold");
  const state: HoldState = { id: "", value: 0, position: "beforeModelUpdate", mode: "set", held: false };
  const hold = createHoldBinder(scene, log, state);
  const datalist = document.createElement("datalist");
  datalist.id = DATALIST_ID;
  root.append(datalist);

  const reattach = (): void => hold.attach(scene.current);
  const idInput = textInput("PARAM_ANGLE_X", (v) => {
    state.id = v.trim();
    hold.track();
    reattach();
  }, DATALIST_ID);
  const hookSelect = select(HOOK_POSITIONS, (v) => {
    state.position = v as HookPosition;
    reattach();
  });
  hookSelect.value = state.position;
  const modeSelect = select(WRITE_MODES, (v) => {
    state.mode = v as WriteMode;
    reattach();
  });
  const holdBox = checkbox("Hold (write every frame)", (on) => {
    state.held = on;
    reattach();
  });

  row(root, "param id", idInput);
  mountValueRows(root, state);
  row(root, "hook", hookSelect);
  row(root, "write", modeSelect);
  row(root, "", holdBox.root);

  scene.onBeforeDispose(hold.drop);
  scene.onModel((ctx) => {
    datalist.replaceChildren(...(ctx.facts.paramIds ?? C2_DEFAULT_IDS).map(optionFor));
    hold.track();
    hold.attach(ctx);
  });
}

function createHoldBinder(scene: LabScene, log: LogLine, state: HoldState): HoldBinder {
  let detach: (() => void) | null = null;
  return {
    attach(ctx) {
      detach?.();
      detach = null;
      if (ctx === null || !state.held || state.id === "") return;
      const { id, mode, position } = state;
      detach = ctx.hooks.add(position, ({ params }) => params[mode](id, state.value));
      log(`hold ${id} ${mode} @ ${position}`);
    },
    track: () => scene.current?.sampler.track(state.id === "" ? [] : [state.id]),
    drop: () => void (detach = null),
  };
}

function mountValueRows(root: HTMLElement, state: HoldState): void {
  const valueLabel = document.createElement("span");
  valueLabel.textContent = "0.0";
  const valueSlider = slider({ min: -1, max: 1, step: 0.1, value: 0 }, (v) => {
    state.value = v;
    valueLabel.textContent = v.toFixed(1);
  });
  const rangeSelect = select(["±1", "±30"], (v) => {
    const max = v === "±30" ? 30 : 1;
    applySlider(valueSlider, { min: -max, max, step: 0.1, value: Math.max(-max, Math.min(max, state.value)) });
    state.value = Number(valueSlider.value);
    valueLabel.textContent = state.value.toFixed(1);
  });
  row(root, "value", valueSlider, valueLabel);
  row(root, "range", rangeSelect);
}

function optionFor(id: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = id;
  return o;
}
