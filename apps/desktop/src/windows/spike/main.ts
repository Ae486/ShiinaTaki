/**
 * INPUT:  the DOM (a #root element) and the vendored Cubism runtime globals loaded by spike.html.
 * OUTPUT: mounts the Live2D spike canvas + a live text readout of `window.__spikeStatus`; runs the harness on load.
 * POS:    experimental / spike — not in production path; standalone Vite entry (spike.html), runs in a plain browser, no Tauri.
 */

import { runSpike } from "../../renderer/spike/run-spike.ts";
import type { ModelProbeResult, SpikeStatus } from "../../renderer/spike/spike-status.ts";

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("spike: #root not found");

const canvasHost = document.createElement("div");
canvasHost.style.cssText = "flex:1;min-width:0;height:100vh;position:relative";
const readout = document.createElement("pre");
readout.style.cssText = "width:38ch;margin:0;padding:12px;overflow:auto;height:100vh;background:#11111a;color:#cfe;font:12px/1.5 monospace";
root.style.cssText = "display:flex";
root.append(canvasHost, readout);

function line(name: string, check: { ok: boolean; detail: string }): string {
  return `  ${check.ok ? "PASS" : "FAIL"} ${name}: ${check.detail}`;
}

function renderModel(m: ModelProbeResult): string {
  return [
    `# ${m.label} [${m.generation}]`,
    line("load", m.loaded),
    line("motion", m.motion),
    line("expression", m.expression),
    line("hitTest", m.hitTest),
    line("manifestHitAreas", m.manifestHitAreas),
    line("paramRoundTrip", m.paramRoundTrip),
    line("lipSyncApi", m.lipSyncApi),
    line("framing", m.framing),
  ].join("\n");
}

function renderReadout(status: SpikeStatus): void {
  const header = [
    `engine v${status.engineVersion}  pixi v${status.pixiVersion}`,
    `cubismCore global: ${status.runtimeGlobals.cubismCore}`,
    `cubismLegacy global: ${status.runtimeGlobals.cubismLegacy}`,
    status.fatalError ? `FATAL: ${status.fatalError}` : "",
  ].filter(Boolean);
  const body = status.models.map(renderModel);
  const footer = status.decision ? `\nDECISION:\n${status.decision}` : "";
  readout.textContent = [...header, "", ...body].join("\n") + footer;
}

runSpike(canvasHost, renderReadout).catch((err: unknown) => {
  readout.textContent = `spike crashed: ${String(err)}`;
});
