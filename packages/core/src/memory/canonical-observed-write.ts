/**
 * INPUT:  trusted scrubbed observation text, Local provider and the active Character's Bank pair
 * OUTPUT: synchronous canonical observed-memory write through the actual Local provider
 * POS:    core/memory — image-description adapter; observed sources never become primary conversation witnesses
 */
import { randomUUID } from "node:crypto";
import { clampAutoImportance } from "./auto-layer-policy.ts";
import type { CanonicalLocalBanks } from "./canonical-local-banks.ts";
import { projectRetention } from "./canonical-layer-policy.ts";
import { AUTO_WRITABLE_LAYER_IDS, getLayer } from "./layer-registry.ts";
import type { LocalMemoryProvider } from "./local-memory-provider.ts";
import type { MemoryWriteRequest } from "./memory-tools.ts";

export function writeCanonicalObservedMemory(input: {
  provider: LocalMemoryProvider;
  epochId: string;
  banks(characterId: string): CanonicalLocalBanks;
}, request: MemoryWriteRequest): { id: string; layer: string } {
  if (request.origin !== "observed") throw new Error("MEMORY_LEGACY_WRITE_RETIRED");
  const layer = getLayer(request.type);
  if (!layer || !AUTO_WRITABLE_LAYER_IDS.includes(layer.id)) throw new Error("MEMORY_INVALID_REQUEST");
  const banks = input.banks(request.characterId);
  const bankId = layer.ownership === "global" ? banks.global.bankId : banks.character.bankId;
  const capturedAt = new Date().toISOString();
  const result = input.provider.retainObserved({ authorityEpochId: input.epochId,
    requestId: `observed:${randomUUID()}`, actor: "background-policy" }, {
    bankId, content: request.content, context: null, timestamp: capturedAt, tags: [], entities: [], metadata: {},
    observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "system", origin: "machine-observed", characterId: request.characterId,
      timelineFromSeq: request.turnSeq ?? null, timelineToSeq: request.turnSeq ?? null,
      capturedAt, sanitized: true, sourceRef: null },
    policy: { layerId: layer.id, importance: clampAutoImportance(layer.id, request.importance),
      visibility: layer.recallPolicy, disclosure: request.disclosure ?? null, origin: "observed", emotionalWeight: null,
      retention: projectRetention(layer, undefined, capturedAt), policyVersion: 1 },
  });
  const memory = result.memories[0];
  if (!memory) throw new Error("MEMORY_INTEGRITY_ERROR: observed write has no memory receipt");
  return { id: memory.memoryId, layer: layer.id };
}
