/**
 * INPUT:  completed read-only Core copy and its original durable emergency capture identity
 * OUTPUT: complete admitted Bank coverage and content-bound table inventory for that exact copy
 * POS:    core/memory/hindsight-backup — no live runtime, credential, native client or display projection
 */
import { MemoryEmergencySnapshotSchema, type MemoryEmergencyCapture, type MemoryEmergencyBankCoverage,
  type HindsightBackupManifest, type MemoryEmergencySnapshot, type MemoryEmergencyUnknownEffect } from "@taki/shared";
import { readEmergencyCapture } from "../../db/memory-transition-emergency-repo.ts";
import { readTransitionIntent } from "../../db/memory-transition-repo.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "../../db/hindsight-application-replica-checkpoint.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { emergencyRowHash as rowHash } from "../../db/memory-transition-row-hash.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { captureSurvivingBankEvidence } from "../../db/memory-transition-surviving-capture.ts";

export function readEmergencySnapshot(db: Database, capture: MemoryEmergencyCapture, backup: HindsightBackupManifest | null): MemoryEmergencySnapshot {
  const saved = readEmergencyCapture(db, capture.transitionId);
  if (!saved || transitionLocalHash(saved) !== transitionLocalHash(capture)) invalid();
  const marker = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  if (marker?.mode !== "hindsight" || marker.active_epoch_id !== capture.predecessorEpochId) invalid();
  const intent = readTransitionIntent(db, capture.transitionId)!;
  const setup = db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all();
  if (setup.length !== intent.request.expected.banks.length || setup.some((row) => !intent.request.expected.banks.some((bank) =>
    bank.nativeBankId === row.external_bank_id && row.canonical_identity === (bank.scope.kind === "global" ? "global" : `character:${bank.scope.characterId}`)))) invalid();
  const banks = intent.request.expected.banks.map((bank) => coverage(db, { capture, bank, lineage: intent.request.expected.sourceLineageId, backup }));
  // The copied file is the full evidence artifact. Include every ordinary table, including future Pending/Run tables;
  // never decide completeness from a hand-maintained subset or a display count. SQL names come only from SQLite.
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((row) => {
      const table = String(row.name); const quoted = `"${table.replaceAll('"', '""')}"`;
      const rows = db.prepare(`SELECT * FROM ${quoted}`).all();
      return { table, count: rows.length, hash: transitionLocalHash(rows.map(rowHash).sort()) };
    });
  const body = { capture, banks, tables, unknownEffects: unknownEffects(db, capture.predecessorEpochId) };
  return MemoryEmergencySnapshotSchema.parse({ ...body, factsHash: transitionLocalHash(body) });
}

function unknownEffects(db: Database, epochId: string): MemoryEmergencyUnknownEffect[] {
  const definitions = [
    { table: "pending_memory", predicate: "phase<>'completed'", keys: ["bank_id", "operation_id"] },
    { table: "hindsight_memory_write_intents", predicate: "state='pending'", keys: ["bank_id", "request_id"] },
    { table: "hindsight_application_command_jobs", predicate: "state IN ('prepared','dispatched')", keys: ["bank_id", "request_id"] },
    { table: "hindsight_ingestion_spans", predicate: "state<>'complete'", keys: ["character_id", "span_id"] },
  ] as const;
  return definitions.flatMap(({ table, predicate, keys }) => db.prepare(`SELECT * FROM ${table}
    WHERE authority_epoch_id=:epoch AND ${predicate} ORDER BY ${keys.join(",")}`).all({ epoch: epochId })
    .map((row) => ({ table, epochId, recordKey: JSON.stringify(keys.map((key) => row[key])),
      rowHash: rowHash(row), disposition: "held-unknown" as const })));
}

function coverage(db: Database, input: { capture: MemoryEmergencyCapture; bank: NonNullable<ReturnType<typeof readTransitionIntent>>["request"]["expected"]["banks"][number];
  lineage: string; backup: HindsightBackupManifest | null }): MemoryEmergencyBankCoverage {
  const bankId = input.bank.nativeBankId ?? invalid(); const epochId = input.capture.predecessorEpochId;
  const replica = safely(() => readReplicaCheckpoint(db, bankId));
  const application = safely(() => readApplicationCheckpoint(db, bankId));
  const paired = replica.value && application.value && !application.value.bankDeleted
    && replica.value.authorityEpochId === epochId && application.value.authorityEpochId === epochId
    && replica.value.providerLineageId === input.lineage && application.value.namespace.provider_lineage === input.lineage
    && replica.value.bankGeneration === input.bank.nativeGeneration
    && replica.value.bankGeneration === application.value.namespace.bank_generation
    && transitionLocalHash(replica.value) === transitionLocalHash(application.value.native);
  const backup = input.backup?.verifiedAt ? input.backup : null;
  const nativeProof = backup?.native.proof.banks.find((bank) => bank.bankId === bankId);
  const compatible = replica.value && backup?.authority.epochId === epochId
    && replica.value.authorityEpochId === epochId && replica.value.providerLineageId === input.lineage
    && replica.value.bankGeneration === input.bank.nativeGeneration
    && backup.authority.providerLineageId === input.lineage && backup.native.proof.providerLineage === input.lineage
    && nativeProof?.bankGeneration === replica.value.bankGeneration;
  const pending = safely(() => createPendingMemoryRepo(db).summary({ authorityEpochId: epochId, bankId }).pendingCount
    + countPendingHindsightMemoryWrites(db, { authorityEpochId: epochId, bankId }));
  const surviving = paired ? safely(() => captureSurvivingBankEvidence(db, input)) : null;
  return { bankId, scope: input.bank.scope, nativeGeneration: replica.value?.bankGeneration ?? input.bank.nativeGeneration,
    replicaCursor: replica.value?.endCursor ?? null, applicationNativeCursor: application.value?.checkpoint.native_cursor ?? null,
    applicationStateCursor: application.value?.checkpoint.state_cursor ?? null,
    backupNativeCursor: compatible ? nativeProof!.currentCursor : null,
    backupApplicationNativeCursor: compatible && paired ? nativeProof?.application?.nativeCursor ?? null : null,
    backupApplicationStateCursor: compatible && paired ? nativeProof?.application?.stateCursor ?? null : null,
    pendingCount: pending.value ?? null, checkpointHash: paired ? applicationCheckpointHash(application.value!) : null,
    survivingEvidenceId: surviving?.value?.evidenceId ?? null,
    evidence: replica.failed || application.failed || surviving?.failed ? "unreadable" : paired ? "paired-replica"
      : !replica.value && !application.value ? "missing" : replica.value && !application.value ? "native-only" : "incompatible",
    remoteHead: "unknown", remoteLoss: "unknown" };
}
function safely<T>(read: () => T): { value: T | undefined; failed: boolean } {
  try { return { value: read(), failed: false }; } catch { return { value: undefined, failed: true }; }
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
