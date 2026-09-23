/**
 * INPUT:  one leased cutover run, the selected Local capture, per-Bank Core-minted identities and the authenticated D78 client
 * OUTPUT: activateBank() (baseline -> prepare -> import -> verify, replaying persisted evidence and never re-POSTing) and
 *         promoteActivation() (markReady -> promotion with the PR03 custody carry) over the unchanged B4/D78 primitives
 * POS:    core/memory/hindsight-activation — the only production caller of the D78 mutation primitives; each step is its own transaction
 */
import type { HindsightCurrentCapture, HindsightCurrentTransferRequest, MemoryHindsightPhase, MemoryHindsightProducerRef,
  MemoryHindsightProgress } from "@taki/shared";
import { carryHindsightActivationCustody } from "../../db/hindsight-activation-custody.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "../../db/hindsight-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { readHindsightCurrentImport } from "../../db/hindsight-current-import-repo.ts";
import { prepareHindsightCurrentBank } from "../../db/hindsight-current-preparation-repo.ts";
import { createHindsightCutoverRunRepo, type HindsightCutoverLease } from "../../db/hindsight-cutover-run-repo.ts";
import { createHindsightReplicaRepo } from "../../db/hindsight-replica-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightCurrentStateClient } from "../hindsight/hindsight-current-client.ts";
import { fetchHindsightCurrentBaseline, importHindsightCurrentBank, verifyHindsightCurrentBank } from "../hindsight/hindsight-current-orchestrator.ts";

export interface HindsightActivationBankIdentity {
  nativeBankId: string; scope: "global" | "character"; replicaEpochId: string; verificationId: string;
}
export interface HindsightActivationIdentity {
  operationId: string; runId: string; predecessorEpochId: string; hindsightEpochId: string; transactionId: string;
  banks: HindsightActivationBankIdentity[];
}
export interface HindsightActivationReceipt {
  runId: string; transactionId: string; hindsightEpochId: string; predecessorEpochId: string; committedAt: string; carriedWitnessCount: number;
}
export interface ActivationProgress {
  current(): MemoryHindsightProducerRef;
  phase(phase: MemoryHindsightPhase, patch?: Partial<MemoryHindsightProgress>): void;
  manifest(manifestId: string): void;
  prepared(nativeBankId: string, preparationId: string): void;
}
export interface ActivationChainContext {
  db: Database; client: HindsightCurrentStateClient; lease: HindsightCutoverLease; identity: HindsightActivationIdentity;
  providerLineage: string; configFingerprint: string; timeoutMs: number; snapshotTtlSeconds: number;
  now(): string; progress: ActivationProgress; renew(): void;
}

export function createActivationProgress(input: {
  identity: HindsightActivationIdentity; configFingerprint: string; checkpoint(producer: MemoryHindsightProducerRef): void;
}): ActivationProgress {
  const { identity } = input;
  let ref: MemoryHindsightProducerRef = { kind: "hindsight", runId: identity.runId, hindsightEpochId: identity.hindsightEpochId,
    transactionId: identity.transactionId, configFingerprint: input.configFingerprint, manifestId: null,
    progress: { phase: "reserved", bankCount: identity.banks.length, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0 },
    banks: identity.banks.map((bank) => ({ ...bank, preparationId: null })) };
  const publish = (next: MemoryHindsightProducerRef) => { ref = next; input.checkpoint(ref); };
  return {
    current: () => ref,
    phase: (phase, patch) => publish({ ...ref, progress: { ...ref.progress, ...patch, phase } }),
    manifest: (manifestId) => publish({ ...ref, manifestId }),
    prepared: (nativeBankId, preparationId) => publish({ ...ref,
      progress: { ...ref.progress, phase: "preparing", preparedBankCount: ref.progress.preparedBankCount + 1 },
      banks: ref.banks.map((bank) => bank.nativeBankId === nativeBankId ? { ...bank, preparationId } : bank) }),
  };
}

export async function activateBank(ctx: ActivationChainContext, input: {
  capture: HindsightCurrentCapture; sourceBankId: string; bank: HindsightActivationBankIdentity; previousPreparationId: string | null;
}): Promise<void> {
  const { db, progress } = ctx; const { bank } = input; const context = { timeoutMs: ctx.timeoutMs };
  const counts = progress.current().progress;
  progress.phase("preparing");
  let preparationId = existingPreparation(db, input.capture.captureId, bank.nativeBankId);
  if (!preparationId) {
    ctx.renew();
    const baseline = await fetchHindsightCurrentBaseline({ bankId: bank.nativeBankId, ttlSeconds: ctx.snapshotTtlSeconds, client: ctx.client, context });
    const prepared = prepareHindsightCurrentBank(db, { lease: ctx.lease, manifestId: input.capture.manifest.manifestId,
      expectedEpochId: ctx.identity.predecessorEpochId, now: ctx.now(), sourceBankId: input.sourceBankId, providerLineage: ctx.providerLineage,
      bankGeneration: baseline.metadata.manifest.bankGeneration, baseline, supersede: supersedeOf(db, input.previousPreparationId) });
    preparationId = prepared.preparationId;
    if (prepared.request === null || prepared.gaps.length) throw new Error("HINDSIGHT_CURRENT_PREPARATION_GAPS");
  }
  progress.prepared(bank.nativeBankId, preparationId);
  if (!verificationEvidenceExists(db, preparationId)) {
    progress.phase("importing");
    if (!readHindsightCurrentImport(db, preparationId)) {
      ctx.renew();
      await importHindsightCurrentBank({ db, preparationId, client: ctx.client, context });
    }
    progress.phase("verifying", { importedBankCount: counts.importedBankCount + 1 });
    ctx.renew();
    const verified = await verifyHindsightCurrentBank({ db, preparationId, lease: ctx.lease, verificationId: bank.verificationId,
      replicaEpochId: bank.replicaEpochId, client: ctx.client, context, now: ctx.now });
    if (!verified.evidence) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
  }
  progress.phase("verifying", { importedBankCount: counts.importedBankCount + 1, verifiedBankCount: counts.verifiedBankCount + 1 });
}

export function promoteActivation(ctx: ActivationChainContext): HindsightActivationReceipt {
  const { db, identity, progress } = ctx;
  progress.phase("ready");
  const replica = createHindsightReplicaRepo(db); const setup = createHindsightBankSetupRepo(db).list();
  const banks = identity.banks.map((bank) => {
    const checkpoint = replica.checkpoint(bank.nativeBankId); if (!checkpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
    const templateDigest = setup.find((row) => row.externalBankId === bank.nativeBankId && row.status === "verified")?.templateDigest;
    if (!templateDigest) throw new Error("HINDSIGHT_TEMPLATE_NOT_VERIFIED");
    return { bankId: bank.nativeBankId, templateDigest, checkpoint };
  });
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks);
  ctx.renew();
  markReadyOnce(ctx, checkpointSetDigest);
  progress.phase("committing");
  const committedAt = ctx.now(); let carriedWitnessCount = 0;
  promoteHindsightAuthority(db, { lease: ctx.lease, predecessorEpochId: identity.predecessorEpochId, hindsightEpochId: identity.hindsightEpochId,
    transactionId: identity.transactionId, configFingerprint: ctx.configFingerprint, checkpointSetDigest, banks, now: committedAt,
    beforeCommit: () => {
      carriedWitnessCount = carryHindsightActivationCustody(db, { predecessorEpochId: identity.predecessorEpochId,
        hindsightEpochId: identity.hindsightEpochId, now: committedAt }).carriedWitnessCount;
    } });
  // The commit is durable here; "binding" tells a restart that only the runtime rebind may still be outstanding.
  progress.phase("binding", { carriedWitnessCount });
  return { runId: identity.runId, transactionId: identity.transactionId, hindsightEpochId: identity.hindsightEpochId,
    predecessorEpochId: identity.predecessorEpochId, committedAt, carriedWitnessCount };
}

/** A run left `ready` by an interrupted promotion keeps its readiness only when it names this exact checkpoint set. */
function markReadyOnce(ctx: ActivationChainContext, checkpointSetDigest: string): void {
  const row = ctx.db.prepare("SELECT phase,config_fingerprint,checkpoint_set_digest FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: ctx.identity.runId });
  if (row?.phase === "ready") {
    if (row.config_fingerprint !== ctx.configFingerprint || row.checkpoint_set_digest !== checkpointSetDigest) throw new Error("HINDSIGHT_CHECKPOINT_SET_STALE");
    return;
  }
  createHindsightCutoverRunRepo(ctx.db).markReady({ lease: ctx.lease, configFingerprint: ctx.configFingerprint, checkpointSetDigest, now: ctx.now() });
}

function existingPreparation(db: Database, captureId: string, nativeBankId: string): string | null {
  const row = db.prepare("SELECT preparation_id FROM hindsight_current_preparations WHERE capture_id=:capture AND bank_id=:bank")
    .get({ capture: captureId, bank: nativeBankId });
  return row ? String(row.preparation_id) : null;
}

function verificationEvidenceExists(db: Database, preparationId: string): boolean {
  return db.prepare("SELECT 1 AS present FROM hindsight_current_verification_evidence WHERE preparation_id=:preparation LIMIT 1")
    .get({ preparation: preparationId }) !== undefined;
}

/** After an explicit recapture the target Bank already holds the earlier transfer; its exact receipts let native supersede it. */
function supersedeOf(db: Database, previousPreparationId: string | null): HindsightCurrentTransferRequest["supersede"] {
  const imported = previousPreparationId === null ? undefined : readHindsightCurrentImport(db, previousPreparationId);
  if (!imported) return [];
  const { result } = imported;
  const ownership = { receipt_kind: "current_state_transfer" as const, operation_id: result.operation_id, request_hash: result.request_hash, result_hash: result.result_hash };
  return imported.mappings.flatMap((mapping) => mapping.target_kind === "bank" ? [] : [{ object_kind: mapping.target_kind,
    object_id: mapping.target_id, object_revision: mapping.target_revision, payload_hash: mapping.target_payload_hash, ownership }]);
}
