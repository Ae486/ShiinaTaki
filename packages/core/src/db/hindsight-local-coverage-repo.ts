/**
 * INPUT:  B4 run identity, expected Local epoch, and selected immutable coverage versions
 * OUTPUT: atomic capture/reopen/comparison and writer-reserved typed reads for source preparation
 * POS:    core/db — owns current Local coverage evidence; source preparation composes its synchronous transaction
 */
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  HINDSIGHT_LOCAL_COVERAGE_ENCODING, HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS,
  HindsightLocalCoverageComparisonSchema, HindsightLocalCoverageManifestSchema,
  type CanonicalMemoryRecord, type CanonicalMemorySource, type HindsightLocalCoverageComparison,
  type HindsightLocalCoverageDifference, type HindsightLocalCoverageManifest,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { compareHindsightCoverageWithB2, hindsightB2EvidenceDigest } from "./hindsight-local-coverage-b2.ts";
import {
  compareKeys, coverageHash, readHindsightLocalCoverageState, readHindsightLocalSource, readHindsightLocalSourceRecords,
  type HindsightLocalCoverageState,
} from "./hindsight-local-coverage-reader.ts";
import type { Database } from "./sqlite.ts";

export interface HindsightLocalSourcePreparationInput {
  runId: string;
  manifestId: string;
  expectedEpochId: string;
  bankId: string;
  documentId: string;
}
export interface HindsightLocalSourcePreparation {
  manifest: HindsightLocalCoverageManifest;
  source: CanonicalMemorySource;
  records: CanonicalMemoryRecord[];
}
export interface HindsightLocalCoverageRepo {
  capture(input: { runId: string; expectedEpochId: string; capturedAt: string }): HindsightLocalCoverageManifest;
  read(manifestId: string): HindsightLocalCoverageManifest;
  selected(runId: string): HindsightLocalCoverageManifest | undefined;
  compareCurrent(manifestId: string): HindsightLocalCoverageComparison;
  assertCurrent(manifestId: string): HindsightLocalCoverageManifest;
  readForPreparation(input: HindsightLocalSourcePreparationInput): HindsightLocalSourcePreparation;
}

export function createHindsightLocalCoverageRepo(db: Database): HindsightLocalCoverageRepo {
  return {
    capture: (input) => atomic(db, () => capture(db, input)),
    read: (manifestId) => read(db, manifestId),
    selected: (runId) => selected(db, runId),
    compareCurrent: (manifestId) => atomic(db, () => compareCurrent(db, read(db, manifestId))),
    assertCurrent: (manifestId) => atomic(db, () => assertCurrent(db, read(db, manifestId))),
    readForPreparation: (input) => atomic(db, () => readForPreparation(db, input)),
  };
}

function capture(db: Database, input: { runId: string; expectedEpochId: string; capturedAt: string }): HindsightLocalCoverageManifest {
  reserveHindsightLocalWriter(db, input.expectedEpochId);
  const run = db.prepare("SELECT expected_predecessor_epoch_id,status FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: input.runId });
  if (!run || run.expected_predecessor_epoch_id !== input.expectedEpochId || !["running", "ready"].includes(String(run.status))) {
    throw new Error("HINDSIGHT_LOCAL_COVERAGE_RUN_MISMATCH");
  }
  const state = readHindsightLocalCoverageState(db, input.expectedEpochId);
  const prior = db.prepare(`SELECT manifest_id FROM hindsight_local_coverage_manifests
    WHERE run_id=:run AND captured_at=:captured AND content_digest=:digest`)
    .get({ run: input.runId, captured: input.capturedAt, digest: state.contentDigest });
  if (prior) return read(db, String(prior.manifest_id));
  const version = Number(db.prepare(`SELECT coalesce(max(manifest_version),0)+1 AS next
    FROM hindsight_local_coverage_manifests WHERE run_id=:run`).get({ run: input.runId })?.next ?? 1);
  const value = { schemaVersion: 1 as const, encoding: HINDSIGHT_LOCAL_COVERAGE_ENCODING, manifestId: randomUUID(),
    manifestVersion: version, runId: input.runId, capturedAt: input.capturedAt, ...state,
    ...compareHindsightCoverageWithB2(db, { runId: input.runId, state }) };
  const manifest = HindsightLocalCoverageManifestSchema.parse({ ...value, manifestDigest: canonicalPayloadHash(value) });
  db.prepare(`INSERT INTO hindsight_local_coverage_manifests
    (manifest_id,run_id,local_epoch_id,manifest_version,schema_version,captured_at,content_digest,source_revision_fence,manifest_digest,manifest_json)
    VALUES (:id,:run,:epoch,:version,1,:captured,:digest,:fence,:manifestDigest,:manifest)`)
    .run({ id: manifest.manifestId, run: manifest.runId, epoch: manifest.localEpochId, version: manifest.manifestVersion,
      captured: manifest.capturedAt, digest: manifest.contentDigest, fence: manifest.sourceRevisionFence,
      manifestDigest: manifest.manifestDigest, manifest: canonicalJson(manifest) });
  return manifest;
}

function read(db: Database, manifestId: string): HindsightLocalCoverageManifest {
  const row = db.prepare("SELECT * FROM hindsight_local_coverage_manifests WHERE manifest_id=:id").get({ id: manifestId });
  if (!row) throw new Error("HINDSIGHT_LOCAL_COVERAGE_MISSING");
  const parsed = HindsightLocalCoverageManifestSchema.safeParse(JSON.parse(String(row.manifest_json)));
  if (!parsed.success) throw new Error("HINDSIGHT_LOCAL_COVERAGE_CORRUPT");
  const manifest = parsed.data;
  const { manifestDigest, ...value } = manifest;
  if (manifestDigest !== canonicalPayloadHash(value) || manifestDigest !== row.manifest_digest
    || manifest.manifestId !== row.manifest_id || manifest.runId !== row.run_id || manifest.localEpochId !== row.local_epoch_id
    || manifest.manifestVersion !== row.manifest_version || manifest.schemaVersion !== row.schema_version
    || manifest.capturedAt !== row.captured_at || manifest.contentDigest !== row.content_digest
    || manifest.sourceRevisionFence !== row.source_revision_fence
    || manifest.sourceRevisionFence !== coverageHash("source-revision-fence", manifest.records.filter((record) => record.kind === "source"))
    || manifest.contentDigest !== coverageHash("full-state", { localEpochId: manifest.localEpochId, bankIds: manifest.bankIds, records: manifest.records })) {
    throw new Error("HINDSIGHT_LOCAL_COVERAGE_CORRUPT");
  }
  return manifest;
}

function selected(db: Database, runId: string): HindsightLocalCoverageManifest | undefined {
  const row = db.prepare("SELECT manifest_id FROM hindsight_cutover_local_coverage WHERE run_id=:run").get({ run: runId });
  if (!row) return undefined;
  const manifest = read(db, String(row.manifest_id));
  if (manifest.runId !== runId) throw new Error("HINDSIGHT_LOCAL_COVERAGE_RUN_MISMATCH");
  return manifest;
}

function compareCurrent(db: Database, manifest: HindsightLocalCoverageManifest): HindsightLocalCoverageComparison {
  return compareState(manifest, readHindsightLocalCoverageState(db));
}

function assertCurrent(db: Database, manifest: HindsightLocalCoverageManifest): HindsightLocalCoverageManifest {
  const current = compareCurrent(db, manifest);
  if (!current.matches || hindsightB2EvidenceDigest(db, manifest.runId) !== manifest.b2EvidenceDigest) {
    throw new Error("HINDSIGHT_LOCAL_COVERAGE_STALE");
  }
  return manifest;
}

function compareState(manifest: HindsightLocalCoverageManifest, state: HindsightLocalCoverageState): HindsightLocalCoverageComparison {
  const before = new Map(manifest.records.map((record) => [record.key, record]));
  const after = new Map(state.records.map((record) => [record.key, record]));
  const differences: HindsightLocalCoverageDifference[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareKeys)) {
    const previous = before.get(key); const current = after.get(key); const identity = current ?? previous;
    if (!identity || (previous?.payloadHash === current?.payloadHash && previous?.revision === current?.revision)) continue;
    differences.push({ kind: identity.kind, key, bankId: identity.bankId, objectId: identity.objectId,
      relatedId: identity.relatedId, change: !previous ? "added" : !current ? "missing" : "changed",
      previousRevision: previous?.revision ?? null, currentRevision: current?.revision ?? null,
      previousHash: previous?.payloadHash ?? null, currentHash: current?.payloadHash ?? null });
  }
  if (differences.length > HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS) throw new Error("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED");
  return HindsightLocalCoverageComparisonSchema.parse({ manifestId: manifest.manifestId,
    currentEpochId: state.localEpochId, currentSourceCount: state.sourceCount,
    matches: state.localEpochId === manifest.localEpochId && state.contentDigest === manifest.contentDigest
      && state.sourceRevisionFence === manifest.sourceRevisionFence && differences.length === 0,
    currentContentDigest: state.contentDigest, currentSourceRevisionFence: state.sourceRevisionFence, differences });
}

function readForPreparation(db: Database, input: HindsightLocalSourcePreparationInput): HindsightLocalSourcePreparation {
  reserveHindsightLocalWriter(db, input.expectedEpochId);
  const manifest = selected(db, input.runId);
  if (!manifest || manifest.manifestId !== input.manifestId || manifest.localEpochId !== input.expectedEpochId) {
    throw new Error("HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE");
  }
  assertCurrent(db, manifest);
  const source = readHindsightLocalSource(db, { epochId: input.expectedEpochId, bankId: input.bankId, documentId: input.documentId });
  return { manifest, source, records: readHindsightLocalSourceRecords(db, source) };
}

export function selectHindsightLocalCoverage(db: Database, input: { runId: string; manifestId: string; leaseOwner: string | null; leaseFence: number; selectedAt: string }): void {
  const result = db.prepare(`INSERT INTO hindsight_cutover_local_coverage (run_id,manifest_id,selection_lease_fence,selected_at,ready_manifest_id)
    SELECT :run,:manifest,:fence,:now,NULL FROM hindsight_cutover_runs r WHERE r.run_id=:run AND r.status IN ('running','ready')
      AND ((:fence=0 AND r.lease_fence=0 AND r.lease_owner IS NULL AND :owner IS NULL)
        OR (r.lease_fence=:fence AND r.lease_owner=:owner AND r.lease_expires_at>:now))
    ON CONFLICT(run_id) DO UPDATE SET manifest_id=excluded.manifest_id,
    selection_lease_fence=excluded.selection_lease_fence,selected_at=excluded.selected_at,ready_manifest_id=NULL`)
    .run({ run: input.runId, manifest: input.manifestId, owner: input.leaseOwner, fence: input.leaseFence, now: input.selectedAt });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

/** Must run inside the caller's transaction, before any Local read used by a final acceptance decision. */
export function reserveHindsightLocalWriter(db: Database, expectedEpochId: string): void {
  const result = db.prepare(`UPDATE canonical_memory_authority_state SET active_epoch_id=active_epoch_id
    WHERE singleton=1 AND active_epoch_id=:epoch AND EXISTS (SELECT 1 FROM canonical_memory_authority_epochs e
      WHERE e.epoch_id=:epoch AND e.provider_id='local' AND e.status='active' AND e.reason='initial-local')`)
    .run({ epoch: expectedEpochId });
  if (result.changes !== 1) throw new Error("HINDSIGHT_PREDECESSOR_STALE");
}

function atomic<T>(db: Database, operation: () => T): T {
  let result: T | undefined;
  try { db.transaction(() => { result = operation(); }); }
  catch (error) {
    if (error instanceof ZodError) throw new Error("HINDSIGHT_LOCAL_COVERAGE_INVALID", { cause: error });
    if (error instanceof RangeError) throw new Error("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED", { cause: error });
    throw error;
  }
  return result as T;
}
