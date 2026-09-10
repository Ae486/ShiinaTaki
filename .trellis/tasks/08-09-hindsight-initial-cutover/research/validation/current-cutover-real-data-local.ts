/**
 * INPUT:  an audited current Local copy and the production B4 capture/lease repositories
 * OUTPUT: complete source preflight, stable capture and renewable lease across real HTTP waits
 * POS:    task-only consumer; writes migration evidence while preserving every source table
 */
import type { HindsightCurrentCapture, HindsightCurrentPreparationGap } from "../../../../../packages/shared/src/index.ts";
import { HINDSIGHT_CURRENT_STATE_MAX_BYTES, HINDSIGHT_CURRENT_STATE_MAX_RECORDS } from "../../../../../packages/shared/src/hindsight-current-state-schema.ts";
import { captureHindsightCurrentLocal } from "../../../../../packages/core/src/db/hindsight-current-capture-repo.ts";
import { createHindsightCutoverRunRepo, type HindsightCutoverLease } from "../../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { createHindsightLocalCoverageRepo } from "../../../../../packages/core/src/db/hindsight-local-coverage-repo.ts";
import type { Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { canonicalPayloadHash } from "../../../../../packages/core/src/memory/legacy-migration/legacy-identities.ts";
import { openAuditedCopy, requirePreservedSource } from "./current-cutover-real-data-audit.ts";
import { OWNED_RUN_ID, RealDataMetadata, failureCode, requireCondition } from "./current-cutover-real-data-state.ts";

const LEASE_TTL_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;

export class RealDataSession {
  readonly metadata: RealDataMetadata;
  readonly controller = new AbortController();
  readonly capture: HindsightCurrentCapture;
  db: Database;
  lease: HindsightCutoverLease;
  stage = "PREFLIGHT";
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private heartbeatFailure: string | null = null;

  constructor(metadata: RealDataMetadata) {
    this.metadata = metadata;
    this.db = openAuditedCopy(metadata);
    try {
      this.lease = this.acquire();
      this.capture = this.captureLocal();
      this.startHeartbeat();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  get state() {
    requireCondition(this.metadata.state, "REAL_DATA_STATE_MISSING");
    return this.metadata.state;
  }

  assertLive(): void {
    requireCondition(!this.heartbeatFailure, this.heartbeatFailure ?? "LEASE_LOST");
    requireCondition(!this.controller.signal.aborted, "REAL_DATA_CANCELLED");
  }

  reopen(): void {
    this.assertLive();
    this.stopHeartbeat();
    requirePreservedSource(this.db, this.metadata);
    this.db.close();
    this.db = openAuditedCopy(this.metadata);
    this.lease = this.acquire();
    this.state.counters.reopenCount++;
    this.metadata.save();
    this.startHeartbeat();
    this.metadata.report("REAL_DATA_REOPENED", { ...this.state.counters, leaseFence: this.lease.fence });
  }

  close(): void {
    this.stopHeartbeat();
    try {
      const audit = requirePreservedSource(this.db, this.metadata);
      createHindsightCutoverRunRepo(this.db).releaseLease({ lease: this.lease, now: new Date().toISOString() });
      this.metadata.report("REAL_DATA_SOURCE_PRESERVED", { sourceSha256: audit.sha256, b2Sha256: audit.b2Sha256,
        canonicalSha256: audit.canonicalSha256, epochId: this.state.sourceEpochId });
    } finally {
      this.db.close();
    }
  }

  private acquire(): HindsightCutoverLease {
    const runs = createHindsightCutoverRunRepo(this.db);
    const state = this.state;
    const now = new Date().toISOString();
    const prior = this.db.prepare("SELECT expected_predecessor_epoch_id FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: state.b2RunId });
    if (!prior) runs.create({ runId: state.b2RunId, expectedPredecessorEpochId: state.sourceEpochId, now });
    else requireCondition(prior.expected_predecessor_epoch_id === state.sourceEpochId, "REAL_DATA_RUN_PREDECESSOR_CHANGED");
    return runs.acquireLease({ runId: state.b2RunId, owner: `d78-real-data-${OWNED_RUN_ID}`, now,
      expiresAt: new Date(Date.parse(now) + LEASE_TTL_MS).toISOString() });
  }

  private captureLocal(): HindsightCurrentCapture {
    const manifest = createHindsightLocalCoverageRepo(this.db).selected(this.state.b2RunId);
    requireCondition(manifest, "HINDSIGHT_LOCAL_COVERAGE_MISSING");
    requireCondition(this.state.manifestId === null || this.state.manifestId === manifest.manifestId, "REAL_DATA_MANIFEST_CHANGED");
    const capture = captureHindsightCurrentLocal(this.db, { lease: this.lease, manifestId: manifest.manifestId,
      expectedEpochId: this.state.sourceEpochId, now: new Date().toISOString() });
    requireCondition(this.state.captureId === null || this.state.captureId === capture.captureId, "REAL_DATA_CAPTURE_CHANGED");
    this.state.manifestId = manifest.manifestId;
    this.state.captureId = capture.captureId;
    this.metadata.save();
    return capture;
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      try {
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.parse(now) + LEASE_TTL_MS).toISOString();
        createHindsightCutoverRunRepo(this.db).renewLease({ lease: this.lease, now, expiresAt });
        // Callers capture this object before awaiting. Keep its expiration current as well as the database row.
        this.lease.expiresAt = expiresAt;
        this.metadata.report("REAL_DATA_LEASE_RENEWED", { stage: this.stage, fence: this.lease.fence, expiresAt,
          ...this.state.counters });
      } catch (error) {
        this.heartbeatFailure = failureCode(error);
        this.controller.abort();
        this.metadata.report("REAL_DATA_LEASE_FAILED", { reason: this.heartbeatFailure });
        this.stopHeartbeat();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

export function reportSourcePreflight(session: RealDataSession): void {
  const { capture } = session;
  const scopes = capture.banks.map((bank) => JSON.stringify(bank.scope));
  requireCondition(new Set(scopes).size === scopes.length && capture.banks.filter((bank) => bank.scope.kind === "global").length === 1,
    "REAL_DATA_BANK_SCOPE_AMBIGUOUS");
  requireCondition(capture.banks.some((bank) => bank.scope.kind === "character"), "REAL_DATA_B3_CHARACTER_SCOPE_REQUIRED");
  const banks = capture.banks.map((bank) => bankPreflight(capture, bank.bankId));
  const gaps = banks.flatMap((bank) => bank.gaps);
  session.metadata.report("REAL_DATA_PREFLIGHT", { epochId: capture.manifest.localEpochId,
    runId: capture.manifest.runId, manifestId: capture.manifest.manifestId, captureId: capture.captureId,
    manifestDigest: capture.manifest.manifestDigest, sourceRevisionFence: capture.manifest.sourceRevisionFence,
    contentDigest: capture.manifest.contentDigest, witnessCount: capture.manifest.records.length,
    sourceCount: capture.sources.length, unitCount: capture.records.length, derivedCount: capture.derived.length,
    artifactCount: capture.dispositions.filter((item) => item.destination === "taki-artifact").length,
    catchUpCount: capture.manifest.catchUp.length, banks, gapCount: gaps.length, gapDigest: canonicalPayloadHash(gaps),
    maxRecordsPerBank: HINDSIGHT_CURRENT_STATE_MAX_RECORDS, maxRequestBytes: HINDSIGHT_CURRENT_STATE_MAX_BYTES,
    exactNativeEnvelope: "AUTHENTICATED_B3_BASELINE_REQUIRED" });
  requireCondition(gaps.length === 0, "HINDSIGHT_CURRENT_PREPARATION_GAPS");
}

function bankPreflight(capture: HindsightCurrentCapture, bankId: string) {
  const bank = capture.banks.find((item) => item.bankId === bankId);
  requireCondition(bank, "HINDSIGHT_CURRENT_BANK_MISSING");
  const sources = capture.sources.filter((item) => item.bankId === bankId);
  const records = capture.records.filter((item) => item.unit.bankId === bankId);
  const derived = capture.derived.filter((item) => item.bankId === bankId);
  const sourceIds = new Set(sources.map((item) => item.documentId));
  const unitIds = new Set(records.map((item) => item.unit.memoryId));
  const nativeRecordCount = 1 + sources.length + records.length + derived.length;
  const gaps: HindsightCurrentPreparationGap[] = [];
  if (nativeRecordCount > HINDSIGHT_CURRENT_STATE_MAX_RECORDS) gaps.push({ code: "native_record_limit", objectKind: "bank", objectId: bankId });
  for (const { unit } of records) {
    if (unit.chunkId !== null) gaps.push({ code: "chunk_evidence_unavailable", objectKind: "memory_unit", objectId: unit.memoryId });
    if (unit.documentId !== null && !sourceIds.has(unit.documentId) || unit.sourceMemoryIds.some((id) => !unitIds.has(id))) {
      gaps.push({ code: "missing_source", objectKind: "memory_unit", objectId: unit.memoryId });
    }
  }
  return { sourceBankId: bankId, scope: bank.scope.kind, scopeDigest: canonicalPayloadHash(bank.scope),
    sourceCount: sources.length, unitCount: records.length, derivedCount: derived.length, nativeRecordCount,
    canonicalPayloadBytes: Buffer.byteLength(JSON.stringify({ bank, sources, records, derived }), "utf8"),
    nullSourceTextCount: sources.filter((item) => item.retainedText === null).length,
    emptySourceTextCount: sources.filter((item) => item.retainedText === "").length,
    facts: counts(records.map((item) => item.unit.factType)), lifecycle: counts(records.map((item) => item.unit.state)),
    observationScopeValueCount: new Set(records.map((item) => canonicalPayloadHash(item.unit.observationScopes))).size,
    gaps, gapDigest: canonicalPayloadHash(gaps) };
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
