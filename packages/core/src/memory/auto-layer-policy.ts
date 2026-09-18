/**
 * INPUT:  a layer id + importance proposed by the AUTOMATIC writer (never a user/tool-driven write)
 * OUTPUT: AUTO_LAYER_CHOICES + autoLayerGuidance() + resolveAutoLayer(id) + autoImportanceCeiling(threshold) +
 *         clampAutoImportance(layer, value)
 * POS:    core/memory — T5 Q11-1 policy: the auto path picks its own layer but can never reach the always-visible
 *         rung. Choice set and ceiling are both DERIVED from the layer registry; nothing here hardcodes a threshold.
 */
import { TAKI_MEMORY_DEFAULT_IMPORTANCE } from "@taki/shared";
import { AUTO_WRITABLE_LAYER_IDS, getLayer } from "./layer-registry.ts";

// Bounds for a layer that pins nothing: the auto path stays mid-range because it judges from a transcript alone.
const AUTO_IMPORTANCE_MIN = 3;
const AUTO_IMPORTANCE_MAX = 7;

// Used when the model omits `layer` — the least-visible per-character layer, which is what the auto path wrote
// unconditionally before T5. Asserted to be a real choice so a registry edit cannot leave it dangling.
const FALLBACK_AUTO_LAYER = "episodes";

if (!AUTO_WRITABLE_LAYER_IDS.includes(FALLBACK_AUTO_LAYER))
  throw new Error(`auto-layer policy: fallback layer '${FALLBACK_AUTO_LAYER}' is not an auto-writable layer`);

/** The auto writer's `layer` enum, as a zod-ready non-empty tuple. */
export const AUTO_LAYER_CHOICES = [...AUTO_WRITABLE_LAYER_IDS] as [string, ...string[]];

// Human-readable gloss per layer. The SET comes from the registry; only the wording is per-id, and a layer without
// a gloss still renders (as a bare id) rather than disappearing from the prompt.
const LAYER_GLOSS: Record<string, string> = {
  profile: "a stable fact, preference, or taboo about the user",
  episodes: "a moment between you worth recalling later",
  intentions: "a private thought to raise with them another time",
};

export function autoLayerGuidance(): string {
  return AUTO_WRITABLE_LAYER_IDS.map((id) => {
    const gloss = LAYER_GLOSS[id];
    return gloss ? `'${id}' — ${gloss}` : `'${id}'`;
  }).join("; ");
}

export function resolveAutoLayer(layer: string | undefined): string {
  return layer !== undefined && AUTO_WRITABLE_LAYER_IDS.includes(layer) ? layer : FALLBACK_AUTO_LAYER;
}

/**
 * The highest importance an auto write may carry in a layer with this pin threshold. A threshold-free layer gets the
 * plain band top; otherwise the ceiling sits STRICTLY below the threshold, so no registry edit (a threshold dropped
 * into the band) can silently hand the auto path always-visible status.
 */
export function autoImportanceCeiling(threshold: number | undefined): number {
  return threshold === undefined ? AUTO_IMPORTANCE_MAX : Math.min(AUTO_IMPORTANCE_MAX, threshold - 1);
}

/**
 * Clamp an auto-written importance STRICTLY below the layer's pin threshold when it has one. A misjudged auto write
 * then costs at most one extra searchable row; it can never install itself in every prompt.
 */
export function clampAutoImportance(layer: string, value: number | undefined): number {
  const max = autoImportanceCeiling(getLayer(layer)?.pinnedImportanceThreshold);
  const rounded = Math.round(value ?? TAKI_MEMORY_DEFAULT_IMPORTANCE);
  return Math.max(AUTO_IMPORTANCE_MIN, Math.min(max, rounded));
}
