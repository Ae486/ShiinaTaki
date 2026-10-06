/**
 * INPUT:  original queued command, verified publication candidate and current target rows
 * OUTPUT: exact target Bank/logical ID/revision or a terminal revision conflict before dispatch
 * POS:    core/memory/transitions — target execution never mutates the old Run or captured command
 */
import { randomUUID } from "node:crypto";
import type { MemoryTransitionCandidate, MemoryEmergencyCandidate, MemoryTransitionQueuedIntent, MemoryTransitionQueueExecution, MemoryTransitionReceipt } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTransitionLocalCapture } from "../../db/memory-transition-local-capture.ts";
import { readCanonicalRecord } from "../../db/canonical-memory-maintenance-records.ts";
import { createHindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-repo.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";

export function mapTransitionQueueIntent(db: Database, input: { intent: MemoryTransitionQueuedIntent;
  candidate: MemoryTransitionCandidate | MemoryEmergencyCandidate; receipt: MemoryTransitionReceipt; now: string;
}): MemoryTransitionQueueExecution | null {
  const { intent, candidate, receipt } = input;
  const scope = candidate.scopes.find((row) => transitionLocalHash(row.scope) === transitionLocalHash(intent.scope));
  if (!scope) return null;
  const local = receipt.identity.targetProvider === "local";
  const base = { intentId: intent.intentId, replayId: intent.replayId, targetRequestId: randomUUID(), targetEpochId: receipt.newEpochId,
    targetBankId: local ? scope.localBankId : scope.nativeBankId, targetLogicalId: intent.logicalTargetId,
    expectedRevision: null as number | null, mappingHash: candidate.mappingHash, preparedAt: input.now };
  if (intent.command.kind === "retain") {
    // A named existing document has independent Source CAS semantics. It cannot silently become an append to an
    // unrelated target document. Only new-document retains are representable by the current queue contract.
    return intent.command.request.documentId === null ? base : null;
  }
  const mapping = candidate.mappings.find((row) => row.kind === "memory_unit" && row.localBankId === scope.localBankId
    && (local ? row.native.object_id === intent.logicalTargetId : row.localId === intent.logicalTargetId));
  if (!mapping) return null;
  const originalRevision = local ? mapping.native.object_revision : candidate.localCaptureId
    ? readTransitionLocalCapture(db, candidate.localCaptureId).state.records.find((row) => row.unit.bankId === scope.localBankId
      && row.unit.memoryId === mapping.localId)?.unit.revision : undefined;
  if (originalRevision !== intent.expectedRevision) return null;
  const target = local ? candidate.state.records.find((row) => row.unit.bankId === scope.localBankId && row.unit.memoryId === mapping.localId)?.unit : mapping.native;
  if (!target) return null;
  const targetLogicalId = local ? mapping.localId : mapping.native.object_id;
  const expectedRevision = local && "revision" in target ? target.revision : mapping.native.object_revision;
  const current = local ? readCanonicalRecord(db, { epochId: receipt.newEpochId, bankId: scope.localBankId, memoryId: targetLogicalId })
    : createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), bankScope: () => scope.scope })
      .record({ bankId: scope.nativeBankId, namespace: { application_id: "taki", provider_lineage: receipt.identity.targetLineageId,
        bank_generation: scope.nativeGeneration }, memoryId: targetLogicalId, includeHidden: true, includeInvalidated: true });
  if (current?.unit.revision !== expectedRevision) return null;
  return { ...base, targetLogicalId, expectedRevision };
}

export function transitionTargetCommand(intent: MemoryTransitionQueuedIntent, execution: MemoryTransitionQueueExecution) {
  return intent.command.kind === "retain" ? { kind: "retain" as const, request: { ...intent.command.request, bankId: execution.targetBankId } }
    : { kind: "mutation" as const, request: { ...intent.command.request, bankId: execution.targetBankId,
      memoryId: execution.targetLogicalId, expectedRevision: execution.expectedRevision! } };
}
