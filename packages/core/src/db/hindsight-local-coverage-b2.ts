/**
 * INPUT:  current Local witnesses and the original B2 source/result/operation receipt contracts
 * OUTPUT: comparable full-record matches plus explicit bounded new/changed/missing/unproven catch-up entries
 * POS:    core/db — read-only historical comparison; never reconstructs or rewrites a fictitious B2 snapshot
 */
import {
  HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS, HindsightLocalCoverageCatchUpSchema,
  type HindsightLocalCoverageCatchUp, type HindsightLocalCoverageRecord,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash, documentIdentity } from "../memory/legacy-migration/legacy-identities.ts";
import { compareKeys, localCoverageKey, type HindsightLocalCoverageState } from "./hindsight-local-coverage-reader.ts";
import type { Database, SqlRow } from "./sqlite.ts";

interface B2Evidence { sources: SqlRow[]; results: SqlRow[]; receipts: SqlRow[] }
interface ComparisonContext {
  evidence: B2Evidence;
  sourceRows: Map<string, SqlRow[]>;
  sourceIds: Map<string, SqlRow>;
  results: Map<string, SqlRow>;
  receipts: Map<string, SqlRow>;
  currentSources: Map<string, HindsightLocalCoverageRecord[]>;
  currentUnitIds: Set<string>;
  matchingUnits: Set<string>;
  matchingProvenance: Set<string>;
  catchUp: HindsightLocalCoverageCatchUp[];
}
export interface HindsightB2CoverageComparison {
  b2EvidenceDigest: string;
  b2MatchingRecordCount: number;
  catchUp: HindsightLocalCoverageCatchUp[];
}

export function compareHindsightCoverageWithB2(db: Database, input: { runId: string; state: HindsightLocalCoverageState }): HindsightB2CoverageComparison {
  const evidence = readB2Evidence(db, input.runId);
  const context = comparisonContext(evidence, input.state.records);
  for (const record of input.state.records.filter((item) => item.kind === "unit")) {
    compareUnit(context, record);
  }
  for (const record of input.state.records.filter((item) => item.kind !== "unit" && item.kind !== "epoch")) {
    compareOther(context, record);
  }
  appendMissing(context);
  const { catchUp, matchingUnits } = context;
  if (catchUp.length > HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS) throw new Error("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED");
  catchUp.sort((left, right) => compareKeys(left.key, right.key) || compareKeys(left.reason, right.reason));
  return { b2EvidenceDigest: canonicalPayloadHash(evidence), b2MatchingRecordCount: matchingUnits.size,
    catchUp: catchUp.map((item) => HindsightLocalCoverageCatchUpSchema.parse(item)) };
}

function comparisonContext(evidence: B2Evidence, records: HindsightLocalCoverageRecord[]): ComparisonContext {
  const sourceRows = new Map<string, SqlRow[]>(); const currentSources = new Map<string, HindsightLocalCoverageRecord[]>();
  for (const row of evidence.sources) {
    const key = String(row.document_id); const rows = sourceRows.get(key) ?? []; rows.push(row); sourceRows.set(key, rows);
  }
  for (const record of records.filter((item) => item.kind === "source")) {
    const rows = currentSources.get(record.objectId) ?? []; rows.push(record); currentSources.set(record.objectId, rows);
  }
  return { evidence, sourceRows, currentSources, sourceIds: new Map(evidence.sources.map((row) => [String(row.source_id), row])),
    results: new Map(evidence.results.map((row) => [String(row.memory_id), row])),
    receipts: new Map(evidence.receipts.map((row) => [String(row.request_id), row])),
    currentUnitIds: new Set(records.filter((record) => record.kind === "unit").map((record) => record.objectId)),
    matchingUnits: new Set(), matchingProvenance: new Set(), catchUp: [] };
}

export function hindsightB2EvidenceDigest(db: Database, runId: string): string {
  return canonicalPayloadHash(readB2Evidence(db, runId));
}

function readB2Evidence(db: Database, runId: string): B2Evidence {
  for (const table of ["memory_migration_sources", "memory_migration_results"]) {
    const count = Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id=:run`).get({ run: runId })?.n ?? 0);
    if (count > HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS) throw new Error("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED");
  }
  return {
    sources: db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run ORDER BY source_id").all({ run: runId }),
    results: db.prepare("SELECT * FROM memory_migration_results WHERE run_id=:run ORDER BY source_id,result_ordinal").all({ run: runId }),
    receipts: db.prepare(`SELECT r.* FROM canonical_memory_operation_receipts r JOIN memory_migration_runs m
      ON m.epoch_id=r.authority_epoch_id JOIN memory_migration_sources s ON s.run_id=m.run_id AND s.operation_id=r.request_id
      WHERE m.run_id=:run ORDER BY r.request_id`).all({ run: runId }),
  };
}

function compareUnit(context: ComparisonContext, record: HindsightLocalCoverageRecord): void {
  const { catchUp, matchingUnits } = context;
  const previous = context.results.get(record.objectId);
  if (!previous) { catchUp.push(diagnostic(record, "b2-new")); return; }
  const previousHash = String(previous.result_payload_hash);
  if (record.b2RecordPayloadHash === previousHash && record.revision === Number(previous.revision)) {
    matchingUnits.add(unitKey(record));
    const source = context.sourceIds.get(String(previous.source_id));
    if (typeof source?.document_id === "string") {
      context.matchingProvenance.add(unitKey({ bankId: record.bankId, objectId: source.document_id }));
    }
    return;
  }
  catchUp.push({ ...diagnostic(record, record.b2RecordPayloadHash ? "b2-changed" : "b2-unproven"),
    b2SourceId: String(previous.source_id), previousRevision: Number(previous.revision), previousHash,
    currentHash: record.b2RecordPayloadHash ?? null });
}

function compareOther(context: ComparisonContext, record: HindsightLocalCoverageRecord): void {
  const { catchUp, matchingUnits } = context;
  if ((record.kind === "policy" || record.kind === "lineage") && matchingUnits.has(unitKey(record))) return;
  if (record.kind === "source") { compareSource(context, record); return; }
  if (record.kind === "source-provenance") {
    if (context.matchingProvenance.has(unitKey(record))) return;
    const source = context.currentSources.get(record.objectId)?.find((item) => item.bankId === record.bankId);
    const previous = source ? context.sourceRows.get(source.objectId)?.find((row) => sourceMatches(source, row)) : undefined;
    if (source && previous && zeroSourceProven(source, previous, context.receipts)) return;
  }
  // B2 has no complete Bank, derived-object or Block payload witness; an identity or count is not that evidence.
  catchUp.push(diagnostic(record, "b2-unproven"));
}

function compareSource(context: ComparisonContext, record: HindsightLocalCoverageRecord): void {
  const { catchUp } = context;
  const previous = context.sourceRows.get(record.objectId)?.find((row) => sourceMatches(record, row));
  if (!previous) { catchUp.push(diagnostic(record, "b2-new")); return; }
  const hashes = record.sourceHashes;
  const changed = record.revision !== 1 || hashes?.declaredContentHash !== previous.content_hash;
  if (!changed && previous.result_count === 0 && zeroSourceProven(record, previous, context.receipts)) return;
  catchUp.push({ ...diagnostic(record, changed ? "b2-changed" : "b2-unproven"),
    b2SourceId: String(previous.source_id), previousRevision: 1 });
}

function zeroSourceProven(record: HindsightLocalCoverageRecord, source: SqlRow, receipts: Map<string, SqlRow>): boolean {
  const receipt = receipts.get(String(source.operation_id));
  // legacy-canonical-converter.ts hashes the entire source only for its zero-unit branch.
  return source.disposition === "converted-zero" && receipt?.operation === "retain"
    && receipt.request_hash === record.sourceHashes?.canonicalSourceHash
    && receipt.result_json === canonicalJson({ memories: [] });
}

function sourceMatches(record: HindsightLocalCoverageRecord, source: SqlRow): boolean {
  return source.kind === "entry" && source.disposition !== "excluded" && record.bankId !== null
    && source.document_id === record.objectId && source.canonical_source_id === record.objectId
    && documentIdentity(record.bankId, String(source.source_id)) === record.objectId;
}

function appendMissing(context: ComparisonContext): void {
  const { evidence, catchUp } = context;
  for (const source of evidence.sources.filter((row) => row.disposition !== "excluded")) {
    if (source.kind === "block" || source.document_id === null || source.canonical_source_id === null) {
      catchUp.push(historicalDiagnostic(source, source.kind === "block" ? "block" : "source", "b2-unproven"));
    } else if (!context.currentSources.get(String(source.document_id))?.some((record) => sourceMatches(record, source))) {
      catchUp.push(historicalDiagnostic(source, "source", "b2-missing"));
    }
  }
  for (const result of evidence.results) {
    if (context.currentUnitIds.has(String(result.memory_id))) continue;
    const identity = { kind: "unit" as const, bankId: null, objectId: String(result.memory_id), relatedId: null };
    catchUp.push({ ...identity, key: localCoverageKey(identity), reason: "b2-missing", b2SourceId: String(result.source_id),
      previousRevision: Number(result.revision), currentRevision: null,
      previousHash: String(result.result_payload_hash), currentHash: null });
  }
}

function historicalDiagnostic(source: SqlRow, kind: "source" | "block", reason: "b2-unproven" | "b2-missing"): HindsightLocalCoverageCatchUp {
  const identity = { kind, bankId: null, objectId: String(source.document_id ?? source.source_id), relatedId: null };
  return { ...identity, key: localCoverageKey(identity), reason, b2SourceId: String(source.source_id),
    previousRevision: null, currentRevision: null, previousHash: null, currentHash: null };
}

function diagnostic(record: HindsightLocalCoverageRecord, reason: HindsightLocalCoverageCatchUp["reason"]): HindsightLocalCoverageCatchUp {
  return { kind: record.kind, key: record.key, bankId: record.bankId, objectId: record.objectId, relatedId: record.relatedId,
    reason, b2SourceId: null, previousRevision: null, currentRevision: record.revision, previousHash: null,
    currentHash: record.payloadHash };
}

function unitKey(record: Pick<HindsightLocalCoverageRecord, "bankId" | "objectId">): string { return canonicalJson([record.bankId, record.objectId]); }
