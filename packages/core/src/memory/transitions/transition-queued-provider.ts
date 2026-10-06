/**
 * INPUT:  real provider calls with immutable captured Run/Effect provenance and the durable transition owner
 * OUTPUT: original provider execution or a committed distinct queue acknowledgement, never a successful write
 * POS:    core/memory/transitions — actual foreground retain/mutation seam shared by both provider compositions
 */
import { MEMORY_ERROR_POLICY, MemoryErrorSchema, type MemoryErrorCode, type MemoryResult, type MutationRequest, type RetainRequest } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { enqueueTransitionWrite, readTransitionQueue } from "../../db/memory-transition-queue-repo.ts";
import type { MemoryProvider, MemoryProviderCallContext } from "../memory-provider.ts";
import { hasEmergencyStorage } from "../../db/memory-transition-emergency-quarantine.ts";

export function sourceTransition(db: Database, epochId: string): string | undefined {
  const rows = db.prepare(`SELECT i.transition_id FROM memory_transition_intents i JOIN memory_transition_attempts a USING(transition_id)
    WHERE a.phase<>'terminal' AND json_extract(i.intent_json,'$.request.expected.predecessorEpochId')=:epoch
      ${hasEmergencyStorage(db) ? "AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.transition_id=i.transition_id)" : ""}`).all({ epoch: epochId });
  if (rows.length > 1) throw new Error("MEMORY_TRANSITION_CONFLICT");
  return rows[0] ? String(rows[0].transition_id) : undefined;
}

export function transitionQueuedProvider(db: Database, provider: MemoryProvider): MemoryProvider {
  return { ...provider,
    retain: (context, request) => route(db, { provider, context, command: { kind: "retain", request }, execute: () => provider.retain(context, request) }),
    mutate: (context, request) => route(db, { provider, context, command: { kind: "mutation", request }, execute: () => provider.mutate(context, request) }),
  };
}

async function route<T>(db: Database, input: { provider: MemoryProvider; context: MemoryProviderCallContext;
  command: { kind: "retain"; request: RetainRequest } | { kind: "mutation"; request: MutationRequest }; execute(): Promise<MemoryResult<T>>;
}): Promise<MemoryResult<T>> {
  const { context, command, provider } = input;
  const transitionId = sourceTransition(db, context.authorityEpochId);
  if (!transitionId) return input.execute();
  const intent = readTransitionIntent(db, transitionId)!;
  const bank = intent.request.expected.banks.find((entry) => entry.sourceBankId === command.request.bankId);
  const capabilities = await provider.capabilities();
  try {
    if (context.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
    if (!bank) throw new Error("MEMORY_TRANSITION_STALE");
    if (command.kind === "retain" && command.request.documentId != null) throw new Error("MEMORY_TRANSITION_CONFLICT");
    if (command.kind === "retain" && intent.request.expected.targetProvider === "local"
      && (command.request.updateMode !== "replace" || command.request.strategy !== null)) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
    const outcome = enqueueTransitionWrite(db, { now: new Date().toISOString(), admission: {
      transitionId, sourceEpochId: context.authorityEpochId, callerRequestId: context.requestId,
      provenance: context.provenance ?? { callerId: context.actor, runId: null, attemptId: null, effectId: null },
      scope: bank.scope, logicalTargetId: command.kind === "mutation" ? command.request.memoryId : command.request.documentId ?? context.requestId,
      expectedRevision: command.kind === "mutation" ? command.request.expectedRevision : null, command,
    } });
    const admitted = outcome.status === "queued" ? outcome : (() => {
      const saved = readTransitionQueue(db, transitionId).find((row) => row.callerRequestId === context.requestId);
      if (!saved) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      return { status: "queued" as const, transitionId, intentId: saved.intentId, sequence: saved.sequence };
    })();
    return { ok: false, requestId: context.requestId, providerId: provider.providerId, authorityEpochId: context.authorityEpochId, capabilities,
      error: MemoryErrorSchema.parse({ code: "MEMORY_TRANSITION_QUEUED", category: "availability", retryable: false, nextAction: "none",
        message: "Memory write has durable transition custody. Observe its outcome using the returned queue identity.", queue: admitted }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MEMORY_TRANSITION_UNAVAILABLE";
    const code = queueErrorCode(message);
    const [category, retryable, nextAction] = MEMORY_ERROR_POLICY[code];
    return { ok: false, requestId: context.requestId, providerId: provider.providerId, authorityEpochId: context.authorityEpochId, capabilities,
      error: MemoryErrorSchema.parse({ code, category, retryable, nextAction, message: code }) };
  }
}

function queueErrorCode(message: string): MemoryErrorCode {
  switch (message) {
    case "MEMORY_TRANSITION_QUEUE_FULL": case "MEMORY_TRANSITION_CUTOFF":
    case "MEMORY_CAPABILITY_UNSUPPORTED": case "MEMORY_OPERATION_CANCELLED": return message;
    case "MEMORY_TRANSITION_CONFLICT": return "MEMORY_REQUEST_ID_CONFLICT";
    case "MEMORY_TRANSITION_STALE": return "MEMORY_AUTHORITY_MISMATCH";
    case "MEMORY_TRANSITION_PROOF_INVALID": return "MEMORY_INTEGRITY_ERROR";
    case "MEMORY_TRANSITION_OUTCOME_UNKNOWN": return "MEMORY_OUTCOME_UNKNOWN";
    case "MEMORY_TRANSITION_LEASE_LOST": case "MEMORY_TRANSITION_UNAVAILABLE": return "MEMORY_PROVIDER_UNAVAILABLE";
    default: return "MEMORY_INTERNAL_ERROR";
  }
}
