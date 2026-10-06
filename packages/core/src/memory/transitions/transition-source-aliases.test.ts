import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../db/canonical-memory-maintenance-repo.ts";
import { readCanonicalSourceSet } from "../../db/canonical-memory-source-references.ts";
import { readCanonicalSource, upsertCanonicalSource } from "../../db/canonical-memory-maintenance-records.ts";
import { captureTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta } from "../../db/memory-transition-delta-repo.ts";
import { readTransitionSourceUploads } from "../../db/memory-transition-source-upload.ts";
import { createCanonicalMemoryRepo } from "../../db/canonical-memory-repo.ts";

function setup(retiredAlias = false, sourceOptions?: NonNullable<Parameters<typeof createTransitionReentryFixture>[1]>["sourceOptions"]) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const fixture = createTransitionReentryFixture(db, { aliases: true, retiredAlias, sourceOptions });
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, fixture.local.tokenizer);
  const identity = { epochId: fixture.candidate.targetEpochId, bankId: "global", memoryId: "logical-unit", characterId: "a" };
  const alias = fixture.candidate.state.sourceAliases.find((row) => row.bankId === "global")!;
  const prepare = () => prepareTransitionDelta(db, { ...fixture.input, captureId: captureTransitionLocal(db, fixture.input).captureId,
    localBankId: "global", ...fixture.targets.find((row) => row.target.bank_id === "native-global")! });
  return { db, fixture, maintenance, identity, alias, prepare };
}
describe("W3 exact Source aliases and historical consumers", () => {
  it("preserves the old physical artifact CAS address without pretending it matches a newer native document version", () => {
    const test = setup(false, { stalePhysical: true });
    try {
      const source = readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.physicalDocumentId })!;
      expect(source.retainedText).toBe("Newer full native document");
      const mapping = test.fixture.candidate.mappings.find((row) => row.kind === "document" && row.localId === source.documentId)!;
      expect(mapping.native.object_revision).toBe(2); expect(mapping.application?.key.artifact_id).toBe("document-logical-unit");
      test.db.transaction(() => upsertCanonicalSource(test.db, { ...source, retainedText: "Local edit of newer physical document", revision: source.revision + 1 }, source.revision + 1));
      const changed = test.prepare().request.application.find((row) => row.key.artifact_id === "document-logical-unit")!;
      expect(changed.expected_artifact).toEqual(mapping.application); expect(changed.body?.artifact_kind).toBe("source");
    } finally { test.db.close(); }
  });
  it.each(["conflictingOriginal", "foreignOriginal"] as const)("refuses %s physical identity instead of choosing an alias", (kind) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try { expect(() => createTransitionReentryFixture(db, { aliases: true, sourceOptions: { [kind]: true } })).toThrow("MEMORY_TRANSITION_PROOF_INVALID"); }
    finally { db.close(); }
  });
  it("updates the existing physical Source artifact after an append alias becomes the document head", () => {
    const test = setup();
    try {
      const source = readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.physicalDocumentId })!;
      const physical = test.fixture.candidate.mappings.find((row) => row.kind === "document" && row.localId === source.documentId)!;
      expect(physical.application?.key.artifact_id).toBe("document-logical-unit");
      expect(source.provenance).toEqual(test.fixture.seed.source.provenance);
      test.db.transaction(() => upsertCanonicalSource(test.db, { ...source, retainedText: "Whole physical document edit",
        revision: source.revision + 1 }, source.revision + 1));
      const prepared = test.prepare();
      const changed = prepared.request.application.find((row) => row.key.artifact_id === "document-logical-unit")!;
      expect(changed.disposition).toBe("upsert"); expect(changed.expected_artifact).toEqual(physical.application);
      expect(changed.body?.artifact_kind).toBe("source"); expect(prepared.request.rows.documents[0]?.original_text).toBe("Whole physical document edit");
      expect(prepared.request.application.find((row) => row.key.artifact_id === test.alias.artifact.key.artifact_id)?.disposition).toBe("reuse");
      expect(readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.documentId })?.retainedText).toBe("append fragment two");
    } finally { test.db.close(); }
  });
  it("uses real retention to retire only an unreferenced alias while a surviving unit keeps its physical document", () => {
    const test = setup();
    try {
      const source = readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.physicalDocumentId })!;
      const made = test.fixture.local.make({ memoryId: "surviving-document-user" });
      const epoch = test.identity.epochId;
      createCanonicalMemoryRepo(test.db).retain({ epochId: epoch, bankId: "global", requestId: "surviving-document-user", requestHash: "a".repeat(64),
        source, unit: { ...made.unit, authorityEpochId: epoch, documentId: source.documentId },
        policy: { ...made.policy, authorityEpochId: epoch }, searchTerms: "surviving" });
      const derived = test.fixture.candidate.state.records.find((row) => row.unit.factType === "observation")!;
      for (const memoryId of [derived.unit.memoryId, test.identity.memoryId]) {
        const current = test.maintenance.record({ ...test.identity, memoryId })!;
        const changed = test.maintenance.policyEdit({ ...test.identity, memoryId, expectedRevision: current.unit.revision,
          requestId: `rolling-${memoryId}`, now: "2026-10-01T00:00:01.000Z",
          patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
        test.maintenance.hardDeleteRolling({ ...test.identity, memoryId, expectedRevision: changed.record.unit.revision,
          requestId: `expired-${memoryId}`, now: "2026-11-01T00:00:00.000Z" });
      }
      expect(readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.documentId })).toBeUndefined();
      expect(readCanonicalSource(test.db, { ...test.identity, documentId: source.documentId })).toEqual({ ...source, revision: source.revision + 1 });
      const prepared = test.prepare();
      expect(prepared.request.application.find((row) => row.key.artifact_id === test.alias.artifact.key.artifact_id)?.disposition).toBe("retire");
      expect(prepared.request.native.find((row) => row.source.source_id === source.documentId)?.disposition).toBe("reuse");
    } finally { test.db.close(); }
  });
  it("preserves physical logical ID plus append fragments and exact ordered repeated historical references", () => {
    const test = setup();
    try {
      expect(test.alias.documentId).not.toBe(test.alias.physicalDocumentId);
      expect(test.alias.physicalDocumentId).toBe("document-logical-unit");
      const refs = readCanonicalSourceSet(test.db, test.identity)!.references;
      expect(refs.map((ref) => ref.source.retainedText)).toEqual(["", "append fragment one", "append fragment two", "append fragment one"]);
      expect(refs.map((ref) => ref.artifact?.revision)).toEqual([1, 1, 2, 1]);
      expect(test.maintenance.evidenceSources(test.identity)).toEqual(refs.map((ref) => ref.source));
      const prepared = test.prepare();
      expect(prepared.request.native.filter((row) => row.source.source_kind === "document")).toHaveLength(1);
      expect(prepared.request.rows.documents).toEqual([]);
      expect(prepared.request.application.find((row) => row.key.artifact_id === "retain:owned-fragment")?.disposition).toBe("reuse");
    } finally { test.db.close(); }
  });
  it("compiles actual alias-only edits through a durable byte upload while native document and unit remain unchanged", () => {
    const test = setup();
    try {
      const source = readCanonicalSource(test.db, { ...test.identity, documentId: test.alias.documentId })!;
      test.db.transaction(() => upsertCanonicalSource(test.db, { ...source, retainedText: "edited Local fragment", metadata: JSON.parse('{"\\u0000":1,"__proto__":{"kept":true}}'),
        revision: source.revision + 1 }, source.revision + 1));
      const prepared = test.prepare(); const upload = readTransitionSourceUploads(test.db, prepared.transitionId);
      expect(upload).toHaveLength(1); expect(test.prepare()).toEqual(prepared);
      expect(prepared.request.rows.documents).toEqual([]); expect(prepared.request.rows.memory_units).toEqual([]);
      expect(prepared.request.application.find((row) => row.key.artifact_id === "retain:owned-fragment")?.body?.artifact_kind).toBe("source_evidence");
      const memory = prepared.request.application.find((row) => row.key.artifact_id === "logical-unit")!.body;
      expect(memory?.artifact_kind).toBe("memory_evidence");
      if (memory?.artifact_kind !== "memory_evidence") throw new Error("memory selector fixture");
      expect(memory.body.source_artifacts.map((row) => row.kind)).toEqual(["existing", "delta", "delta", "delta"]);
      expect(Buffer.from(upload[0]!.base64, "base64").byteLength).toBe(upload[0]!.ref.total_bytes);
    } finally { test.db.close(); }
  });
  it("keeps selected non-tombstoned historical Source revisions readable after the latest alias is retired", () => {
    const test = setup(true);
    try {
      expect(test.alias.retired).toBe(true);
      expect(test.maintenance.evidenceSources(test.identity).map((row) => row.retainedText))
        .toEqual(["", "append fragment one", "append fragment two", "append fragment one"]);
      const prepared = test.prepare();
      const source = prepared.request.application.find((row) => row.key.artifact_id === "retain:owned-fragment")!;
      expect(source.disposition).toBe("reuse"); expect(source.expected_artifact?.revision).toBe(3);
      expect(readCanonicalSourceSet(test.db, test.identity)!.references.map((ref) => ref.artifact?.revision)).toEqual([1, 1, 2, 1]);
    } finally { test.db.close(); }
  });
  it("copies distinct pinned versions as distinct genuine Local Sources while preserving duplicate order and original provenance", () => {
    const test = setup();
    try {
      const before = test.maintenance.record(test.identity)!;
      const result = test.maintenance.copyToBank({ ...test.identity, expectedRevision: before.unit.revision, destinationBankId: "a-bank",
        requestId: "copy-alias-history", now: "2026-10-01T00:00:01.000Z",
        policy: { layerId: "episodes", visibility: "retrieved", retention: { kind: "permanent" } } });
      const copied = readCanonicalSourceSet(test.db, { ...test.identity, bankId: "a-bank", memoryId: result.record.unit.memoryId })!.references;
      expect(copied.map((ref) => ref.source.retainedText)).toEqual(["", "append fragment one", "append fragment two", "append fragment one"]);
      expect(copied[1]!.documentId).toBe(copied[3]!.documentId); expect(copied[1]!.documentId).not.toBe(copied[2]!.documentId);
      expect(copied.every((ref) => ref.artifact === null && ref.intent === "local")).toBe(true);
      expect(result.record.provenance).toEqual(before.provenance);
      expect(test.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { test.db.close(); }
  });
});
