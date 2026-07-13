/**
 * INPUT:  probe outcomes produced while loading and exercising each test model.
 * OUTPUT: SpikeStatus/ModelProbeResult types + `publishSpikeStatus` writing `window.__spikeStatus` for machine-readable evidence.
 * POS:    experimental / spike — not in production path; shared status shape for the renderer selection harness (#13).
 */

export interface ProbeCheck {
  ok: boolean;
  detail: string;
}

export type ModelGeneration = "legacy" | "modern" | "unknown";

export interface ModelProbeResult {
  label: string;
  source: string;
  generation: ModelGeneration;
  loaded: ProbeCheck;
  motion: ProbeCheck;
  expression: ProbeCheck;
  hitTest: ProbeCheck;
  paramRoundTrip: ProbeCheck;
  lipSyncApi: ProbeCheck;
  manifestHitAreas: ProbeCheck;
  framing: ProbeCheck;
}

export interface SpikeStatus {
  startedAt: string;
  finishedAt: string | null;
  engineVersion: string;
  pixiVersion: string;
  runtimeGlobals: { cubismCore: boolean; cubismLegacy: boolean };
  models: ModelProbeResult[];
  decision: string | null;
  fatalError: string | null;
}

declare global {
  interface Window {
    __spikeStatus?: SpikeStatus;
  }
}

export function publishSpikeStatus(status: SpikeStatus): void {
  window.__spikeStatus = status;
}
