/**
 * INPUT:  validated Canonical records and pending sources plus admission-captured Bank routes
 * OUTPUT: semantic Memory views with callable selectors, attribution and complete source data
 * POS:    core/memory/canonical-tools — model boundary only; never changes records or recall admission
 */
import type { CanonicalMemoryRecord, MemoryProvenance, RecallPendingOverlayEntry, RetainRequest } from "@taki/shared";

export interface MemoryModelRoutes { readonly global: string; readonly character: string }

export function memoryModelScope(routes: MemoryModelRoutes, bankId: string) {
  if (bankId === routes.global && bankId === routes.character) return "both";
  if (bankId === routes.global) return "global";
  if (bankId === routes.character) return "character";
  throw new Error("memory model view belongs to an uncaptured Bank");
}

export function memoryPolicyModelView(policy: RetainRequest["policy"]) {
  return { layer: policy.layerId, origin: policy.origin, visibility: policy.visibility,
    disclosure: policy.disclosure, importance: policy.importance, retention: policy.retention,
    ...(policy.emotionalWeight !== null ? { emotionalWeight: policy.emotionalWeight } : {}) };
}

function provenanceModelView(provenance: MemoryProvenance) {
  return { actor: provenance.actor, origin: provenance.origin, sourceRef: provenance.sourceRef,
    capturedAt: provenance.capturedAt,
    ...(provenance.characterId !== null ? { characterId: provenance.characterId } : {}),
    ...(provenance.timelineFromSeq !== null ? { timelineFromSeq: provenance.timelineFromSeq, timelineToSeq: provenance.timelineToSeq } : {}) };
}

export function memorySourceModelView(source: RetainRequest) {
  return { content: source.content, context: source.context, policy: memoryPolicyModelView(source.policy),
    provenance: provenanceModelView(source.provenance),
    ...(source.timestamp !== null ? { timestamp: source.timestamp } : {}),
    ...(source.tags.length ? { tags: source.tags } : {}),
    ...(source.entities.length ? { entities: source.entities } : {}),
    ...(Object.keys(source.metadata).length ? { metadata: source.metadata } : {}),
    ...(source.observationScopes !== null ? { observationScopes: source.observationScopes } : {}) };
}

export function memoryRecordModelView(record: CanonicalMemoryRecord, routes: MemoryModelRoutes) {
  const { unit, policy, provenance } = record;
  const time = Object.fromEntries(Object.entries({ eventDate: unit.eventDate, occurredStart: unit.occurredStart,
    occurredEnd: unit.occurredEnd, mentionedAt: unit.mentionedAt, createdAt: unit.createdAt, updatedAt: unit.updatedAt,
    editedAt: unit.editedAt, consolidatedAt: unit.consolidatedAt, consolidationFailedAt: unit.consolidationFailedAt,
    invalidatedAt: unit.invalidatedAt }).filter(([, value]) => value !== null));
  return { scope: memoryModelScope(routes, unit.bankId), memoryId: unit.memoryId, revision: unit.revision,
    text: unit.text, ...(unit.context !== null ? { context: unit.context } : {}), factType: unit.factType,
    state: unit.state, policy: memoryPolicyModelView(policy), provenance: provenanceModelView(provenance),
    ...(unit.tags.some((tag) => tag !== `taki-layer:${policy.layerId}`)
      ? { tags: unit.tags.filter((tag) => tag !== `taki-layer:${policy.layerId}`) } : {}),
    ...(Object.keys(unit.metadata).length ? { metadata: unit.metadata } : {}),
    ...(unit.entities.length ? { entities: unit.entities } : {}),
    ...(unit.sourceMemoryIds.length ? { sourceMemoryIds: unit.sourceMemoryIds } : {}),
    ...(unit.observationScopes !== null ? { observationScopes: unit.observationScopes } : {}),
    ...(unit.invalidationReason !== null ? { invalidationReason: unit.invalidationReason } : {}),
    time, proofCount: unit.proofCount };
}

export function memoryPendingModelView(pending: RecallPendingOverlayEntry, routes: MemoryModelRoutes) {
  const base = { scope: memoryModelScope(routes, pending.bankId), confirmed: pending.confirmed,
    phase: pending.phase, originalAt: pending.originalAt };
  if (pending.operation.kind === "retain") return { ...base, kind: "retain",
    ...memorySourceModelView(pending.operation.request), zeroResultAllowed: pending.operation.zeroResultAllowed };
  const request = pending.operation.request;
  return { ...base, kind: request.kind, memoryId: request.memoryId, expectedRevision: request.expectedRevision,
    ...(request.kind === "edit" ? { patch: request.patch } : {}),
    ...(request.kind === "invalidate" ? { reason: request.reason } : {}),
    ...(pending.targetRecord ? { target: memoryRecordModelView(pending.targetRecord, routes) } : {}) };
}
