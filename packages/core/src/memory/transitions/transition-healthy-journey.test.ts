import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { addHealthyUnusedBank } from "../../testing/memory-transition-healthy-journey-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemoryRepo, stableRequestHash } from "../../db/canonical-memory-repo.ts";
import { readCanonicalSourceSet } from "../../db/canonical-memory-source-references.ts";
import { readTransitionPreparation } from "../../db/memory-transition-delta-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import { transitionSemanticHash } from "./transition-local-projection.ts";
import * as candidateModule from "./transition-healthy-candidate.ts";

const candidateErrors: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); candidateErrors.length = 0;
  const prepare = candidateModule.prepareHealthyTransitionCandidate;
  vi.spyOn(candidateModule, "prepareHealthyTransitionCandidate").mockImplementation(async (input) => {
    try { return await prepare(input); } catch (error) { candidateErrors.push(error instanceof Error ? error.stack! : String(error)); throw error; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

type Harness = Awaited<ReturnType<typeof createHealthyTransitionHarness>>;
async function complete(h: Harness, kind: "transition.return-local" | "transition.reenter-hindsight") {
  const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
  expect(h.owner.status(operation.operationId), candidateErrors.join("\n") || JSON.stringify(h.records.slice(-3))).toMatchObject({ state: "completed" });
  return operation;
}

describe("complete healthy journey with actual Local changes", () => {
  it("preserves actual expired-activity deletion and immutable retirement evidence on reentry", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      await complete(h, "transition.return-local");
      const authority = createCanonicalMemoryAuthorityRepo(h.db); const maintenance = createCanonicalMemoryMaintenanceRepo(h.db);
      const epochId = authority.activeEpoch().epochId;
      const record = maintenance.list({ epochId, characterId: null }).find((row) => row.unit.bankId === "bank")!;
      const identity = { epochId, bankId: "bank", memoryId: record.unit.memoryId, characterId: null };
      // Seed the prior day's explicit activity policy through its writer; expiry itself uses the current clock.
      maintenance.policyEdit({ ...identity, expectedRevision: record.unit.revision, requestId: "expired-policy",
        now: "2026-09-29T00:00:00.000Z", patch: { layerId: "activity", retention: { kind: "rolling-window", days: 1 } } });
      maintenance.hardDeleteRolling({ ...identity, expectedRevision: maintenance.record(identity)!.unit.revision,
        requestId: "expired-delete", now: W3_AT });
      const receipt = h.db.prepare("SELECT result_json FROM canonical_memory_operation_receipts WHERE request_id='expired-delete'").get();
      await complete(h, "transition.reenter-hindsight"); await complete(h, "transition.return-local");
      expect(maintenance.record({ ...identity, epochId: authority.activeEpoch().epochId })).toBeUndefined();
      await complete(h, "transition.reenter-hindsight"); await complete(h, "transition.return-local");
      expect(maintenance.record({ ...identity, epochId: authority.activeEpoch().epochId })).toBeUndefined();
      expect(h.db.prepare("SELECT result_json FROM canonical_memory_operation_receipts WHERE request_id='expired-delete'").get()).toEqual(receipt);
      expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await h.close(); }
  }, 45_000);

  it("preserves a new Character copy, repeated Source versions, reinforcement and empty Bank over reentry and return", async () => {
    const h = await createHealthyTransitionHarness({ aliases: true });
    try {
      await complete(h, "transition.return-local");
      const authority = createCanonicalMemoryAuthorityRepo(h.db); const maintenance = createCanonicalMemoryMaintenanceRepo(h.db);
      const epochId = authority.activeEpoch().epochId;
      const origin = { epochId, bankId: "bank", memoryId: "journey-unit", characterId: "new-character" };
      const originalRefs = readCanonicalSourceSet(h.db, origin)!.references;
      expect(originalRefs.map((ref) => ref.source.retainedText)).toEqual([h.local.source.retainedText, "append fragment one", "append fragment two", "append fragment one"]);
      const bank = addHealthyUnusedBank(h, "new-character"); const empty = addHealthyUnusedBank(h, "empty-character");
      const copied = maintenance.copyToBank({ ...origin, expectedRevision: maintenance.record(origin)!.unit.revision,
        destinationBankId: bank.bankId, requestId: "journey-copy", now: W3_AT,
        policy: { layerId: "episodes", visibility: "retrieved", retention: { kind: "permanent" } } });
      const identity = { epochId, bankId: bank.bankId, memoryId: copied.record.unit.memoryId, characterId: "new-character" };
      const copiedRefs = readCanonicalSourceSet(h.db, identity)!.references;
      expect(copiedRefs.map((ref) => ref.source.retainedText)).toEqual(originalRefs.map((ref) => ref.source.retainedText));
      expect(copiedRefs[1]!.documentId).toBe(copiedRefs[3]!.documentId);
      const source = { ...copiedRefs[0]!.source, documentId: "reinforced-source", retainedText: "New reinforcement evidence",
        metadata: { number: 1, string: "1", nested: [null, false] }, contentHash: null, revision: 1,
        provenance: { ...copiedRefs[0]!.source.provenance, origin: "auto-gate" as const } };
      maintenance.ingest({ epochId, bankId: identity.bankId, characterId: identity.characterId,
        requestId: "journey-reinforcement", now: W3_AT, source, units: [],
        duplicates: [{ memoryId: identity.memoryId, expectedRevision: copied.record.unit.revision, importance: 8 }] });
      const before = maintenance.record(identity)!;
      const beforeEvidence = maintenance.evidenceSources(identity);
      expect(beforeEvidence.some((row) => row.retainedText === source.retainedText)).toBe(true);
      await complete(h, "transition.reenter-hindsight");
      const preparations = h.db.prepare("SELECT id FROM memory_transition_preparations").all().map((row) => readTransitionPreparation(h.db, String(row.id)));
      expect(preparations.filter((row) => row.request.unused_scope)).toHaveLength(2);
      expect(preparations.find((row) => row.scope.localBankId === empty.bankId)!.request.native).toHaveLength(1);
      await complete(h, "transition.return-local");
      const finalIdentity = { ...identity, epochId: authority.activeEpoch().epochId };
      expect(transitionSemanticHash(maintenance.record(finalIdentity)!)).toBe(transitionSemanticHash(before));
      const finalRefs = readCanonicalSourceSet(h.db, finalIdentity)!.references;
      expect(finalRefs.slice(0, 4).map((ref) => ref.source.retainedText)).toEqual(copiedRefs.map((ref) => ref.source.retainedText));
      expect(finalRefs[1]!.artifact).toEqual(finalRefs[3]!.artifact);
      expect(maintenance.evidenceSources(finalIdentity).map(transitionSemanticHash).sort()).toEqual(beforeEvidence.map(transitionSemanticHash).sort());
      expect(authority.listBanks(finalIdentity.epochId)).toHaveLength(4);
      expect(maintenance.list({ epochId: finalIdentity.epochId, characterId: "empty-character" }).filter((row) => row.unit.bankId === empty.bankId)).toEqual([]);
      expect(h.remote.calls).toMatchObject({ acquire: 10, verify: 10, resolve: 10, delta: 4 });
      expect(h.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { await h.close(); }
  }, 45_000);

  it("preserves edits and invalidation, then restoration through a second complete cycle", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      await complete(h, "transition.return-local");
      const authority = createCanonicalMemoryAuthorityRepo(h.db); const maintenance = createCanonicalMemoryMaintenanceRepo(h.db);
      const repo = createCanonicalMemoryRepo(h.db);
      const epochId = authority.activeEpoch().epochId;
      const memoryId = maintenance.list({ epochId, characterId: null }).find((row) => row.unit.bankId === "bank")!.unit.memoryId;
      const identity = { epochId, bankId: "bank", memoryId, characterId: null };
      const blocks = createStructuredMemoryBlockRepo(h.db);
      const globalScope = { kind: "global" as const, characterId: null };
      const characterScope = { kind: "character" as const, characterId: "taki" };
      const editedBlocks = [
        blocks.replace({ blockId: "user-card", scope: globalScope, content: "Updated user-authored Global Block",
          actor: "user", expectedEpochId: epochId, expectedRevision: blocks.read("user-card", globalScope)?.revision ?? 0, now: W3_AT }),
        blocks.replace({ blockId: "memory-index", scope: characterScope, content: "Updated Character memory index",
          actor: "background", expectedEpochId: epochId, expectedRevision: blocks.read("memory-index", characterScope)?.revision ?? 0, now: W3_AT }),
      ];
      const edit = { ...identity, expectedRevision: maintenance.record(identity)!.unit.revision, requestId: "journey-edit", now: W3_AT,
        searchTerms: "edited memory", patch: { text: "Edited current Local memory", context: "Current context" } };
      repo.edit({ ...edit, requestHash: stableRequestHash(edit) });
      maintenance.policyEdit({ ...identity, expectedRevision: maintenance.record(identity)!.unit.revision,
        requestId: "journey-policy", now: W3_AT, patch: { importance: 9, visibility: "hidden" } });
      maintenance.invalidate({ ...identity, expectedRevision: maintenance.record(identity)!.unit.revision,
        requestId: "journey-invalidate", now: W3_AT, reason: "explicit Local invalidation" });
      const invalidated = maintenance.record(identity)!;
      await complete(h, "transition.reenter-hindsight"); await complete(h, "transition.return-local");
      const restoredIdentity = { ...identity, epochId: authority.activeEpoch().epochId };
      expect(transitionSemanticHash(maintenance.record(restoredIdentity)!)).toBe(transitionSemanticHash(invalidated));
      for (const block of editedBlocks) expect(blocks.read(block.blockId, block.scope)).toEqual(block);
      maintenance.restore({ ...restoredIdentity, expectedRevision: maintenance.record(restoredIdentity)!.unit.revision,
        requestId: "journey-restore", now: W3_AT });
      const restored = maintenance.record(restoredIdentity)!;
      await complete(h, "transition.reenter-hindsight"); await complete(h, "transition.return-local");
      expect(transitionSemanticHash(maintenance.record({ ...identity, epochId: authority.activeEpoch().epochId })!)).toBe(transitionSemanticHash(restored));
      for (const block of editedBlocks) expect(blocks.read(block.blockId, block.scope)).toEqual(block);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(5);
      expect(h.remote.calls.delta).toBe(4);
    } finally { await h.close(); }
  }, 45_000);
});
