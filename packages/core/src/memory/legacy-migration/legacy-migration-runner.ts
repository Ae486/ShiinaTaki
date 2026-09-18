/**
 * INPUT:  explicit operator migration commands, Workspace roots, Database, and shared authority fence
 * OUTPUT: dry-run/stage/resume/status/exceptions/verify/activate outcomes with durable resumable state
 * POS:    core/memory/legacy-migration — on-demand offline orchestrator; never imported by normal memory runtime
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryMigrationActivation, MemoryMigrationReport, MemoryMigrationStatus, MemoryMigrationVerify } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { Database } from "../../db/sqlite.ts";
import { convertLegacyBlock, convertLegacyEntry } from "./legacy-canonical-converter.ts";
import { createLegacyCanonicalImportRepo } from "./legacy-canonical-import-repo.ts";
import { activateCanonicalLocal, readMemoryAuthoritySelection } from "./legacy-activation-repo.ts";
import { canonicalJson, legacyHash, sourceIdentity } from "./legacy-identities.ts";
import { createLegacyMigrationLedgerRepo, type Lease } from "./legacy-migration-ledger-repo.ts";
import { normalizeLegacySource } from "./legacy-source-normalizer.ts";
import { publishLegacySnapshot, type LegacySnapshotManifest } from "./legacy-snapshot.ts";
import type { MemoryAuthorityFence } from "./memory-authority-fence.ts";

export interface LegacyMigrationRunner {
  dryRun(workspaceRoot: string): MemoryMigrationReport;
  stage(input: { workspaceRoot: string; owner: string }): MemoryMigrationStatus;
  resume(input: { runId: string; owner: string }): MemoryMigrationStatus;
  status(runId: string): MemoryMigrationStatus;
  verify(runId: string): MemoryMigrationVerify;
  exceptions(input: { runId: string; cursor: string | null; limit: number }): { items: Array<{ sourceId: string; code: string; relativePath?: string }>; nextCursor: string | null };
  exclude(input: { runId: string; sourceId: string; reason: string; actor: string }): MemoryMigrationStatus;
  activate(input: { runId: string; workspaceRoot: string; timeoutMs: number }): Promise<MemoryMigrationActivation>;
}

export function createLegacyMigrationRunner(deps: { db: Database; destinationRoot: string; fence: MemoryAuthorityFence; now?: () => string; onActivated?: (epochId: string) => void }): LegacyMigrationRunner {
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    dryRun: (workspaceRoot) => dryRun(workspaceRoot, now()),
    stage: (input) => stage(deps.db, { ...input, destinationRoot: deps.destinationRoot, now: now() }),
    resume: (input) => resume(deps.db, { ...input, destinationRoot: deps.destinationRoot, now: now() }),
    status: (runId) => status(deps.db, runId),
    verify: (runId) => verify(deps.db, runId, now()),
    exceptions: (input) => exceptions(deps.db, input),
    exclude: (input) => exclude(deps.db, { ...input, now: now() }),
    activate: (input) => deps.fence.quiesce({ timeoutMs: input.timeoutMs }, async () => {
      try {
        const result = await activate(deps.db, { ...input, now: now() });
        if (result.activated) deps.fence.retire();
        if (result.activated && result.epochId) await deps.onActivated?.(result.epochId);
        return result;
      } finally { retireUnlessLegacy(deps.db, deps.fence); }
    }),
  };
}

function retireUnlessLegacy(db: Database, fence: MemoryAuthorityFence): void {
  // Even the marker read after COMMIT can fail. Only a positively verified legacy selection permits reopening.
  let legacy = false;
  try { legacy = readMemoryAuthoritySelection(db).mode === "legacy-markdown"; }
  finally { if (!legacy) fence.retire(); }
}

function resume(db: Database, input: { runId: string; owner: string; destinationRoot: string; now: string }): MemoryMigrationStatus {
  const run = db.prepare("SELECT snapshot_id,epoch_id FROM memory_migration_runs WHERE run_id=:run AND status IN ('running','failed')").get({ run: input.runId });
  if (!run?.epoch_id) throw new Error("MIGRATION_NOT_FOUND");
  const directory = join(input.destinationRoot, String(run.snapshot_id).replace(":", "-"));
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as LegacySnapshotManifest;
  const ledger = createLegacyMigrationLedgerRepo(db); const lease = ledger.acquireLease({ runId: input.runId, owner: input.owner, now: input.now, expiresAt: future(input.now, 600_000) });
  const rows = db.prepare("SELECT relative_path,kind,raw_sha256,byte_length FROM memory_migration_sources WHERE run_id=:run AND disposition IN ('pending','normalized','staged','failed') ORDER BY source_id").all({ run: input.runId });
  for (const row of rows) {
    db.prepare("UPDATE memory_migration_sources SET disposition='pending',diagnostic_code=NULL,updated_at=:now WHERE run_id=:run AND relative_path=:path").run({ now: input.now, run: input.runId, path: String(row.relative_path) });
    stageSource(db, { manifest, directory, item: { relativePath: String(row.relative_path), kind: row.kind as "entry" | "block", rawSha256: String(row.raw_sha256), byteLength: Number(row.byte_length), exception: null }, epochId: String(run.epoch_id), lease, now: input.now, existing: true });
  }
  ledger.releaseLease({ lease, now: input.now });
  return status(db, input.runId);
}

function dryRun(workspaceRoot: string, now: string): MemoryMigrationReport {
  const snapshot = publishLegacySnapshot({ workspaceRoot, destinationRoot: workspaceRoot, now, dryRun: true });
  let exceptional = 0; let plannedZero = 0; let plannedOne = 0;
  for (const item of snapshot.manifest.entries) {
    if (item.exception) { exceptional += 1; continue; }
    const bytes = readFileSync(livePath(workspaceRoot, item.relativePath)); const result = normalizeLegacySource(item.relativePath, bytes);
    if (!result.ok) exceptional += 1; else if (result.source.content.length === 0) plannedZero += 1; else plannedOne += 1;
  }
  return { reportId: snapshot.manifest.snapshotId, exceptional, plannedZero, plannedOne, plannedMany: 0, sourceCount: snapshot.manifest.entries.length };
}

function stage(db: Database, input: { workspaceRoot: string; destinationRoot: string; owner: string; now: string }): MemoryMigrationStatus {
  const snapshot = publishLegacySnapshot({ workspaceRoot: input.workspaceRoot, destinationRoot: input.destinationRoot, now: input.now });
  if (!snapshot.directory) throw new Error("INTEGRITY_MISMATCH");
  const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(input.now);
  // Keep the canonical runtime usable even when migration has no per-character searchable entry.
  ensureBank(db, { epochId: epoch.epochId, characterId: null, now: input.now });
  ensureBank(db, { epochId: epoch.epochId, characterId: "taki", now: input.now });
  const runId = randomUUID(); const ledger = createLegacyMigrationLedgerRepo(db);
  ledger.createRun({ runId, snapshotId: snapshot.manifest.snapshotId, epochId: epoch.epochId, now: input.now });
  const lease = ledger.acquireLease({ runId, owner: input.owner, now: input.now, expiresAt: future(input.now, 600_000) });
  for (const item of snapshot.manifest.entries) stageSource(db, { manifest: snapshot.manifest, directory: snapshot.directory, item, epochId: epoch.epochId, lease, now: input.now });
  ledger.releaseLease({ lease, now: input.now });
  return status(db, runId);
}

function stageSource(db: Database, input: { manifest: LegacySnapshotManifest; directory: string; item: LegacySnapshotManifest["entries"][number]; epochId: string; lease: Lease; now: string; existing?: boolean }): void {
  const sourceId = sourceIdentity(input.item.relativePath, input.item.rawSha256); const ledger = createLegacyMigrationLedgerRepo(db);
  if (!input.existing) ledger.addSource({ runId: input.lease.runId, sourceId, kind: input.item.kind, relativePath: input.item.relativePath, rawSha256: input.item.rawSha256, byteLength: input.item.byteLength, now: input.now });
  const attempt = ledger.beginAttempt({ lease: input.lease, sourceId, phase: "normalize", now: input.now });
  try {
    if (input.item.exception) return failSource(db, { lease: input.lease, sourceId, attempt, code: input.item.exception.code, now: input.now });
    const normalized = normalizeLegacySource(input.item.relativePath, readFileSync(join(input.directory, input.item.relativePath)));
    if (!normalized.ok) return failSource(db, { lease: input.lease, sourceId, attempt, code: normalized.diagnostic.code, now: input.now });
    updateNormalizedSource({ db, lease: input.lease, sourceId, source: normalized.source, now: input.now });
    linkDuplicateEvidence({ db, lease: input.lease, sourceId, rawSha256: input.item.rawSha256 });
    const importer = createLegacyCanonicalImportRepo(db);
    if (normalized.source.kind === "block") {
      const block = convertLegacyBlock(normalized.source, input.now); if (block) importer.importBlock(block);
      ledger.setResults({ lease: input.lease, sourceId, results: [], now: input.now });
    } else {
      const bankId = ensureBank(db, { epochId: input.epochId, characterId: normalized.source.characterId, now: input.now });
      const converted = convertLegacyEntry({ source: normalized.source, epochId: input.epochId, bankId });
      if (!converted.ok) return failSource(db, { lease: input.lease, sourceId, attempt, code: converted.diagnostic.code, now: input.now });
      if (converted.kind === "zero") { importer.importZero(converted); ledger.setResults({ lease: input.lease, sourceId, results: [], now: input.now }); updateCanonicalIds({ db, lease: input.lease, sourceId, documentId: converted.source.documentId, operationId: converted.operationId }); }
      else { importer.importRecord(converted); ledger.setResults({ lease: input.lease, sourceId, results: [{ memoryId: converted.record.unit.memoryId, revision: 1, payloadHash: converted.payloadHash }], now: input.now }); updateCanonicalIds({ db, lease: input.lease, sourceId, documentId: converted.source.documentId, operationId: converted.operationId }); }
    }
    ledger.finishAttempt({ lease: input.lease, sourceId, attemptNo: attempt, now: input.now });
  } catch (error) {
    failSource(db, { lease: input.lease, sourceId, attempt, code: migrationErrorCode(error), now: input.now });
  }
}

function migrationErrorCode(error: unknown): "IMPORT_CONFLICT" | "SNAPSHOT_CHANGED" | "INTEGRITY_MISMATCH" {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("IMPORT_CONFLICT")) return "IMPORT_CONFLICT";
  if (message.includes("SNAPSHOT_CHANGED")) return "SNAPSHOT_CHANGED";
  return "INTEGRITY_MISMATCH";
}

function failSource(db: Database, input: { lease: Lease; sourceId: string; attempt: number; code: string; now: string }): void {
  createLegacyMigrationLedgerRepo(db).finishAttempt({ lease: input.lease, sourceId: input.sourceId, attemptNo: input.attempt, now: input.now, diagnostic: { code: input.code as never, detail: null } });
  db.prepare("UPDATE memory_migration_sources SET disposition='failed',diagnostic_code=:code,updated_at=:now WHERE run_id=:run AND source_id=:source").run({ code: input.code, now: input.now, run: input.lease.runId, source: input.sourceId });
}

function verify(db: Database, runId: string, now: string): MemoryMigrationVerify {
  const counts = status(db, runId); const run = db.prepare("SELECT snapshot_id,epoch_id FROM memory_migration_runs WHERE run_id=:run").get({ run: runId });
  if (!run) throw new Error("MIGRATION_NOT_FOUND");
  const sources = db.prepare("SELECT source_id,disposition,result_count,content_hash,canonical_source_id FROM memory_migration_sources WHERE run_id=:run ORDER BY source_id").all({ run: runId });
  const mismatch = db.prepare(`SELECT count(*) AS n FROM memory_migration_sources s WHERE s.run_id=:run
    AND (s.result_count<>(SELECT count(*) FROM memory_migration_results r WHERE r.run_id=s.run_id AND r.source_id=s.source_id)
      OR EXISTS (SELECT 1 FROM memory_migration_results r LEFT JOIN canonical_memory_units u ON u.authority_epoch_id=:epoch AND u.memory_id=r.memory_id WHERE r.run_id=s.run_id AND r.source_id=s.source_id AND u.memory_id IS NULL)
      OR (s.canonical_source_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM canonical_memory_sources c WHERE c.authority_epoch_id=:epoch AND c.document_id=s.canonical_source_id)))`).get({ run: runId, epoch: String(run.epoch_id) });
  const bankMismatch = db.prepare("SELECT count(*) AS n FROM canonical_memory_sources WHERE authority_epoch_id=:epoch AND NOT EXISTS (SELECT 1 FROM canonical_memory_banks b WHERE b.authority_epoch_id=canonical_memory_sources.authority_epoch_id AND b.bank_id=canonical_memory_sources.bank_id)").get({ epoch: String(run.epoch_id) });
  const valid = counts.blockingCount === 0 && Number(mismatch?.n ?? 0) === 0 && Number(bankMismatch?.n ?? 0) === 0;
  const manifest = legacyHash("legacy-manifest-verified/v2", String(run.snapshot_id), String(run.epoch_id), canonicalJson(sources));
  const readiness = valid ? legacyHash("legacy-readiness/v2", runId, manifest, canonicalJson({ sources, banks: db.prepare("SELECT bank_id,scope_kind,character_id FROM canonical_memory_banks WHERE authority_epoch_id=:epoch ORDER BY bank_id").all({ epoch: String(run.epoch_id) }) })) : null;
  if (valid) db.transaction(() => {
    db.prepare("UPDATE memory_migration_sources SET phase='verified',updated_at=:now WHERE run_id=:run AND disposition IN ('converted-zero','converted-one','converted-many','excluded')").run({ now, run: runId });
    db.prepare("UPDATE memory_migration_runs SET phase='verified',status='ready',verified_manifest_digest=:manifest,readiness_digest=:readiness,updated_at=:now WHERE run_id=:run").run({ manifest, readiness, now, run: runId });
  });
  return { runId, verified: valid, manifestDigest: valid ? manifest : null, readinessDigest: readiness, blockingCount: counts.blockingCount + Number(mismatch?.n ?? 0) + Number(bankMismatch?.n ?? 0) };
}

function updateNormalizedSource(input: { db: Database; lease: Lease; sourceId: string; source: { contentHash: string; kind: string; layerId: string | null; characterId: string | null }; now: string }): void {
  const { db, lease, sourceId, source, now } = input;
  const result = db.prepare(`UPDATE memory_migration_sources SET normalized_hash=:normalized,content_hash=:content,phase='normalized',disposition='normalized',updated_at=:now WHERE run_id=:run AND source_id=:source AND EXISTS (SELECT 1 FROM memory_migration_runs WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now)`).run({ normalized: legacyHash("legacy-normalized/v1", source.kind, source.contentHash, source.layerId ?? "", source.characterId ?? ""), content: source.contentHash, now, run: lease.runId, source: sourceId, owner: lease.owner, fence: lease.fence });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

function linkDuplicateEvidence(input: { db: Database; lease: Lease; sourceId: string; rawSha256: string }): void {
  const { db, lease, sourceId, rawSha256 } = input;
  const duplicate = db.prepare("SELECT source_id FROM memory_migration_sources WHERE run_id=:run AND raw_sha256=:hash AND source_id<>:source ORDER BY source_id LIMIT 1").get({ run: lease.runId, hash: rawSha256, source: sourceId });
  if (!duplicate) return;
  db.prepare("UPDATE memory_migration_sources SET duplicate_source_id=:duplicate WHERE run_id=:run AND source_id=:source").run({ duplicate: String(duplicate.source_id), run: lease.runId, source: sourceId });
  db.prepare("UPDATE memory_migration_sources SET duplicate_source_id=coalesce(duplicate_source_id,:source) WHERE run_id=:run AND source_id=:duplicate").run({ source: sourceId, run: lease.runId, duplicate: String(duplicate.source_id) });
}

function updateCanonicalIds(input: { db: Database; lease: Lease; sourceId: string; documentId: string; operationId: string }): void {
  const { db, lease, sourceId, documentId, operationId } = input;
  const result = db.prepare("UPDATE memory_migration_sources SET document_id=:document,operation_id=:operation,canonical_source_id=:canonical WHERE run_id=:run AND source_id=:source").run({ document: documentId, operation: operationId, canonical: documentId, run: lease.runId, source: sourceId });
  if (result.changes !== 1) throw new Error("INTEGRITY_MISMATCH");
}

function status(db: Database, runId: string): MemoryMigrationStatus {
  const run = db.prepare("SELECT phase,status FROM memory_migration_runs WHERE run_id=:run").get({ run: runId }); if (!run) throw new Error("MIGRATION_NOT_FOUND");
  const row = db.prepare(`SELECT count(*) AS total,sum(CASE WHEN disposition IN ('converted-zero','converted-one','converted-many','excluded','verified') THEN 1 ELSE 0 END) AS resolved,sum(CASE WHEN disposition IN ('pending','normalized','staged','failed') THEN 1 ELSE 0 END) AS blocking FROM memory_migration_sources WHERE run_id=:run`).get({ run: runId });
  return { runId, phase: String(run.phase), status: String(run.status), sourceCount: Number(row?.total ?? 0), resolvedCount: Number(row?.resolved ?? 0), blockingCount: Number(row?.blocking ?? 0) };
}

function exceptions(db: Database, input: { runId: string; cursor: string | null; limit: number }) { const rows = db.prepare("SELECT source_id,diagnostic_code,relative_path FROM memory_migration_sources WHERE run_id=:run AND diagnostic_code IS NOT NULL AND source_id>:cursor ORDER BY source_id LIMIT :limit").all({ run: input.runId, cursor: input.cursor ?? "", limit: input.limit + 1 }); const page = rows.slice(0, input.limit); return { items: page.map((row) => ({ sourceId: String(row.source_id), code: String(row.diagnostic_code), relativePath: String(row.relative_path) })), nextCursor: rows.length > input.limit ? String(page.at(-1)?.source_id) : null }; }
function exclude(db: Database, input: { runId: string; sourceId: string; reason: string; actor: string; now: string }): MemoryMigrationStatus { const ledger = createLegacyMigrationLedgerRepo(db); const lease = ledger.acquireLease({ runId: input.runId, owner: input.actor, now: input.now, expiresAt: future(input.now, 600_000) }); ledger.exclude({ lease, sourceId: input.sourceId, reason: input.reason, actor: input.actor, now: input.now }); ledger.releaseLease({ lease, now: input.now }); return status(db, input.runId); }
async function activate(db: Database, input: { runId: string; workspaceRoot: string; timeoutMs: number; now: string }): Promise<MemoryMigrationActivation> { const run = db.prepare("SELECT * FROM memory_migration_runs WHERE run_id=:run").get({ run: input.runId }); if (!run) throw new Error("MIGRATION_NOT_FOUND"); const live = publishLegacySnapshot({ workspaceRoot: input.workspaceRoot, destinationRoot: input.workspaceRoot, now: input.now, dryRun: true }); if (live.manifest.snapshotId !== run.snapshot_id) throw new Error("SNAPSHOT_CHANGED"); const ledger = createLegacyMigrationLedgerRepo(db); const lease = ledger.acquireLease({ runId: input.runId, owner: "activation", now: input.now, expiresAt: future(input.now, input.timeoutMs) }); const selection = activateCanonicalLocal(db, { lease, manifestDigest: String(run.verified_manifest_digest), readinessDigest: String(run.readiness_digest), transactionId: randomUUID(), now: input.now }); if (selection.mode === "hindsight") throw new Error("MEMORY_INTEGRITY_ERROR"); return { runId: input.runId, activated: true, mode: selection.mode, epochId: selection.epochId }; }
function ensureBank(db: Database, input: { epochId: string; characterId: string | null; now: string }): string { const authority = createCanonicalMemoryAuthorityRepo(db); const bankId = legacyHash("legacy-bank/v1", input.characterId ?? "global"); if (!authority.getBank(input.epochId, bankId)) authority.createBank({ authorityEpochId: input.epochId, bankId, scope: input.characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId: input.characterId }, name: input.characterId === null ? "Global Memory" : `Character ${input.characterId}`, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Preserve canonical Taki memory", config: {}, createdAt: input.now, updatedAt: input.now }); return bankId; }
function livePath(workspaceRoot: string, relativePath: string): string { const parts = relativePath.split("/"); return join(workspaceRoot, parts[0] === "entries" ? "memory" : "blocks", ...parts.slice(1)); }
function future(now: string, ms: number): string { return new Date(Date.parse(now) + ms).toISOString(); }
