/**
 * INPUT: recalled records and the currently selected Hindsight application replica
 * OUTPUT: exact native/source/artifact/policy currentness closures under the original namespace
 * POS: core/memory/hindsight — synchronous verified evidence; never synchronizes or promotes Local authority
 */
import type { CanonicalMemoryRecord, RetainCompletedResult } from "@taki/shared";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { CaptureRecallEvidence } from "../memory-recall-evidence.ts";
import { recordEligible } from "../memory-recall-selection.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import type { HindsightIngestionDurabilityDeps } from "../../db/hindsight-ingestion-durability.ts";
import type { HindsightSourceLifetime } from "./hindsight-source-lifetime.ts";
import type { Database } from "../../db/sqlite.ts";
import { readHindsightMemoryWrite } from "../../db/hindsight-memory-write-storage.ts";

export function readHindsightSourceEvidence(replica: HindsightApplicationReplicaRepo,
  input: HindsightApplicationScope & { documentId: string }) {
  const head = replica.nativeHead({ ...input, objectKind: "document", objectId: input.documentId });
  if (head?.binding_state === "tombstoned") return { kind: "withdrawn" } as const;
  if (!head?.version || head.binding_state !== "bound" || !head.bound_artifact) return { kind: "unavailable" } as const;
  const artifact = replica.artifact({ ...input, version: head.bound_artifact });
  const body = artifact && replica.body({ ...input, bodyId: artifact.body_ref.body_id });
  const projection = replica.logicalRecord({ ...input, objectKind: "document", objectId: input.documentId });
  if (body?.content.body_schema !== "application-source.v1" || projection?.payload?.kind !== "document") {
    return { kind: "unavailable" } as const;
  }
  const original = body.content.value; const witness = original.original_witness; const version = head.version;
  if (!witness || witness.source_kind !== "document" || witness.source_id !== input.documentId
    || witness.source_revision !== version.object_revision || witness.source_payload_hash !== version.payload_hash
    || original.original_source.retainedText !== projection.payload.value.retainedText
    || original.original_source.context !== projection.payload.value.context
    || !sameApplicationValue(original.original_source.provenance, projection.payload.value.provenance)) {
    return { kind: "withdrawn" } as const;
  }
  return { kind: "current", head, original, source: projection.payload.value } as const;
}

export function createHindsightRecallEvidence(input: {
  replica: HindsightApplicationReplicaRepo; assertCurrent(): void; now?: () => number;
}): CaptureRecallEvidence {
  return (record, query) => {
    // These records cannot satisfy the stronger original-Source contract; avoid per-candidate control reads.
    if (!record.unit.documentId || record.unit.sourceMemoryIds.length > 0) return;
    input.assertCurrent();
    const checkpoint = input.replica.checkpoint(record.unit.bankId);
    if (!checkpoint || checkpoint.bankDeleted || checkpoint.authorityEpochId !== record.unit.authorityEpochId) return;
    const scope = { bankId: record.unit.bankId, namespace: checkpoint.namespace };
    const read = () => readRecordEvidence(input.replica, { ...scope, record });
    const evidence = read();
    if (!evidence) return;
    const current = () => {
      input.assertCurrent(); const actual = input.replica.checkpoint(scope.bankId);
      return actual !== undefined && !actual.bankDeleted && actual.authorityEpochId === checkpoint.authorityEpochId
        && sameApplicationValue(actual.namespace, scope.namespace) && sameApplicationValue(evidence, read())
        && recordEligible(record, { query, now: input.now?.() ?? Date.now() });
    };
    return current() ? current : undefined;
  };
}

function readRecordEvidence(replica: HindsightApplicationReplicaRepo,
  input: HindsightApplicationScope & { record: CanonicalMemoryRecord }) {
  const { record } = input; const documentId = record.unit.documentId;
  // A declared subset cannot prove all inputs of an opaque derived record (D81).
  if (!documentId || record.unit.sourceMemoryIds.length > 0) return;
  const current = replica.record({ ...input, memoryId: record.unit.memoryId });
  const head = replica.nativeHead({ ...input, objectKind: "memory_unit", objectId: record.unit.memoryId });
  if (!current || !sameApplicationValue(current, record) || head?.binding_state !== "bound" || !head.bound_artifact) return;
  const source = readHindsightSourceEvidence(replica, { ...input, documentId });
  return source.kind === "current" ? { record: current, head, source } : undefined;
}

export function captureHindsightIngestionBinding(replica: HindsightApplicationReplicaRepo, db?: Database): NonNullable<HindsightIngestionDurabilityDeps["captureBinding"]> {
  return ({ batch, receipt }) => {
    if (receipt.evidence.kind !== "provider") return;
    const checkpoint = replica.checkpoint(batch.bank.bankId);
    if (!checkpoint || checkpoint.bankDeleted || checkpoint.namespace.provider_lineage !== batch.providerLineageId
      || checkpoint.namespace.bank_generation !== batch.bankGeneration) return;
    if (db) {
      const write = readHindsightMemoryWrite(db, { authorityEpochId: checkpoint.authorityEpochId, bankId: batch.bank.bankId, requestId: batch.requestId });
      if (write) return write.terminal?.kind === "retain" && sameApplicationValue(write.terminal.result, receipt.evidence.result)
        && write.identity.operation.kind === "retain" && sameApplicationValue(write.identity.operation.request, batch.request)
        ? write.terminal.sourceLifetime : undefined;
    }
    const scope = { bankId: batch.bank.bankId, namespace: checkpoint.namespace };
    return captureHindsightRetainLifetime(replica, { ...scope, result: receipt.evidence.result });
  };
}

export function captureHindsightRetainLifetime(replica: HindsightApplicationReplicaRepo,
  input: HindsightApplicationScope & { result: RetainCompletedResult }): HindsightSourceLifetime | undefined {
    if (input.result.memories.length > 256) return;
    const source = readHindsightSourceEvidence(replica, { ...input, documentId: input.result.documentId });
    if (source.kind !== "current" || source.source.revision !== input.result.sourceRevision) return;
    const memoryBindings: HindsightSourceLifetime["memoryBindings"] = [];
    for (const ref of input.result.memories) {
      const record = replica.record({ ...input, memoryId: ref.memoryId, includeInvalidated: true, includeHidden: true });
      const head = replica.nativeHead({ ...input, objectKind: "memory_unit", objectId: ref.memoryId });
      if (!record || record.unit.revision !== ref.revision || head?.binding_state !== "bound" || !head.bound_artifact) return;
      memoryBindings.push({ policy: record.policy, head });
    }
    return { sourceBinding: source.head, memoryBindings };
}
