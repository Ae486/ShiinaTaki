import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatAgent } from "./chat-agent.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createCompactionPass } from "./compaction-pass.ts";
import { reduceMessages } from "./context-reduction.ts";
import type { RequestMeasurement } from "./request-measurement.ts";
import { createMemoryEngine } from "../memory/memory-engine.ts";
import { createMaintenanceAutoMemory } from "../memory/auto-memory.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { generatingModel, scriptedModel } from "../testing/mock-language-model.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";

const fixtures: CompanionFixture[] = [];
const dbs: Database[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); for (const db of dbs.splice(0)) db.close(); });

function capturingModel(holder: { prompt?: unknown }): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      holder.prompt = prompt;
      return { stream: simulateReadableStream({ chunks: [
        { type: "text-start", id: "t1" }, { type: "text-delta", id: "t1", delta: "ok" },
        { type: "text-end", id: "t1" }, { type: "finish", finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } } },
      ] }) };
    },
  }) as LanguageModel;
}

async function drain(stream: AsyncIterable<string>): Promise<string> { let output = ""; for await (const delta of stream) output += delta; return output; }

describe("admitted request Context Reduction seam", () => {
  it("sends a valid reduced tool-result projection while preserving Timeline bytes", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    const oldResult = "secret-token=do-not-forward " + "x".repeat(6_000);
    fixture.conversation.appendTurn("taki", [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "probe", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "probe", output: { type: "text", value: oldResult } }] },
    ] as never);
    const before = fixture.conversation.history("taki");
    const holder: { prompt?: unknown } = {};
    const measurements: number[] = [];
    const agent = createChatAgent({ model: capturingModel(holder), store: fixture.conversation, memory: fixture.memory,
      onRequestMeasured: (_characterId, measurement) => measurements.push(measurement.projectedInputTokens),
      requestReduction: ({ outgoing }) => reduceMessages({ messages: outgoing, targetTokens: 10 }).messages });
    await drain(agent.stream({ characterId: "taki", message: "continue" }));
    const rendered = JSON.stringify(holder.prompt);
    expect(rendered).toContain("c1");
    expect(rendered).toContain("... reduced ...");
    expect(rendered).not.toContain("x".repeat(3_000));
    expect(measurements.length).toBeGreaterThanOrEqual(2);
    expect(fixture.conversation.history("taki").slice(0, before.length)).toEqual(before);
  });

  it("changes the actual provider prompt when reducing a typed rolling-summary head", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
    const timeline = createTimelineRepo(db); const summaries = createSummaryRepo(db);
    const conversation = createConversationStore({ repo: timeline, summaries, window: { budget: () => 1_000_000 } });
    const memory = createMemoryEngine({ db, memoryRoot: "memory", timeline });
    conversation.appendUser("taki", "before summary");
    summaries.upsert({ characterId: "taki", throughSeq: 1, text: "head-".repeat(2_000) + "tail-marker" });
    const holder: { prompt?: unknown } = {};
    const measurements: number[] = [];
    const agent = createChatAgent({ model: capturingModel(holder), store: conversation, memory,
      onRequestMeasured: (_characterId, measurement) => measurements.push(measurement.projectedInputTokens),
      requestReduction: ({ outgoing, measurement }) => reduceMessages({ messages: outgoing, targetTokens: 20,
        summaryHead: measurement.summaryTokens > 0 }).messages });
    await drain(agent.stream({ characterId: "taki", message: "continue" }));
    const rendered = JSON.stringify(holder.prompt);
    expect(rendered).toContain("<conversation-summary>");
    expect(rendered).toContain("... reduced ...");
    expect(rendered).toContain("tail-marker");
    expect(measurements.at(-1)).toBeLessThan(measurements[0]!);
  });

  it("measures persisted tool output before detached maintenance and keeps the final pressure snapshot", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    const model = scriptedModel([{ kind: "tool", toolCallId: "c1", toolName: "probe", input: {} }, { kind: "text", deltas: ["done"] }]);
    const snapshots: number[] = [];
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory,
      extraTools: { probe: tool({ inputSchema: z.object({}), execute: async () => ({ payload: "x".repeat(6_000) }) }) },
      onRequestMeasured: (_characterId, measurement) => snapshots.push(measurement.projectedInputTokens),
      requestReduction: ({ outgoing, measurement }) => {
        const reduced = reduceMessages({ messages: outgoing, targetTokens: 20, summaryHead: measurement.summaryTokens > 0 });
        return reduced.tokensSaved > 0 ? reduced.messages : undefined;
      } });
    await drain(agent.stream({ characterId: "taki", message: "inspect" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    // Native dispatch also reports its exact envelope, so initial preparation/dispatch may be equal.
    // The persisted full tool payload must still increase pressure before the final reduced projection.
    const fullToolPressure = Math.max(...snapshots);
    expect(fullToolPressure).toBeGreaterThan(snapshots[0]!);
    expect(snapshots.at(-1)).toBeLessThan(fullToolPressure);
    const timeline = JSON.stringify(fixture.conversation.history("taki"));
    expect(timeline).toContain("x".repeat(6_000));
    const finalSnapshot = snapshots.at(-1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(snapshots.at(-1)).toBe(finalSnapshot);
  });

  it("keeps non-primary control input from triggering pending relationship compaction", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    for (let index = 0; index < 10; index += 1) fixture.conversation.appendUser("taki", `history-${index}`);
    const holder: { prompt?: unknown } = {};
    const snapshots: number[] = [];
    let latest: RequestMeasurement | undefined;
    let effectiveWindow = Number.POSITIVE_INFINITY;
    const calls: string[] = [];
    const summaries = createSummaryRepo(fixture.db);
    const { logger } = createCaptureLogger();
    const compact = createCompactionPass({
      view: { estimatedTokens: fixture.conversation.estimatedTokens, budget: () => 100,
        effectiveWindowTokens: () => effectiveWindow, measureRequest: () => latest },
      timeline: createTimelineRepo(fixture.db), summaries, operations: createCompactionOperationRepo(fixture.db),
      slot: { model: generatingModel("compacted history"), run: async (label, task) => { calls.push(label); return task(); },
        usage: () => ({ calls: calls.length, inputTokens: 0, outputTokens: 0, usageUnknown: 0 }) },
      config: { triggerRatio: 0.8, keepMessages: 1 }, logger,
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const maintenance = createMaintenanceAutoMemory({ compact, logger, maintenance: () => ({ run: () => gate }) });
    let pending = Promise.resolve();
    const agent = createChatAgent({ model: capturingModel(holder), store: fixture.conversation, memory: fixture.memory,
      autoMemory: { onTurnCompleted: (characterId) => { pending = maintenance.onTurnCompleted(characterId); return pending; } },
      onRequestMeasured: (_characterId, measurement) => { latest = measurement; snapshots.push(measurement.projectedInputTokens); } });
    await drain(agent.stream({ characterId: "taki", message: "A relationship turn." }));
    const primarySnapshots = [...snapshots];
    const timeline = fixture.conversation.history("taki");
    effectiveWindow = ((latest?.projectedInputTokens ?? 0) + 100) / 0.8;
    try {
      await drain(agent.stream({ characterId: "taki", message: "Scheduled wake." }, {
        turnKind: "non-primary", controlInput: "ephemeral-control " + "x".repeat(10_000),
      }));
    } finally {
      release();
      await pending;
    }

    expect(JSON.stringify(holder.prompt)).toContain("ephemeral-control");
    expect(calls).toEqual([]);
    expect(summaries.get("taki")).toBeNull();
    expect(fixture.conversation.history("taki")).toEqual(timeline);
    expect(snapshots).toEqual(primarySnapshots);
  });
});
