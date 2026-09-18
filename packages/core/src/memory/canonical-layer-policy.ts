/**
 * INPUT:  canonical Bank ownership and the existing Memory Layer registry policy
 * OUTPUT: shared Bank/layer validation and deterministic Local retention projection
 * POS:    core/memory — policy projection shared by foreground Local writes and maintenance
 */
import type { CanonicalMemoryBank, TakiMemoryPolicyProjection } from "@taki/shared";
import { DEFAULT_INTENTIONS_DAYS } from "../config/memory-config.ts";
import type { MemoryLayerDefinition } from "./layer-registry.ts";

export function requireLayerOwnership(bank: CanonicalMemoryBank, layer: MemoryLayerDefinition): void {
  const expected = layer.ownership === "global" ? "global" : "character";
  if (bank.scope.kind !== expected) throw new Error("MEMORY_INVALID_REQUEST: layer and Bank scope mismatch");
}

export function projectRetention(layer: MemoryLayerDefinition,
  previous: TakiMemoryPolicyProjection["retention"] | undefined, at: string): TakiMemoryPolicyProjection["retention"] {
  return canonicalLayerRetention({ layer, previous, at });
}

export function canonicalLayerRetention(input: {
  layer: MemoryLayerDefinition; previous?: TakiMemoryPolicyProjection["retention"]; at: string; intentionsDefaultDays?: number;
}): TakiMemoryPolicyProjection["retention"] {
  const { layer, previous, at } = input;
  if (layer.retention === "permanent") return { kind: "permanent" };
  if (layer.retention === "expiring") return previous?.kind === "expiring" ? previous : {
    kind: "expiring", expiresAt: new Date(Date.parse(at) + (input.intentionsDefaultDays ?? DEFAULT_INTENTIONS_DAYS) * 86_400_000).toISOString(),
  };
  if ("rollingDays" in layer.retention) return { kind: "rolling-window", days: layer.retention.rollingDays };
  return { kind: "importance-decay", archiveBelowImportance: layer.retention.archiveBelowImportance, afterDays: layer.retention.afterDays };
}
