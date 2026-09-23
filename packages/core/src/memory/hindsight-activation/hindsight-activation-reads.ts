/**
 * INPUT:  the authority marker, the Local epoch's Banks, B3 setup rows, the live connection fingerprint, the B2 activation
 *         receipt, the Hindsight promotion receipts and cutover run evidence
 * OUTPUT: readHindsightActivationPlan() (side-effect-free prerequisites the kind handler admits from and mints ids for),
 *         readHindsightActivationRun() (run/lease/current-state/receipt plus custody counters for memory.activation.status)
 *         and readCommittedHindsightProducer() (the committed identity rebuilt from receipts for a binding repair)
 * POS:    core/memory/hindsight-activation — pure reads over durable tables; never touches the network or the marker
 */
import type { MemoryActivationRun, MemoryHindsightBlocking, MemoryHindsightProducerRef } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";

export interface HindsightActivationPlanBank {
  sourceBankId: string; scope: "global" | "character"; characterId: string | null; nativeBankId: string | null; verified: boolean;
}
export interface HindsightActivationPlan {
  authority: Pick<MemoryAuthoritySelection, "mode" | "epochId" | "transactionId">;
  /** Under Local: the B2 run id joined by the Local receipt; under Hindsight: the committed cutover run; null when unproven. */
  runId: string | null;
  predecessorEpochId: string | null;
  configFingerprint: string | null;
  providerLineage: string | null;
  setupPhase: string;
  setupRevision: number;
  configured: boolean;
  /** The B3 snapshot's fingerprint no longer matches the live connection (endpoint/secret changed after setup). */
  drifted: boolean;
  banks: HindsightActivationPlanBank[];
  blocking: MemoryHindsightBlocking[];
}
export interface HindsightActivationRunRead {
  run: MemoryActivationRun | null;
  leaseOwner: string | null;
  custody: { openGroups: number; unconsumedWitnesses: number; pendingSpans: number };
}
export interface HindsightActivationPlanInput { setup: Pick<HindsightSetupService, "status">; fingerprint(): string | null }

export function readHindsightActivationPlan(db: Database, input: HindsightActivationPlanInput): HindsightActivationPlan {
  const selection = readMemoryAuthoritySelection(db);
  const snapshot = input.setup.status();
  const base = { authority: { mode: selection.mode, epochId: selection.epochId, transactionId: selection.transactionId },
    setupPhase: snapshot.phase, setupRevision: snapshot.revision, configured: snapshot.phase === "configured" && snapshot.compatibility !== null,
    drifted: snapshot.configFingerprint !== null && input.fingerprint() !== snapshot.configFingerprint,
    configFingerprint: snapshot.configFingerprint, providerLineage: snapshot.compatibility?.providerLineage ?? null };
  if (selection.mode === "hindsight") {
    const receipt = db.prepare("SELECT run_id,predecessor_epoch_id FROM hindsight_authority_activation_receipts WHERE transaction_id=:tx AND hindsight_epoch_id=:epoch")
      .get({ tx: selection.transactionId, epoch: selection.epochId });
    return { ...base, runId: receipt ? String(receipt.run_id) : null, predecessorEpochId: receipt ? String(receipt.predecessor_epoch_id) : null, banks: [], blocking: [] };
  }
  if (selection.mode !== "canonical-local" || !selection.epochId) {
    return { ...base, runId: null, predecessorEpochId: null, banks: [], blocking: [] };
  }
  const receipt = db.prepare(`SELECT run_id FROM memory_migration_activation_receipts
    WHERE epoch_id=:epoch AND transaction_id=:tx AND marker_mode='canonical-local'`).get({ epoch: selection.epochId, tx: selection.transactionId });
  const banks = readPlanBanks(db, selection.epochId);
  return { ...base, runId: receipt ? String(receipt.run_id) : null, predecessorEpochId: selection.epochId, banks, blocking: blockingOf(db, banks) };
}

function readPlanBanks(db: Database, epochId: string): HindsightActivationPlanBank[] {
  const setup = createHindsightBankSetupRepo(db);
  return createCanonicalMemoryAuthorityRepo(db).listBanks(epochId)
    .sort((left, right) => left.bankId.localeCompare(right.bankId))
    .map((bank) => {
      const native = setup.get(bank.scope.kind === "global" ? "global" : `character:${bank.scope.characterId}`);
      return { sourceBankId: bank.bankId, scope: bank.scope.kind, characterId: bank.scope.characterId,
        nativeBankId: native?.externalBankId ?? null, verified: native?.status === "verified" && native.scope === bank.scope.kind };
    });
}

/** Missing verified rows and extra B3 rows are both reported before anything native happens (promotion needs exact equality). */
function blockingOf(db: Database, banks: HindsightActivationPlanBank[]): MemoryHindsightBlocking[] {
  const blocking: MemoryHindsightBlocking[] = banks.filter((bank) => !bank.verified).map((bank) => ({
    scope: bank.scope, characterId: bank.characterId, localBankId: bank.sourceBankId, code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" }));
  const covered = new Set(banks.map((bank) => bank.scope === "global" ? "global" : `character:${bank.characterId}`));
  for (const row of createHindsightBankSetupRepo(db).list()) {
    if (covered.has(row.canonicalIdentity)) continue;
    blocking.push({ scope: row.scope, characterId: row.scope === "global" ? null : row.canonicalIdentity.replace(/^character:/, ""),
      localBankId: null, code: "HINDSIGHT_BANKS_INCOMPLETE" });
  }
  return blocking;
}

export interface HindsightActivationRunScope {
  runId: string | null;
  predecessorEpochId: string | null;
  /** Present once Hindsight is selected: custody counters then read the Hindsight source ledger instead of the retired Local one. */
  hindsightEpochId?: string | null;
}

export function readHindsightActivationRun(db: Database, input: HindsightActivationRunScope): HindsightActivationRunRead {
  const custody = { openGroups: 0, ...readCustodyCounters(db, input) };
  const row = input.runId === null ? undefined : db.prepare("SELECT lease_owner FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: input.runId });
  if (input.runId === null || !row) return { run: null, leaseOwner: null, custody };
  const status = createHindsightCutoverRunRepo(db).status(input.runId);
  const receipt = db.prepare(`SELECT transaction_id,hindsight_epoch_id,committed_at FROM hindsight_authority_activation_receipts
    WHERE run_id=:run`).get({ run: input.runId });
  return { leaseOwner: row.lease_owner === null ? null : String(row.lease_owner), custody,
    run: { runId: status.runId, phase: status.phase, status: status.status, lease: status.lease, currentState: status.currentState ?? null,
      receipt: receipt ? { transactionId: String(receipt.transaction_id), epochId: String(receipt.hindsight_epoch_id), committedAt: String(receipt.committed_at) } : null } };
}

function readCustodyCounters(db: Database, scope: HindsightActivationRunScope) {
  const count = (sql: string, epoch: string) => Number(db.prepare(sql).get({ epoch })?.n ?? 0);
  if (scope.hindsightEpochId) {
    return {
      unconsumedWitnesses: count("SELECT count(*) AS n FROM hindsight_ingestion_primary_commits WHERE authority_epoch_id=:epoch AND ingestion_span_id IS NULL", scope.hindsightEpochId),
      pendingSpans: count("SELECT count(*) AS n FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch AND state<>'complete'", scope.hindsightEpochId),
    };
  }
  if (scope.predecessorEpochId === null) return { unconsumedWitnesses: 0, pendingSpans: 0 };
  return {
    unconsumedWitnesses: count("SELECT count(*) AS n FROM canonical_memory_primary_commits WHERE authority_epoch_id=:epoch AND ingestion_span_id IS NULL", scope.predecessorEpochId),
    pendingSpans: count("SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE authority_epoch_id=:epoch AND state<>'complete'", scope.predecessorEpochId),
  };
}

/**
 * The committed identity for a binding repair when no operation row carries it: receipts name the run, epoch, transaction,
 * fingerprint and per-Bank replica epochs; the latest verification candidate names each Bank's verification id. Null when the
 * receipt or any Bank's verification evidence is missing — recovery then has nothing proven to repair against.
 */
export function readCommittedHindsightProducer(db: Database, input: { epochId: string; transactionId: string }): MemoryHindsightProducerRef | null {
  const receipt = db.prepare("SELECT run_id,config_fingerprint FROM hindsight_authority_activation_receipts WHERE transaction_id=:tx AND hindsight_epoch_id=:epoch")
    .get({ tx: input.transactionId, epoch: input.epochId });
  if (!receipt) return null;
  const rows = db.prepare(`SELECT b.bank_id,b.replica_epoch_id,s.scope_kind,
      (SELECT c.verification_id FROM hindsight_current_verification_candidates c JOIN hindsight_current_preparations p ON p.preparation_id=c.preparation_id
        WHERE p.bank_id=b.bank_id ORDER BY c.rowid DESC LIMIT 1) AS verification_id,
      (SELECT e.preparation_id FROM hindsight_current_verification_evidence e JOIN hindsight_current_preparations p ON p.preparation_id=e.preparation_id
        WHERE p.bank_id=b.bank_id ORDER BY e.rowid DESC LIMIT 1) AS preparation_id
    FROM hindsight_authority_bank_receipts b LEFT JOIN hindsight_bank_setup s ON s.external_bank_id=b.bank_id
    WHERE b.transaction_id=:tx ORDER BY b.bank_id`).all({ tx: input.transactionId });
  if (rows.some((row) => row.verification_id === null || row.verification_id === undefined || (row.scope_kind !== "global" && row.scope_kind !== "character"))) return null;
  const banks = rows.map((row) => ({ nativeBankId: String(row.bank_id), scope: row.scope_kind as "global" | "character", replicaEpochId: String(row.replica_epoch_id),
    verificationId: String(row.verification_id), preparationId: row.preparation_id === null || row.preparation_id === undefined ? null : String(row.preparation_id) }));
  return { kind: "hindsight", runId: String(receipt.run_id), hindsightEpochId: input.epochId, transactionId: input.transactionId,
    configFingerprint: String(receipt.config_fingerprint), manifestId: null, banks,
    progress: { phase: "binding", bankCount: banks.length, preparedBankCount: banks.length, importedBankCount: banks.length, verifiedBankCount: banks.length, carriedWitnessCount: 0 } };
}
