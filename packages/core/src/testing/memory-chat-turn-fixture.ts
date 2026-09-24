/**
 * INPUT:  a composed memory runtime (captureRun + engine), its SQLite handle and a Character id
 * OUTPUT: memoryChatTurn() — one primary turn through the real Harness admission and chat agent with a streaming mock model
 * POS:    core/testing — test-only chat.send-level driver; no WS server, provider or real model
 */
import type { RunMemoryReference } from "@taki/shared";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createConversationStore } from "../agents/conversation-store.ts";
import { createRunRepo } from "../db/run-repo.ts";
import type { Database } from "../db/sqlite.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createRunService } from "../harness/run-service.ts";
import { createRunSnapshotCapture } from "../harness/run-snapshot-capture.ts";
import type { CapturedMemoryRun } from "../memory/canonical-memory-run.ts";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import { streamingMockModel } from "./mock-language-model.ts";

interface TurnRuntime { memory: MemoryEngine; captureRun(characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> }

interface ChatTurn { text: string; memorySnapshot: RunMemoryReference; toolNames: string[]; prompt: string }

export async function memoryChatTurn(runtime: TurnRuntime, db: Database, characterId: string): Promise<ChatTurn> {
  const model = streamingMockModel([`hello ${characterId}`]);
  const runs = createRunService({ repo: createRunRepo(db), provider: "deterministic", modelId: "fixture",
    snapshot: createRunSnapshotCapture({ memory: { captureRun: runtime.captureRun }, provider: "deterministic", modelId: "fixture",
      governance: { level: () => ({ level: "standard", policyGeneration: 1, registryRevision: 1 }) },
      extensions: { runContext: () => ({ tools: {}, instructions: "", snapshot: { runId: "capture", primaryHostId: "core",
        hosts: [], entries: [], collisions: [], budget: { maxEntries: 1, maxDescriptionChars: 1, maxSearchResults: 1, maxCalls: 1 } } }) } }) });
  const admitted = await runs.admit({ triggerRequestId: `trigger-${characterId}`, idempotencyKey: `turn-${characterId}`, characterId,
    initiator: "primary", provenance: { provider: "chat" }, deliveryClass: "class_a", contextMode: "primary" });
  const agent = createChatAgent({ model, memory: runtime.memory, store: createConversationStore({ repo: createTimelineRepo(db) }) });
  if (!runs.start(admitted.run.runId, admitted.attempt.attemptId)) throw new Error("fixture Run did not start");
  let text = "";
  for await (const delta of agent.stream({ characterId, message: "hi" }, {
    runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, runContext: runs.context(admitted.run.runId)!,
  })) text += delta;
  runs.settle(admitted.run.runId, admitted.attempt.attemptId, "completed");
  const call = model.doStreamCalls[0]!;
  return { text, memorySnapshot: admitted.snapshot.memory, toolNames: (call.tools ?? []).map((tool) => tool.name),
    prompt: JSON.stringify(call.prompt) };
}
