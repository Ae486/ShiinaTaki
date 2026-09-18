/**
 * INPUT:  a scrubbed machine observation and the current Character's verified Hindsight Bank pair
 * OUTPUT: durable source acceptance through the real provider, with an honest source or Pending operation identity
 * POS:    core/memory/hindsight — image-description writer adapter; never invents extracted facts or primary conversation witnesses
 */
import { randomUUID } from "node:crypto";
import { clampAutoImportance } from "../auto-layer-policy.ts";
import { AUTO_WRITABLE_LAYER_IDS, getLayer } from "../layer-registry.ts";
import { canonicalLayerRetention } from "../canonical-layer-policy.ts";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";
import type { MemoryWriteOp } from "../episodic-writer.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";

export function createHindsightObservedWriter(state: HindsightRuntimeState): MemoryWriteOp {
  return async (input) => {
    state.runtime.assertConnection();
    const layer = getLayer(input.layer);
    if (input.origin !== "observed" || !layer || !AUTO_WRITABLE_LAYER_IDS.includes(layer.id)
      || !isSafeAutomaticMemoryText(input.content)) throw new Error("MEMORY_INVALID_REQUEST");
    const bank = state.runtime.resolveBanks(input.characterId).find((route) => route.scope === (layer.ownership === "global" ? "global" : "character"));
    if (!bank) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    const at = state.now?.() ?? new Date().toISOString();
    const result = await state.provider.retain({ authorityEpochId: state.runtime.epoch.epochId,
      requestId: `observed:${randomUUID()}`, actor: "background-policy" }, {
      bankId: bank.bankId, content: input.content, context: null, timestamp: at, tags: [], entities: [], metadata: {},
      observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
      provenance: { actor: "system", origin: "machine-observed", characterId: input.characterId,
        timelineFromSeq: input.turnSeq ?? null, timelineToSeq: input.turnSeq ?? null, capturedAt: at, sanitized: true, sourceRef: null },
      policy: { layerId: layer.id, importance: clampAutoImportance(layer.id, input.importance), visibility: layer.recallPolicy,
        disclosure: input.disclosure ?? null, origin: "observed", emotionalWeight: null, policyVersion: 1,
        retention: canonicalLayerRetention({ layer, at, intentionsDefaultDays: state.config.intentionsDefaultDays }) },
    });
    state.runtime.assertConnection();
    if (!result.ok) throw new Error(result.error.code);
    return result.data.status === "pending" ? { id: result.data.operationId, kind: "pending-operation" }
      : { id: result.data.documentId, kind: "source" };
  };
}
