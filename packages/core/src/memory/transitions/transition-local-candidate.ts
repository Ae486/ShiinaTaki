/**
 * INPUT:  W1 fenced transition, persisted complete native evidence and verified historical Local scope lineage
 * OUTPUT: immutable isolated Local candidate, common baseline and stable D86 scope identities
 * POS:    core/memory/transitions — W3 preparation; selected canonical tables and old receipts remain untouched
 */
import { MemoryTransitionCandidateSchema, MemoryTransitionLocalStateSchema,
  type MemoryTransitionNativeEvidence, type MemoryTransitionScopeMapping, type MemoryTransitionCandidate,
  type MemoryTransitionLocalState, type MemoryTransitionIntent } from "@taki/shared";
import { requireTransitionPreparation, requireTransitionLocalClosure, type TransitionCaptureInput } from "../../db/memory-transition-local-capture.ts";
import { readTransitionNativeEvidence, reserveTransitionCandidate, reserveTransitionScope, saveTransitionCandidate,
  saveTransitionCommonBaseline } from "../../db/memory-transition-candidate-repo.ts";
import { readTransitionLocalAncestors, readTransitionPublishedNativeBaseline } from "../../db/memory-transition-candidate-repo.ts";
import { transitionDocumentHash } from "../../db/memory-transition-document-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { projectTransitionLocalBank, transitionProjectionContext } from "./transition-local-projection.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { projectTransitionPendingSources } from "./transition-pending-sources.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "./transition-evidence-context.ts";

export function buildTransitionLocalCandidate(db: Database, input: TransitionCaptureInput & { evidenceIds: string[] }): MemoryTransitionCandidate {
  return withTransitionEvidenceContext(db, (verification) => buildLocalCandidate(db, { ...input, verification }));
}
function buildLocalCandidate(db: Database, input: TransitionCaptureInput & { evidenceIds: string[]; verification: TransitionEvidenceContext }): MemoryTransitionCandidate {
  const verification = input.verification;
  const reservation = reserveTransitionCandidate(db, input);
  let candidate: MemoryTransitionCandidate | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    if (intent.request.expected.sourceProvider !== "hindsight") invalid();
    const evidence = input.evidenceIds.map((id) => readTransitionNativeEvidence(db, id, verification));
    requireInventory(intent, evidence);
    const scopes = evidence.map((entry) => resolveScope(db, { intent, evidence: entry, verification }));
    const state: MemoryTransitionLocalState = { banks: [], sources: [], records: [], derived: [], blocks: [], history: [], historicalReferences: [], sourceAliases: [], sourceSets: [] };
    const mappings = [];
    for (const [index, entry] of evidence.entries()) {
      const scope = scopes[index]; if (!scope) invalid();
      const nativeBaseline = readTransitionPublishedNativeBaseline(db, { epochId: intent.request.expected.predecessorEpochId,
        nativeBankId: scope.nativeBankId, verification });
      const projection = projectTransitionLocalBank({ evidence: entry, scope, verification, epochId: reservation.epochId, createdAt: reservation.createdAt,
        localEpochIds: readTransitionLocalAncestors(db, intent.request.expected.predecessorEpochId),
        nativeBaseline, previous: nativeBaseline?.mappings });
      state.banks.push(projection.bank); state.sources.push(...projection.sources); state.records.push(...projection.records);
      state.derived.push(...projection.derived); mappings.push(...projection.mappings);
      state.historicalReferences.push(...projection.historicalReferences);
      state.sourceAliases.push(...projection.sourceAliases); state.sourceSets.push(...projection.sourceSets);
      state.history.push(...projection.initialPolicies);
      state.blocks.push(...readBlocks(entry, scope, verification));
    }
    state.history.push(...historicalRows(db, scopes));
    sortState(state); requireTransitionLocalClosure(state);
    const body = { version: 1 as const, transitionId: intent.transitionId, predecessorEpochId: intent.request.expected.predecessorEpochId,
      targetEpochId: reservation.epochId, createdAt: reservation.createdAt, localCaptureId: null,
      evidenceIds: evidence.map((entry) => entry.evidenceId), scopes, mappings, state: MemoryTransitionLocalStateSchema.parse(state),
      pendingSources: scopes.flatMap((scope) => projectTransitionPendingSources(evidence.find((entry) => entry.evidenceId === scope.evidenceId) ?? invalid(), scope, verification)),
      mappingHash: transitionLocalHash(mappings), stateHash: transitionLocalHash(state) };
    candidate = MemoryTransitionCandidateSchema.parse({ ...body, candidateId: transitionDocumentHash("candidates", body) });
    saveTransitionCandidate(db, { ...input, candidate });
    saveTransitionCommonBaseline(db, { ...input, candidateId: candidate.candidateId,
      predecessorBaselineId: intent.request.expected.baselineHash });
  });
  if (!candidate) invalid(); return candidate;
}
function requireInventory(intent: MemoryTransitionIntent, evidence: MemoryTransitionNativeEvidence[]): void {
  const expected = intent.request.expected.banks.map((bank) => bank.nativeBankId).sort();
  const actual = evidence.map((entry) => entry.status.bank_id).sort();
  if (transitionLocalHash(expected) !== transitionLocalHash(actual)
    || evidence.some((entry) => entry.transitionId !== intent.transitionId)) invalid();
}
function resolveScope(db: Database, input: { intent: MemoryTransitionIntent; evidence: MemoryTransitionNativeEvidence; verification: TransitionEvidenceContext }): MemoryTransitionScopeMapping {
  const { intent, evidence } = input;
  const admitted = intent.request.expected.banks.find((bank) => bank.nativeBankId === evidence.status.bank_id); if (!admitted) invalid();
  const context = transitionProjectionContext(evidence, input.verification);
  const bankHead = context.heads.find((head) => head.object_kind === "bank"); if (!bankHead) invalid();
  const body = context.body(bankHead);
  if (body && body.body_schema !== "application-bank.v1") invalid();
  const originalBank = body?.body_schema === "application-bank.v1" ? body.value.original_bank : null;
  if (originalBank && body?.body_schema === "application-bank.v1") {
    const epoch = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: originalBank.authorityEpochId });
    if (!epoch || epoch.provider_id !== "local" || epoch.provider_lineage_id !== body.value.original_provider_lineage
      || body.value.original_authority_epoch_id !== originalBank.authorityEpochId) invalid();
  }
  if (body?.body_schema === "application-bank.v1" && transitionLocalHash(body.value.scope) !== transitionLocalHash(admitted.scope)) invalid();
  const original = originalBank ? { bankId: originalBank.bankId, epochId: originalBank.authorityEpochId } : null;
  const localBankId = reserveTransitionScope(db, { intent, scope: admitted.scope, original });
  if (originalBank && transitionLocalHash(originalBank.scope) !== transitionLocalHash(admitted.scope)) invalid();
  return { scope: admitted.scope, localBankId, nativeBankId: evidence.status.bank_id,
    nativeGeneration: evidence.status.request.bank_generation, evidenceId: evidence.evidenceId,
    origin: original ? "original" : "new", originEpochId: original?.epochId ?? null };
}
export function readBlocks(evidence: MemoryTransitionNativeEvidence, scope: MemoryTransitionScopeMapping, verification?: TransitionEvidenceContext) {
  const context = transitionProjectionContext(evidence, verification);
  const current = new Map<string, (typeof context.artifacts extends Map<string, infer T> ? T : never)>();
  for (const artifact of context.artifacts.values()) {
    const key = JSON.stringify(artifact.key); const prior = current.get(key);
    if (!prior || prior.revision < artifact.revision) current.set(key, artifact);
  }
  return [...current.values()].filter((artifact) => artifact.key.artifact_kind === "block" && !artifact.tombstoned).map((artifact) => {
    const body = context.reader.body(artifact.body_ref).content;
    if (body.body_schema !== "application-block.v1" || transitionLocalHash(body.value.scope) !== transitionLocalHash(scope.scope)) invalid();
    return body.value;
  });
}
export function historicalRows(db: Database, scopes: MemoryTransitionScopeMapping[]): MemoryTransitionLocalState["history"] {
  const result: MemoryTransitionLocalState["history"] = [];
  for (const scope of scopes) {
    if (!scope.originEpochId) continue;
    for (const table of ["canonical_memory_revision_snapshots", "canonical_memory_retired_sources"]) {
      for (const row of db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch AND bank_id=:bank`)
        .all({ epoch: scope.originEpochId, bank: scope.localBankId })) result.push({ table, rowJson: JSON.stringify(row) });
    }
  }
  for (const epoch of new Set(scopes.flatMap((scope) => scope.originEpochId ? [scope.originEpochId] : []))) {
    for (const row of db.prepare("SELECT * FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch").all({ epoch })) {
      result.push({ table: "canonical_memory_operation_receipts", rowJson: JSON.stringify(row) });
    }
  }
  return result;
}
export function sortState(state: MemoryTransitionLocalState): void {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  state.banks.sort((a, b) => compare(a.bankId, b.bankId));
  state.sources.sort((a, b) => compare(JSON.stringify([a.bankId, a.documentId]), JSON.stringify([b.bankId, b.documentId])));
  state.records.sort((a, b) => compare(JSON.stringify([a.unit.bankId, a.unit.memoryId]), JSON.stringify([b.unit.bankId, b.unit.memoryId])));
  state.derived.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  state.blocks.sort((a, b) => compare(JSON.stringify([a.scope, a.block_id]), JSON.stringify([b.scope, b.block_id])));
  state.history.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  state.historicalReferences.sort((a, b) => compare(JSON.stringify([a.bankId, a.memoryId, a.sourceMemoryId]), JSON.stringify([b.bankId, b.memoryId, b.sourceMemoryId])));
  state.sourceAliases.sort((a, b) => compare(JSON.stringify([a.bankId, a.artifact.key]), JSON.stringify([b.bankId, b.artifact.key])));
  state.sourceSets.sort((a, b) => compare(JSON.stringify([a.bankId, a.memoryId]), JSON.stringify([b.bankId, b.memoryId])));
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
