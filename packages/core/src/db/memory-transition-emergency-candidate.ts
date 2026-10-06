/**
 * INPUT:  current emergency ownership, sealed incident and its complete original surviving Bank evidence
 * OUTPUT: immutable independently reconstructed Local candidate without a healthy common baseline
 * POS:    core/db — consumes the existing W3 row/provenance projection; does not publish authority
 */
import { randomUUID } from "node:crypto";
import { MemoryEmergencyCandidateSchema, MemoryTransitionLocalStateSchema,
  type MemoryEmergencyCandidate, type MemorySurvivingBankEvidence, type MemoryTransitionScopeMapping,
  type MemoryTransitionLocalState } from "@taki/shared";
import { readEmergencyCapture, readEmergencyIncident } from "./memory-transition-emergency-repo.ts";
import { readTransitionIntent, requireTransitionLease, assertTransitionPredecessor, type TransitionLease } from "./memory-transition-repo.ts";
import { insertTransitionDocument, readTransitionDocument, transitionDocumentHash } from "./memory-transition-document-repo.ts";
import { reserveTransitionScope, readTransitionLocalAncestors, readTransitionPublishedNativeBaseline } from "./memory-transition-candidate-repo.ts";
import { requireTransitionLocalClosure } from "./memory-transition-local-capture.ts";
import { projectSurvivingLocalBank } from "../memory/transitions/transition-local-projection.ts";
import { projectPendingSources } from "../memory/transitions/transition-pending-sources.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";
import { historicalRows, sortState } from "../memory/transitions/transition-local-candidate.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { Database } from "./sqlite.ts";
import { readSurvivingBaselinePolicies } from "./memory-transition-surviving-policy.ts";

export function prepareEmergencyCandidate(db: Database, input: { lease: TransitionLease; now: string; evidence: MemorySurvivingBankEvidence[] }): MemoryEmergencyCandidate {
  return withTransitionEvidenceContext(db, (verification) => prepareCandidate(db, input, verification));
}
function prepareCandidate(db: Database, input: Parameters<typeof prepareEmergencyCandidate>[1], verification: TransitionEvidenceContext): MemoryEmergencyCandidate {
  let result: MemoryEmergencyCandidate | undefined;
  db.transaction(() => {
    const attempt = requireTransitionLease(db, input); const intent = readTransitionIntent(db, attempt.transitionId);
    if (!intent || !intent.incidentId || !["fenced", "proven"].includes(attempt.phase) || attempt.cutoffAt === null) invalid();
    assertTransitionPredecessor(db, intent);
    const incident = readEmergencyIncident(db, intent.transitionId); const capture = readEmergencyCapture(db, intent.transitionId);
    if (!incident?.transition || !capture || input.evidence.length !== intent.request.expected.banks.length) invalid();
    const captured = incident.transition;
    const verifiedEvidence = input.evidence.map((raw) => {
      // This insertion is still inside the same uncommitted transaction. Validate its actual stored bytes before
      // consuming anything; a failure rolls back all insertions and cannot acknowledge unverified evidence.
      insertTransitionDocument(db, "surviving_evidence", { id: raw.evidenceId, transitionId: intent.transitionId, slot: raw.bankId, value: raw });
      const evidence = verification.readSurviving(db, raw.evidenceId);
      const covered = captured.banks.find((bank) => bank.bankId === evidence.bankId);
      if (!covered || covered.survivingEvidenceId !== evidence.evidenceId || evidence.captureId !== capture.captureId
        || evidence.transitionId !== intent.transitionId || covered.checkpointHash !== evidence.checkpointHash) invalid();
      return evidence;
    });
    let reservation = db.prepare("SELECT * FROM memory_transition_candidate_reservations WHERE transition_id=:id").get({ id: intent.transitionId });
    if (!reservation) {
      db.prepare("INSERT INTO memory_transition_candidate_reservations VALUES(:transition,:epoch,:now)")
        .run({ transition: intent.transitionId, epoch: randomUUID(), now: input.now });
      reservation = db.prepare("SELECT * FROM memory_transition_candidate_reservations WHERE transition_id=:id").get({ id: intent.transitionId });
    }
    if (!reservation) invalid();
    const scopes = verifiedEvidence.map((evidence): MemoryTransitionScopeMapping => {
      const bank = intent.request.expected.banks.find((entry) => entry.nativeBankId === evidence.bankId);
      const context = verification.surviving(evidence);
      const head = context.heads.find((entry) => entry.object_kind === "bank"); if (!bank || !head) invalid();
      const body = context.body(head); if (body && body.body_schema !== "application-bank.v1") invalid();
      const original = body?.body_schema === "application-bank.v1" ? body.value.original_bank : null;
      if (body?.body_schema === "application-bank.v1" && transitionLocalHash(body.value.scope) !== transitionLocalHash(bank.scope)) invalid();
      const originalAddress = original ? { bankId: original.bankId, epochId: original.authorityEpochId } : null;
      return { scope: bank.scope, nativeBankId: evidence.bankId, nativeGeneration: evidence.namespace.bank_generation,
        localBankId: reserveTransitionScope(db, { intent, scope: bank.scope, original: originalAddress }),
        origin: original ? "original" : "new", originEpochId: original?.authorityEpochId ?? null, evidenceId: evidence.evidenceId };
    });
    const identity = { transitionId: intent.transitionId, predecessorEpochId: intent.request.expected.predecessorEpochId,
      targetEpochId: String(reservation.target_epoch_id), createdAt: String(reservation.created_at), scopes };
    const projection = reconstruct(db, identity, verification);
    const body = { version: 2 as const, kind: "emergency-surviving" as const, ...identity,
      incidentId: capture.incidentId, incidentHash: transitionLocalHash(incident), captureId: capture.captureId,
      localCaptureId: null, evidenceIds: scopes.map((scope) => scope.evidenceId), ...projection,
      mappingHash: transitionLocalHash(projection.mappings), stateHash: transitionLocalHash(projection.state) };
    result = MemoryEmergencyCandidateSchema.parse({ ...body, candidateId: transitionDocumentHash("candidates", body) });
    insertTransitionDocument(db, "candidates", { id: result.candidateId, transitionId: intent.transitionId, slot: "final", value: result });
    readVerifiedEmergencyCandidate(db, result.candidateId, verification);
  });
  return result ?? invalid();
}

export function readVerifiedEmergencyCandidate(db: Database, candidateId: string, context?: TransitionEvidenceContext): MemoryEmergencyCandidate {
  context?.assertIndependent();
  return withTransitionEvidenceContext(db, (verification) => readEmergencyCandidate(db, candidateId, verification), context);
}
function readEmergencyCandidate(db: Database, candidateId: string, verification: TransitionEvidenceContext): MemoryEmergencyCandidate {
  const candidate = readTransitionDocument(db, "candidates", { id: candidateId, schema: MemoryEmergencyCandidateSchema });
  if (!candidate) invalid();
  const incident = readEmergencyIncident(db, candidate.transitionId); const capture = readEmergencyCapture(db, candidate.transitionId);
  const intent = readTransitionIntent(db, candidate.transitionId);
  if (!incident?.transition || !capture || !intent || candidate.incidentId !== incident.incidentId
    || candidate.captureId !== capture.captureId || candidate.incidentHash !== transitionLocalHash(incident)
    || candidate.predecessorEpochId !== capture.predecessorEpochId || candidate.targetEpochId === candidate.predecessorEpochId
    || candidate.localCaptureId !== null || candidate.scopes.length !== intent.request.expected.banks.length
    || new Set(candidate.scopes.map((scope) => scope.nativeBankId)).size !== candidate.scopes.length
    || candidate.scopes.some((scope) => !incident.transition!.banks.some((bank) => bank.bankId === scope.nativeBankId
      && bank.survivingEvidenceId === scope.evidenceId && bank.nativeGeneration === scope.nativeGeneration
      && transitionLocalHash(bank.scope) === transitionLocalHash(scope.scope)))
    || transitionLocalHash(candidate.evidenceIds) !== transitionLocalHash(candidate.scopes.map((scope) => scope.evidenceId))) invalid();
  const reservation = db.prepare("SELECT * FROM memory_transition_candidate_reservations WHERE transition_id=:id").get({ id: candidate.transitionId });
  if (reservation?.target_epoch_id !== candidate.targetEpochId || reservation.created_at !== candidate.createdAt) invalid();
  const expected = reconstruct(db, candidate, verification);
  if (candidate.stateHash !== transitionLocalHash(expected.state) || candidate.mappingHash !== transitionLocalHash(expected.mappings)
    || transitionLocalHash(candidate.state) !== candidate.stateHash || transitionLocalHash(candidate.mappings) !== candidate.mappingHash
    || transitionLocalHash(candidate.pendingSources) !== transitionLocalHash(expected.pendingSources)) invalid();
  return candidate;
}

function reconstruct(db: Database, identity: Pick<MemoryEmergencyCandidate, "transitionId" | "predecessorEpochId" | "targetEpochId" | "createdAt" | "scopes">,
  verification: TransitionEvidenceContext) {
  const state: MemoryTransitionLocalState = { banks: [], sources: [], records: [], derived: [], blocks: [], history: [],
    historicalReferences: [], sourceAliases: [], sourceSets: [] };
  const mappings = []; const pendingSources = [];
  for (const scope of identity.scopes) {
    const evidence = verification.readSurviving(db, scope.evidenceId);
    if (!evidence || evidence.transitionId !== identity.transitionId || evidence.bankId !== scope.nativeBankId
      || evidence.namespace.bank_generation !== scope.nativeGeneration) invalid();
    const context = verification.surviving(evidence);
    const nativeBaseline = readTransitionPublishedNativeBaseline(db, { epochId: identity.predecessorEpochId, nativeBankId: scope.nativeBankId, verification });
    const survivingPolicies = readSurvivingBaselinePolicies(db, { evidence, predecessorEpochId: identity.predecessorEpochId, baseline: nativeBaseline, verification });
    const projected = projectSurvivingLocalBank({ evidence, scope, epochId: identity.targetEpochId, createdAt: identity.createdAt,
      nativeBaseline, survivingPolicies, verification, previous: nativeBaseline?.mappings, localEpochIds: readTransitionLocalAncestors(db, identity.predecessorEpochId) });
    state.banks.push(projected.bank); state.sources.push(...projected.sources); state.records.push(...projected.records);
    state.derived.push(...projected.derived); mappings.push(...projected.mappings);
    state.historicalReferences.push(...projected.historicalReferences); state.sourceAliases.push(...projected.sourceAliases);
    state.sourceSets.push(...projected.sourceSets); state.history.push(...projected.initialPolicies);
    const blocks = new Map<string, typeof evidence.artifacts[number]>();
    for (const artifact of evidence.artifacts.filter((artifact) => artifact.key.artifact_kind === "block")) {
      const key = JSON.stringify(artifact.key); const prior = blocks.get(key);
      if (!prior || prior.revision < artifact.revision) blocks.set(key, artifact);
    }
    for (const artifact of blocks.values()) {
      if (artifact.tombstoned) continue;
      const body = context.reader.body(artifact.body_ref).content;
      if (body.body_schema !== "application-block.v1" || transitionLocalHash(body.value.scope) !== transitionLocalHash(scope.scope)) invalid();
      state.blocks.push(body.value);
    }
    pendingSources.push(...projectPendingSources({ context, scope, evidenceId: evidence.evidenceId, evidenceHash: evidence.evidenceId }));
  }
  state.history.push(...historicalRows(db, identity.scopes)); sortState(state); requireTransitionLocalClosure(state);
  return { state: MemoryTransitionLocalStateSchema.parse(state), mappings, pendingSources };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
