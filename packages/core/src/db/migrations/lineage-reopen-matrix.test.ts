import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Migration } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { mcpDesiredServersMigration018 } from "./018-mcp-desired-servers.ts";
import { skillPackagesMigration019 } from "./019-skill-packages.ts";
import { parallelFoundationConvergenceMigration020 } from "./020-parallel-foundation-convergence.ts";
import { memoryLegacyMigration021 } from "./021-memory-legacy-migration.ts";
import { hindsightConnectionSetupMigration022 } from "./022-hindsight-connection-setup.ts";
import { hindsightInitialCutoverMigration023 } from "./023-hindsight-initial-cutover.ts";
import { harnessRunsMigration024 } from "./024-harness-runs.ts";
import { runEventsMigration025 } from "./025-run-events.ts";
import { runEffectsMigration026 } from "./026-run-effects.ts";
import { effectApprovalRefMigration027 } from "./027-effect-approval-ref.ts";
import { recoveryAdmissionMigration028 } from "./028-recovery-admission.ts";
import { scheduledTasksMigration029 } from "./029-scheduled-tasks.ts";
import { scheduledOccurrenceCharacterMigration030 } from "./030-scheduled-occurrence-character.ts";
import { runUsageDetailsMigration031 } from "./031-run-usage-details.ts";
import { conversationCompactionLifecycleMigration032 } from "./032-conversation-compaction-lifecycle.ts";
import { hindsightReplicaSyncMigration033 } from "./033-hindsight-replica-sync.ts";
import { hindsightReplicaSchedulerMigration034 } from "./034-hindsight-replica-scheduler.ts";
import { timelinePresentationMigration035 } from "./035-timeline-presentation.ts";
import { pendingMemoryMigration035 } from "./035-pending-memory.ts";
import { memoryTimelineConvergenceMigration036 } from "./036-memory-timeline-convergence.ts";
import { hindsightLocalCoverageMigration037 } from "./037-hindsight-local-coverage.ts";
import { hindsightSourceEvidenceMigration038 } from "./038-hindsight-source-evidence.ts";
import { hindsightCurrentStateMigration039 } from "./039-hindsight-current-state.ts";
import { hindsightCutoverConvergenceMigration040 } from "./040-hindsight-cutover-convergence.ts";
import { canonicalMemoryMaintenanceMigration041 } from "./041-canonical-memory-maintenance.ts";
import { hindsightApplicationStateMigration042 } from "./042-hindsight-application-state.ts";
import { hindsightIngestionMigration043 } from "./043-hindsight-ingestion.ts";
import { hindsightApplicationCommandsMigration044 } from "./044-hindsight-application-commands.ts";
import { hindsightPolicyWorkMigration045 } from "./045-hindsight-policy-work.ts";
import { hindsightRuntimeAdmissionMigration046 } from "./046-hindsight-runtime-admission.ts";
import { hindsightMemoryWritesMigration047 } from "./047-hindsight-memory-writes.ts";
import { memoryOperationsMigration048 } from "./048-memory-operations.ts";
import { initiativeDeliveryMigration049 } from "./049-initiative-delivery.ts";
import { initiativeModelOpportunitiesMigration050 } from "./050-initiative-model-opportunities.ts";
import { initiativeFeedbackMigration051 } from "./051-initiative-feedback.ts";
import { interactionPatternsMigration052 } from "./052-interaction-patterns.ts";
import { initiativeWakePolicyMigration053 } from "./053-initiative-wake-policy.ts";
import { initiativeIntentionsMigration054 } from "./054-initiative-intentions.ts";
import { initiativeBackoffMigration055 } from "./055-initiative-backoff.ts";
import { subagentConversationsMigration056 } from "./056-subagent-conversations.ts";
import { sourceContextMigration057 } from "./057-source-context.ts";
import { canonicalPayloadHash } from "../../memory/legacy-migration/legacy-identities.ts";
import { createIntlSegmenterTokenizer } from "../../memory/search-tokenizer.ts";
import { createReplicaRecordStore } from "../hindsight-replica-record-store.ts";
import { createHindsightReplicaLeaseRepo } from "../hindsight-replica-lease-repo.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../hindsight-replica-checkpoint-store.ts";

const roots: string[] = [];
const dbs: Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-migration-lineage-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

function createPath(): string {
  const root = mkdtempSync(join(tmpdir(), "taki-migration-lineage-"));
  roots.push(root);
  return join(root, "taki.db");
}

function open(path: string, migrations: Migration[], onMigrated?: (applied: number[]) => void): Database {
  const db = openDatabase({ path, migrations, onMigrated });
  dbs.push(db);
  return db;
}

function close(db: Database): void {
  db.close();
  const index = dbs.indexOf(db);
  if (index >= 0) dbs.splice(index, 1);
}

function expectFinalSchema(db: Database): void {
  expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(62);
  expect(db.prepare("PRAGMA table_info(timeline_messages)").all().map((row) => row.name)).toContain("presentation");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  expect(tables).toEqual(expect.arrayContaining([
    "canonical_memory_units",
    "canonical_memory_revision_snapshots",
    "canonical_memory_operation_receipts",
    "canonical_memory_retired_sources",
    "canonical_memory_ingestion_cursors",
    "canonical_memory_ingestion_spans",
    "canonical_memory_primary_commits",
    "hindsight_application_replica_projections",
    "hindsight_application_command_jobs",
    "hindsight_policy_work",
    "hindsight_application_runtime_admission",
    "hindsight_memory_write_intents",
    "memory_operations",
    "subagent_conversations",
    "subagent_inputs",
    "subagent_executions",
    "run_messages",
    "run_deliveries",
    "initiative_policy_facts",
    "initiative_model_opportunities",
    "delivery_presentations",
    "initiative_feedback",
    "mcp_desired_servers",
    "skill_packages",
    "memory_authority_selection",
    "memory_migration_runs",
    "hindsight_connection_state",
    "hindsight_cutover_runs",
    "hindsight_import_operations",
    "hindsight_replica_checkpoints",
    "hindsight_replica_sync_checkpoints",
    "hindsight_replica_sync_records",
    "hindsight_replica_sync_fts",
    "hindsight_replica_sync_leases",
    "hindsight_replica_sync_schedule",
    "hindsight_replica_sync_snapshot_cache",
    "pending_memory",
    "hindsight_local_coverage_manifests",
    "hindsight_cutover_local_coverage",
    "hindsight_source_evidence",
    "hindsight_source_unit_evidence",
    "hindsight_source_object_bindings",
    "hindsight_authority_activation_receipts",
    "runs",
    "run_attempts",
    "run_snapshots",
    "run_receipts",
    "run_events",
    "run_effects",
    "run_usage",
    "core_process_generations",
    "scheduled_tasks",
    "schedule_occurrences",
    "user_timezone",
    "conversation_compaction_operations",
    "conversation_compaction_events",
  ]));
  expect(db.prepare("PRAGMA table_info(schedule_occurrences)").all().map((row) => row.name)).toContain("character_id");
  expect(db.prepare("PRAGMA table_xinfo(timeline_messages)").all().find((row) => row.name === "presentation"))
    .toEqual(expect.objectContaining({ type: "TEXT", notnull: 0, dflt_value: null, pk: 0, hidden: 0 }));
  expect(db.prepare("PRAGMA table_info(run_usage)").all().map((row) => row.name)).toEqual(expect.arrayContaining([
    "input_no_cache_tokens", "cache_read_tokens", "cache_write_tokens", "output_text_tokens", "reasoning_tokens",
  ]));
  expect(db.prepare("PRAGMA table_info(conversation_summary)").all().map((row) => row.name)).toEqual(expect.arrayContaining([
    "revision", "last_operation_id", "source_from_seq", "source_through_seq", "source_digest", "captured_tail_seq",
  ]));
  expect(db.prepare("PRAGMA table_info(canonical_memory_ingestion_cursors)").all().map((row) => row.name))
    .toContain("eligibility_start_seq");
  expect(db.prepare("PRAGMA table_info(canonical_memory_primary_commits)").all().map((row) => row.name))
    .toEqual(expect.arrayContaining(["authority_epoch_id", "committed_through_seq", "ingestion_span_id"]));
}

function expectReopenNoOp(path: string): Database {
  const appliedOnReopen: number[][] = [];
  const reopened = open(path, MIGRATIONS, (applied) => appliedOnReopen.push(applied));
  expectFinalSchema(reopened);
  expect(appliedOnReopen).toEqual([[]]);
  return reopened;
}

function memoryTimelineData(db: Database) {
  const columns = db.prepare("PRAGMA table_info(timeline_messages)").all();
  const hasPending = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pending_memory'").get();
  return {
    timeline: db.prepare("SELECT * FROM timeline_messages ORDER BY seq").all(),
    presentationBytes: columns.some((column) => column.name === "presentation")
      ? db.prepare("SELECT seq,hex(CAST(presentation AS BLOB)) AS bytes FROM timeline_messages ORDER BY seq").all() : null,
    pending: hasPending
      ? db.prepare("SELECT *,hex(CAST(state_json AS BLOB)) AS bytes FROM pending_memory ORDER BY sequence").all() : [],
    watermarks: db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('timeline_messages','pending_memory') ORDER BY name").all(),
  };
}

function seedMemoryTimelineData(db: Database, history: "034" | "main" | "t4" | "both"): void {
  db.exec(`INSERT INTO timeline_messages (seq,id,character_id,role,content,parts,created_at) VALUES
    (7,'old-user','taki','user','Original text.',NULL,'2026-09-07T00:00:00.000Z'),
    (19,'old-tool','taki','tool','Original projection.','[]','2026-09-07T00:01:00.000Z'),
    (28,'old-reply','taki','assistant','Original reply.','[]','2026-09-07T00:02:00.000Z'),
    (90,'deleted-tail','taki','assistant','Deleted fixture.',NULL,'2026-09-07T00:03:00.000Z');
    DELETE FROM timeline_messages WHERE seq=90;`);
  if (history === "t4" || history === "both") {
    db.prepare("UPDATE timeline_messages SET presentation=:presentation WHERE seq=19")
      .run({ presentation: '{ "kind": "avatar", "value": "wave 馃悎" }\r\n' });
    db.prepare("UPDATE timeline_messages SET presentation='' WHERE seq=28").run();
  }
  if (history === "main" || history === "both") {
    db.exec(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('old-epoch','local','local-lineage','active',NULL,'2026-09-07T00:00:00.000Z',NULL,'initial-local');`);
    const insert = db.prepare(`INSERT INTO pending_memory
      (sequence,authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
      VALUES (:sequence,'old-epoch','bank',:operation_id,'retain',:hash,'outcome_unknown',3,:state)`);
    const state = '{\n "requestHash": "' + "b".repeat(64) + '", "fields": { "n": 1, "s": "1", "nil": null, "empty": "" }\n}\r\n';
    insert.run({ sequence: 41, operation_id: "old-operation", hash: "a".repeat(64), state });
    insert.run({ sequence: 120, operation_id: "deleted-operation", hash: "a".repeat(64), state });
    db.prepare("DELETE FROM pending_memory WHERE sequence=120").run();
  }
}

describe("migration lineage reopen matrix", () => {
  it("converges a fresh database and is a no-op after reopen", () => {
    const path = createPath();
    const firstApplied: number[][] = [];
    const first = open(path, MIGRATIONS, (applied) => firstApplied.push(applied));
    expectFinalSchema(first);
    expect(firstApplied).toEqual([[...Array.from({ length: 58 }, (_, index) => index + 1), 60, 61, 62]]);
    close(first);
    const reopened = expectReopenNoOp(path);
    expect(reopened.prepare("SELECT count(*) AS count FROM migrations").get()?.count).toBe(61);
  });

  it("converges the historical T4 17/18 MCP-Skill lineage through the current tail", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS.slice(0, 16));
    expect(runMigrations(first, [
      { version: 17, sql: mcpDesiredServersMigration018.sql },
      { version: 18, sql: skillPackagesMigration019.sql },
    ])).toEqual([17, 18]);
    close(first);
    const tailApplied: number[][] = [];
    const reopened = open(path, [
      skillPackagesMigration019,
      parallelFoundationConvergenceMigration020,
      memoryLegacyMigration021,
      hindsightConnectionSetupMigration022,
      hindsightInitialCutoverMigration023,
      harnessRunsMigration024,
      runEventsMigration025,
      runEffectsMigration026,
      effectApprovalRefMigration027,
      recoveryAdmissionMigration028,
      scheduledTasksMigration029,
      scheduledOccurrenceCharacterMigration030,
      runUsageDetailsMigration031,
      conversationCompactionLifecycleMigration032,
      hindsightReplicaSyncMigration033,
      hindsightReplicaSchedulerMigration034,
      pendingMemoryMigration035,
      memoryTimelineConvergenceMigration036,
      hindsightLocalCoverageMigration037,
      hindsightSourceEvidenceMigration038,
      hindsightCurrentStateMigration039,
      hindsightCutoverConvergenceMigration040,
      canonicalMemoryMaintenanceMigration041,
      hindsightApplicationStateMigration042,
      hindsightIngestionMigration043,
      hindsightApplicationCommandsMigration044,
      hindsightPolicyWorkMigration045,
      hindsightRuntimeAdmissionMigration046,
      hindsightMemoryWritesMigration047,
      memoryOperationsMigration048,
      initiativeDeliveryMigration049,
      initiativeModelOpportunitiesMigration050,
      initiativeFeedbackMigration051,
      interactionPatternsMigration052,
      initiativeWakePolicyMigration053,
      initiativeIntentionsMigration054,
      initiativeBackoffMigration055,
      subagentConversationsMigration056,
      sourceContextMigration057,
      ...MIGRATIONS.filter((migration) => migration.version > 57),
    ], (applied) => tailApplied.push(applied));
    expect(tailApplied).toEqual([[19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62]]);
    expectFinalSchema(reopened);
    expect(reopened.prepare("SELECT version FROM migrations ORDER BY version").all().map((row) => row.version)).toEqual(
      [...Array.from({ length: 58 }, (_, index) => index + 1), 60, 61, 62],
    );
    close(reopened);
    expectReopenNoOp(path);
  });

  it("applies the committed main 021-023 tail to the pre-main database", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS.slice(0, 20));
    expect(first.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(20);
    close(first);
    const tailApplied: number[][] = [];
    const reopened = open(path, MIGRATIONS, (applied) => tailApplied.push(applied));
    expect(tailApplied).toEqual([[21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62]]);
    expectFinalSchema(reopened);
    expect(reopened.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode)
      .toBe("legacy-markdown");
    close(reopened);
    expectReopenNoOp(path);
  });

  it("upgrades a version-31 database with an existing summary and reopens as a no-op", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS.slice(0, 31));
    first.prepare(`INSERT INTO conversation_summary (character_id,through_seq,text,updated_at)
      VALUES ('taki',12,'historical summary','2026-08-30T00:00:00.000Z')`).run();
    close(first);

    const applied: number[][] = [];
    const upgraded = open(path, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([[32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62]]);
    expect(upgraded.prepare(`SELECT through_seq,text,revision,last_operation_id,source_from_seq,source_through_seq,
      source_digest,captured_tail_seq FROM conversation_summary WHERE character_id='taki'`).get()).toEqual({
      through_seq: 12,
      text: "historical summary",
      revision: 1,
      last_operation_id: null,
      source_from_seq: null,
      source_through_seq: null,
      source_digest: null,
      captured_tail_seq: null,
    });
    close(upgraded);
    expectReopenNoOp(path);
  });

  it("preserves a legal Hindsight authority marker and activation receipt on reopen", () => {
    const path = createPath();
    const first = open(path, MIGRATIONS);
    first.exec(`
      INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('local-epoch','local','local-lineage','closed',NULL,'2026-08-23T00:00:00.000Z','2026-08-23T00:01:00.000Z','initial-local');
      INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('hindsight-epoch','hindsight','provider-lineage','active','local-epoch','2026-08-23T00:02:00.000Z',NULL,'planned-switch');
      INSERT INTO memory_migration_runs
        (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('hindsight-run','snapshot','verified','ready','2026-08-23T00:00:00.000Z','2026-08-23T00:03:00.000Z',1);
      UPDATE memory_authority_selection
      SET mode='hindsight',active_epoch_id='hindsight-epoch',verified_snapshot_id=NULL,
          activation_transaction_id='hindsight-tx',provider_lineage_id='provider-lineage',
          replica_checkpoint_digest='${"a".repeat(64)}',updated_at='2026-08-23T00:03:00.000Z'
      WHERE singleton=1;
      INSERT INTO hindsight_authority_activation_receipts
        (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,
         config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
      VALUES ('hindsight-tx','hindsight-run','local-epoch','hindsight-epoch','provider-lineage',
              '${"b".repeat(64)}','${"c".repeat(64)}',1,1,'2026-08-23T00:03:00.000Z');
    `);
    close(first);
    const reopened = expectReopenNoOp(path);
    expect(reopened.prepare("SELECT mode,active_epoch_id,provider_lineage_id FROM memory_authority_selection WHERE singleton=1").get())
      .toEqual({ mode: "hindsight", active_epoch_id: "hindsight-epoch", provider_lineage_id: "provider-lineage" });
    expect(reopened.prepare("SELECT transaction_id FROM hindsight_authority_activation_receipts").get()?.transaction_id)
      .toBe("hindsight-tx");
  });

  it("adds the current tail without rewriting an existing replica, checkpoint, or usable lease", () => {
    const path = createPath(); const first = open(path, MIGRATIONS.slice(0, 33));
    const at = "2026-09-06T00:00:00.000Z"; const uuid = "11111111-1111-4111-8111-111111111111";
    const record = { bankId: "bank", objectKind: "memory_unit", objectId: "removed", objectRevision: 2, operation: "tombstone", payload: null };
    first.exec(`INSERT INTO hindsight_replica_sync_records
      (bank_id,object_kind,object_id,object_revision,operation,record_json,record_hash,source_cursor)
      VALUES ('bank','memory_unit','removed',2,'tombstone','${JSON.stringify(record)}','${canonicalPayloadHash(record)}',12);`);
    const lease = createHindsightReplicaLeaseRepo(first, () => at).acquire({ bankId: "bank", ownerId: "old-owner", durationMs: 60_000 });
    const checkpoint = { bankId: "bank", providerLineageId: uuid, bankGeneration: uuid, authorityEpochId: "authority",
      replicaEpochId: uuid, endCursor: 12, snapshotId: uuid, snapshotCursor: 8, snapshotManifestDigest: "a".repeat(64),
      manifestDigest: createReplicaRecordStore(first, createIntlSegmenterTokenizer({ stoplist: true })).digest("bank"), verifiedAt: at };
    first.transaction(() => publishReplicaCheckpoint(first, { previous: null, next: checkpoint }));
    const records = first.prepare("SELECT * FROM hindsight_replica_sync_records").all();
    const leases = first.prepare("SELECT * FROM hindsight_replica_sync_leases").all();
    close(first); const applied: number[][] = [];
    const upgraded = open(path, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([[34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62]]);
    expectFinalSchema(upgraded);
    expect(upgraded.prepare("SELECT * FROM hindsight_replica_sync_records").all()).toEqual(records);
    expect(createReplicaRecordStore(upgraded, createIntlSegmenterTokenizer({ stoplist: true })).get({
      bankId: "bank", objectKind: "memory_unit", objectId: "removed", includeTombstones: true,
    })).toEqual(record);
    expect(upgraded.prepare("SELECT * FROM hindsight_replica_sync_leases").all()).toEqual(leases);
    expect(() => createHindsightReplicaLeaseRepo(upgraded, () => at).assert(lease)).not.toThrow();
    expect(readReplicaCheckpoint(upgraded, "bank")).toEqual(checkpoint);
    expect(upgraded.prepare("SELECT count(*) AS n FROM hindsight_replica_sync_schedule").get()?.n).toBe(0);
    expect(upgraded.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("legacy-markdown");
    close(upgraded); const reopened = expectReopenNoOp(path);
    expect(readReplicaCheckpoint(reopened, "bank")).toEqual(checkpoint);
    expect(reopened.prepare("SELECT * FROM hindsight_replica_sync_records").all()).toEqual(records);
    expect(reopened.prepare("SELECT * FROM hindsight_replica_sync_leases").all()).toEqual(leases);
    expect(() => createHindsightReplicaLeaseRepo(reopened, () => at).assert(lease)).not.toThrow();
  });

  it.each(["034", "main", "t4", "both"] as const)("preserves the %s history and data through all B4 storage and reopen", (history) => {
    const path = createPath();
    const first = open(path, MIGRATIONS.filter((migration) => migration.version <= 34));
    const timeline035: Migration = timelinePresentationMigration035;
    if (history !== "034") runMigrations(first, [history === "t4" ? timeline035 : pendingMemoryMigration035]);
    if (history === "both") first.exec(timeline035.sql);
    seedMemoryTimelineData(first, history);
    const receipts = first.prepare("SELECT version,applied_at FROM migrations ORDER BY version").all();
    const before = memoryTimelineData(first);
    close(first);

    const applied: number[][] = [];
    const upgraded = open(path, MIGRATIONS, (versions) => applied.push(versions));
    expect(applied).toEqual([history === "034" ? [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62] : [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62]]);
    expectFinalSchema(upgraded);
    expect(upgraded.prepare("SELECT version,applied_at FROM migrations WHERE version<=:version ORDER BY version")
      .all({ version: history === "034" ? 34 : 35 })).toEqual(receipts);
    const after = memoryTimelineData(upgraded);
    expect(after.timeline).toEqual(before.timeline.map((row) => ({ ...row, presentation: row.presentation ?? null, source_context_json: null })));
    if (before.presentationBytes) expect(after.presentationBytes).toEqual(before.presentationBytes);
    expect(after.pending).toEqual(before.pending);
    expect(after.watermarks).toEqual(before.watermarks);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    close(upgraded);
    const reopened = expectReopenNoOp(path);
    expect(memoryTimelineData(reopened)).toEqual(after);
    expect(reopened.prepare("SELECT version,applied_at FROM migrations WHERE version<=:version ORDER BY version")
      .all({ version: history === "034" ? 34 : 35 })).toEqual(receipts);
  });
});
