import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { evidenceFromBundle } from "../../testing/memory-transition-candidate-fixtures.ts";
import { applicationTestNative, applicationTestBankPayload } from "../../testing/hindsight-application-fixtures.ts";
import { captureTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta } from "../../db/memory-transition-delta-repo.ts";
import { signHindsightTransitionAcquire, hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import { HindsightTransitionUnusedScopeSchema } from "@taki/shared";
import { createCanonicalMemoryMaintenanceRepo } from "../../db/canonical-memory-maintenance-repo.ts";
import { readCanonicalSourceSet } from "../../db/canonical-memory-source-references.ts";
import { compileTransitionUnusedDelta } from "./transition-unused-delta.ts";

function unusedTarget(fixture: ReturnType<typeof createTransitionReentryFixture>) {
  const scope = { bankId: "new-native-bank", namespace: { application_id: "taki" as const,
    provider_lineage: fixture.intent.request.expected.targetLineageId, bank_generation: randomUUID() } };
  const evidence = evidenceFromBundle({ transitionId: fixture.intent.transitionId, scope, artifacts: [],
    native: [applicationTestNative({ scope, kind: "bank", payload: applicationTestBankPayload(scope), cursor: 1 })] });
  const proof = HindsightTransitionUnusedScopeSchema.parse({ bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage,
    bank_generation: scope.namespace.bank_generation, creation_id: randomUUID(), native_cursor: 1,
    template_hash: "a".repeat(64), history_hash: "b".repeat(64), baseline_hash: evidence.status.proof!.baseline_hash, proof_hash: "0".repeat(64) });
  proof.proof_hash = hindsightTransitionHash(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")));
  const request = signHindsightTransitionAcquire(scope.bankId, { ...evidence.status.request, direction: "reenter-hindsight", unused_scope: proof });
  return { target: { ...evidence.status, request, proof: null, phase: "fenced" as const },
    inventory: { nativeSnapshot: evidence.status.proof!.native_snapshot, nativePages: evidence.nativePages,
      applicationManifest: evidence.status.proof!.application_snapshot, applicationPages: evidence.applicationPages, bodies: evidence.bodies } };
}

describe("W3 genuine unused-scope consumer branch", () => {
  it("preserves ordered and repeated Sources from a real Local copy into a new scope", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionReentryFixture(db, { newScope: true, aliases: true });
      const maintenance = createCanonicalMemoryMaintenanceRepo(db, fixture.local.tokenizer);
      const identity = { epochId: fixture.candidate.targetEpochId, bankId: "global", memoryId: "logical-unit", characterId: "new-character" };
      const copied = maintenance.copyToBank({ ...identity, expectedRevision: maintenance.record(identity)!.unit.revision,
        destinationBankId: "new-local-bank", requestId: "copy-to-new-scope", now: "2026-10-01T00:00:01.000Z",
        policy: { layerId: "episodes", visibility: "retrieved", retention: { kind: "permanent" } } });
      const references = readCanonicalSourceSet(db, { ...identity, bankId: "new-local-bank", memoryId: copied.record.unit.memoryId })!.references;
      expect(references.map((ref) => ref.source.retainedText)).toEqual(["", "append fragment one", "append fragment two", "append fragment one"]);
      const capture = captureTransitionLocal(db, fixture.input);
      const { target, inventory } = unusedTarget(fixture);
      const input = { capture, localBankId: "new-local-bank", localLineageId: fixture.intent.request.expected.sourceLineageId, target, inventory };
      const compiled = compileTransitionUnusedDelta(input);
      const memory = compiled.application.find((row) => row.key.artifact_id === copied.record.unit.memoryId)!.body;
      expect(memory?.artifact_kind).toBe("memory");
      if (memory?.artifact_kind !== "memory") throw new Error("missing copied Memory");
      expect(memory.body.source_artifacts).toEqual(references.map((ref) => ({ artifact_kind: "source", artifact_id: ref.documentId })));
      const foreign = structuredClone(capture);
      const set = foreign.state.sourceSets.find((row) => row.bankId === "new-local-bank" && row.memoryId === copied.record.unit.memoryId)!;
      set.references[0]!.intent = "existing";
      set.references[0]!.artifact = fixture.candidate.state.sourceSets.find((row) => row.bankId === "global" && row.memoryId === "logical-unit")!.references[0]!.artifact;
      expect(() => compileTransitionUnusedDelta({ ...input, capture: foreign })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      const prepared = prepareTransitionDelta(db, { ...fixture.input, captureId: capture.captureId, localBankId: "new-local-bank",
        target, retired: null, unusedInventory: inventory });
      expect(prepared.request.application).toEqual(compiled.application);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("requires scope absence from common history and keeps its real baseline kind and IDs on retry", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const fixture = createTransitionReentryFixture(db, { newScope: true });
      const capture = captureTransitionLocal(db, fixture.input);
      const scope = { bankId: "new-native-bank", namespace: { application_id: "taki" as const,
        provider_lineage: fixture.intent.request.expected.targetLineageId, bank_generation: randomUUID() } };
      const evidence = evidenceFromBundle({ transitionId: fixture.intent.transitionId, scope, artifacts: [],
        native: [applicationTestNative({ scope, kind: "bank", payload: applicationTestBankPayload(scope), cursor: 1 })] });
      const proof = HindsightTransitionUnusedScopeSchema.parse({ bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage,
        bank_generation: scope.namespace.bank_generation, creation_id: randomUUID(), native_cursor: 1,
        template_hash: "a".repeat(64), history_hash: "b".repeat(64), baseline_hash: evidence.status.proof!.baseline_hash, proof_hash: "0".repeat(64) });
      proof.proof_hash = hindsightTransitionHash(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")));
      const request = signHindsightTransitionAcquire(scope.bankId, { ...evidence.status.request, direction: "reenter-hindsight", unused_scope: proof });
      const target = { ...evidence.status, request, proof: null, phase: "fenced" as const };
      const unusedInventory = { nativeSnapshot: evidence.status.proof!.native_snapshot, nativePages: evidence.nativePages,
        applicationManifest: evidence.status.proof!.application_snapshot, applicationPages: evidence.applicationPages, bodies: evidence.bodies };
      const input = { ...fixture.input, captureId: capture.captureId, localBankId: "new-local-bank", target, retired: null, unusedInventory };
      const first = prepareTransitionDelta(db, input);
      expect(first.request.baseline_transition_id).toBeNull(); expect(first.request.baseline_proof_hash).toBeNull();
      expect(first.request.unused_scope).toEqual(proof); expect(first.scope.localBankId).toBe("new-local-bank");
      expect(first.request.native).toHaveLength(1); expect(first.request.native[0]?.disposition).toBe("reuse");
      expect(prepareTransitionDelta(db, input)).toEqual(first);
      expect(() => prepareTransitionDelta(db, { ...input, localBankId: "global" })).toThrow();
      expect(first.request.application[0]?.body?.artifact_kind === "bank" && first.request.application[0].body.body.original_bank?.bankId).toBe("new-local-bank");
    } finally { db.close(); }
  });
});
