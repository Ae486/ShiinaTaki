/**
 * INPUT:  isolated SQLite and the real B2/B4 activation producers with deterministic native responses
 * OUTPUT: real selected predecessor plus complete synthetic W2 evidence for W4 transaction tests
 * POS:    core/testing — exercises Core publication; synthetic certificates do not certify native maintenance
 */
import { randomUUID } from "node:crypto";
import { TakiApplicationNativePayloadSchema, type MemoryTransitionIntent } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { createHindsightActivationHarness, ACTIVATION_CONFIG, ACTIVATION_LINEAGE, type HindsightActivationHarness } from "../memory/hindsight-activation/hindsight-activation-fixture.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionCustody } from "../db/memory-transition-custody.ts";
import { admitFixtureTransition, evidenceFromBundle, W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { applicationTestArtifact, applicationTestBody, applicationTestNative, applicationTestMemoryPayload } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { DEFAULT_TRANSITION_QUEUE_POLICY, readTransitionAttempt, updateTransitionAttempt, changeTransitionAdmission,
  type TransitionLease } from "../db/memory-transition-repo.ts";
import { persistTransitionNativeEvidence } from "../db/memory-transition-candidate-repo.ts";
import { buildTransitionLocalCandidate } from "../memory/transitions/transition-local-candidate.ts";
import { buildTransitionPublicationProof } from "../db/memory-transition-publication-proof.ts";
import { recordTransitionProof } from "../db/memory-transition-evidence-repo.ts";

export async function createTransitionPublicationFixture(options: {
  derived?: boolean;
  queuePolicy?: Partial<MemoryTransitionIntent["queuePolicy"]>;
  beforeAdmission?(harness: HindsightActivationHarness): Promise<void>;
  beforeFence?(input: { db: Database; intent: MemoryTransitionIntent; lease: TransitionLease }): Promise<void>;
} = {}) {
  const h = createHindsightActivationHarness();
  await h.service.start(h.identity(), h.control());
  await options.beforeAdmission?.(h);
  const { db } = h; const transitionId = randomUUID();
  const localLineage = String(db.prepare("SELECT provider_lineage_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch")
    .get({ epoch: h.local.epochId })!.provider_lineage_id);
  const localBanks = createCanonicalMemoryAuthorityRepo(db).listBanks(h.local.epochId);
  const proofs = publicationNativeEvidence(h, { transitionId, localLineage, localBanks, derived: options.derived });
  const expected = { predecessorEpochId: "hindsight-epoch", sourceProvider: "hindsight" as const,
    sourceLineageId: ACTIVATION_LINEAGE, targetProvider: "local" as const,
    targetLineageId: localLineage,
    configRevision: 2, configFingerprint: ACTIVATION_CONFIG, inventoryRevision: 2,
    inventoryHash: canonicalPayloadHash(db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all()),
    banks: proofs.map((evidence, index) => ({ scope: localBanks.find((bank) => bank.scope.kind === h.banks[index]!.scope)!.scope,
      sourceBankId: evidence.status.bank_id, targetBankId: null, sourceRevision: 1, nativeBankId: evidence.status.bank_id,
      nativeGeneration: evidence.status.request.bank_generation, manifestHash: "a".repeat(64), mappingHash: "a".repeat(64),
      policyRevision: 0, blockRevision: 0 })), baselineReceiptId: null, baselineHash: null,
    custodyBoundaryHash: transitionLocalHash(readTransitionCustody(db, "hindsight-epoch")) };
  const intent: MemoryTransitionIntent = { version: 1, transitionId, operationId: randomUUID(), actorId: "w4-fixture",
    admittedAt: W3_AT, queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY, ...options.queuePolicy }, incidentId: null,
    request: { kind: "transition.return-local", requestId: randomUUID(), previewId: randomUUID(), expected,
      previewHash: canonicalPayloadHash(["taki-transition-preview.v1", "transition.return-local", expected]), confirmation: "healthy-switch" } };
  let lease = admitFixtureTransition(db, intent, options.beforeFence !== undefined);
  if (options.beforeFence) {
    await options.beforeFence({ db, intent, lease });
    lease = changeTransitionAdmission(db, { lease, now: W3_AT, action: "close" });
    lease = updateTransitionAttempt(db, { lease, now: W3_AT, patch: { phase: "fenced" } });
  }
  const input = { lease, now: W3_AT, currentTime: () => W3_AT, assertConfiguration: () => undefined };
  for (const evidence of proofs) persistTransitionNativeEvidence(db, { ...input, evidence });
  const candidate = buildTransitionLocalCandidate(db, { ...input, evidenceIds: proofs.map((evidence) => evidence.evidenceId) });
  const prove = () => {
    const proof = buildTransitionPublicationProof(db, { ...input, candidateId: candidate.candidateId });
    recordTransitionProof(db, { ...input, proof });
    const current = readTransitionAttempt(db, intent.transitionId)!;
    input.lease = updateTransitionAttempt(db, { ...input, lease: current, patch: { phase: "proven" } });
    return { ...input, candidateId: candidate.candidateId };
  };
  return { ...h, proofs, intent, candidate, input, prove };
}

export function publicationNativeEvidence(h: HindsightActivationHarness, input: { transitionId: string; localLineage: string;
  localBanks: ReturnType<ReturnType<typeof createCanonicalMemoryAuthorityRepo>['listBanks']>; derived?: boolean }) {
  const { db } = h; const { transitionId, localLineage, localBanks } = input;
  return h.banks.map((binding) => {
    const bank = localBanks.find((row) => row.scope.kind === binding.scope)!;
    const committed = db.prepare("SELECT * FROM hindsight_authority_bank_receipts WHERE bank_id=:bank")
      .get({ bank: binding.nativeBankId })!;
    const scope = { bankId: binding.nativeBankId, namespace: { application_id: "taki" as const,
      provider_lineage: ACTIVATION_LINEAGE, bank_generation: String(committed.bank_generation) } };
    const native = applicationTestNative({ scope, kind: "bank", cursor: Number(committed.end_cursor) + 1,
      payload: { bank_id: scope.bankId, name: bank.name, mission: bank.mission, disposition: bank.disposition,
        config: bank.config, created_at: bank.createdAt, updated_at: bank.updatedAt } });
    const artifact = applicationTestArtifact({ scope, key: { artifact_kind: "bank", artifact_id: bank.bankId },
      binding: { kind: "exact_native", native: native.head.version! }, body: applicationTestBody("application-bank.v1",
        { scope: bank.scope, original_bank: bank, original_provider_lineage: localLineage,
          original_authority_epoch_id: h.local.epochId }, scope) });
    applicationTestBind(native, artifact.artifact);
    const unit = applicationTestNative({ scope, kind: "memory_unit", cursor: Number(committed.end_cursor) + 2,
      payload: applicationTestMemoryPayload({ bank_id: scope.bankId, memory_id: `unit-${bank.bankId}`,
        document_id: null, text: "A fixture memory survives the publication." }) });
    const derived = input.derived ? binding.baseline.filter((row) => row.object_kind === "mental_model" || row.object_kind === "directive")
      .map((row, index) => applicationTestNative({ scope, kind: row.object_kind, payload: TakiApplicationNativePayloadSchema.parse(row.payload),
        // Opposite revision/ID ordering makes candidate JSON order differ from SQLite inventory order.
        revision: row.object_kind === "mental_model" ? 3 : 2, cursor: Number(committed.end_cursor) + 3 + index })) : [];
    return evidenceFromBundle({ transitionId, scope, native: [native, unit, ...derived], artifacts: [artifact] });
  });
}
