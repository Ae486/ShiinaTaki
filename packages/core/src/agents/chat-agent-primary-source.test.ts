import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APICallError, tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "../memory/local-memory-provider.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { errorPartThenStreamModel, midStreamErrorModel, scriptedModel, slowStreamingModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createChatAgent } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";

const fixtures: CompanionFixture[] = []; const roots: string[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); for (const root of roots.splice(0)) rmTempDir(root); });
function fresh(disk = false) {
  const root = disk ? mkdtempSync(join(tmpdir(), "taki-chat-source-")) : undefined;
  if (root) roots.push(root);
  const f = createCompanionFixture(root ? { dbPath: join(root, "state.db") } : {}); fixtures.push(f); return f;
}
function capture(f: CompanionFixture) {
  const timeline = createTimelineRepo(f.db); const sources = createPrimaryConversationSourceRepo({ db: f.db, timeline });
  const onAppend = vi.fn();
  const store = createConversationStore({ repo: timeline, onAppend,
    primarySources: { repo: sources, afterCommit: (notify) => f.db.afterCommit(notify) } });
  return { sources, store, timeline, onAppend };
}
async function drain(stream: AsyncIterable<string>) { let result = ""; for await (const delta of stream) result += delta; return result; }
function memoryReference() {
  return createMemoryRunReference({ providerId: "local", contractVersion: 1, capabilities: LOCAL_MEMORY_CAPABILITIES,
    authorityEpochId: "captured-epoch", providerLineageId: "captured-lineage" });
}
function sourceId(f: CompanionFixture) { return String(f.db.prepare("SELECT source_id FROM primary_conversation_sources").get()?.source_id); }

describe("primary Chat source lifecycle", () => {
  it("captures selected Hindsight identity without a Run or provider capability availability", async () => {
    const f = fresh(); const { store, sources } = capture(f);
    const epoch = createCanonicalMemoryAuthorityRepo(f.db).initializeLocalAuthority();
    f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_id='hindsight' WHERE epoch_id=:epoch").run({ epoch: epoch.epochId });
    f.db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id=:epoch,
      activation_transaction_id='activation',provider_lineage_id=:lineage,replica_checkpoint_digest=:digest WHERE singleton=1`)
      .run({ epoch: epoch.epochId, lineage: epoch.providerLineageId, digest: "a".repeat(64) });
    const identity = { providerId: "hindsight", authorityEpochId: epoch.epochId, providerLineageId: epoch.providerLineageId };
    const agent = createChatAgent({ model: scriptedModel([{ kind: "text", deltas: ["actual answer"] }]),
      store, memory: f.memory });
    await drain(agent.stream({ characterId: "taki", message: "hello" }));
    expect(sources.readRetained(sourceId(f)).memory).toEqual(identity);
    expect(sources.listUnbound({ characterId: "taki", memory: identity })).toEqual([sourceId(f)]);
  });

  it("captures admission identity and exact actual tool/response membership, independent of provider callback availability", async () => {
    const f = fresh(true); const { store, sources } = capture(f); const callback = vi.fn(() => { throw new Error("provider offline"); });
    const memory = memoryReference(); const model = scriptedModel([
      { kind: "tool", toolCallId: "call", toolName: "probe", input: {} }, { kind: "text", deltas: ["Actual primary answer"] },
    ]);
    const agent = createChatAgent({ model, store, memory: f.memory, onPrimaryCommitted: callback,
      extraTools: { probe: tool({ inputSchema: z.object({}), execute: async () => {
        store.appendAssistant("taki", "Unrelated autonomous speech"); return { actual: true };
      } }) } });
    await drain(agent.stream({ characterId: "taki", message: "Primary question" },
      { runId: "run", attemptId: "attempt", runContext: { memorySnapshot: memory } }));
    const id = sourceId(f); const source = sources.readRetained(id);
    expect(source).toMatchObject({ runId: "run", memory, throughSeq: 5 });
    expect(source.entries.map((entry) => entry.seq)).toEqual([1, 3, 4, 5]);
    expect(source.entries.map((entry) => entry.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(callback).not.toHaveBeenCalled(); f.reopen();
    expect(capture(f).sources.readRetained(id)).toEqual(source);
  });

  it("retracts a silent cancellation and retains truthful no-Run partial output", async () => {
    const f = fresh(); const { store, sources, timeline } = capture(f);
    const controller = new AbortController(); controller.abort(); const onRetract = vi.fn();
    const cancelled = createChatAgent({ model: slowStreamingModel(["never"], 20), store, memory: f.memory });
    await drain(cancelled.stream({ characterId: "taki", message: "cancel" }, { signal: controller.signal, onRetract }));
    expect(onRetract).toHaveBeenCalledTimes(1); expect(timeline.latestAscending("taki", 20)).toEqual([]);
    expect(f.db.prepare("SELECT state FROM primary_conversation_sources").get()?.state).toBe("retracted");
    const failure = new Error("transport failed");
    const partial = createChatAgent({ model: midStreamErrorModel(["visible partial"], failure), store, memory: f.memory });
    await expect(drain(partial.stream({ characterId: "taki", message: "hello" }))).rejects.toBe(failure);
    const id = String(f.db.prepare("SELECT source_id FROM primary_conversation_sources WHERE state='retained'").get()?.source_id);
    const retained = sources.readRetained(id);
    expect(retained.entries.map((entry) => entry.content)).toEqual(["hello", "visible partial"]);
    expect(retained.runId).toBeUndefined(); expect(retained.memory).toEqual({ providerId: "legacy-markdown" });
  });

  it("keeps one source and captured memory through an Attempt-changing overflow retry", async () => {
    const f = fresh(); const { store, sources } = capture(f); const dispose = vi.fn(); const memory = memoryReference();
    const model = errorPartThenStreamModel(new APICallError({ message: "maximum context length exceeded",
      url: "https://provider.invalid", requestBodyValues: {}, statusCode: 400,
      responseBody: '{"error":{"code":"context_length_exceeded"}}', isRetryable: false }), ["recovered"]);
    const runContext = vi.fn(() => ({ memorySnapshot: memory, dispose }));
    const agent = createChatAgent({ model, store, memory: f.memory, runContext, onOverflow: vi.fn() });
    const turn = { runId: "run", attemptId: "attempt-one", onRetry: () => { turn.attemptId = "attempt-two"; return true; } };
    await expect(drain(agent.stream({ characterId: "taki", message: "hello" }, turn))).resolves.toBe("recovered");
    expect(model.doStreamCalls).toHaveLength(2); expect(runContext).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalledTimes(1);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM primary_conversation_sources").get()?.n).toBe(1);
    expect(sources.readRetained(sourceId(f))).toMatchObject({ memory, runId: "run" });
  });

  it("seals only actual text on iterator close and preserves that exact source after reopen", async () => {
    const f = fresh(true); const { store, sources } = capture(f);
    const maintenance = vi.fn(async () => undefined);
    const agent = createChatAgent({ model: slowStreamingModel(["delivered", "unread"], 10), store, memory: f.memory,
      autoMemory: { onTurnCompleted: maintenance } });
    const iterator = agent.stream({ characterId: "taki", message: "original input" })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe("delivered");
    await iterator.return?.();
    const id = sourceId(f); const retained = sources.readRetained(id);
    expect(retained.entries.map((entry) => entry.content)).toEqual(["original input", "delivered"]);
    expect(maintenance).not.toHaveBeenCalled();
    f.reopen(); const restarted = capture(f);
    expect(restarted.sources.recoverOpen()).toEqual({ retainedSourceIds: [], unresolvedSourceIds: [] });
    expect(restarted.sources.readRetained(id)).toEqual(retained);
  });

  it("retains a silently cancelled input after independent work was accepted without fabricating output", async () => {
    const f = fresh(true); const { store, sources } = capture(f);
    const controller = new AbortController(); controller.abort();
    const onRetract = vi.fn(); const maintenance = vi.fn(async () => undefined);
    const agent = createChatAgent({ model: slowStreamingModel(["never"], 10), store, memory: f.memory,
      autoMemory: { onTurnCompleted: maintenance } });
    await expect(drain(agent.stream({ characterId: "taki", message: "accepted independent task" },
      { signal: controller.signal, independentWorkAccepted: true, onRetract }))).rejects.toBe(controller.signal.reason);
    const id = sourceId(f); const retained = sources.readRetained(id);
    expect(retained.entries.map((entry) => entry.content)).toEqual(["accepted independent task"]);
    expect(onRetract).not.toHaveBeenCalled(); expect(maintenance).not.toHaveBeenCalled();
    f.reopen(); expect(capture(f).sources.readRetained(id)).toEqual(retained);
  });

  it("captures fallback context before initial persistence and disposes it if the initial write fails", async () => {
    const f = fresh(); const { store, timeline } = capture(f); const model = scriptedModel([{ kind: "text", deltas: ["never"] }]);
    const captureFailure = new Error("capture failed");
    const captureFailingAgent = createChatAgent({ model, store, memory: f.memory, runContext: () => { throw captureFailure; } });
    await expect(drain(captureFailingAgent.stream({ characterId: "taki", message: "hello" }))).rejects.toBe(captureFailure);
    expect(timeline.latestAscending("taki", 20)).toEqual([]);
    const dispose = vi.fn(); f.db.exec("CREATE TRIGGER fail_source BEFORE INSERT ON primary_conversation_sources BEGIN SELECT RAISE(ABORT,'source failure'); END");
    const agent = createChatAgent({ model, store, memory: f.memory, runContext: () => ({ dispose }) });
    await expect(drain(agent.stream({ characterId: "taki", message: "hello" }))).rejects.toThrow("source failure");
    expect(dispose).toHaveBeenCalledTimes(1); expect(timeline.latestAscending("taki", 20)).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("reopens a failed response seal as an interrupted actual input with no fabricated output", async () => {
    const f = fresh(true); const { store, timeline, onAppend } = capture(f);
    f.db.exec("CREATE TRIGGER fail_seal BEFORE UPDATE ON primary_conversation_sources BEGIN SELECT RAISE(ABORT,'seal failure'); END");
    const agent = createChatAgent({ model: scriptedModel([{ kind: "text", deltas: ["uncommitted answer"] }]), store, memory: f.memory });
    await expect(drain(agent.stream({ characterId: "taki", message: "hello" }))).rejects.toThrow("seal failure");
    expect(timeline.latestAscending("taki", 20).map((entry) => entry.content)).toEqual(["hello"]);
    expect(onAppend).toHaveBeenCalledTimes(1); const id = sourceId(f);
    f.db.exec("DROP TRIGGER fail_seal"); f.reopen(); const next = capture(f);
    expect(next.sources.recoverOpen()).toEqual({ retainedSourceIds: [id], unresolvedSourceIds: [] });
    expect(next.sources.readRetained(id).entries.map((entry) => entry.content)).toEqual(["hello"]);
  });
});
