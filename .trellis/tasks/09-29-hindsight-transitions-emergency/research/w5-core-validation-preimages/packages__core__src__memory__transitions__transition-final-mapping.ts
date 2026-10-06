/**
 * INPUT:  persisted delta/result identities and actual final post-maintenance W2 snapshots for every admitted Bank
 * OUTPUT: validated final logical mappings and isolated candidate/checkpoint identity for W4's complete COMMIT join
 * POS:    core/memory/transitions — W3 final-state validation; immediate delta revisions alone never become a baseline
 */
import { MemoryTransitionCandidateSchema, type MemoryTransitionCandidate, type MemoryTransitionPreparation,
  type MemoryTransitionNativeEvidence, type MemoryTransitionLocalState, type MemoryTransitionObjectMapping } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { requireTransitionPreparation, readTransitionLocalCapture, assertTransitionLocalCurrent,
  requireTransitionLocalClosure, type TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import { readTransitionPreparation, readTransitionDeltaResult, validatePreparedDeltaResult } from "../../db/memory-transition-delta-repo.ts";
import { readTransitionNativeEvidence, reserveTransitionCandidate, saveTransitionCandidate, saveTransitionCommonBaseline,
  readTransitionCandidate, readTransitionLocalAncestors, readTransitionPublishedNativeBaseline } from "../../db/memory-transition-candidate-repo.ts";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import { projectTransitionLocalBank, transitionProjectionContext } from "./transition-local-projection.ts";
import { sortState, readBlocks, historicalRows } from "./transition-local-candidate.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { sameApplicationValue } from "../hindsight/hindsight-application-integrity.ts";
import { projectTransitionPendingSources } from "./transition-pending-sources.ts";

export function buildTransitionHindsightCandidate(db: Database, input: TransitionCaptureInput & {
  preparationIds: string[]; evidenceIds: string[];
}): MemoryTransitionCandidate {
  const reservation = reserveTransitionCandidate(db, input); let candidate: MemoryTransitionCandidate | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    if (intent.request.expected.sourceProvider !== "local") invalid();
    const prepared = input.preparationIds.map((id) => readTransitionPreparation(db, id));
    const evidence = input.evidenceIds.map((id) => readTransitionNativeEvidence(db, id));
    const expected = intent.request.expected.banks.map((bank) => bank.sourceBankId).sort();
    if (transitionLocalHash(expected) !== transitionLocalHash(prepared.map((row) => row.scope.localBankId).sort())
      || evidence.length !== prepared.length || new Set(evidence.map((entry) => entry.status.bank_id)).size !== evidence.length
      || new Set(prepared.map((row) => row.captureId)).size !== 1) invalid();
    const first = prepared[0]; if (!first) invalid();
    const capture = readTransitionLocalCapture(db, first.captureId); assertTransitionLocalCurrent(db, capture);
    const state: MemoryTransitionLocalState = { banks: [], sources: [], records: [], derived: [], blocks: capture.state.blocks, history: [...capture.state.history], historicalReferences: [], sourceAliases: [], sourceSets: [] };
    const mappings: MemoryTransitionObjectMapping[] = []; const scopes = [];
    for (const preparation of prepared) {
      const final = evidence.find((entry) => entry.status.bank_id === preparation.scope.nativeBankId); if (!final) invalid();
      const previous = validateTransitionFinalMapping(db, preparation, final);
      const scope = { ...preparation.scope, evidenceId: final.evidenceId }; scopes.push(scope);
      const projected = projectTransitionLocalBank({ evidence: final, scope, epochId: reservation.epochId,
        createdAt: reservation.createdAt, previous, localEpochIds: readTransitionLocalAncestors(db, intent.request.expected.predecessorEpochId),
        nativeBaseline: preparationNativeBaseline(db, preparation) });
      state.banks.push(projected.bank); state.sources.push(...projected.sources); state.records.push(...projected.records);
      state.derived.push(...projected.derived); mappings.push(...projected.mappings);
      state.historicalReferences.push(...projected.historicalReferences);
      state.sourceAliases.push(...projected.sourceAliases); state.sourceSets.push(...projected.sourceSets);
      state.history.push(...projected.initialPolicies);
    }
    sortState(state); requireTransitionLocalClosure(state);
    const body = { version: 1 as const, transitionId: intent.transitionId, predecessorEpochId: intent.request.expected.predecessorEpochId,
      targetEpochId: reservation.epochId, createdAt: reservation.createdAt, localCaptureId: capture.captureId,
      evidenceIds: evidence.map((entry) => entry.evidenceId), scopes, mappings, state,
      pendingSources: scopes.flatMap((scope) => projectTransitionPendingSources(evidence.find((entry) => entry.evidenceId === scope.evidenceId) ?? invalid(), scope)),
      mappingHash: transitionLocalHash(mappings), stateHash: transitionLocalHash(state) };
    candidate = MemoryTransitionCandidateSchema.parse({ ...body, candidateId: transitionDocumentHash("candidates", body) });
    saveTransitionCandidate(db, { ...input, candidate });
    saveTransitionCommonBaseline(db, { ...input, candidateId: candidate.candidateId, predecessorBaselineId: first.baselineId });
  });
  if (!candidate) invalid(); return candidate;
}
export function validateTransitionFinalMapping(db: Database, preparation: MemoryTransitionPreparation,
  evidence: MemoryTransitionNativeEvidence): MemoryTransitionObjectMapping[] {
  const saved = readTransitionDeltaResult(db, preparation.transitionId, preparation.scope.localBankId);
  if (!saved || saved.preparationId !== preparation.preparationId) invalid();
  validatePreparedDeltaResult(preparation, saved.result);
  const proof = evidence.status.proof;
  if (!proof || evidence.transitionId !== preparation.transitionId || proof.delta_result_hash !== saved.result.result_hash
    || proof.bank_id !== preparation.scope.nativeBankId || proof.bank_generation !== preparation.scope.nativeGeneration
    || proof.provider_lineage !== preparation.target.request.provider_lineage
    || proof.request_hash !== preparation.target.request.request_hash
    || proof.native_snapshot.manifest.end_cursor < saved.result.native_through_cursor
    || proof.application_snapshot.checkpoint.state_cursor < saved.result.application_through_cursor) invalid();
  const context = transitionProjectionContext(evidence); const mappings: MemoryTransitionObjectMapping[] = [];
  for (const mapping of saved.result.mappings) {
    if (!mapping.target) {
      const descriptor = preparation.request.native.find((row) => sameApplicationValue(row.source, mapping.source));
      if (!descriptor?.target || context.heads.some((head) => head.object_kind === descriptor.target?.object_kind
        && head.object_id === descriptor.target.object_id && head.version !== null)) invalid();
      continue;
    }
    const target = mapping.target;
    const head = context.heads.find((row) => row.object_kind === target.object_kind && row.object_id === target.object_id);
    if (mapping.disposition === "deleted") {
      if (!head?.tombstone || head.version || head.tombstone.object_revision < target.object_revision
        || head.previous_version?.payload_hash !== target.payload_hash) invalid();
      continue;
    }
    if (!head || (head.version?.object_revision ?? head.tombstone?.object_revision ?? 0) < target.object_revision
      || head.version?.object_revision === target.object_revision && head.version.payload_hash !== target.payload_hash) invalid();
    if (!head.version) continue;
    mappings.push({ localBankId: preparation.scope.localBankId, kind: mapping.source.source_kind, localId: mapping.source.source_id,
      native: head.version, semanticHash: mapping.source.source_payload_hash, application: head.bound_artifact,
      applicationBodyHash: head.bound_artifact ? context.reader.artifact(head.bound_artifact).body_ref.bytes_sha256 : null, origin: "baseline" });
  }
  for (const artifact of saved.result.artifacts) {
    const retained = context.reader.artifact(artifact.current);
    if (!sameApplicationValue({ key: retained.key, revision: retained.revision, record_hash: retained.record_hash }, artifact.current)) invalid();
  }
  return mappings;
}

/** W4 calls this again inside COMMIT/boot validation; hashes alone cannot certify an arbitrary caller-supplied projection. */
export function readVerifiedTransitionCandidate(db: Database, candidateId: string): MemoryTransitionCandidate {
  const candidate = readTransitionCandidate(db, candidateId);
  const records: MemoryTransitionLocalState = { banks: [], sources: [], records: [], derived: [], blocks: [], history: [], historicalReferences: [], sourceAliases: [], sourceSets: [] };
  const mappings: MemoryTransitionObjectMapping[] = [];
  const pendingSources = [];
  for (const scope of candidate.scopes) {
    if (!candidate.evidenceIds.includes(scope.evidenceId)) invalid();
    const evidence = readTransitionNativeEvidence(db, scope.evidenceId);
    pendingSources.push(...projectTransitionPendingSources(evidence, scope));
    if (evidence.transitionId !== candidate.transitionId || scope.nativeBankId !== evidence.status.bank_id
      || scope.nativeGeneration !== evidence.status.request.bank_generation) invalid();
    const prepared = candidate.localCaptureId ? findPreparation(db, candidate.transitionId, scope.localBankId) : null;
    const published = prepared ? undefined : readTransitionPublishedNativeBaseline(db, candidate.predecessorEpochId, scope.nativeBankId);
    const previous = prepared ? validateTransitionFinalMapping(db, prepared, evidence) : published?.mappings;
    const projection = projectTransitionLocalBank({ evidence, scope, epochId: candidate.targetEpochId, createdAt: candidate.createdAt, previous,
      localEpochIds: readTransitionLocalAncestors(db, candidate.predecessorEpochId), nativeBaseline: prepared ? preparationNativeBaseline(db, prepared)
        : published });
    records.banks.push(projection.bank); records.sources.push(...projection.sources); records.records.push(...projection.records);
    records.derived.push(...projection.derived); mappings.push(...projection.mappings);
    records.historicalReferences.push(...projection.historicalReferences);
    records.sourceAliases.push(...projection.sourceAliases); records.sourceSets.push(...projection.sourceSets);
    records.history.push(...projection.initialPolicies); records.blocks.push(...readBlocks(evidence, scope));
  }
  records.history.push(...(candidate.localCaptureId ? readTransitionLocalCapture(db, candidate.localCaptureId).state.history
    : historicalRows(db, candidate.scopes)));
  sortState(records);
  for (const key of ["banks", "sources", "records", "derived", "blocks", "history", "historicalReferences", "sourceAliases", "sourceSets"] as const) {
    if (!sameApplicationValue(records[key], candidate.state[key])) invalid();
  }
  if (!sameApplicationValue(mappings, candidate.mappings) || new Set(candidate.scopes.map((scope) => scope.localBankId)).size !== candidate.scopes.length
    || candidate.scopes.length !== candidate.evidenceIds.length || !sameApplicationValue(pendingSources, candidate.pendingSources)) invalid();
  requireTransitionLocalClosure(candidate.state); return candidate;
}
function findPreparation(db: Database, transitionId: string, bankId: string): MemoryTransitionPreparation {
  const row = db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:transition AND slot=:slot")
    .get({ transition: transitionId, slot: bankId });
  if (!row) invalid(); return readTransitionPreparation(db, String(row.id));
}
function preparationNativeBaseline(db: Database, preparation: MemoryTransitionPreparation) {
  if (preparation.request.unused_scope) return undefined;
  return { evidence: readTransitionNativeEvidence(db, preparation.scope.evidenceId), reusedMemoryIds: preparation.request.native
    .flatMap((row) => row.source.source_kind === "memory_unit" && row.disposition === "reuse" && row.target ? [row.target.object_id] : []) };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
