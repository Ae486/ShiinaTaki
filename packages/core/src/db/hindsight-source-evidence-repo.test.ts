import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CanonicalMemoryRecordSchema, CanonicalMemorySourceSchema, HindsightLogicalSnapshotRecordSchema,
  HindsightNativeResultSchema, HindsightNativeResultPageSchema, HindsightTrackedRetainRequestSchema,
  nativeProofJson, nativeReferenceFields, nativeResultFields, nativeReceiptFields, nativeRetainRequestFields,
  type CanonicalMemoryRecord, type CanonicalMemorySource, type HindsightLogicalSnapshotRecord,
  type HindsightPreparedSource, type HindsightSourceConfirmation, type HindsightSourceProjectionScope,
} from "@taki/shared";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";
import { createHindsightSourceEvidenceRepo } from "./hindsight-source-evidence-repo.ts";
import { createHindsightReplicaSyncRepo } from "./hindsight-replica-sync-repo.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { hindsightBankBindings } from "../memory/hindsight/hindsight-bank-identity.ts";
import { nativeProofHash } from "../memory/hindsight/hindsight-native-proof.ts";
import { prepareHindsightSource, encodeHindsightSourceMetadataV1 } from "../memory/hindsight/hindsight-source-preparation.ts";
import { createHindsightSourceEvidenceProjection } from "../memory/hindsight/hindsight-source-evidence-projection.ts";
import { projectHindsightJournal, projectHindsightReplicaRecord } from "../memory/hindsight/hindsight-replica-projection.ts";
import { HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema,
  normalizeSnapshotMetadata, normalizeSnapshotPage } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { HindsightJournalWireSchema, normalizeHindsightJournal } from "../memory/hindsight/hindsight-journal-contracts.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";

const at = "2026-09-08T00:00:00.000Z";
const later = "2026-09-08T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";
const batchId = "55555555-5555-4555-8555-555555555555";
const nativeBank = hindsightBankBindings("taki")[0].externalBankId;
const nativeIds = ["aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "aaaaaaaa-aaaa-4aaa-8aaa-000000000002"];
const scope: HindsightSourceProjectionScope = { authorityEpochId: "target-hindsight-epoch", providerLineageId: lineage,
  bankGeneration: generation, bank: { bankId: nativeBank, scope: { kind: "global", characterId: null } } };
const databases: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of roots.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("taki-source-evidence-")) {
      throw new Error("unsafe source evidence fixture path");
    }
    rmSync(target, { recursive: true, force: true });
  }
});

describe("typed Hindsight source preparation", () => {
  it("distinguishes numeric/string metadata and null/empty context although native encodings collide", () => {
    const source = localSource("local"); const records = [localRecord(source, "one")];
    const first = prepareHindsightSource({ source, records });
    const second = prepareHindsightSource({ source: { ...source, metadata: { ...source.metadata, number: "1" } }, records });
    expect(first.nativeItem).toEqual(second.nativeItem);
    expect(first.evidenceId).not.toBe(second.evidenceId); expect(first.sourceHash).not.toBe(second.sourceHash);
    const empty = prepareHindsightSource({ source: { ...source, context: "" }, records });
    expect(empty.evidenceId).not.toBe(first.evidenceId);
    expect(first.source.context).toBeNull(); expect(empty.nativeItem?.context).toBe("");
    expect(first.source.contentHash).toBe("declared-legacy-representation");
    expect(first.retainedTextHash).toBe(createHash("sha256").update(source.retainedText!).digest("hex"));
    expect(first.units[0]?.record.unit.metadata).toEqual(records[0]?.unit.metadata);
    expect(first.units[0]?.record.unit.metadata).not.toEqual(first.source.metadata);
    expect(first.nativeItem?.metadata?.nested).toBe('{"field_name":[null,true,1.5,"雪😀"]}');
  });

  it("uses complete record witnesses including independent provenance and orders Unicode identities deterministically", () => {
    const source = localSource("local");
    const first = localRecord(source, "\u{10000}"); const second = localRecord(source, "\ue000");
    first.provenance = { ...first.provenance, actor: "agent", origin: "explicit-agent", sourceRef: "unit-source" };
    const prepared = prepareHindsightSource({ source, records: [second, first] });
    expect(prepared.units.map(({ record }) => record.unit.memoryId)).toEqual(["\u{10000}", "\ue000"]);
    expect(prepared.units[0]?.record.provenance.sourceRef).toBe("unit-source");
    const changed = structuredClone(first); changed.policy.importance += 1;
    expect(prepareHindsightSource({ source, records: [second, changed] }).evidenceId).not.toBe(prepared.evidenceId);
    const { db, path } = isolatedDatabase(); createHindsightSourceEvidenceRepo(db).savePrepared(prepared); db.close();
    expect(createHindsightSourceEvidenceRepo(open(path)).getPrepared(prepared.evidenceId)).toEqual(prepared);
  });

  it("rejects foreign epoch/Bank/document units and duplicates before creating evidence", () => {
    const source = localSource("local"); const record = localRecord(source, "one");
    for (const field of ["authorityEpochId", "bankId", "documentId"] as const) {
      const changed = structuredClone(record); changed.unit[field] = "foreign";
      if (field !== "documentId") changed.policy[field] = "foreign";
      expect(() => prepareHindsightSource({ source, records: [changed] })).toThrow("HINDSIGHT_SOURCE_RELATIONSHIP_INVALID");
    }
    expect(() => prepareHindsightSource({ source, records: [record, record] })).toThrow("HINDSIGHT_SOURCE_RELATIONSHIP_INVALID");
  });

  it("persists explicit representation gaps without truncating valid Canonical content", () => {
    const { db, path } = isolatedDatabase(); const repo = createHindsightSourceEvidenceRepo(db);
    const ordinary = localSource("local");
    const large = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key-${index}`, "界".repeat(16_384)]));
    const sources = [{ ...ordinary, retainedText: null }, { ...ordinary, retainedText: "" },
      { ...ordinary, metadata: Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`key-${index}`, index])) },
      { ...ordinary, metadata: large }, { ...ordinary, retainedText: "text\ud800" }];
    const prepared = sources.map((source) => repo.savePrepared(prepareHindsightSource({ source, records: [] })));
    expect(prepared.map((value) => value.nativeItem)).toEqual(sources.map(() => null));
    expect(prepared.map((value) => value.gaps.map((gap) => gap.code))).toEqual([
      ["source_text_missing"], ["source_text_empty"], ["native_metadata_keys"],
      ["native_request_bytes"], ["native_unicode"],
    ]);
    db.close(); const reopened = createHindsightSourceEvidenceRepo(open(path));
    for (const value of prepared) expect(reopened.getPrepared(value.evidenceId)).toEqual(value);
    expect(reopened.getPrepared(prepared[2]!.evidenceId)?.source.metadata).toEqual(sources[2]?.metadata);
  });

  it("keeps deep valid JSON and samples only diagnostics when many units exceed native bounds", () => {
    const source = localSource("local");
    source.metadata = { nested: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } };
    expect(prepareHindsightSource({ source, records: [] }).gapCount).toBe(0);
    const records = Array.from({ length: 40 }, (_, index) => {
      const record = localRecord(source, `unit-${index.toString().padStart(2, "0")}`);
      record.unit.metadata = Object.fromEntries(Array.from({ length: 129 }, (_, key) => [`key-${key}`, 1]));
      return record;
    });
    const value = prepareHindsightSource({ source, records });
    expect(value.gapCount).toBe(40); expect(value.gaps).toHaveLength(32); expect(value.units).toHaveLength(40);
    expect(value.gaps.every((gap) => gap.objectKind === "memory_unit")).toBe(true);
    expect(value.units[39]?.record.unit.metadata).toEqual(records[39]?.unit.metadata);
  });
});

describe("durable source evidence and actual replica projection", () => {
  it("prepares real Local rows, reopens, confirms exact native objects, and reseeds without losing evidence", () => {
    const f = fixture(); const localEpoch = createCanonicalMemoryAuthorityRepo(f.db).activeEpoch();
    const beforePending = f.db.prepare("SELECT * FROM pending_memory").all();
    f.db.close(); const db = open(f.path); const evidence = createHindsightSourceEvidenceRepo(db);
    expect(evidence.getPrepared(f.prepared.evidenceId)).toEqual(f.prepared);
    const bindings = evidence.confirm(f.confirmation);
    expect(bindings).toHaveLength(3);
    expect(bindings[0]).toMatchObject({ sourceBankId: "global", bankId: nativeBank, objectRevision: 3,
      requestHash: f.confirmation.result.request_hash, resultHash: f.confirmation.result.result_hash });
    expect(evidence.confirm({ ...f.confirmation, confirmedAt: "2026-09-08T00:00:01.000Z" })).toEqual(bindings);
    const projection = createHindsightSourceEvidenceProjection({ repo: evidence, ...scope });
    const replica = createHindsightReplicaSyncRepo({ db, projection, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => at });
    const lease = replica.leases.acquire({ bankId: nativeBank, ownerId: "offline", durationMs: 60_000 });
    const seed = { ...f.snapshot, authorityEpochId: scope.authorityEpochId, expectedProviderLineageId: lineage,
      expectedBankGeneration: generation, expectedCheckpoint: null, lease };
    const checkpoint = replica.seedVerifiedSnapshot(seed);
    expect(replica.record({ bankId: nativeBank, memoryId: nativeIds[0]! })).toBeUndefined();
    const unit = replica.record({ bankId: nativeBank, memoryId: nativeIds[0]!, includeInvalidated: true });
    expect(unit?.unit).toMatchObject({ authorityEpochId: scope.authorityEpochId, memoryId: nativeIds[0], bankId: nativeBank,
      text: "Native current text 0", context: "native context 0", state: "invalidated", revision: 7,
      entities: ["Native entity"], chunkId: "native-chunk-0", invalidationReason: "native invalidation" });
    expect(unit?.unit.metadata).toEqual(f.prepared.units[0]?.record.unit.metadata);
    expect(unit?.policy).toEqual({ ...f.prepared.units[0]!.record.policy, authorityEpochId: scope.authorityEpochId,
      memoryId: nativeIds[0], bankId: nativeBank });
    const second = replica.record({ bankId: nativeBank, memoryId: nativeIds[1]! });
    expect(second?.unit.sourceMemoryIds).toEqual([nativeIds[0]]);
    expect(second?.unit.eventDate).toBe(later); expect(second?.unit.tags).toEqual(["native-tag", "taki-layer:relationships"]);
    const source = replica.logicalRecord({ bankId: nativeBank, objectKind: "document", objectId: "doc" });
    expect(source?.payload).toMatchObject({ kind: "document", value: { context: null, retainedText: f.prepared.source.retainedText,
      contentHash: f.prepared.retainedTextHash, metadata: f.prepared.source.metadata, tags: ["native-document-tag"] } });
    replica.seedVerifiedSnapshot({ ...seed, expectedCheckpoint: checkpoint });
    expect(evidence.getPrepared(f.prepared.evidenceId)).toEqual(f.prepared);
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(3);
    expect(createCanonicalMemoryAuthorityRepo(db).activeEpoch()).toEqual(localEpoch);
    expect(db.prepare("SELECT * FROM pending_memory").all()).toEqual(beforePending);
    expect(db.prepare("SELECT count(*) AS n FROM memory_migration_sources").get()?.n).toBe(0);
    db.close(); const reopened = open(f.path);
    const restored = createHindsightSourceEvidenceProjection({ repo: createHindsightSourceEvidenceRepo(reopened), ...scope });
    expect(projectHindsightReplicaRecord(f.records[1]!, context(restored)).payload).toEqual(source?.payload);
  });

  it("uses explicit associations and refuses to copy source metadata to one-to-many native facts", () => {
    const f = fixture();
    f.repo.confirm({ ...f.confirmation, unitAssociations: [] });
    const projection = createHindsightSourceEvidenceProjection({ repo: f.repo, ...scope });
    expect(() => projectHindsightReplicaRecord(f.records[2]!, context(projection))).toThrow("HINDSIGHT_SOURCE_BINDING_MISSING");
    const duplicate = { ...f.confirmation, unitAssociations: [
      { sourceMemoryId: "one", nativeMemoryId: nativeIds[0]! }, { sourceMemoryId: "one", nativeMemoryId: nativeIds[1]! },
    ] };
    expect(() => f.repo.confirm(duplicate)).toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    const wrong = structuredClone(f.records); const unit = wrong[2]!;
    if (unit.payload.kind !== "memory_unit") throw new Error("fixture");
    unit.payload.value.metadata = encodeHindsightSourceMetadataV1(f.prepared.source.metadata);
    expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...snapshot(wrong) } }))
      .toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(1);
  });

  it("reuses the original immutable binding after another verified snapshot or equivalent journal observation", () => {
    const f = fixture(); const original = f.repo.confirm(f.confirmation);
    const observed = structuredClone(f.snapshot); const nextSnapshot = "66666666-6666-4666-8666-666666666666";
    observed.metadata.snapshotId = nextSnapshot; observed.pages[0]!.snapshotId = nextSnapshot;
    observed.metadata.manifest.endCursor = 10; observed.metadata.manifest.manifestDigest = snapshotManifestHash(observed.metadata);
    expect(f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...observed } })).toEqual(original);
    const document = f.records[1]!;
    if (document.payload.kind !== "document") throw new Error("fixture");
    const value = document.payload.value;
    const unrelated = Array.from({ length: 3 }, (_, index) => HindsightLogicalSnapshotRecordSchema.parse({
      objectKind: "document", objectId: `unrelated-${index}`, objectRevision: 4 + index,
      payload: { kind: "document", value: { ...value, documentId: `unrelated-${index}` } },
    }));
    const page = parsedJournal([document, ...unrelated, ...f.records.slice(2)], 2);
    expect(f.repo.confirm({ ...f.confirmation, observation: { kind: "journal", page } })).toEqual(original);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(3);
    expect(original.every((binding) => binding.observationKind === "snapshot" && binding.observationId === snapshotId)).toBe(true);
  });

  it("refuses a changed evidence interpretation or a different operation even when the exact object stays unchanged", () => {
    const f = fixture(); const original = f.repo.confirm(f.confirmation);
    const source = structuredClone(f.prepared.source); source.metadata.number = "1";
    const alternative = prepareHindsightSource({ source, records: f.prepared.units.map(({ record }) => record) });
    expect(alternative.nativeItem).toEqual(f.prepared.nativeItem); f.repo.savePrepared(alternative);
    expect(() => f.repo.confirm({ ...f.confirmation, evidenceId: alternative.evidenceId })).toThrow("HINDSIGHT_SOURCE_BINDING_CONFLICT");
    const other = structuredClone(f.confirmation); const otherId = "77777777-7777-4777-8777-777777777777";
    other.request.operation_id = otherId; other.result.operation_id = otherId;
    other.result.request_hash = nativeProofHash(nativeRetainRequestFields(nativeBank, other.request));
    other.result.result_hash = nativeProofHash(nativeResultFields(other.result));
    other.result.native_receipt_hash = nativeProofHash(nativeReceiptFields(other.result));
    for (const page of other.resultPages) {
      page.operation_id = otherId; page.result_hash = other.result.result_hash;
      page.page_sha256 = nativeProofHash(["taki-native-page.v1", page.result_hash, page.page_number, page.references.map(nativeReferenceFields)]);
    }
    expect(() => f.repo.confirm(other)).toThrow("HINDSIGHT_SOURCE_BINDING_CONFLICT");
    expect(f.repo.confirm(f.confirmation)).toEqual(original);
  });

  it("requires real verified B3 Bank ownership when Local and native Bank IDs differ", () => {
    const f = fixture();
    f.db.prepare("UPDATE hindsight_bank_setup SET status='pending'").run();
    expect(() => f.repo.confirm(f.confirmation)).toThrow("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
    seedNativeBank(f.db);
    const wrong = structuredClone(f.confirmation); wrong.result.bank_id = "global";
    expect(() => f.repo.confirm(wrong)).toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(0);
  });

  it("validates native result pages and a real parsed document revision rather than inventing it from a receipt", () => {
    const f = fixture();
    for (const mutate of [
      (value: HindsightSourceConfirmation) => { value.request.items[0]!.content = "changed request"; },
      (value: HindsightSourceConfirmation) => { value.result.request_hash = "0".repeat(64); },
      (value: HindsightSourceConfirmation) => { value.result.native_receipt_hash = "0".repeat(64); },
      (value: HindsightSourceConfirmation) => { value.resultPages[0]!.references[0]!.revision += 1; },
      (value: HindsightSourceConfirmation) => { value.resultPages = []; },
    ]) {
      const wrong = structuredClone(f.confirmation); mutate(wrong);
      expect(() => f.repo.confirm(wrong)).toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    }
    const missing = snapshot(f.records.filter((record) => record.objectKind !== "document"));
    expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...missing } }))
      .toThrow("HINDSIGHT_SOURCE_NATIVE_OBJECT_MISSING");
    const stale = structuredClone(f.records); stale[1]!.objectRevision = 9;
    expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...snapshot(stale) } }))
      .toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(0);
  });

  it.each(["revision", "payload", "bank", "lineage", "generation"] as const)("refuses stale %s projections without an older binding fallback", (kind) => {
    const f = fixture(); f.repo.confirm(f.confirmation);
    const projection = createHindsightSourceEvidenceProjection({ repo: f.repo, ...scope });
    const record = structuredClone(f.records[2]!); const call = context(projection);
    if (record.payload.kind !== "memory_unit") throw new Error("fixture");
    if (kind === "revision") { record.objectRevision += 1; record.payload.value.revision += 1; }
    if (kind === "payload") record.payload.value.text = "new native text";
    if (kind === "bank") record.payload.value.bankId = "foreign";
    if (kind === "lineage") call.providerLineageId = snapshotId;
    if (kind === "generation") call.bankGeneration = snapshotId;
    expect(() => projectHindsightReplicaRecord(record, call)).toThrow(/HINDSIGHT_(SOURCE|REPLICA)_/);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(3);
  });

  it("refuses otherwise well-formed snapshots with a wrong native namespace, unit revision, or document hash", () => {
    const f = fixture();
    for (const field of ["bankId", "providerLineage", "bankGeneration"] as const) {
      const captured = structuredClone(f.snapshot); captured.metadata.manifest[field] = snapshotId;
      captured.metadata.manifest.manifestDigest = snapshotManifestHash(captured.metadata);
      expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...captured } }))
        .toThrow(/HINDSIGHT_(SOURCE_BINDING_INVALID|SNAPSHOT_)/);
    }
    for (const field of ["revision", "contentHash"] as const) {
      const records = structuredClone(f.records);
      if (field === "revision") {
        const unit = records[2]!; unit.objectRevision += 1;
        if (unit.payload.kind === "memory_unit") unit.payload.value.revision += 1;
      } else {
        const document = records[1]!;
        if (document.payload.kind === "document") document.payload.value.contentHash = "f".repeat(64);
      }
      expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...snapshot(records) } }))
        .toThrow("HINDSIGHT_SOURCE_BINDING_INVALID");
    }
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(0);
  });

  it("refuses incorrect native metadata/layer evidence and does not overwrite native-owned fields", () => {
    const f = fixture();
    for (const field of ["metadata", "tags"] as const) {
      const records = structuredClone(f.records); const unit = records[2]!;
      if (unit.payload.kind !== "memory_unit") throw new Error("fixture");
      if (field === "metadata") unit.payload.value.metadata = { number: "invented" };
      else unit.payload.value.tags = ["taki-layer:profile", "taki-layer:relationships"];
      expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "snapshot", ...snapshot(records) } }))
        .toThrow(/HINDSIGHT_SOURCE_(BINDING_INVALID|LAYER_MISMATCH)/);
    }
    f.repo.confirm(f.confirmation);
    const projection = createHindsightSourceEvidenceProjection({ repo: f.repo, ...scope });
    const legacyContext = { bankId: nativeBank, authorityEpochId: scope.authorityEpochId, projection };
    expect(() => projectHindsightReplicaRecord(f.records[2]!, legacyContext)).toThrow("HINDSIGHT_SOURCE_PROJECTION_SCOPE_MISMATCH");
  });

  it("confirms against parsed journal data and never restores a tombstoned unit", () => {
    const f = fixture();
    f.records[1]!.objectRevision = 6;
    const journal = parsedJournal(f.records.slice(1), 5);
    f.repo.confirm({ ...f.confirmation, observation: { kind: "journal", page: journal } });
    const projection = createHindsightSourceEvidenceProjection({ repo: f.repo, ...scope });
    const replica = createHindsightReplicaSyncRepo({ db: f.db, projection,
      tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now: () => at });
    const lease = replica.leases.acquire({ bankId: nativeBank, ownerId: "offline", durationMs: 60_000 });
    const checkpoint = replica.seedVerifiedSnapshot({ ...snapshot(f.records), authorityEpochId: scope.authorityEpochId,
      expectedProviderLineageId: lineage, expectedBankGeneration: generation, expectedCheckpoint: null, lease });
    const tombstone = normalizeHindsightJournal(HindsightJournalWireSchema.parse({ provider_lineage: lineage, bank_generation: generation,
      from_cursor: 8, next_cursor: 9, current_cursor: 9, minimum_available_cursor: 0, has_more: false,
      changes: [{ cursor: 9, provider_lineage: lineage, bank_generation: generation, batch_id: batchId,
        batch_index: 0, batch_size: 1, object_kind: "memory_unit", object_id: nativeIds[1], object_revision: 9,
        operation: "tombstone", payload: null, recorded_at: at }] }), nativeBank);
    const page = projectHindsightJournal(tombstone, context(projection));
    replica.applyPage({ page, expectedCheckpoint: checkpoint, lease });
    expect(replica.record({ bankId: nativeBank, memoryId: nativeIds[1]! })).toBeUndefined();
    expect(replica.logicalRecord({ bankId: nativeBank, objectKind: "memory_unit", objectId: nativeIds[1]!, includeTombstones: true })?.operation)
      .toBe("tombstone");
    const missing = parsedJournal(f.records.slice(1), 5);
    missing.changes[2] = { ...missing.changes[2]!, operation: "tombstone", payload: null };
    expect(() => f.repo.confirm({ ...f.confirmation, observation: { kind: "journal", page: missing } }))
      .toThrow("HINDSIGHT_SOURCE_NATIVE_OBJECT_MISSING");
  });

  it("enforces immutable source/unit/binding rows and atomic evidence writes", () => {
    const f = fixture(); f.repo.confirm(f.confirmation);
    for (const table of ["hindsight_source_evidence", "hindsight_source_unit_evidence", "hindsight_source_object_bindings"]) {
      expect(() => f.db.exec(`DELETE FROM ${table}`)).toThrow(/IMMUTABLE/);
      const column = table === "hindsight_source_object_bindings" ? "binding_id" : "evidence_id";
      expect(() => f.db.exec(`UPDATE ${table} SET ${column}=${column}`)).toThrow(/IMMUTABLE/);
      expect(() => f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow(/IMMUTABLE/);
    }
    const { db } = isolatedDatabase();
    db.exec("CREATE TRIGGER fail_unit BEFORE INSERT ON hindsight_source_unit_evidence BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    expect(() => createHindsightSourceEvidenceRepo(db).savePrepared(f.prepared)).toThrow("injected failure");
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(0);
  });

  it("rolls back document binding when a unit binding write fails and rejects altered prepared bytes", () => {
    const f = fixture();
    f.db.exec("CREATE TRIGGER fail_binding BEFORE INSERT ON hindsight_source_object_bindings WHEN NEW.object_kind='memory_unit' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    expect(() => f.repo.confirm(f.confirmation)).toThrow("HINDSIGHT_SOURCE_BINDING_CONFLICT");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(0);
    expect(f.repo.getPrepared(f.prepared.evidenceId)).toEqual(f.prepared);
    const changed = structuredClone(f.prepared); changed.source.metadata.number = "changed";
    expect(() => f.repo.savePrepared(changed)).toThrow("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_source_evidence").get()?.n).toBe(1);
  });

  it("fails closed after actual evidence loss and does not change the preserved bindings", () => {
    const f = fixture(); f.repo.confirm(f.confirmation);
    f.db.exec("PRAGMA foreign_keys=OFF");
    f.db.exec("DROP TRIGGER hindsight_source_evidence_no_delete");
    f.db.prepare("DELETE FROM hindsight_source_evidence WHERE evidence_id=:id").run({ id: f.prepared.evidenceId });
    f.db.exec("PRAGMA foreign_keys=ON");
    f.db.close(); const db = open(f.path);
    const projection = createHindsightSourceEvidenceProjection({ repo: createHindsightSourceEvidenceRepo(db), ...scope });
    expect(() => projectHindsightReplicaRecord(f.records[2]!, context(projection))).toThrow("HINDSIGHT_SOURCE_EVIDENCE_MISSING");
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_source_object_bindings").get()?.n).toBe(3);
  });
});

function fixture() {
  const { db, path } = isolatedDatabase(); const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(at);
  authority.createBank({ authorityEpochId: epoch.epochId, bankId: "global", scope: { kind: "global", characterId: null },
    name: "Local Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: at });
  const source = localSource(epoch.epochId); const local = createCanonicalMemoryRepo(db);
  const requested = [localRecord(source, "one"), localRecord(source, "two")];
  local.retain({ epochId: epoch.epochId, bankId: "global", requestId: "source", requestHash: "a".repeat(64), source,
    units: requested.map((record) => ({ unit: record.unit, policy: record.policy, searchTerms: record.unit.text })) });
  const records = requested.map(({ unit }) => local.record(epoch.epochId, "global", unit.memoryId)!);
  const prepared = prepareHindsightSource({ source, records }); const repo = createHindsightSourceEvidenceRepo(db);
  repo.savePrepared(prepared); seedNativeBank(db);
  const native = nativeRecords(prepared); const captured = snapshot(native);
  const confirmation = nativeConfirmation(prepared, native);
  return { db, path, prepared, repo, records: native, snapshot: captured, confirmation };
}

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "taki-source-evidence-")); roots.push(directory);
  const path = join(directory, "core.db"); return { db: open(path), path };
}
function open(path: string): Database {
  const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db); return db;
}
function context(projection: ReturnType<typeof createHindsightSourceEvidenceProjection>) {
  return { projection, bankId: nativeBank, authorityEpochId: scope.authorityEpochId, providerLineageId: lineage, bankGeneration: generation };
}
function seedNativeBank(db: Database): void {
  createHindsightBankSetupRepo(db).upsert({ scope: "global", canonicalIdentity: "global", externalBankId: nativeBank,
    templateRevision: "1", templateDigest: "a".repeat(64), status: "verified", operationIds: [], lastVerifiedAt: at, lastError: null });
}

function localSource(epoch: string): CanonicalMemorySource {
  return CanonicalMemorySourceSchema.parse({ authorityEpochId: epoch, bankId: "global", documentId: "doc",
    contentHash: "declared-legacy-representation", retainedText: "Sanitized retained source 雪😀\r\né", context: null,
    metadata: { number: 1, string: "1", nested: { field_name: [null, true, 1.5, "雪😀"] } }, tags: ["source-tag"], observationScopes: "shared",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: 1, timelineToSeq: 2,
      capturedAt: at, sanitized: true, sourceRef: "retained-source" }, revision: 2, createdAt: at, updatedAt: at });
}

function localRecord(source: CanonicalMemorySource, memoryId: string): CanonicalMemoryRecord {
  const layer = memoryId === "two" ? "relationships" : "profile";
  return CanonicalMemoryRecordSchema.parse({
    unit: { authorityEpochId: source.authorityEpochId, bankId: source.bankId, documentId: source.documentId, memoryId, chunkId: null,
      text: "Original Local unit", context: "", factType: "world", state: "valid", revision: 1, tags: [`taki-layer:${layer}`],
      metadata: { number: memoryId === "two" ? "1" : 1, unitOnly: memoryId, nested: { items: [false, "unit 雪😀"] } },
      entities: ["Local entity"], sourceMemoryIds: [], observationScopes: "shared", eventDate: at, occurredStart: null,
      occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null,
      consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 },
    policy: { authorityEpochId: source.authorityEpochId, bankId: source.bankId, memoryId, layerId: layer, importance: 6,
      visibility: "retrieved", disclosure: "Original disclosure", origin: "self", emotionalWeight: 0.5,
      retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at }, provenance: source.provenance });
}

function nativeRecords(prepared: HindsightPreparedSource): HindsightLogicalSnapshotRecord[] {
  const bank = HindsightLogicalSnapshotRecordSchema.parse({ objectKind: "bank", objectId: nativeBank, objectRevision: 1,
    payload: { kind: "bank", value: { bankId: nativeBank, name: "Native Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      mission: "Native mission", config: { native: true }, createdAt: at, updatedAt: at } } });
  const document = HindsightLogicalSnapshotRecordSchema.parse({ objectKind: "document", objectId: "doc", objectRevision: 3,
    payload: { kind: "document", value: { bankId: nativeBank, documentId: "doc", contentHash: prepared.retainedTextHash,
      metadata: prepared.nativeItem?.metadata, tags: ["native-document-tag"], observationScopes: "shared", createdAt: at, updatedAt: later } } });
  const units = prepared.units.map(({ record }, index) => HindsightLogicalSnapshotRecordSchema.parse({
    objectKind: "memory_unit", objectId: nativeIds[index], objectRevision: 7 + index,
    payload: { kind: "memory_unit", value: { bankId: nativeBank, memoryId: nativeIds[index], documentId: "doc", chunkId: `native-chunk-${index}`,
      text: `Native current text ${index}`, context: `native context ${index}`, factType: "experience", state: index === 0 ? "invalidated" : "valid",
      revision: 7 + index, tags: ["native-tag", `taki-layer:${record.policy.layerId}`], metadata: encodeHindsightSourceMetadataV1(record.unit.metadata),
      entities: ["Native entity"], sourceMemoryIds: index === 0 ? [] : [nativeIds[0]], observationScopes: "shared",
      eventDate: later, occurredStart: later, occurredEnd: later, mentionedAt: later, createdAt: at, updatedAt: later,
      editedAt: later, consolidatedAt: later, consolidationFailedAt: null, invalidationReason: index === 0 ? "native invalidation" : null,
      invalidatedAt: index === 0 ? later : null, proofCount: 3 } } }));
  return [bank, document, ...units];
}

function snapshot(records: HindsightLogicalSnapshotRecord[]) {
  const wire = records.map(wireRecord); const hash = canonicalPayloadHash(wire);
  const page = normalizeSnapshotPage(HindsightSnapshotPageWireSchema.parse({ snapshot_id: snapshotId, page_number: 0,
    total_pages: 1, record_count: wire.length, content_sha256: hash, records: wire }));
  const kinds = (kind: string) => records.filter((record) => record.objectKind === kind).length;
  const states = (state: string) => records.filter((record) => record.payload.kind === "memory_unit" && record.payload.value.state === state).length;
  const metadata = normalizeSnapshotMetadata(HindsightSnapshotMetadataWireSchema.parse({ snapshot_id: snapshotId, created_at: at, expires_at: later,
    manifest: { schema_version: 1, bank_id: nativeBank, provider_lineage: lineage, bank_generation: generation,
      end_cursor: 8, page_size: 100, total_pages: 1, total_records: records.length,
      counts: { bank: kinds("bank"), document: kinds("document"), memory_unit: { valid: states("valid"), invalidated: states("invalidated") },
        mental_model: 0, directive: 0, total: records.length }, page_hashes: [hash], sha256: "a".repeat(64) } }));
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  return { metadata, pages: [page] };
}

function nativeConfirmation(prepared: HindsightPreparedSource, records: HindsightLogicalSnapshotRecord[]): HindsightSourceConfirmation {
  const identity = { contract_version: "1.0.0" as const, provider_lineage: lineage, bank_generation: generation, operation_id: operationId };
  const request = HindsightTrackedRetainRequestSchema.parse({ ...identity, items: [prepared.nativeItem] });
  const references = records.filter((record) => record.payload.kind === "memory_unit").map((record, ordinal) => ({
    ordinal, input_index: 0, document_id: "doc", memory_id: record.objectId, revision: record.objectRevision,
    state: record.payload.kind === "memory_unit" ? record.payload.value.state : "valid" as const }));
  const digest = createHash("sha256").update("taki-native-references.v1\n");
  for (const reference of references) digest.update(`${nativeProofJson(nativeReferenceFields(reference))}\n`);
  const result = HindsightNativeResultSchema.parse({ ...identity, bank_id: nativeBank, operation_kind: "retain",
    request_hash: nativeProofHash(nativeRetainRequestFields(nativeBank, request)), native_outcome: "applied", native_through_cursor: 8,
    inputs: [{ input_index: 0, document_id: "doc", update_mode: "replace", prepared_input_hash: "b".repeat(64),
      document_hash: prepared.retainedTextHash, created_count: references.length, full_result_count: references.length, first_ordinal: 0 }],
    mutation: null, manifest: { total_records: references.length, page_size: 128, total_pages: 1, references_sha256: digest.digest("hex") },
    result_hash: "0".repeat(64), native_receipt_hash: "0".repeat(64) });
  result.result_hash = nativeProofHash(nativeResultFields(result)); result.native_receipt_hash = nativeProofHash(nativeReceiptFields(result));
  const page = HindsightNativeResultPageSchema.parse({ ...identity, bank_id: nativeBank, operation_kind: "retain", result_hash: result.result_hash,
    page_number: 0, first_ordinal: 0, references,
    page_sha256: nativeProofHash(["taki-native-page.v1", result.result_hash, 0, references.map(nativeReferenceFields)]) });
  return { evidenceId: prepared.evidenceId, request, result, resultPages: [page], observation: { kind: "snapshot", ...snapshot(records) },
    unitAssociations: prepared.units.map(({ record }, index) => ({ sourceMemoryId: record.unit.memoryId, nativeMemoryId: nativeIds[index]! })), confirmedAt: at };
}

function parsedJournal(records: HindsightLogicalSnapshotRecord[], predecessorCursor: number) {
  const cursor = predecessorCursor + records.length;
  return normalizeHindsightJournal(HindsightJournalWireSchema.parse({ provider_lineage: lineage, bank_generation: generation,
    from_cursor: predecessorCursor, next_cursor: cursor, current_cursor: cursor, minimum_available_cursor: 0, has_more: false,
    changes: records.map((record, index) => ({ ...wireRecord(record), cursor: predecessorCursor + index + 1,
      provider_lineage: lineage, bank_generation: generation, batch_id: batchId, batch_index: index, batch_size: records.length,
      operation: "upsert", recorded_at: at })) }), nativeBank);
}

function wireRecord(record: HindsightLogicalSnapshotRecord) {
  return { object_kind: record.objectKind, object_id: record.objectId, object_revision: record.objectRevision,
    payload: Object.fromEntries(Object.entries(record.payload.value).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value,
    ])) };
}
