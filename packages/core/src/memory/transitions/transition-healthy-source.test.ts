import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { readCanonicalSourceAliases } from "../../db/canonical-memory-source-references.ts";
import { readCanonicalSource, upsertCanonicalSource } from "../../db/canonical-memory-maintenance-records.ts";
import { readTransitionSourceUploads } from "../../db/memory-transition-source-upload.ts";
import * as candidateModule from "./transition-healthy-candidate.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("healthy Source upload continuation", () => {
  it("reuses original sealed multipart bytes after reply loss and preserves old Source bodies through the roundtrip", async () => {
    const h = await createHealthyTransitionHarness({ aliases: true });
    try {
      const returned = h.owner.submit(await h.request()); await h.owner.stop(); expect(h.owner.status(returned.operationId).state).toBe("completed");
      const authority = createCanonicalMemoryAuthorityRepo(h.db); const epochId = authority.activeEpoch().epochId;
      const alias = readCanonicalSourceAliases(h.db, epochId)[0]!;
      const identity = { epochId, bankId: alias.bankId, documentId: alias.documentId };
      const source = readCanonicalSource(h.db, identity)!;
      const updated = { ...source, retainedText: "源".repeat(100_000), revision: source.revision + 1 };
      h.db.transaction(() => upsertCanonicalSource(h.db, updated, updated.revision));
      const oldBodies = new Map(h.initial.flatMap((value) => value.bodies).map((body) => [body.ref.body_id, body.base64]));
      const originalSourceBodies = h.initial.flatMap((value) => value.applicationPages.flatMap((page) => page.records))
        .flatMap((row) => row.kind === "artifact" && row.artifact.key.artifact_kind === "source" ? [row.artifact.body_ref.body_id] : []);
      h.remote.fault.sourceSealReply = true;
      const admitted = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      const uploads = readTransitionSourceUploads(h.db, transitionId); expect(uploads).toHaveLength(1);
      expect(uploads[0]!.ref.total_parts).toBe(2);
      const counts = { ...h.remote.sources.calls }; expect(counts.seal).toBe(1); expect(counts.part).toBe(uploads[0]!.ref.total_parts);
      const errors: string[] = []; const prepare = candidateModule.prepareHealthyTransitionCandidate;
      vi.spyOn(candidateModule, "prepareHealthyTransitionCandidate").mockImplementation(async (input) => {
        try { return await prepare(input); } catch (error) { errors.push(error instanceof Error ? error.stack! : String(error)); throw error; }
      });
      h.remote.fault.unavailable = false; h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId, "transition.reenter-hindsight")); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state, errors.join("\n")).toBe("completed");
      expect(h.remote.sources.calls).toEqual({ ...counts, prepare: counts.prepare + 1 });
      expect(readTransitionSourceUploads(h.db, transitionId)).toEqual(uploads);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_source_upload_attempts WHERE transition_id=:id").get({ id: transitionId })?.n).toBe(1);
      const again = h.owner.submit(await h.request()); await h.owner.stop(); expect(h.owner.status(again.operationId).state).toBe("completed");
      expect(readCanonicalSource(h.db, { ...identity, epochId: authority.activeEpoch().epochId })?.retainedText).toBe(updated.retainedText);
      const returnedId = again.producer?.kind === "transition" ? again.producer.transitionId : "";
      const finalBodies = new Map([...h.remote.evidence.values()].filter((value) => value.transitionId === returnedId)
        .flatMap((value) => value.bodies).map((body) => [body.ref.body_id, body.base64]));
      for (const bodyId of originalSourceBodies) expect(finalBodies.get(bodyId)).toBe(oldBodies.get(bodyId));
      for (const value of h.remote.evidence.values()) for (const body of value.bodies) {
        if (oldBodies.has(body.ref.body_id)) expect(body.base64).toBe(oldBodies.get(body.ref.body_id));
      }
      expect(h.remote.calls.delta).toBe(2);
    } finally { await h.close(); }
  // This full 300 KB multipart/recovery/return journey takes about 31 seconds on the owned Windows fixture,
  // including with the pre-repair producer. Keep all original bytes/assertions and a finite per-test budget.
  }, 60_000);
});
