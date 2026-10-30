/**
 * INPUT:  one synchronous SQLite view of the active canonical Local epoch
 * OUTPUT: complete sorted payload witnesses and typed current source/record reads
 * POS:    core/db — coverage reader; includes invalidated units and independent policy/lineage/Block state
 */
import { createHash } from "node:crypto";
import {
  CanonicalMemorySourceSchema, HINDSIGHT_LOCAL_COVERAGE_ENCODING, HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS,
  HindsightLocalCoverageRecordSchema, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type HindsightLocalCoverageKind, type HindsightLocalCoverageRecord,
} from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export interface HindsightLocalCoverageState {
  localEpochId: string;
  bankIds: string[];
  sourceCount: number;
  sourceRevisionFence: string;
  contentDigest: string;
  records: HindsightLocalCoverageRecord[];
}

const tables = [
  ["bank", "canonical_memory_banks", "bank_id"],
  ["source", "canonical_memory_sources", "document_id"],
  ["unit", "canonical_memory_units", "memory_id"],
  ["policy", "canonical_memory_policy", "memory_id"],
  ["lineage", "canonical_memory_unit_sources", "memory_id"],
  ["derived", "canonical_memory_derived", "object_id"],
] as const;

export function readHindsightLocalCoverageState(db: Database, expectedEpochId?: string): HindsightLocalCoverageState {
  const epoch = readEpoch(db, expectedEpochId);
  const epochId = String(epoch.epoch_id);
  requireCaptureSize(db, epochId);
  const records = [witness("epoch", epoch, { objectId: epochId, bankId: null })];
  for (const [kind, table, identity] of tables) {
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch`).all({ epoch: epochId })) {
      appendRow(db, { records, kind, row, identity });
    }
  }
  // Blocks have no provider epoch. Their complete current state remains relevant across an authority change.
  for (const row of db.prepare("SELECT block_id,scope_kind,character_id,content,revision,updated_at FROM taki_memory_blocks").all()) {
    records.push(witness("block", row, { objectId: String(row.block_id), bankId: null,
      relatedId: row.character_id === null ? null : String(row.character_id) }));
  }
  records.sort((left, right) => compareKeys(left.key, right.key));
  const bankIds = records.filter((record) => record.kind === "bank").map((record) => record.objectId).sort();
  const sources = records.filter((record) => record.kind === "source");
  return { localEpochId: epochId, bankIds, sourceCount: sources.length, records,
    sourceRevisionFence: coverageHash("source-revision-fence", sources),
    contentDigest: coverageHash("full-state", { localEpochId: epochId, bankIds, records }) };
}

function readEpoch(db: Database, expectedEpochId?: string): SqlRow {
  const row = db.prepare(`SELECT e.*,s.updated_at AS authority_updated_at FROM canonical_memory_authority_state s
    JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1`).get();
  if (!row || row.provider_id !== "local" || row.status !== "active" || row.reason !== "initial-local"
    || (expectedEpochId !== undefined && row.epoch_id !== expectedEpochId)) {
    throw new Error("HINDSIGHT_PREDECESSOR_STALE");
  }
  return row;
}

function requireCaptureSize(db: Database, epochId: string): void {
  let count = 1 + Number(db.prepare("SELECT count(*) AS n FROM taki_memory_blocks").get()?.n ?? 0);
  for (const [kind, table] of tables) {
    const rows = Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE authority_epoch_id=:epoch`).get({ epoch: epochId })?.n ?? 0);
    count += rows * (kind === "source" ? 2 : 1);
  }
  if (count > HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS) throw new Error("HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED");
}

function appendRow(db: Database, input: { records: HindsightLocalCoverageRecord[]; kind: HindsightLocalCoverageKind; row: SqlRow; identity: string }): void {
  const { row, kind, records } = input;
  const record = witness(kind, row, { bankId: String(row.bank_id), objectId: String(row[input.identity]),
    relatedId: kind === "lineage" ? String(row.source_memory_id) : kind === "derived" ? String(row.kind) : null });
  if (kind === "source") {
    const source = parseSource(row);
    record.sourceHashes = { declaredContentHash: source.contentHash,
      retainedTextSha256: source.retainedText === null ? null : createHash("sha256").update(source.retainedText).digest("hex"),
      canonicalSourceHash: canonicalPayloadHash(source) };
    records.push(witness("source-provenance", { provenance_json: row.provenance_json ?? null }, {
      bankId: source.bankId, objectId: source.documentId,
    }));
  }
  if (kind === "unit") {
    const current = createCanonicalMemoryRepo(db).record(String(row.authority_epoch_id), String(row.bank_id), String(row.memory_id));
    // B2's actual converter hashed this full record, separately from both its source and the SQL row witness.
    if (current) {
      current.unit.sourceMemoryIds.sort();
      record.b2RecordPayloadHash = canonicalPayloadHash(current);
    }
  }
  records.push(HindsightLocalCoverageRecordSchema.parse(record));
}

function witness(kind: HindsightLocalCoverageKind, row: SqlRow, identity: { bankId: string | null; objectId: string; relatedId?: string | null }): HindsightLocalCoverageRecord {
  const relatedId = identity.relatedId ?? null;
  const revision = row.revision ?? row.object_revision ?? row.policy_version;
  return { kind, ...identity, relatedId, key: localCoverageKey({ kind, ...identity, relatedId }),
    revision: revision === undefined ? null : Number(revision), payloadHash: coverageHash(kind, decodeJsonColumns(row)) };
}

function decodeJsonColumns(row: SqlRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    key.endsWith("_json") && typeof value === "string" ? JSON.parse(value) as unknown : value]));
}

export function localCoverageKey(identity: Pick<HindsightLocalCoverageRecord, "kind" | "bankId" | "objectId" | "relatedId">): string {
  return canonicalJson([identity.kind, identity.bankId, identity.objectId, identity.relatedId]);
}

export function coverageHash(domain: string, value: unknown): string {
  return canonicalPayloadHash({ encoding: HINDSIGHT_LOCAL_COVERAGE_ENCODING, domain, value });
}

export function compareKeys(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

export function readHindsightLocalSource(db: Database, input: { epochId: string; bankId: string; documentId: string }): CanonicalMemorySource {
  const row = db.prepare(`SELECT * FROM canonical_memory_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:document`)
    .get({ epoch: input.epochId, bank: input.bankId, document: input.documentId });
  if (!row) throw new Error("HINDSIGHT_LOCAL_SOURCE_MISSING");
  return parseSource(row);
}

export function readHindsightLocalSourceRecords(db: Database, source: CanonicalMemorySource): CanonicalMemoryRecord[] {
  const repo = createCanonicalMemoryRepo(db);
  return db.prepare(`SELECT memory_id FROM canonical_memory_units
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:document ORDER BY memory_id`)
    .all({ epoch: source.authorityEpochId, bank: source.bankId, document: source.documentId }).map((row) => {
      const record = repo.record(source.authorityEpochId, source.bankId, String(row.memory_id));
      if (!record) throw new Error("HINDSIGHT_LOCAL_RECORD_INCOMPLETE");
      return record;
    });
}

function parseSource(row: SqlRow): CanonicalMemorySource {
  return CanonicalMemorySourceSchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id,
    documentId: row.document_id, contentHash: row.content_hash, retainedText: row.retained_text, context: row.context,
    tags: JSON.parse(String(row.tags_json)), metadata: JSON.parse(String(row.metadata_json)),
    observationScopes: row.observation_scopes_json === null ? null : JSON.parse(String(row.observation_scopes_json)),
    provenance: JSON.parse(String(row.provenance_json)), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}
