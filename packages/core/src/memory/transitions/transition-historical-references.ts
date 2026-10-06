/**
 * INPUT: complete final W2 heads/history and already resolved durable logical identities
 * OUTPUT: explicit proven edges to tombstoned native memory identities
 * POS: core/memory/transitions — history projection, never a live or invalidated placeholder unit
 */
import { MemoryTransitionHistoricalReferenceSchema, type MemoryTransitionHistoricalReference } from "@taki/shared";
import { readHindsightApplicationNative } from "../hindsight/hindsight-application-projection.ts";
import { transitionObjectKey, type TransitionProjectionContext, type LocalBankProjectionInput } from "./transition-local-projection.ts";

export function projectTransitionHistoricalReferences(input: { source: LocalBankProjectionInput;
  context: TransitionProjectionContext; ids: Map<string, string>; bankId: string }): MemoryTransitionHistoricalReference[] {
  const source = input.source;
  const result: MemoryTransitionHistoricalReference[] = [];
  for (const head of input.context.heads) {
    if (head.object_kind !== "memory_unit" || !head.version) continue;
    const native = readHindsightApplicationNative({ namespace: source.namespace,
      bankId: source.bankId, head, evidence: input.context.reader });
    if (!("source_memory_ids" in native.payload)) invalid();
    for (const reference of native.payload.source_memory_ids) {
      const source = input.context.heads.find((row) => row.object_kind === "memory_unit" && row.object_id === reference);
      if (!source) invalid();
      if (source.version) continue;
      if (source.binding_state !== "tombstoned" || !source.tombstone || !source.previous_version) invalid();
      result.push(MemoryTransitionHistoricalReferenceSchema.parse({ bankId: input.bankId,
        memoryId: input.ids.get(transitionObjectKey("memory_unit", head.object_id)),
        sourceMemoryId: input.ids.get(transitionObjectKey("memory_unit", reference)), evidenceId: input.source.evidenceId,
        proofHash: input.source.evidenceHash, referrer: head.version, previous: source.previous_version, tombstone: source.tombstone }));
    }
  }
  return result;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
