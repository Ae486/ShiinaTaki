/**
 * INPUT:  an active original/continuation operation, its fresh guard and correlated Host/Native observations
 * OUTPUT: immutable dispatch fences and confirmed candidate facts in the controlling Core
 * POS:    candidate repository progress; an existing fence never authorizes another effect or generic success receipt
 */
import { HindsightCandidateDispatchSchema, HindsightCandidateResourceSchema, HindsightCandidateRestoreReceiptSchema,
  type HindsightCandidateDispatch, type HindsightCandidateGuard, type HindsightCandidateResource,
  type HindsightCandidateRestoreReceipt, type HindsightCandidateRecord } from "@taki/shared/hindsight-candidate-domain";
import { HindsightCandidatePhysicalIdentitySchema, HindsightCandidateVerificationSchema,
  type HindsightCandidatePhysicalIdentity, type HindsightCandidateVerification } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { assertCandidateAccess, type CandidateAccess } from "./hindsight-candidate-domain-admission.ts";
import { candidateDomainFail, candidateDomainHash, candidateRecoveryResult, requireCandidateDomain } from "./hindsight-candidate-domain-read.ts";

export interface CandidateObservation {
  resource?: { dispatch: HindsightCandidateDispatch; value: HindsightCandidateResource; sources: HindsightCandidatePhysicalIdentity[] };
  restore?: { dispatch: HindsightCandidateDispatch; value: HindsightCandidateRestoreReceipt };
  baseline?: { dispatch: HindsightCandidateDispatch; identity: HindsightCandidatePhysicalIdentity; value: HindsightCandidateVerification };
}

/** True is issued once, only after the dispatch fence commits; false permits original-resource observation only. */
export function recordCandidateDispatch(db: Database, access: CandidateAccess, input: { dispatch: HindsightCandidateDispatch; guard: HindsightCandidateGuard }): boolean {
  const dispatch = HindsightCandidateDispatchSchema.parse(input.dispatch); let inserted = false;
  db.transaction(() => {
    const request = assertCandidateAccess(db, access, input.guard);
    if (request.kind === "candidate.inspect") candidateDomainFail("INSPECTION_ONLY");
    const record = requireCandidateDomain(db, access.candidateId);
    if (dispatch.candidateId !== access.candidateId) candidateDomainFail("CONFLICT");
    const previous = record.dispatches.find((entry) => entry.action === dispatch.action);
    if (previous) { if (candidateDomainHash("dispatch", previous) !== candidateDomainHash("dispatch", dispatch)) candidateDomainFail("CONFLICT"); return; }
    if (record.verification || dispatch.action === "restore" && !record.resource) candidateDomainFail("CONFLICT");
    if (dispatch.authorityHash !== candidateDomainHash("guard", input.guard)) candidateDomainFail("STALE");
    assertEffect(db, dispatch, input.guard);
    db.prepare("INSERT INTO hindsight_candidate_dispatches VALUES (:candidate,:action,:operation,:effect,:hash,:json)")
      .run({ candidate: access.candidateId, action: dispatch.action, operation: access.operationId, effect: dispatch.effectId,
        hash: candidateDomainHash("dispatch", dispatch), json: JSON.stringify(dispatch) });
    inserted = true;
  });
  return inserted;
}

export function recordCandidateObservation(db: Database, access: CandidateAccess, input: { observation: CandidateObservation; guard: HindsightCandidateGuard }) {
  db.transaction(() => {
    assertCandidateAccess(db, access, input.guard);
    let record = requireCandidateDomain(db, access.candidateId);
    if (input.observation.resource) {
      const proof = input.observation.resource; requireDispatch(record, proof.dispatch, "reserve");
      const value = HindsightCandidateResourceSchema.parse(proof.value); assertResource(record, value, proof.sources);
      insertFact(db, access, { kind: "resource", value }); record = requireCandidateDomain(db, access.candidateId);
    }
    if (input.observation.restore) {
      const proof = input.observation.restore; requireDispatch(record, proof.dispatch, "restore");
      const value = HindsightCandidateRestoreReceiptSchema.parse(proof.value);
      if (!record.resource || value.candidateId !== record.candidateId || value.restoreRequestId !== proof.dispatch.hostRequestId
        || value.restoreInputHash !== proof.dispatch.inputHash || value.archiveSha256 !== record.plan.source.archiveSha256
        || value.physicalIdentityHash !== candidateDomainHash("resource", record.resource)) candidateDomainFail("PROOF_MISMATCH");
      insertFact(db, access, { kind: "restore", value }); record = requireCandidateDomain(db, access.candidateId);
    }
    if (input.observation.baseline) {
      const proof = input.observation.baseline; requireDispatch(record, proof.dispatch, "restore");
      const value = HindsightCandidateVerificationSchema.parse(proof.value);
      const identity = HindsightCandidatePhysicalIdentitySchema.parse(proof.identity);
      const stable = record.resource && Object.fromEntries(Object.keys(record.resource).map((key) => [key, identity[key as keyof typeof identity]]));
      if (!record.restore || !record.resource || value.stage !== "baseline_verified" || value.candidateId !== record.candidateId
        || value.inventoryHash !== record.plan.source.inventoryHash || value.requestHash !== record.plan.source.backupRequestHash
        || value.identityHash !== transitionLocalHash(identity) || candidateDomainHash("resource", stable) !== candidateDomainHash("resource", record.resource)) candidateDomainFail("PROOF_MISMATCH");
      insertFact(db, access, { kind: "verification", value: { verification: value, identity } });
    }
  });
  return requireCandidateDomain(db, access.candidateId);
}

/** A producer completion is attributed to this exact operation, never a previous operation's candidate baseline. */
export function sealCandidateObservation(db: Database, access: CandidateAccess, guard: HindsightCandidateGuard) {
  const result = candidateRecoveryResult(requireCandidateDomain(db, access.candidateId));
  db.transaction(() => {
    assertCandidateAccess(db, access, guard);
    const previous = db.prepare("SELECT result_hash FROM hindsight_candidate_observations WHERE operation_id=:id").get({ id: access.operationId });
    const hash = candidateDomainHash("observation", result);
    if (previous) { if (previous.result_hash !== hash) candidateDomainFail("CONFLICT"); return; }
    db.prepare("INSERT INTO hindsight_candidate_observations VALUES (:operation,:hash,:json)")
      .run({ operation: access.operationId, hash, json: JSON.stringify(result) });
  });
  return result;
}

function assertEffect(db: Database, dispatch: HindsightCandidateDispatch, guard: HindsightCandidateGuard) {
  const row = db.prepare("SELECT * FROM run_effects WHERE effect_id=:id").get({ id: dispatch.effectId });
  const executor: unknown = row?.executor_ref_json ? JSON.parse(String(row.executor_ref_json)) : null;
  const source: unknown = row?.source_ref_json ? JSON.parse(String(row.source_ref_json)) : null;
  if (!row || row.run_id !== dispatch.runId || row.attempt_id !== dispatch.attemptId || row.input_digest !== dispatch.inputHash
    || row.state !== "intent_committed" || row.replay_posture !== "never" || typeof executor !== "object" || executor === null
    || !("type" in executor) || executor.type !== "host" || !("hostId" in executor) || executor.hostId !== guard.host.executionHostId
    || typeof source !== "object" || source === null || !("type" in source) || source.type !== "host") candidateDomainFail("PROOF_MISMATCH");
}

function requireDispatch(record: HindsightCandidateRecord, supplied: HindsightCandidateDispatch, action: HindsightCandidateDispatch["action"]) {
  const stored = record.dispatches.find((entry) => entry.action === action);
  if (!stored || candidateDomainHash("dispatch", stored) !== candidateDomainHash("dispatch", HindsightCandidateDispatchSchema.parse(supplied))) candidateDomainFail("PROOF_MISMATCH");
}

function insertFact(db: Database, access: CandidateAccess, fact: { kind: string; value: unknown }) {
  const previous = db.prepare("SELECT fact_hash FROM hindsight_candidate_facts WHERE candidate_id=:id AND kind=:kind").get({ id: access.candidateId, kind: fact.kind });
  const hash = candidateDomainHash(fact.kind, fact.value);
  if (previous) { if (previous.fact_hash !== hash) candidateDomainFail("PROOF_MISMATCH"); return; }
  db.prepare("INSERT INTO hindsight_candidate_facts VALUES (:candidate,:kind,:operation,:hash,:json)")
    .run({ candidate: access.candidateId, kind: fact.kind, operation: access.operationId, hash, json: JSON.stringify(fact.value) });
}

function assertResource(record: HindsightCandidateRecord, value: HindsightCandidateResource, rawSources: HindsightCandidatePhysicalIdentity[]) {
  const sources = rawSources.map((source) => HindsightCandidatePhysicalIdentitySchema.parse(source));
  if (value.resourceId !== record.candidateId || !sources.length || Object.entries(record.plan.guard.host)
    .some(([key, expected]) => value[key as keyof typeof value] !== expected)) candidateDomainFail("PROOF_MISMATCH");
  if (value.volumes.some((volume) => volume.writableAttachments.length !== 1 || volume.writableAttachments[0] !== value.containerId)) candidateDomainFail("PROOF_MISMATCH");
  for (const source of sources) {
    if (source.role !== "source" || source.coreHostId !== value.coreHostId || source.resourceId === value.resourceId
      || source.containerId === value.containerId || source.postgres.systemIdentifier === value.postgres.systemIdentifier
      || source.volumes.some((old) => value.volumes.some((next) => old.backingId === next.backingId
        || source.engineId === value.engineId && old.name === next.name || old.writableAttachments.includes(value.containerId)))) candidateDomainFail("PROOF_MISMATCH");
  }
}
