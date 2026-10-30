/**
 * INPUT:  an owned temporary or in-memory SQLite database
 * OUTPUT: deterministic canonical sources, facts, policies, and scoped maintenance fixtures
 * POS:    core/db — test support only; no runtime wiring, user data, services, or model calls
 */
import type { CanonicalMemoryRecord, CanonicalMemorySource, CanonicalMemoryUnit,
  TakiMemoryPolicyProjection } from "@taki/shared";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-repo.ts";
import { createCanonicalMemoryRepo, stableRequestHash } from "./canonical-memory-repo.ts";
import type { Database } from "./sqlite.ts";

export const CANONICAL_MAINTENANCE_AT = "2026-01-01T00:00:00.000Z";
export const CANONICAL_MAINTENANCE_LATER = "2026-02-01T00:00:00.000Z";
export interface CanonicalMaintenanceSeed {
  memoryId?: string; bankId?: string; layerId?: string;
  source?: Partial<CanonicalMemorySource>; unit?: Partial<CanonicalMemoryUnit>;
  policy?: Partial<TakiMemoryPolicyProjection>;
}

export function createCanonicalMaintenanceFixture(db: Database) {
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epochId = authority.initializeLocalAuthority(CANONICAL_MAINTENANCE_AT).epochId;
  for (const [bankId, characterId] of [["global", null], ["a-bank", "a"], ["b-bank", "b"]] as const) {
    authority.createBank({ authorityEpochId: epochId, bankId,
      scope: characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId },
      name: bankId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Fixture memory", config: {},
      createdAt: CANONICAL_MAINTENANCE_AT, updatedAt: CANONICAL_MAINTENANCE_AT });
  }
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const records = createCanonicalMemoryRepo(db); const maintenance = createCanonicalMemoryMaintenanceRepo(db, tokenizer);
  const make = (input: CanonicalMaintenanceSeed = {}) => makeFixtureRecord(epochId, input);
  const seed = (input: CanonicalMaintenanceSeed = {}) => {
    const value = make(input);
    records.retain({ epochId, bankId: value.unit.bankId, requestId: `seed-${value.unit.bankId}-${value.unit.memoryId}`,
      requestHash: stableRequestHash(value), source: value.source, unit: value.unit, policy: value.policy,
      searchTerms: tokenizer.tokenize([value.unit.text, value.unit.context, value.policy.disclosure].join(" ")).join(" ") });
    return value;
  };
  return { db, epochId, authority, records, maintenance, tokenizer, make, seed };
}

function makeFixtureRecord(epochId: string, input: CanonicalMaintenanceSeed) {
  const at = CANONICAL_MAINTENANCE_AT;
  const bankId = input.bankId ?? "global"; const memoryId = input.memoryId ?? "memory";
  const layerId = input.policy?.layerId ?? input.layerId ?? "profile";
  const source: CanonicalMemorySource = { authorityEpochId: epochId, bankId, documentId: `document-${memoryId}`,
    retainedText: `Original approved conversation for ${memoryId}: I prefer quiet cafes.`, contentHash: null,
    context: "Original context", tags: ["original-source-tag"], metadata: { original: true, nested: [null, "", 3] },
    observationScopes: "shared", provenance: { actor: "agent", origin: "auto-gate",
      characterId: bankId === "global" ? null : bankId[0] ?? null, timelineFromSeq: 3, timelineToSeq: 5,
      capturedAt: at, sanitized: true, sourceRef: `timeline:${memoryId}` }, revision: 1,
    createdAt: at, updatedAt: at, ...input.source };
  const unit: CanonicalMemoryUnit = { authorityEpochId: epochId, bankId, memoryId, documentId: source.documentId,
    chunkId: null, text: `I remember quiet cafes (${memoryId}).`, context: "The original user wording",
    factType: "experience", state: "valid", revision: 1, tags: ["keep-tag", `taki-layer:${layerId}`],
    metadata: { number: 4, string: "4", flag: false, nothing: null, nested: { empty: "", values: [1, "1", null] } },
    entities: ["cafes"], sourceMemoryIds: [], observationScopes: [["scope-tag"]], eventDate: at,
    occurredStart: at, occurredEnd: at, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null,
    consolidatedAt: at, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null,
    proofCount: 3, ...input.unit };
  const policy: TakiMemoryPolicyProjection = { authorityEpochId: epochId, bankId, memoryId, layerId,
    importance: 5, visibility: "retrieved", disclosure: "when a cafe is mentioned", origin: "self",
    emotionalWeight: 0.25, retention: { kind: "permanent" }, policyVersion: 2, updatedAt: at, ...input.policy };
  const record: CanonicalMemoryRecord = { unit, policy, provenance: source.provenance };
  return { source, unit, policy, record };
}

export function canonicalMaintenanceRows(db: Database) {
  const tables = ["canonical_memory_sources", "canonical_memory_units", "canonical_memory_policy",
    "canonical_memory_unit_sources", "canonical_memory_fts", "canonical_memory_revision_snapshots",
    "canonical_memory_operation_receipts", "canonical_memory_retired_sources"];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
