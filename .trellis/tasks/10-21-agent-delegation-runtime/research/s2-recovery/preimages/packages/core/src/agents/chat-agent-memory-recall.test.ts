import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, tool } from "ai";
import { z } from "zod";
import { createChatAgent, type AgentRunContext } from "./chat-agent.ts";
import { createConversationStore } from "./conversation-store.ts";
import type { RequestReductionInput } from "./request-preparation.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { failThenStreamModel, scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { fenceUntrusted } from "./untrusted-fence.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";
import { createAutomaticMemoryRecall } from "../memory/automatic-memory-recall.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { primaryEntryDigest, renderIngestionSource, sanitizeCommittedPrimarySpan,
  type PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
function fresh() { const f = createCompanionFixture(); fixtures.push(f); return f; }
async function drain(stream: AsyncIterable<string>): Promise<string> { let text = ""; for await (const delta of stream) text += delta; return text; }
const fenced = (content: string) => fenceUntrusted({ source: "automatic-memory-recall", content });

describe("ChatAgent automatic memory projection", () => {
  it("injects recall before request measurement, then excludes it from replay, tool records, and ingestion source", async () => {
    const f = fresh();
    const model = scriptedModel([{ kind: "tool", toolCallId: "c1", toolName: "probe", input: {} },
      { kind: "text", deltas: ["first response"] }, { kind: "text", deltas: ["second response"] }]);
    const projections: RequestReductionInput[] = [];
    const committed: PrimaryConversationCommit[] = [];
    const atMaintenance: string[] = [];
    const recall = vi.fn(async ({ query }: { query: string }) => fenced(query === "first user input" ? "RECALL_FIRST_ONLY" : "RECALL_SECOND_ONLY"));
    const context: AgentRunContext = { automaticMemoryRecall: recall, memoryTools: {}, memoryPrompt: "CAPTURED_MEMORY_PROCEDURE",
      assembleMemory: () => "CAPTURED_STABLE_MEMORY", tools: { probe: tool({ inputSchema: z.object({}), execute: async () => ({ safe: "tool-result-evidence" }) }) } };
    const liveAssemble = vi.spyOn(f.memory, "assemble").mockImplementation(() => { throw new Error("must use captured assembly"); });
    const liveTools = vi.spyOn(f.memory, "createTools").mockImplementation(() => { throw new Error("must use captured tools"); });
    const livePrompt = vi.fn(() => "LIVE_DIFFERENT_PROMPT");
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, memoryPrompt: livePrompt,
      requestReduction: (input) => { projections.push(input); return undefined; },
      onPrimaryCommitted: (input) => committed.push(input),
      autoMemory: { onTurnCompleted: async () => { atMaintenance.push(JSON.stringify(projections.at(-1)?.outgoing)); } } });

    expect(await drain(agent.stream({ characterId: "taki", message: "first user input" }, { runContext: context }))).toBe("first response");
    const firstProjection = projections[0]!;
    expect(JSON.stringify(firstProjection.outgoing)).toContain("RECALL_FIRST_ONLY");
    expect(firstProjection.measurement.requestMessageTokens).toBe(estimateMessagesTokens(firstProjection.outgoing));
    expect(firstProjection.measurement.requestMessageTokens).toBeGreaterThan(firstProjection.measurement.historyTokens);
    expect(firstProjection.instructions).not.toContain("RECALL_FIRST_ONLY");
    expect(firstProjection.instructions).toContain("CAPTURED_STABLE_MEMORY");
    expect(model.doStreamCalls[1]!.prompt.slice(0, model.doStreamCalls[0]!.prompt.length)).toEqual(model.doStreamCalls[0]!.prompt);
    expect(recall).toHaveBeenCalledTimes(1);
    expect(atMaintenance[0]).not.toContain("RECALL_");

    const persisted = createConversationStore({ repo: createTimelineRepo(f.db) }).history("taki");
    expect(JSON.stringify(persisted)).toContain("tool-result-evidence");
    expect(JSON.stringify(persisted)).not.toMatch(/RECALL_|turn-context|automatic-memory-recall/);
    const proof = committed[0]!;
    const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: proof.entries.at(-1)!.seq,
      entries: proof.entries.map((entry) => ({ kind: "primary-committed" as const, digest: primaryEntryDigest(entry),
        committedThroughSeq: proof.entries.at(-1)!.seq, entry })) });
    expect(renderIngestionSource(source.messages)).toContain("first user input");
    expect(renderIngestionSource(source.messages)).toContain("first response");
    expect(JSON.stringify(source)).not.toMatch(/RECALL_|tool-result-evidence|CAPTURED_/);

    expect(await drain(agent.stream({ characterId: "taki", message: "second user input" }, { runContext: context }))).toBe("second response");
    const secondPrompt = JSON.stringify(model.doStreamCalls[2]!.prompt);
    expect(secondPrompt).toContain("RECALL_SECOND_ONLY"); expect(secondPrompt).not.toContain("RECALL_FIRST_ONLY");
    expect(recall).toHaveBeenCalledTimes(2);
    expect(liveAssemble).not.toHaveBeenCalled(); expect(liveTools).not.toHaveBeenCalled(); expect(livePrompt).not.toHaveBeenCalled();
  });

  it("reuses the same automatic recall across the one permitted context-overflow retry", async () => {
    const f = fresh();
    const model = failThenStreamModel(new APICallError({ message: "maximum context length exceeded", statusCode: 400,
      url: "https://fixture.invalid", requestBodyValues: {} }), ["recovered"]);
    const recall = vi.fn(async () => fenced("RECALL_ONCE"));
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, onOverflow: vi.fn() });
    expect(await drain(agent.stream({ characterId: "taki", message: "hello" }, { runContext: { automaticMemoryRecall: recall } }))).toBe("recovered");
    expect(model.doStreamCalls).toHaveLength(2); expect(recall).toHaveBeenCalledOnce();
    for (const call of model.doStreamCalls) expect(JSON.stringify(call.prompt)).toContain("RECALL_ONCE");
    expect(JSON.stringify(f.conversation.history("taki"))).not.toContain("RECALL_ONCE");
  });

  it.each(["timeout", "failure"])("completes the foreground response after complete automatic recall %s", async (mode) => {
    const f = fresh(); const model = streamingMockModel(["foreground continues"]);
    const snapshot = createMemoryRunReference({ providerId: "local", providerLineageId: "lineage", authorityEpochId: "epoch", contractVersion: 1,
      capabilities: { providerId: "local", contractVersion: 1, retain: true, recall: true, reflect: false, edit: true, invalidate: true,
        restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false } });
    const recall = createAutomaticMemoryRecall({ snapshot, router: { globalBankId: () => "g", characterBankId: () => "taki", characterId: () => "taki" },
      config: { timeoutMs: 10 }, coordinator: { recall: async () => { if (mode === "failure") throw new Error("private failure"); return new Promise(() => undefined); } } });
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });
    expect(await drain(agent.stream({ characterId: "taki", message: "continue" }, { runContext: { automaticMemoryRecall: recall } }))).toBe("foreground continues");
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt)).not.toContain("automatic-memory-recall");
    expect(f.conversation.history("taki")).toEqual([{ role: "user", content: "continue" }, { role: "assistant", content: "foreground continues" }]);
  });

  it("contains an unexpected projection exception and skips automatic recall for non-primary Runs", async () => {
    const f = fresh(); const recall = vi.fn(async () => { throw new Error("projection failed"); });
    const committed = vi.fn(); const autoMemory = { onTurnCompleted: vi.fn(async () => undefined) };
    const agent = createChatAgent({ model: streamingMockModel(["ok"]), store: f.conversation, memory: f.memory, autoMemory, onPrimaryCommitted: committed });
    const runContext = { automaticMemoryRecall: recall };
    expect(await drain(agent.stream({ characterId: "taki", message: "primary" }, { runContext }))).toBe("ok");
    expect(recall).toHaveBeenCalledOnce(); expect(committed).toHaveBeenCalledOnce(); expect(autoMemory.onTurnCompleted).toHaveBeenCalledOnce();
    const before = f.conversation.history("taki");
    expect(await drain(agent.stream({ characterId: "taki", message: "control" }, { runContext, turnKind: "non-primary" }))).toBe("ok");
    expect(recall).toHaveBeenCalledOnce(); expect(committed).toHaveBeenCalledOnce(); expect(autoMemory.onTurnCompleted).toHaveBeenCalledOnce();
    expect(f.conversation.history("taki")).toEqual(before);
  });
});
