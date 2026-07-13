/**
 * INPUT:  a stage Application + a ProbeConfig (label, model manifest URL, generation-agnostic exercise hints).
 * OUTPUT: a fully-populated ModelProbeResult — load, motion, expression, hit-test, param round-trip, lip-sync, framing observations.
 * POS:    experimental / spike — not in production path; the core evidence collector for the renderer selection harness (#13).
 */

import type { Application } from "pixi.js";
import { Live2DModel, type InternalModel } from "untitled-pixi-live2d-engine";
import { CubismLegacyInternalModel, CubismInternalModel } from "untitled-pixi-live2d-engine";
import type { ModelGeneration, ModelProbeResult, ProbeCheck } from "./spike-status.ts";
import { probeParamRoundTrip } from "./param-probe.ts";

export interface ProbeConfig {
  label: string;
  source: string;
  centerFraction: number;
}

const FAIL: ProbeCheck = { ok: false, detail: "not reached (load failed)" };

export async function probeModel(app: Application, config: ProbeConfig): Promise<ModelProbeResult> {
  const base: ModelProbeResult = {
    label: config.label,
    source: config.source,
    generation: "unknown",
    loaded: { ok: false, detail: "" },
    motion: FAIL,
    expression: FAIL,
    hitTest: FAIL,
    paramRoundTrip: FAIL,
    lipSyncApi: FAIL,
    manifestHitAreas: FAIL,
    framing: FAIL,
  };

  let model: Live2DModel;
  try {
    model = await Live2DModel.from(config.source, { autoInteract: false });
  } catch (err) {
    base.loaded = { ok: false, detail: `Live2DModel.from threw: ${String(err)}` };
    return base;
  }

  placeModel(app, model, config.centerFraction);
  const internal = model.internalModel;
  base.generation = detectGeneration(internal);
  base.loaded = { ok: true, detail: `${base.generation} model loaded; canvas ${internal.originalWidth}x${internal.originalHeight}` };
  base.motion = await probeMotion(model);
  base.expression = await probeExpression(model);
  base.hitTest = probeHitTest(model);
  base.manifestHitAreas = probeManifestHitAreas(internal);
  base.paramRoundTrip = probeParamRoundTrip(internal);
  base.lipSyncApi = { ok: typeof model.speak === "function", detail: `model.speak is ${typeof model.speak}` };
  base.framing = probeFraming(internal);
  return base;
}

function placeModel(app: Application, model: Live2DModel, centerFraction: number): void {
  model.anchor.set(0.5);
  model.position.set(app.screen.width * centerFraction, app.screen.height / 2);
  const fit = (app.screen.height * 0.9) / model.height;
  model.scale.set(fit);
  app.stage.addChild(model);
}

function detectGeneration(internal: InternalModel): ModelGeneration {
  if (internal instanceof CubismLegacyInternalModel) return "legacy";
  if (internal instanceof CubismInternalModel) return "modern";
  return "unknown";
}

async function probeMotion(model: Live2DModel): Promise<ProbeCheck> {
  try {
    const groups = Object.keys(model.internalModel.motionManager.definitions);
    const group = groups[0];
    if (!group) return { ok: false, detail: "no motion groups in manifest" };
    const started = await model.motion(group, 0);
    return { ok: started !== false, detail: `motion('${group}', 0) -> ${String(started)} (${groups.length} groups)` };
  } catch (err) {
    return { ok: false, detail: `motion threw: ${String(err)}` };
  }
}

async function probeExpression(model: Live2DModel): Promise<ProbeCheck> {
  try {
    const defs = model.internalModel.motionManager.expressionManager?.definitions ?? [];
    if (defs.length === 0) return { ok: false, detail: "no expressions in manifest" };
    const applied = await model.expression(0);
    return { ok: applied !== false, detail: `expression(0) -> ${String(applied)} (${defs.length} expressions)` };
  } catch (err) {
    return { ok: false, detail: `expression threw: ${String(err)}` };
  }
}

function probeHitTest(model: Live2DModel): ProbeCheck {
  try {
    const cx = model.internalModel.originalWidth / 2;
    const cy = model.internalModel.originalHeight / 2;
    const hit = model.hitTest(cx, cy);
    return { ok: true, detail: `hitTest(center) -> [${hit.join(", ")}] (empty = no SDK hit areas defined)` };
  } catch (err) {
    return { ok: false, detail: `hitTest threw: ${String(err)}` };
  }
}

function probeManifestHitAreas(internal: InternalModel): ProbeCheck {
  const names = Object.keys(internal.hitAreas);
  return { ok: true, detail: names.length ? `parsed hit areas: [${names.join(", ")}]` : "no standard SDK hit areas parsed from manifest" };
}

function probeFraming(internal: InternalModel): ProbeCheck {
  const scale = internal.width === 0 ? 0 : internal.originalWidth / internal.width;
  return {
    ok: true,
    detail: `original ${internal.originalWidth}x${internal.originalHeight}, layout ${internal.width.toFixed(0)}x${internal.height.toFixed(0)} (layout-scale ${scale.toFixed(3)})`,
  };
}
