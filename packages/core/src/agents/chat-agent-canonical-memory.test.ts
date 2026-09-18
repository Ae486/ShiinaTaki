import { describe, expect, it, vi } from "vitest";
import type { RetainRequest } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createRunRepo } from "../db/run-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createRunSnapshotCapture } from "../harness/run-snapshot-capture.ts";
import { createRunService } from "../harness/run-service.ts";
import { createCanonicalLocalRuntime } from "../memory/canonical-local-runtime.ts";
import { memoryEffectMetadata } from "../memory/canonical-tools/memory-effect-tool.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";

const at = "2026-09-10T00:00:00.000Z";

function retainRequest(bankId: string, content: string, characterId: string | null): RetainRequest {
  return { bankId, content, context: null, timestamp: at, tags: [], entities: [], metadata: {}, observationScopes: null,
    documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "user", origin: "explicit-user", characterId, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: at, sanitized: true, sourceRef: null },
    policy: { layerId: characterId === null ? "profile" : "episodes", importance: 5, visibility: "retrieved",
      disclosure: null, origin: "self", emotionalWeight: null, policyVersion: 1,
      retention: characterId === null ? { kind: "permanent" } : { kind: "importance-decay", archiveBelowImportance: 4, afterDays: 90 } } };
}

describe("Canonical Local foreground memory wiring", () => {
  it("uses the real Local provider capture through Harness admission and projects recall only into the outgoing turn", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(at);
      const memory = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
      const taki = memory.banks("taki"); const other = memory.banks("other");
      const sources = [retainRequest(taki.global.bankId, "ramen preference stored globally", null),
        retainRequest(taki.character.bankId, "ramen shared experience with Taki", "taki"),
        retainRequest(other.character.bankId, "ramen OTHER_CHARACTER_PRIVATE", "other")];
      for (const [index, request] of sources.entries()) {
        expect(await memory.provider.retain({ requestId: `source-${index}`, authorityEpochId: epoch.epochId, actor: "operator" }, request))
          .toMatchObject({ ok: true, data: { status: "completed" } });
      }
      const conversation = createConversationStore({ repo: createTimelineRepo(db) });
      const model = streamingMockModel(["foreground response"]);
      const runs = createRunService({ repo: createRunRepo(db), provider: "deterministic", modelId: "fixture",
        snapshot: createRunSnapshotCapture({ memory: { captureRun: memory.captureRun }, provider: "deterministic", modelId: "fixture",
          governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) },
          extensions: { runContext: () => ({ tools: {}, instructions: "", snapshot: { runId: "capture", primaryHostId: "core",
            hosts: [], entries: [], collisions: [], budget: { maxEntries: 1, maxDescriptionChars: 1, maxSearchResults: 1, maxCalls: 1 } } }) } }) });
      const admitted = await runs.admit({ triggerRequestId: "trigger", idempotencyKey: "turn", characterId: "taki",
        initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" });
      const context = runs.context(admitted.run.runId)!;
      expect(context.memorySnapshot).toMatchObject({ providerId: "local", providerLineageId: epoch.providerLineageId,
        authorityEpochId: epoch.epochId, capabilities: { vectorRetrieval: "unavailable" } });
      expect(context.memorySnapshot).toEqual(admitted.snapshot.memory);
      expect(memoryEffectMetadata(context.memoryTools!.recall!)?.capabilities).toBe(context.memorySnapshot!.capabilities);
      const fallbackTools = vi.spyOn(memory, "createTools").mockImplementation(() => { throw new Error("unexpected live tool reconstruction"); });
      const fallbackAssembly = vi.spyOn(memory, "assemble").mockImplementation(() => { throw new Error("unexpected live assembly"); });
      const agent = createChatAgent({ model, memory, store: conversation });
      expect(runs.start(admitted.run.runId, admitted.attempt.attemptId)).toBe(true);
      let text = "";
      for await (const delta of agent.stream({ characterId: "taki", message: "ramen" }, {
        runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, runContext: context,
      })) text += delta;
      expect(text).toBe("foreground response");
      const call = model.doStreamCalls[0]!; const prompt = JSON.stringify(call.prompt);
      expect(prompt).toContain("automatic-memory-recall"); expect(prompt).toContain("ramen preference stored globally");
      expect(prompt).toContain("ramen shared experience with Taki"); expect(prompt).not.toContain("OTHER_CHARACTER_PRIVATE");
      expect(JSON.stringify(call.prompt[0])).not.toContain("ramen preference stored globally");
      expect(call.tools?.map((entry) => entry.name).sort()).toEqual(["invalidate_memory", "recall", "restore_memory", "retain", "update_memory"]);
      expect(fallbackTools).not.toHaveBeenCalled(); expect(fallbackAssembly).not.toHaveBeenCalled();
      expect(createConversationStore({ repo: createTimelineRepo(db) }).history("taki"))
        .toEqual([{ role: "user", content: "ramen" }, { role: "assistant", content: "foreground response" }]);
      runs.settle(admitted.run.runId, admitted.attempt.attemptId, "completed");
    } finally { db.close(); }
  });
});
