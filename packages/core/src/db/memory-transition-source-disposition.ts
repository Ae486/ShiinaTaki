/**
 * INPUT:  complete awaiting-native candidate Sources and original Core Pending/parent/source-command journals
 * OUTPUT: factual healthy non-dispatch dispositions; ambiguous effects retain their original ownership
 * POS:    core/db — a final native snapshot alone cannot settle an original awaiting Source
 */
import type { MemoryTransitionCandidate, MemoryTransitionSourceDisposition } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { decodeHindsightMemoryWrite } from "./hindsight-memory-write-storage.ts";
import { readApplicationCommand } from "./hindsight-application-command-storage.ts";
import { readTransitionPendingState, transitionPendingRefusal } from "./memory-transition-pending-refusal.ts";
import type { Database } from "./sqlite.ts";

export function classifyTransitionSources(db: Database, candidate: Pick<MemoryTransitionCandidate, "pendingSources">): MemoryTransitionSourceDisposition[] {
  return candidate.pendingSources.map((source) => {
    const original = source.source.original_source;
    const rows = db.prepare("SELECT * FROM pending_memory WHERE authority_epoch_id=:epoch AND bank_id=:bank")
      .all({ epoch: original.authorityEpochId, bank: source.nativeBankId });
    const pending = rows.map((row) => {
      const state = readTransitionPendingState(db, { authorityEpochId: original.authorityEpochId,
        bankId: source.nativeBankId, operationId: String(row.operation_id) });
      if (!state) invalid(); return state;
    })
      .filter((row) => row.remoteOperationId === source.operationId);
    if (pending.length !== 1) invalid();
    const row = pending[0]!; const request = row.intent.operation;
    if (request.kind !== "retain" || row.documentId !== source.documentId
      || row.intent.providerLineageId !== source.namespace.provider_lineage || row.intent.bankGeneration !== source.namespace.bank_generation
      || !sameApplicationValue([request.request.content, request.request.context, request.request.tags, request.request.metadata,
        request.request.observationScopes, request.request.provenance],
      [original.retainedText, original.context, original.tags, original.metadata, original.observationScopes, original.provenance])) invalid();
    const command = readApplicationCommand(db, { authorityEpochId: original.authorityEpochId, bankId: source.nativeBankId,
      requestId: `source:${source.operationId}` });
    const body = command?.bodies.find((entry) => entry.ref.body_id === source.bodyRef.body_id);
    if (!command || command.state !== "completed" || !command.receipt || !body
      || !sameApplicationValue(body.ref, source.bodyRef) || Buffer.from(body.bytes).toString("base64") !== source.base64) invalid();
    const parents = db.prepare(`SELECT * FROM hindsight_memory_write_intents
      WHERE authority_epoch_id=:epoch AND bank_id=:bank AND native_operation_id=:operation`)
      .all({ epoch: original.authorityEpochId, bank: source.nativeBankId, operation: row.intent.operationId }).map(decodeHindsightMemoryWrite);
    if (parents.length > 1 || parents.some((parent) => parent.terminal?.kind !== "error")) unknown();
    // Absence of a reply is never absence of an effect. Only an original terminal pre-dispatch journal can release
    // this awaiting artifact; W6 owns a separate incident-preservation path for all unresolved native outcomes.
    const disposition = transitionPendingRefusal(row); if (!disposition) unknown();
    return { sourceHash: transitionLocalHash(source), operationId: source.operationId, pendingHash: transitionLocalHash(row),
      parentHash: parents[0] ? transitionLocalHash(parents[0]) : null, disposition };
  });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
function unknown(): never { throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN"); }
