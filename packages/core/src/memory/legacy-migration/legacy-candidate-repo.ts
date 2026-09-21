/**
 * INPUT:  immutable snapshot manifests, exact replacement identity and the Legacy authority marker
 * OUTPUT: isolated epoch/run/full-inventory publication, run-scoped Block plans and candidate discovery reads
 * POS:    core/memory/legacy-migration — candidate storage owner; the selected public authority stays Legacy until activation
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { canonicalMemoryAtomic } from "../../db/canonical-memory-maintenance-storage.ts";
import { assignPrimaryCandidate } from "../../db/primary-memory-custody-repo.ts";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { LegacyBlockProjection } from "./legacy-canonical-converter.ts";
import { createLegacyMigrationLedgerRepo } from "./legacy-migration-ledger-repo.ts";
import { legacyHash, sourceIdentity } from "./legacy-identities.ts";
import type { LegacySnapshotManifest } from "./legacy-snapshot.ts";

const RUN_SELECT = `SELECT r.*,c.workspace_root,c.superseded_by_run_id FROM memory_migration_runs r
  LEFT JOIN memory_migration_candidates c ON c.run_id=r.run_id`;

/** The newest run that no later candidate superseded; raw pre-S2a runs have no candidate row and still qualify. */
export function selectedMigrationRun(db: Database): SqlRow | undefined {
  return db.prepare(`${RUN_SELECT} WHERE c.superseded_by_run_id IS NULL ORDER BY r.requested_at DESC,r.rowid DESC LIMIT 1`).get();
}

export function readMigrationRun(db: Database, runId: string): SqlRow | undefined {
  return db.prepare(`${RUN_SELECT} WHERE r.run_id=:run`).get({ run: runId });
}

export function requireMigrationRun(db: Database, runId: string): SqlRow {
  const run = readMigrationRun(db, runId);
  if (!run) throw new Error("MIGRATION_NOT_FOUND");
  if (run.superseded_by_run_id !== null && run.superseded_by_run_id !== undefined) throw new Error("MIGRATION_SUPERSEDED");
  return run;
}

export interface CandidateInput {
  runId: string;
  replaceRunId?: string;
  workspaceRoot: string;
  manifest: LegacySnapshotManifest;
  now: string;
}

/** One transaction: Legacy marker check, optional supersession, epoch, run, complete inventory, Banks and custody. */
export function publishMigrationCandidate(db: Database, input: CandidateInput): string {
  return canonicalMemoryAtomic(db, () => {
    const marker = db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get();
    if (marker?.mode !== "legacy-markdown") throw new Error("MEMORY_AUTHORITY_MISMATCH");
    const previous = selectedMigrationRun(db);
    if (previous && previous.run_id !== input.replaceRunId) throw new Error("MIGRATION_CANDIDATE_CONFLICT");
    if (!previous && input.replaceRunId) throw new Error("MIGRATION_CANDIDATE_CONFLICT");
    if (previous && (previous.status === "completed" || leaseHeld(previous, input.now))) throw new Error("MIGRATION_CANDIDATE_CONFLICT");
    const priorEpoch = previous?.epoch_id ? String(previous.epoch_id) : null;
    const epoch = previous
      ? replaceEpoch(db, { previous, runId: input.runId, workspaceRoot: input.workspaceRoot, now: input.now })
      : createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(input.now).epochId;
    createLegacyMigrationLedgerRepo(db).createRun({ runId: input.runId, snapshotId: input.manifest.snapshotId, epochId: epoch, now: input.now });
    db.prepare("INSERT INTO memory_migration_candidates (run_id,workspace_root,created_at) VALUES (:run,:root,:now)")
      .run({ run: input.runId, root: resolve(input.workspaceRoot), now: input.now });
    ensureManifestInventory(db, { runId: input.runId, manifest: input.manifest, now: input.now, fill: true });
    ensureMigrationBank(db, { epochId: epoch, characterId: null, now: input.now });
    ensureMigrationBank(db, { epochId: epoch, characterId: "taki", now: input.now });
    assignPrimaryCandidate(db, { epoch, previousEpoch: priorEpoch, now: input.now });
    return epoch;
  });
}

function leaseHeld(run: SqlRow, now: string): boolean {
  return run.lease_owner !== null && run.lease_expires_at !== null && String(run.lease_expires_at) > now;
}

function replaceEpoch(db: Database, input: { previous: SqlRow; runId: string; workspaceRoot: string; now: string }): string {
  const previousId = String(input.previous.run_id);
  const previousEpoch = input.previous.epoch_id === null ? null : String(input.previous.epoch_id);
  // Old raw-run Blocks were published globally without an ownership receipt; shared Blocks are never disposable candidate state.
  const rawBlocks = db.prepare("SELECT 1 FROM memory_migration_sources WHERE run_id=:run AND kind='block' AND disposition LIKE 'converted-%' LIMIT 1")
    .get({ run: previousId });
  if (!input.previous.workspace_root && rawBlocks) throw new Error("INTEGRITY_MISMATCH");
  db.prepare("UPDATE memory_migration_runs SET status='failed',phase='failed',lease_owner=NULL,lease_expires_at=NULL,updated_at=:now WHERE run_id=:run")
    .run({ now: input.now, run: previousId });
  db.prepare(`INSERT INTO memory_migration_candidates (run_id,workspace_root,superseded_by_run_id,created_at)
    VALUES (:run,:root,:next,:now) ON CONFLICT(run_id) DO UPDATE SET superseded_by_run_id=:next`)
    .run({ run: previousId, root: resolve(input.workspaceRoot), next: input.runId, now: input.now });
  if (previousEpoch === null) return createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(input.now).epochId;
  const epoch = randomUUID();
  db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:old AND status='active'")
    .run({ old: previousEpoch, now: input.now });
  db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES (:epoch,'local',:lineage,'active',:old,:now,NULL,'initial-local')`)
    .run({ epoch, lineage: randomUUID(), old: previousEpoch, now: input.now });
  db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch,updated_at=:now WHERE singleton=1").run({ epoch, now: input.now });
  return epoch;
}

/** Registers every manifest source once; an inventory row that contradicts the manifest is an integrity failure. */
export function ensureManifestInventory(db: Database, input: { runId: string; manifest: LegacySnapshotManifest; now: string; fill: boolean }): void {
  const expected = new Map(input.manifest.entries.map((item) => [sourceIdentity(item.relativePath, item.rawSha256), item]));
  const rows = db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run").all({ run: input.runId });
  for (const row of rows) {
    const item = expected.get(String(row.source_id));
    if (!item || row.relative_path !== item.relativePath || row.raw_sha256 !== item.rawSha256 || row.kind !== item.kind
      || row.byte_length !== item.byteLength) {
      throw new Error("INTEGRITY_MISMATCH");
    }
    expected.delete(String(row.source_id));
  }
  if (expected.size > 0 && !input.fill) throw new Error("INTEGRITY_MISMATCH");
  const ledger = createLegacyMigrationLedgerRepo(db);
  for (const [sourceId, item] of expected) {
    ledger.addSource({ runId: input.runId, sourceId, kind: item.kind, relativePath: item.relativePath,
      rawSha256: item.rawSha256, byteLength: item.byteLength, now: input.now });
  }
}

export function ensureMigrationBank(db: Database, input: { epochId: string; characterId: string | null; now: string }): string {
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const bankId = legacyHash("legacy-bank/v1", input.characterId ?? "global");
  if (!authority.getBank(input.epochId, bankId)) {
    authority.createBank({ authorityEpochId: input.epochId, bankId,
      scope: input.characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId: input.characterId },
      name: input.characterId === null ? "Global Memory" : `Character ${input.characterId}`,
      disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Preserve canonical Taki memory", config: {},
      createdAt: input.now, updatedAt: input.now });
  }
  return bankId;
}

function blockKey(block: { blockId: string; scopeKind: string; characterId: string | null }): SqlRow {
  return { id: block.blockId, scope: block.scopeKind, character: block.characterId };
}

const CURRENT_BLOCK = "SELECT content,revision FROM taki_memory_blocks WHERE block_id=:id AND scope_kind=:scope AND ifnull(character_id,'')=ifnull(:character,'')";

/** Stages the Block projection against the shared table's current revision; publication happens only at activation. */
export function stageMigrationBlock(db: Database, input: { runId: string; sourceId: string; block: LegacyBlockProjection }): void {
  const block = input.block;
  const existing = db.prepare(CURRENT_BLOCK).get(blockKey(block));
  if (existing && existing.content !== block.content) throw new Error("IMPORT_CONFLICT");
  db.prepare(`INSERT INTO memory_migration_block_plans
    (run_id,source_id,block_id,scope_kind,character_id,content,expected_revision,expected_content,updated_at)
    VALUES (:run,:source,:block,:scope,:character,:content,:revision,:expected,:now)
    ON CONFLICT(run_id,source_id) DO NOTHING`)
    .run({ run: input.runId, source: input.sourceId, block: block.blockId, scope: block.scopeKind, character: block.characterId,
      content: block.content, revision: Number(existing?.revision ?? 0), expected: existing?.content ?? null, now: block.updatedAt });
}

/** Publishes the selected run's plans inside the activation transaction; a drifted shared Block refuses the whole commit. */
export function publishMigrationBlocks(db: Database, runId: string): void {
  const plans = db.prepare("SELECT * FROM memory_migration_block_plans WHERE run_id=:run ORDER BY source_id").all({ run: runId });
  for (const plan of plans) {
    const key = { blockId: String(plan.block_id), scopeKind: String(plan.scope_kind), characterId: plan.character_id === null ? null : String(plan.character_id) };
    const current = db.prepare(CURRENT_BLOCK).get(blockKey(key));
    if (Number(current?.revision ?? 0) !== plan.expected_revision || (current?.content ?? null) !== plan.expected_content) throw new Error("IMPORT_CONFLICT");
    if (current) continue;
    db.prepare("INSERT INTO taki_memory_blocks (block_id,scope_kind,character_id,content,revision,updated_at) VALUES (:id,:scope,:character,:content,1,:now)")
      .run({ ...blockKey(key), content: String(plan.content), now: String(plan.updated_at) });
  }
}
