/**
 * INPUT:  the durable evidence repository, an explicit target namespace, and current parsed native logical records
 * OUTPUT: a real replica projection that restores only verified source/per-unit types and Taki policy/provenance
 * POS:    core/memory/hindsight — exact-version enrichment; native content, lifecycle, identity, and source links stay authoritative
 */
import { HindsightSourceProjectionScopeSchema, type HindsightPreparedSource,
  type HindsightSourceObjectBinding, type HindsightSourceProjectionScope,
  type HindsightLogicalSnapshotRecord, type JsonValue,
} from "@taki/shared";
import type { HindsightSourceEvidenceRepo } from "../../db/hindsight-source-evidence-repo.ts";
import { canonicalJson, canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { encodeHindsightSourceMetadataV1 } from "./hindsight-source-preparation.ts";
import type { HindsightReplicaProjection } from "./hindsight-replica-projection.ts";

export function createHindsightSourceEvidenceProjection(input: HindsightSourceProjectionScope & {
  repo: HindsightSourceEvidenceRepo;
}): HindsightReplicaProjection {
  const { repo, ...rawScope } = input;
  const scope = HindsightSourceProjectionScopeSchema.parse(rawScope);
  return {
    assertContext: (context) => {
      if (context.authorityEpochId !== scope.authorityEpochId || context.bankId !== scope.bank.bankId
        || context.providerLineageId !== scope.providerLineageId || context.bankGeneration !== scope.bankGeneration) {
        throw new Error("HINDSIGHT_SOURCE_PROJECTION_SCOPE_MISMATCH");
      }
    },
    bankScope: (bankId) => {
      if (bankId !== scope.bank.bankId) throw new Error("HINDSIGHT_SOURCE_PROJECTION_SCOPE_MISMATCH");
      return scope.bank.scope;
    },
    source: (record) => {
      const { evidence } = resolve({ repo, scope }, record);
      if (record.payload.kind !== "document") throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
      assertMetadata(evidence.source.metadata, record.payload.value.metadata);
      return { retainedText: evidence.source.retainedText, context: evidence.source.context,
        provenance: evidence.source.provenance, metadata: evidence.source.metadata };
    },
    memory: (record) => projectMemory({ repo, scope }, record),
  };
}

function resolve(context: { repo: HindsightSourceEvidenceRepo; scope: HindsightSourceProjectionScope }, record: HindsightLogicalSnapshotRecord): {
  evidence: HindsightPreparedSource; binding: HindsightSourceObjectBinding;
} {
  const { scope } = context;
  if (record.payload.value.bankId !== scope.bank.bankId
    || (record.objectKind !== "document" && record.objectKind !== "memory_unit")) throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  const binding = context.repo.binding({ providerLineageId: scope.providerLineageId, bankGeneration: scope.bankGeneration,
    bankId: scope.bank.bankId, objectKind: record.objectKind, objectId: record.objectId, objectRevision: record.objectRevision });
  if (!binding) throw new Error("HINDSIGHT_SOURCE_BINDING_MISSING");
  if (binding.nativePayloadHash !== canonicalPayloadHash(record.payload)) throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  const evidence = context.repo.getPrepared(binding.evidenceId);
  if (!evidence) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_MISSING");
  if (evidence.nativeItem === null || evidence.source.bankId !== binding.sourceBankId
    || evidence.source.documentId !== binding.sourceDocumentId || canonicalJson(scope.bank.scope) !== canonicalJson(binding.bankScope)) {
    throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  }
  return { evidence, binding };
}

function projectMemory(context: { repo: HindsightSourceEvidenceRepo; scope: HindsightSourceProjectionScope }, record: HindsightLogicalSnapshotRecord):
ReturnType<HindsightReplicaProjection["memory"]> {
  const { evidence, binding } = resolve(context, record);
  const source = evidence.units.find(({ record: item }) => item.unit.memoryId === binding.sourceMemoryId)?.record;
  if (!source || record.payload.kind !== "memory_unit") throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  const native = record.payload.value;
  assertMetadata(source.unit.metadata, native.metadata);
  const layerTags = native.tags.filter((tag) => tag.startsWith("taki-layer:"));
  if (layerTags.length !== 1 || layerTags[0] !== `taki-layer:${source.policy.layerId}`) throw new Error("HINDSIGHT_SOURCE_LAYER_MISMATCH");
  return { provenance: source.provenance, unitMetadata: source.unit.metadata,
    policy: { ...source.policy, authorityEpochId: context.scope.authorityEpochId, bankId: native.bankId, memoryId: native.memoryId } };
}

function assertMetadata(original: Record<string, JsonValue>, native: Record<string, unknown>): void {
  if (canonicalJson(encodeHindsightSourceMetadataV1(original)) !== canonicalJson(native)) throw new Error("HINDSIGHT_SOURCE_METADATA_MISMATCH");
}
