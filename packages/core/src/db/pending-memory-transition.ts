/**
 * INPUT:  one validated Pending Memory row and an explicit recovery-stage transition
 * OUTPUT: legal progress preserving immutable intent/native success, with acceptance-aged Pending polling
 * POS:    core/db — pure outbox transition rules; the repository supplies CAS, lease, authority, and checkpoint guards
 */
import {
  MemoryDerivedCompletionEvidenceSchema, PendingMemoryNativeReceiptSchema, PendingMemoryStateSchema, REPLICA_RETRY_DELAYS_MS,
  type MemoryDerivedCompletionEvidence, type MemoryReplicaErrorCode, type MutationRequest,
  type PendingMemoryNativeReceipt, type PendingMemoryRecord, type PendingMemoryState,
  PendingMemoryDispatchSchema, PendingMemoryNativeResultReceiptSchema, HindsightNativeResultStatusSchema,
  type PendingMemoryDispatch, type PendingMemoryNativeResultReceipt, type HindsightNativeResultStatus,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { validatePendingMemoryIntent } from "../memory/pending-memory-safety.ts";
import { assertNativeResultBinding, prepareTrackedDispatch } from "../memory/hindsight/hindsight-native-proof.ts";

export type PendingMemoryChange =
  | { kind: "dispatch"; preparedMutation: MutationRequest | null; dispatch?: PendingMemoryDispatch }
  | { kind: "acknowledged" }
  | { kind: "native_completed"; receipt: PendingMemoryNativeReceipt }
  | { kind: "native_progress"; status: HindsightNativeResultStatus }
  | { kind: "native_factual"; receipt: PendingMemoryNativeResultReceipt }
  | { kind: "derived_completed"; evidence: MemoryDerivedCompletionEvidence }
  | { kind: "confirm" }
  | { kind: "retry"; code: MemoryReplicaErrorCode }
  | { kind: "retry_derived"; code: MemoryReplicaErrorCode }
  | { kind: "terminal"; phase: "superseded" | "failed" | "outcome_unknown" | "cancelled"; code: MemoryReplicaErrorCode; currentRevision?: number };

export function pendingMemoryState(record: PendingMemoryRecord): PendingMemoryState {
  const { sequence, ...state } = record;
  void sequence;
  return state;
}

export function pendingMemoryTerminal(state: PendingMemoryState): boolean {
  return state.terminalAt !== null;
}

export function transitionPendingMemory(record: PendingMemoryRecord, change: PendingMemoryChange, now: string): PendingMemoryState {
  if (pendingMemoryTerminal(record)) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  const state = { ...pendingMemoryState(record), version: record.version + 1, updatedAt: now, diagnosticCode: null };
  switch (change.kind) {
    case "dispatch": return dispatch(state, change, now);
    case "acknowledged":
      requirePhase(state, "submitted");
      return PendingMemoryStateSchema.parse({ ...state, acceptedAt: state.acceptedAt ?? now });
    case "native_completed":
      requirePhase(state, "submitted");
      return PendingMemoryStateSchema.parse({ ...state, phase: "awaiting_derived", acceptedAt: state.acceptedAt ?? now,
        nativeReceipt: PendingMemoryNativeReceiptSchema.parse(change.receipt), nextRetryAt: null });
    case "native_progress":
      requirePhase(state, "submitted");
      return PendingMemoryStateSchema.parse({ ...state, nativeStatus: HindsightNativeResultStatusSchema.parse(change.status) });
    case "native_factual": {
      requirePhase(state, "submitted");
      const receipt = PendingMemoryNativeResultReceiptSchema.parse(change.receipt);
      assertNativeResultBinding(state, receipt.result);
      return PendingMemoryStateSchema.parse({ ...state, phase: "awaiting_pull", acceptedAt: state.acceptedAt ?? now,
        nativeResultReceipt: receipt, nativeResultReceiptHash: canonicalPayloadHash(receipt), nativeStatus: null, nextRetryAt: null });
    }
    case "derived_completed": return derived(state, change.evidence);
    case "confirm":
      requirePhase(state, "awaiting_pull");
      return PendingMemoryStateSchema.parse({ ...state, phase: "completed", lease: null, terminalAt: now, nextRetryAt: null });
    case "retry":
      return retry(state, change.code, now);
    case "retry_derived":
      requirePhase(state, "awaiting_pull");
      if (state.nativeResultReceipt) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
      return retry({ ...state, phase: "awaiting_derived", derivedEvidence: null }, change.code, now);
    case "terminal":
      if (state.nativeReceipt !== null || state.nativeResultReceipt) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
      return PendingMemoryStateSchema.parse({ ...state, phase: change.phase, lease: null, terminalAt: now,
        diagnosticCode: change.code, currentRevision: change.currentRevision ?? null, nextRetryAt: null });
  }
}

function retry(state: PendingMemoryState, code: MemoryReplicaErrorCode, now: string): PendingMemoryState {
  const acceptedAt = state.acceptedAt;
  const delay = code === "HINDSIGHT_PENDING_REMAINS" && acceptedAt !== null
    ? REPLICA_RETRY_DELAYS_MS.find((rung) => rung >= Date.parse(now) - Date.parse(acceptedAt)) ?? REPLICA_RETRY_DELAYS_MS[4]
    : REPLICA_RETRY_DELAYS_MS[Math.min(Math.max(0, state.attempts - 1), 4)] ?? REPLICA_RETRY_DELAYS_MS[4];
  return PendingMemoryStateSchema.parse({ ...state, lease: null, diagnosticCode: code,
    nextRetryAt: new Date(Date.parse(now) + delay).toISOString() });
}

function dispatch(state: PendingMemoryState, change: Extract<PendingMemoryChange, { kind: "dispatch" }>, now: string): PendingMemoryState {
  requirePhase(state, "queued");
  const original = state.intent.operation;
  const prepared = change.preparedMutation;
  if (original.kind === "mutation") {
    if (prepared === null) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    validatePendingMemoryIntent({ ...state.intent, operation: { kind: "mutation", request: prepared } });
    assertPreparedMutation(original.request, prepared);
  } else if (prepared !== null) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  const selected = PendingMemoryDispatchSchema.parse(change.dispatch ?? { protocol: "legacy_native_v1" });
  if (selected.protocol === "tracked_native_v1" && canonicalJson(selected) !== canonicalJson(prepareTrackedDispatch(state, prepared))) {
    throw new Error("HINDSIGHT_PENDING_IDENTITY_CONFLICT");
  }
  return PendingMemoryStateSchema.parse({ ...state, phase: "submitted", dispatchedAt: now, dispatch: selected,
    preparedMutation: prepared, preparedMutationHash: prepared === null ? null : canonicalPayloadHash(prepared) });
}

function assertPreparedMutation(original: MutationRequest, prepared: MutationRequest): void {
  if (original.kind !== "edit" || prepared.kind !== "edit" || original.patch.layerId === undefined) {
    if (canonicalJson(original) !== canonicalJson(prepared)) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    return;
  }
  const withoutEntities = (request: Extract<MutationRequest, { kind: "edit" }>) => ({ ...request, patch: { ...request.patch, entities: undefined } });
  if (canonicalJson(withoutEntities(original)) !== canonicalJson(withoutEntities(prepared))
    || !prepared.patch.entities?.includes(`taki-layer:${original.patch.layerId}`)
    || prepared.patch.entities.some((entity) => entity.startsWith("taki-layer:") && entity !== `taki-layer:${original.patch.layerId}`)) {
    throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  }
}

function derived(state: PendingMemoryState, raw: MemoryDerivedCompletionEvidence): PendingMemoryState {
  requirePhase(state, "awaiting_derived");
  const evidence = MemoryDerivedCompletionEvidenceSchema.parse(raw);
  if (evidence.nativeReceiptHash !== canonicalPayloadHash(state.nativeReceipt)) throw new Error("HINDSIGHT_DERIVED_FENCE_INVALID");
  try { return PendingMemoryStateSchema.parse({ ...state, phase: "awaiting_pull", derivedEvidence: evidence, nextRetryAt: null }); }
  catch { throw new Error("HINDSIGHT_DERIVED_FENCE_INVALID"); }
}

function requirePhase(state: PendingMemoryState, expected: PendingMemoryState["phase"]): void {
  if (state.phase !== expected) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
}
