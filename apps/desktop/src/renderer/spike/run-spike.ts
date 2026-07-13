/**
 * INPUT:  a DOM host element for the canvas; the vendored Cubism runtime globals loaded via <script> beforehand.
 * OUTPUT: loads both a Cubism 2 (moc) and a Cubism 3+ (moc3) taki model, runs all probes, publishes `window.__spikeStatus`.
 * POS:    experimental / spike — not in production path; top-level orchestrator for the renderer selection harness (#13).
 */

import { VERSION as PIXI_VERSION } from "pixi.js";
import { VERSION as ENGINE_VERSION } from "untitled-pixi-live2d-engine";
import { createStage } from "./create-stage.ts";
import { probeModel, type ProbeConfig } from "./probe-model.ts";
import { publishSpikeStatus, type SpikeStatus } from "./spike-status.ts";

// Served by the dev-only middleware in vite.config.ts from models/extracted/taki (git-ignored, never bundled).
const MODELS: ProbeConfig[] = [
  { label: "cubism2:arbeit (moc)", source: "/spike-assets/arbeit/model.json", centerFraction: 0.28 },
  { label: "cubism4:live_01 (moc3)", source: "/spike-assets/live_01/adv_live2d_taki_005_live_01.model3.json", centerFraction: 0.72 },
];

export async function runSpike(host: HTMLElement, onUpdate?: (status: SpikeStatus) => void): Promise<SpikeStatus> {
  const status: SpikeStatus = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    engineVersion: ENGINE_VERSION,
    pixiVersion: PIXI_VERSION,
    runtimeGlobals: {
      cubismCore: "Live2DCubismCore" in window,
      cubismLegacy: "Live2DModelWebGL" in window,
    },
    models: [],
    decision: null,
    fatalError: null,
  };
  publish(status, onUpdate);

  try {
    const app = await createStage(host);
    for (const config of MODELS) {
      status.models.push(await probeModel(app, config));
      publish(status, onUpdate);
    }
    status.decision = deriveDecision(status);
  } catch (err) {
    status.fatalError = String(err);
  }

  status.finishedAt = new Date().toISOString();
  publish(status, onUpdate);
  return status;
}

function publish(status: SpikeStatus, onUpdate?: (status: SpikeStatus) => void): void {
  publishSpikeStatus(status);
  onUpdate?.(status);
}

// Encodes the prd.md decision tree: primary engine locks iff BOTH generations render (load + motion + expression).
function deriveDecision(status: SpikeStatus): string {
  const rendered = (label: string) => {
    const m = status.models.find((x) => x.label.startsWith(label));
    return Boolean(m && m.loaded.ok && m.motion.ok && m.expression.ok);
  };
  const moc = rendered("cubism2");
  const moc3 = rendered("cubism4");
  if (moc && moc3) return "LOCK untitled-pixi-live2d-engine — both moc and moc3 render (motion + expression verified)";
  if (!moc) return "Cubism 2 path FAILED — evaluate whether moc3 assets need Cubism 5 before adopting fallback";
  return "moc3 path failed — investigate (unexpected: engine advertises Cubism 3-5)";
}
