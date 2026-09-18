import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { CanonicalMaintenanceIngestInput } from "./canonical-memory-maintenance-contract.ts";
import { CANONICAL_LOCAL_EVIDENCE_KEY } from "./canonical-memory-maintenance-evidence.ts";
import { CANONICAL_MAINTENANCE_LATER as later, canonicalMaintenanceRows,
  createCanonicalMaintenanceFixture } from "./canonical-memory-maintenance-fixtures.ts";
import { createCanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const databases: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith("taki-b6-ingestion-")) throw new Error("unsafe fixture path");
    rmSync(absolute, { recursive: true, force: true });
  }
});
function fixture(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db);
  return createCanonicalMaintenanceFixture(db);
}
function batch(value: ReturnType<typeof fixture>): CanonicalMaintenanceIngestInput {
  const fresh = value.make({ memoryId: "new-fact" });
  return { epochId: value.epochId, bankId: "global", characterId: "a", requestId: "batch", now: later,
    source: fresh.source, units: [{ unit: fresh.unit, policy: fresh.policy, searchTerms: "unused derived cache input" }],
    duplicates: [{ memoryId: "memory", expectedRevision: 1, importance: 7 }] };
}
function originalTarget(value: ReturnType<typeof fixture>) {
  return { epochId: value.epochId, bankId: "global", characterId: "a", memoryId: "memory" };
}

describe("canonical Local ingestion storage", () => {
  it("atomically retains the original source, new facts and duplicate evidence without replacing original provenance", () => {
    const value = fixture(); const original = value.seed(); const input = batch(value);
    const originalInput = JSON.stringify(input);
    const result = value.maintenance.ingest(input);
    expect(result).toEqual({ documentId: input.source.documentId, sourceRevision: 1,
      memories: [{ memoryId: "new-fact", revision: 1 }], reinforced: [{ memoryId: "memory", revision: 2 }] });
    const reinforced = value.maintenance.record(originalTarget(value));
    expect(reinforced?.unit).toEqual({ ...original.unit, revision: 2, proofCount: 4, updatedAt: later });
    expect(reinforced?.policy.importance).toBe(7);
    expect(reinforced?.provenance).toEqual(original.source.provenance);
    expect(value.maintenance.source({ ...originalTarget(value), documentId: original.source.documentId })).toEqual(original.source);
    const evidence = value.maintenance.evidenceSources(originalTarget(value));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual({ ...input.source, metadata: { ...input.source.metadata,
      [CANONICAL_LOCAL_EVIDENCE_KEY]: { version: 1, targets: [{ epochId: value.epochId, bankId: "global", memoryId: "memory" }] } } });
    expect(JSON.stringify(input)).toBe(originalInput);
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(2);
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(2);
    expect(value.maintenance.ingestReceipt(input)).toEqual(result);
  });

  it("supports duplicate-only and explicit empty extraction without manufacturing an active fact", () => {
    const value = fixture(); value.seed();
    const duplicate = { ...batch(value), units: [] };
    expect(value.maintenance.ingest(duplicate)).toMatchObject({ memories: [], reinforced: [{ memoryId: "memory", revision: 2 }] });
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(1);
    const empty = { ...batch(value), requestId: "empty", source: value.make({ memoryId: "empty" }).source,
      units: [], duplicates: [] };
    expect(value.maintenance.ingest(empty)).toEqual({ documentId: "document-empty", sourceRevision: 1, memories: [], reinforced: [] });
    expect(value.maintenance.source({ ...originalTarget(value), documentId: "document-empty" })).toEqual(empty.source);
    expect(value.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(1);
  });

  it("replays a historical batch after later edits without repeating its source attachment or proof", () => {
    const value = fixture(); value.seed(); const input = batch(value);
    const result = value.maintenance.ingest(input);
    value.maintenance.policyEdit({ ...originalTarget(value), requestId: "later", expectedRevision: 2, now: later,
      patch: { importance: 3, disclosure: "a later trigger" } });
    const before = canonicalMaintenanceRows(value.db);
    expect(value.maintenance.ingestReceipt(input)).toEqual(result);
    expect(value.maintenance.ingest({ ...input, now: "2026-05-01T00:00:00.000Z" })).toEqual(result);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(value.maintenance.record(originalTarget(value))?.unit.proofCount).toBe(4);
    expect(() => value.maintenance.ingestReceipt({ ...input, duplicates: [{ ...input.duplicates[0]!, importance: 8 }] }))
      .toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
    expect(() => value.maintenance.ingest({ ...input, requestId: "second-interpretation" })).toThrow(/MEMORY_REQUEST_ID_CONFLICT/);
  });

  it("retains the exact prepared batch and historical receipt through a real file reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-b6-ingestion-")); roots.push(root);
    const path = join(root, "fixture.db"); const value = fixture(path); value.seed(); const input = batch(value);
    const expected = value.maintenance.ingest(input); value.db.close();
    const reopened = openDatabase({ path, migrations: MIGRATIONS }); databases.push(reopened);
    const maintenance = createCanonicalMemoryMaintenanceRepo(reopened, value.tokenizer);
    expect(maintenance.ingestReceipt(input)).toEqual(expected);
    expect(maintenance.ingest(input)).toEqual(expected);
    expect(maintenance.evidenceSources(originalTarget(value))[0]?.retainedText).toBe(input.source.retainedText);
    expect(maintenance.record(originalTarget(value))?.unit.proofCount).toBe(4);
  });

  it.each([
    "CREATE TRIGGER fail_proof BEFORE UPDATE ON canonical_memory_units WHEN OLD.memory_id='memory' BEGIN SELECT RAISE(ABORT,'proof failed'); END",
    "CREATE TRIGGER fail_batch_receipt BEFORE INSERT ON canonical_memory_operation_receipts WHEN NEW.request_id='batch' BEGIN SELECT RAISE(ABORT,'receipt failed'); END",
  ])("rolls all new facts, source evidence, existing proofs, sparse rows and receipts back on failure", (sql) => {
    const value = fixture(); value.seed(); const before = canonicalMaintenanceRows(value.db); value.db.exec(sql);
    expect(() => value.maintenance.ingest(batch(value))).toThrow();
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
    expect(value.maintenance.ingestReceipt(batch(value))).toBeUndefined();
  });

  it("refuses a stale duplicate before saving a new source and never touches a different Character Bank", () => {
    const value = fixture(); value.seed(); value.seed({ memoryId: "foreign", bankId: "b-bank" });
    const before = canonicalMaintenanceRows(value.db); const input = batch(value);
    expect(() => value.maintenance.ingest({ ...input, duplicates: [{ memoryId: "memory", expectedRevision: 2, importance: 7 }] }))
      .toThrow(/MEMORY_REVISION_MISMATCH:1/);
    expect(() => value.maintenance.ingest({ ...input, duplicates: [{ memoryId: "foreign", expectedRevision: 1, importance: 7 }] }))
      .toThrow(/MEMORY_NOT_FOUND/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });

  it("refuses a Core-source metadata namespace collision or a non-automatic attachment without losing any field", () => {
    const value = fixture(); value.seed(); const input = batch(value); const before = canonicalMaintenanceRows(value.db);
    const colliding = { ...input, source: { ...input.source,
      metadata: { ...input.source.metadata, [CANONICAL_LOCAL_EVIDENCE_KEY]: { prior: "opaque imported value" } } } };
    expect(() => value.maintenance.ingest(colliding)).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(colliding.source.metadata[CANONICAL_LOCAL_EVIDENCE_KEY]).toEqual({ prior: "opaque imported value" });
    expect(() => value.maintenance.ingest({ ...input, source: { ...input.source,
      provenance: { ...input.source.provenance, origin: "explicit-user" } } })).toThrow(/MEMORY_INVALID_REQUEST/);
    expect(canonicalMaintenanceRows(value.db)).toEqual(before);
  });
});
