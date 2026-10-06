/**
 * INPUT:  validated operation admission and identity-bound transition lease changes
 * OUTPUT: immutable intents and CAS executor ownership with persistent admission cutoff
 * POS:    core/db — storage for the existing operation owner; no scheduler or authority publication
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MemoryTransitionAttemptSchema, MemoryTransitionIdentitySchema, MemoryTransitionIntentSchema,
  type MemoryTransitionAttempt, type MemoryTransitionIdentity, type MemoryTransitionIntent } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import type { Database } from "./sqlite.ts";
import { transitionIsQuarantined } from "./memory-transition-emergency-quarantine.ts";

export interface TransitionLease { transitionId: string; operationId: string; attemptId: string; generation: number; revision: number; ownerId: string }
export const DEFAULT_TRANSITION_QUEUE_POLICY = Object.freeze({ maxIntents: 256, maxBytes: 8_388_608, maxIntentBytes: 262_144, admissionWindowMs: 120_000 });

export function readTransitionIntent(db: Database, transitionId: string): MemoryTransitionIntent | undefined {
  const row = db.prepare("SELECT intent_json FROM memory_transition_intents WHERE transition_id=:id").get({ id: transitionId });
  return row ? MemoryTransitionIntentSchema.parse(JSON.parse(String(row.intent_json))) : undefined;
}
export function readTransitionByRequest(db: Database, requestId: string): MemoryTransitionIntent | undefined {
  const row = db.prepare("SELECT intent_json FROM memory_transition_intents WHERE request_id=:id").get({ id: requestId });
  return row ? MemoryTransitionIntentSchema.parse(JSON.parse(String(row.intent_json))) : undefined;
}
export function readTransitionAttempt(db: Database, transitionId: string): MemoryTransitionAttempt | undefined {
  const row = db.prepare("SELECT attempt_json FROM memory_transition_attempts WHERE transition_id=:id").get({ id: transitionId });
  return row ? MemoryTransitionAttemptSchema.parse(JSON.parse(String(row.attempt_json))) : undefined;
}

/** Must join operation insertion in the owner's synchronous transaction; failure leaves no admission ACK. */
export function admitTransition(db: Database, input: { intent: MemoryTransitionIntent; current: MemoryTransitionIdentity }): MemoryTransitionIntent {
  const intent = MemoryTransitionIntentSchema.parse(input.intent);
  const current = MemoryTransitionIdentitySchema.parse(input.current);
  db.transaction(() => {
    const prior = readTransitionByRequest(db, intent.request.requestId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(intent)) throw new Error("MEMORY_TRANSITION_CONFLICT");
      return;
    }
    assertTransitionPredecessor(db, intent);
    if (canonicalJson(current) !== canonicalJson(intent.request.expected)
      || intent.request.previewHash !== canonicalPayloadHash(["taki-transition-preview.v1", intent.request.kind, current])) throw new Error("MEMORY_TRANSITION_STALE");
    const operation = db.prepare("SELECT request_json,producer_json,terminal_at FROM memory_operations WHERE operation_id=:id").get({ id: intent.operationId });
    if (!operation || operation.terminal_at !== null || canonicalJson(JSON.parse(String(operation.request_json))) !== canonicalJson(intent.request)
      || JSON.parse(String(operation.producer_json)).transitionId !== intent.transitionId) throw new Error("MEMORY_TRANSITION_CONFLICT");
    db.prepare("INSERT INTO memory_transition_intents VALUES (:id,:operation,:request,:json)")
      .run({ id: intent.transitionId, operation: intent.operationId, request: intent.request.requestId, json: canonicalJson(intent) });
  });
  return intent;
}

export function assertTransitionPredecessor(db: Database, intent: MemoryTransitionIntent): void {
  const epoch = db.prepare(`SELECT e.epoch_id,e.provider_id,e.provider_lineage_id FROM canonical_memory_authority_state s
    JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1 AND e.status='active'`).get();
  const expected = intent.request.expected;
  if (!epoch || epoch.epoch_id !== expected.predecessorEpochId || epoch.provider_id !== expected.sourceProvider
    || epoch.provider_lineage_id !== expected.sourceLineageId) throw new Error("MEMORY_TRANSITION_STALE");
}

/** Lease takeover replaces only executor identity. It never releases the durable fence or replays an effect. */
export function claimTransition(db: Database, input: { transitionId: string; operationId?: string; ownerId: string; now: string; leaseMs: number }): MemoryTransitionAttempt {
  if (transitionIsQuarantined(db, input.transitionId)) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  z.iso.datetime({ offset: true }).parse(input.now);
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1000 || input.leaseMs > 300_000) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  let next: MemoryTransitionAttempt | undefined;
  db.transaction(() => {
    const intent = readTransitionIntent(db, input.transitionId);
    if (!intent) throw new Error("MEMORY_TRANSITION_STALE");
    const operationId = input.operationId ?? intent.operationId;
    const operation = db.prepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: operationId });
    if (operationId !== intent.operationId && !db.prepare("SELECT operation_id FROM memory_transition_recoveries WHERE operation_id=:id AND transition_id=:transition")
      .get({ id: operationId, transition: intent.transitionId })) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
    const prior = readTransitionAttempt(db, input.transitionId);
    if (operation?.state !== "running" || prior?.phase === "terminal"
      || (prior && Date.parse(prior.leaseUntil) > Date.parse(input.now))) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
    next = MemoryTransitionAttemptSchema.parse({ ...prior, transitionId: input.transitionId, operationId, attemptId: randomUUID(), ownerId: input.ownerId,
      generation: (prior?.generation ?? 0) + 1, revision: (prior?.revision ?? -1) + 1,
      leaseUntil: new Date(Date.parse(input.now) + input.leaseMs).toISOString(), phase: prior?.phase ?? "admitted",
      admissionOpenedAt: prior?.admissionOpenedAt ?? null, cutoffAt: prior?.cutoffAt ?? null, cutoffSequence: prior?.cutoffSequence ?? null,
      lastEvidenceId: prior?.lastEvidenceId ?? null, cancellationRequested: prior?.cancellationRequested ?? false });
    if (prior) writeAttempt(db, prior, next);
    else db.prepare("INSERT INTO memory_transition_attempts VALUES (:id,:revision,:phase,:json)")
      .run({ id: next.transitionId, revision: next.revision, phase: next.phase, json: canonicalJson(next) });
  });
  if (!next) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  return next;
}

export function requireTransitionLease(db: Database, input: { lease: TransitionLease; now: string }): MemoryTransitionAttempt {
  if (transitionIsQuarantined(db, input.lease.transitionId)) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  z.iso.datetime({ offset: true }).parse(input.now);
  const value = readTransitionAttempt(db, input.lease.transitionId);
  const operation = db.prepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: input.lease.operationId });
  if (!value || value.phase === "terminal" || value.attemptId !== input.lease.attemptId || value.generation !== input.lease.generation
    || operation?.state !== "running" || value.operationId !== input.lease.operationId || value.revision !== input.lease.revision
    || value.ownerId !== input.lease.ownerId || Date.parse(value.leaseUntil) <= Date.parse(input.now)) {
    throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  }
  return value;
}

export function updateTransitionAttempt(db: Database, input: { lease: TransitionLease; now: string;
  patch: Partial<Pick<MemoryTransitionAttempt, "phase" | "leaseUntil" | "cancellationRequested">> }): MemoryTransitionAttempt {
  let next: MemoryTransitionAttempt | undefined;
  db.transaction(() => {
    const prior = requireTransitionLease(db, input);
    validateAttemptPatch(db, prior, input);
    next = MemoryTransitionAttemptSchema.parse({ ...prior, ...input.patch, revision: prior.revision + 1 });
    writeAttempt(db, prior, next);
  });
  if (!next) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  return next;
}

function validateAttemptPatch(db: Database, prior: MemoryTransitionAttempt, input: Parameters<typeof updateTransitionAttempt>[1]): void {
  const phases = ["admitted", "draining", "fenced", "proven", "committed", "binding", "settling", "terminal"];
  const phase = input.patch.phase ?? prior.phase;
  if (phase === "terminal" || (phase === "committed" && prior.phase !== "committed")
    || phases.indexOf(phase) < phases.indexOf(prior.phase) || phases.indexOf(phase) > phases.indexOf(prior.phase) + 1
    || (prior.cancellationRequested && input.patch.cancellationRequested === false)) throw new Error("MEMORY_TRANSITION_CONFLICT");
  if (["fenced", "proven"].includes(phase) && prior.cutoffAt === null) throw new Error("MEMORY_TRANSITION_CUTOFF");
  if (phase === "proven" && (!prior.lastEvidenceId || !db.prepare("SELECT evidence_id FROM memory_transition_evidence WHERE evidence_id=:id").get({ id: prior.lastEvidenceId }))) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  if (input.patch.leaseUntil) {
    const remaining = Date.parse(input.patch.leaseUntil) - Date.parse(input.now);
    if (!Number.isFinite(remaining) || remaining < 1000 || remaining > 300_000) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  }
}

export function changeTransitionAdmission(db: Database, input: { lease: TransitionLease; now: string; action: "open" | "close" }): MemoryTransitionAttempt {
  let next: MemoryTransitionAttempt | undefined;
  db.transaction(() => {
    const prior = requireTransitionLease(db, input);
    const intent = readTransitionIntent(db, input.lease.transitionId);
    if (!intent) throw new Error("MEMORY_TRANSITION_STALE");
    assertTransitionPredecessor(db, intent);
    if (prior.cutoffAt !== null || (input.action === "open" && prior.admissionOpenedAt !== null)) throw new Error("MEMORY_TRANSITION_CUTOFF");
    const sequence = Number(db.prepare("SELECT coalesce(max(sequence),0) AS n FROM memory_transition_queue WHERE transition_id=:id").get({ id: prior.transitionId })?.n);
    const patch = input.action === "open" ? { admissionOpenedAt: input.now } : { admissionOpenedAt: prior.admissionOpenedAt ?? input.now, cutoffAt: input.now, cutoffSequence: sequence };
    next = MemoryTransitionAttemptSchema.parse({ ...prior, ...patch, revision: prior.revision + 1 });
    writeAttempt(db, prior, next);
  });
  if (!next) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
  return next;
}

export function writeAttempt(db: Database, prior: MemoryTransitionAttempt, next: MemoryTransitionAttempt): void {
  const changes = db.prepare(`UPDATE memory_transition_attempts SET revision=:revision,phase=:phase,attempt_json=:json
    WHERE transition_id=:id AND revision=:old AND attempt_json=:prior`).run({ id: prior.transitionId, old: prior.revision,
    prior: canonicalJson(prior), revision: next.revision, phase: next.phase, json: canonicalJson(next) }).changes;
  if (changes !== 1) throw new Error("MEMORY_TRANSITION_LEASE_LOST");
}

/** Extend only the same live executor; heartbeat does not invalidate an in-flight producer's phase CAS. */
export function renewTransitionLease(db: Database, input: { lease: TransitionLease; now: string }): void {
  db.transaction(() => {
    const prior = requireTransitionLease(db, input);
    writeAttempt(db, prior, { ...prior, leaseUntil: new Date(Date.parse(input.now) + 300_000).toISOString() });
  });
}
