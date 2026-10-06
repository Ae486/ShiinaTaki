/**
 * INPUT:  verified complete W2 evidence, immutable candidates and W1 fenced ownership
 * OUTPUT: durable target/scope identities, isolated candidate storage and receipt-joined healthy baselines
 * POS:    core/db — W3 preparation only; no authority, runtime, custody or queue publication
 */
import { randomUUID } from "node:crypto";
import { MemoryTransitionNativeEvidenceSchema, MemoryTransitionCandidateSchema, MemoryTransitionCommonBaselineSchema,
  type MemoryTransitionNativeEvidence, type MemoryTransitionCandidate, type MemoryTransitionScopeMapping,
  type MemoryTransitionCommonBaseline, type MemoryTransitionIntent } from "@taki/shared";
import { verifyTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { insertTransitionDocument, readTransitionDocument, transitionDocumentHash } from "./memory-transition-document-repo.ts";
import { requireTransitionPreparation, type TransitionCaptureInput } from "./memory-transition-local-capture.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import type { Database } from "./sqlite.ts";

export function persistTransitionNativeEvidence(db: Database, input: TransitionCaptureInput & { evidence: MemoryTransitionNativeEvidence }): void {
  verifyTransitionNativeEvidence(input.evidence);
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input); const evidence = input.evidence;
    const bank = intent.request.expected.banks.find((entry) => entry.nativeBankId === evidence.status.bank_id);
    if (evidence.transitionId !== intent.transitionId || evidence.status.request.direction !== intent.request.kind.slice(11)
      || evidence.status.request.provider_lineage !== (intent.request.expected.sourceProvider === "hindsight"
        ? intent.request.expected.sourceLineageId : intent.request.expected.targetLineageId)
      || bank && bank.nativeGeneration !== evidence.status.request.bank_generation
      || intent.request.expected.sourceProvider === "hindsight" && !bank) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    insertTransitionDocument(db, "native_evidence", { id: evidence.evidenceId, transitionId: intent.transitionId,
      slot: evidence.status.bank_id, value: evidence });
  });
}
export function readTransitionNativeEvidence(db: Database, id: string): MemoryTransitionNativeEvidence {
  const evidence = readTransitionDocument(db, "native_evidence", { id, schema: MemoryTransitionNativeEvidenceSchema });
  if (!evidence) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  verifyTransitionNativeEvidence(evidence); return evidence;
}
export function reserveTransitionCandidate(db: Database, input: TransitionCaptureInput): { epochId: string; createdAt: string } {
  let result: { epochId: string; createdAt: string } | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input);
    const row = db.prepare("SELECT * FROM memory_transition_candidate_reservations WHERE transition_id=:id").get({ id: intent.transitionId });
    if (row) { result = { epochId: String(row.target_epoch_id), createdAt: String(row.created_at) }; return; }
    result = { epochId: randomUUID(), createdAt: input.now };
    db.prepare("INSERT INTO memory_transition_candidate_reservations VALUES(:id,:epoch,:now)")
      .run({ id: intent.transitionId, epoch: result.epochId, now: result.createdAt });
  });
  if (!result) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return result;
}
export function reserveTransitionScope(db: Database, input: { intent: MemoryTransitionIntent;
  scope: MemoryTransitionScopeMapping["scope"]; original: { bankId: string; epochId: string } | null }): string {
  const lineage = input.intent.request.expected.sourceProvider === "local"
    ? input.intent.request.expected.sourceLineageId : input.intent.request.expected.targetLineageId;
  const scopeKey = JSON.stringify(input.scope);
  const row = db.prepare("SELECT * FROM memory_transition_scope_ids WHERE lineage_id=:lineage AND scope_key=:scope")
    .get({ lineage, scope: scopeKey });
  if (input.original) requireHistoricalScope(db, input);
  if (row) {
    if (input.original && row.local_bank_id !== input.original.bankId) throw new Error("MEMORY_TRANSITION_CONFLICT");
    return String(row.local_bank_id);
  }
  const bankId = input.original?.bankId ?? randomUUID();
  db.prepare("INSERT INTO memory_transition_scope_ids VALUES(:lineage,:scope,:bank,:epoch,:transition)")
    .run({ lineage, scope: scopeKey, bank: bankId, epoch: input.original?.epochId ?? null, transition: input.intent.transitionId });
  return bankId;
}
function requireHistoricalScope(db: Database, input: Parameters<typeof reserveTransitionScope>[1]): void {
  const original = input.original;
  if (!original) return;
  const bank = createCanonicalMemoryAuthorityRepo(db).getBank(original.epochId, original.bankId);
  if (!bank || transitionLocalHash(bank.scope) !== transitionLocalHash(input.scope)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  if (!readTransitionLocalAncestors(db, input.intent.request.expected.predecessorEpochId).includes(original.epochId)) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
}
/** Original Local bodies may belong to any proven healthy ancestor, not only the Bank's first imported epoch. */
export function readTransitionLocalAncestors(db: Database, predecessorEpochId: string): string[] {
  let cursor: string | null = predecessorEpochId;
  const visited = new Set<string>();
  const epochs: string[] = [];
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const row = db.prepare("SELECT predecessor_epoch_id,reason,provider_id FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: cursor });
    if (!row || String(row.reason).includes("emergency")) break;
    if (row.provider_id === "local") epochs.push(cursor);
    cursor = row.predecessor_epoch_id === null ? null : String(row.predecessor_epoch_id);
  }
  return epochs;
}
export function readTransitionPublishedNativeBaseline(db: Database, epochId: string, nativeBankId: string) {
  const row = db.prepare(`SELECT c.id FROM memory_transition_candidate_reservations r
    JOIN memory_transition_candidates c ON c.transition_id=r.transition_id WHERE r.target_epoch_id=:epoch`).get({ epoch: epochId });
  if (!row) return undefined;
  const candidate = readTransitionCandidate(db, String(row.id));
  const receipt = readTransitionReceipt(db, candidate.transitionId);
  const scope = candidate.scopes.find((scope) => scope.nativeBankId === nativeBankId);
  if (!receipt || receipt.newEpochId !== epochId || receipt.mappingHash !== candidate.mappingHash || !scope) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  const evidence = readTransitionNativeEvidence(db, scope.evidenceId);
  return { evidence, mappings: candidate.mappings.filter((row) => row.localBankId === scope.localBankId), reusedMemoryIds: evidence.nativePages.flatMap((page) => page.records)
    .filter((row) => row.object_kind === "memory_unit").map((row) => row.object_id) };
}
export function saveTransitionCandidate(db: Database, input: TransitionCaptureInput & { candidate: MemoryTransitionCandidate }): void {
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input); const candidate = input.candidate;
    const { candidateId, ...body } = MemoryTransitionCandidateSchema.parse(candidate);
    const reservation = db.prepare("SELECT target_epoch_id FROM memory_transition_candidate_reservations WHERE transition_id=:id").get({ id: intent.transitionId });
    if (candidateId !== transitionDocumentHash("candidates", body) || candidate.transitionId !== intent.transitionId
      || candidate.predecessorEpochId !== intent.request.expected.predecessorEpochId || candidate.targetEpochId !== reservation?.target_epoch_id
      || candidate.evidenceIds.length !== intent.request.expected.banks.length
      || candidate.mappingHash !== transitionLocalHash(candidate.mappings) || candidate.stateHash !== transitionLocalHash(candidate.state)) {
      throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    }
    const evidence = candidate.evidenceIds.map((id) => readTransitionNativeEvidence(db, id));
    if (new Set(evidence.map((entry) => entry.status.bank_id)).size !== evidence.length
      || evidence.some((entry) => entry.transitionId !== intent.transitionId)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    insertTransitionDocument(db, "candidates", { id: candidateId, transitionId: intent.transitionId, slot: "final", value: candidate });
  });
}
export function readTransitionCandidate(db: Database, id: string): MemoryTransitionCandidate {
  const candidate = readTransitionDocument(db, "candidates", { id, schema: MemoryTransitionCandidateSchema });
  if (!candidate || candidate.mappingHash !== transitionLocalHash(candidate.mappings)
    || candidate.stateHash !== transitionLocalHash(candidate.state)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return candidate;
}
export function saveTransitionCommonBaseline(db: Database, input: TransitionCaptureInput & { candidateId: string; predecessorBaselineId: string | null }) {
  let result: MemoryTransitionCommonBaseline | undefined;
  db.transaction(() => {
    const intent = requireTransitionPreparation(db, input); const candidate = readTransitionCandidate(db, input.candidateId);
    if (candidate.transitionId !== intent.transitionId) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    const body = { version: 1 as const, transitionId: intent.transitionId, candidateId: candidate.candidateId,
      predecessorBaselineId: input.predecessorBaselineId, providerLineageId: intent.request.expected.sourceProvider === "hindsight"
        ? intent.request.expected.sourceLineageId : intent.request.expected.targetLineageId,
      targetEpochId: candidate.targetEpochId, evidenceIds: candidate.evidenceIds, mappingHash: candidate.mappingHash, stateHash: candidate.stateHash };
    result = MemoryTransitionCommonBaselineSchema.parse({ ...body, baselineId: transitionDocumentHash("baselines", body) });
    insertTransitionDocument(db, "baselines", { id: result.baselineId, transitionId: intent.transitionId, slot: "final", value: result });
  });
  if (!result) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return result;
}
/** A prepared baseline gains historical authority only through the exact later W4 receipt, never through this insertion. */
export function requireTransitionCommonBaseline(db: Database, input: { baselineId: string; receiptId: string; epochId: string }) {
  const baseline = readTransitionDocument(db, "baselines", { id: input.baselineId, schema: MemoryTransitionCommonBaselineSchema });
  if (!baseline) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const receipt = readTransitionReceipt(db, baseline.transitionId);
  const candidate = readTransitionCandidate(db, baseline.candidateId);
  if (!receipt || receipt.receiptId !== input.receiptId || receipt.kind !== "transition.return-local"
    || receipt.newEpochId !== input.epochId || baseline.targetEpochId !== input.epochId
    || receipt.mappingHash !== baseline.mappingHash || candidate.mappingHash !== baseline.mappingHash
    || candidate.stateHash !== baseline.stateHash) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  return { baseline, candidate, receipt };
}
