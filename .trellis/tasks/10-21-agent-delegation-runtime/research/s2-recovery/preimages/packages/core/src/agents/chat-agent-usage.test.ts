import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { abortRejectingModel, scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createChatAgent, type TurnContext, type TurnUsageReport } from "./chat-agent.ts";
import { digestForModelRequest } from "./model-effect-middleware.ts";
import { simulateReadableStream, tool } from "ai";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";
import { z } from "zod";

const fixtures: CompanionFixture[] = [];
const TEST_CONNECTION: Connection = {
  state: { status: "authenticated", deviceId: "chat-agent-test", role: "operator", capabilities: [] },
};
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

// The detached fire lands in a later microtask/macrotask; flush a couple of macrotasks before asserting absence.
async function flushDetached(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function cancellableTurn(controller: AbortController, onRetract?: () => void): TurnContext {
  return { connection: TEST_CONNECTION, notify: () => undefined, onClose: () => undefined, signal: controller.signal, onRetract };
}

describe("chat-agent usage-capture seam (batch 6, R1 tier 2)", () => {
  it("keeps distinct model requests distinct under equal-length strings", () => {
    expect(digestForModelRequest({ prompt: "aa", temperature: 1 })).not.toBe(digestForModelRequest({ prompt: "bb", temperature: 1 }));
  });

  it("settles finish-without-usage as unknown", async () => {
    const settlements: Array<{ outcome?: string }> = [];
    const lifecycle = {
      prepare: (input: { runId: string; attemptId: string }) => ({ schemaVersion: "effect.v1" as const, effectId: `${input.runId}-${input.attemptId}`, runId: input.runId, attemptId: input.attemptId, kind: "model" as const, state: "intent_committed" as const, version: 0, sourceRef: { type: "model" as const, provider: "test", modelId: "test" }, replayPosture: "never" as const }),
      settle: (input: { outcome?: string }) => { settlements.push(input); return { effect: undefined as never, duplicate: false, stale: false }; },
      get: () => undefined,
      unfinished: () => [],
    };
    const middleware = createModelEffectMiddleware({ lifecycle, runId: "run-no-usage", attemptId: "attempt-no-usage" });
    const result = await middleware.wrapStream?.({
      doGenerate: async () => { throw new Error("unused"); },
      doStream: async () => ({ stream: simulateReadableStream({ chunks: [{ type: "finish", finishReason: { unified: "stop", raw: undefined } }] }) }),
      params: { prompt: [] },
      model: { provider: "test", modelId: "test" },
    } as never);
    if (result) { const reader = result.stream.getReader(); while (!(await reader.read()).done) { /* drain */ } }
    expect(settlements).toContainEqual(expect.objectContaining({ outcome: "outcome_unknown" }));
  });

  it("does not invoke a provider when intent preparation fails", async () => {
    let providerCalls = 0;
    const middleware = createModelEffectMiddleware({
      lifecycle: { prepare: () => { throw new Error("intent failed"); }, settle: () => { throw new Error("unexpected settlement"); }, get: () => undefined, unfinished: () => [] },
      runId: "run-failed-intent", attemptId: "attempt-failed-intent",
    });
    await expect(middleware.wrapStream?.({
      doGenerate: async () => { throw new Error("unused"); },
      doStream: async () => { providerCalls += 1; return { stream: simulateReadableStream({ chunks: [] }) }; },
      params: { prompt: [] }, model: { provider: "test", modelId: "test" },
    } as never)).rejects.toThrow("intent failed");
    expect(providerCalls).toBe(0);
  });

  it("creates one Core effect per internal ToolLoopAgent provider request", async () => {
    const f = fresh();
    const prepared: string[] = [];
    const settled: string[] = [];
    let sequence = 0;
    const lifecycle = {
      prepare(input: { runId: string; attemptId: string }) {
        const effectId = `effect-${++sequence}`;
        prepared.push(`${input.runId}/${input.attemptId}`);
        return { schemaVersion: "effect.v1" as const, effectId, runId: input.runId, attemptId: input.attemptId, kind: "model" as const, state: "intent_committed" as const, version: 0, sourceRef: { type: "model" as const, provider: "test", modelId: "test" }, replayPosture: "never" as const };
      },
      settle(input: { effectId: string }) { settled.push(input.effectId); return { effect: undefined as never, duplicate: false, stale: false }; },
      get: () => undefined,
      unfinished: () => [],
    };
    const agent = createChatAgent({ model: scriptedModel([{ kind: "tool", toolCallId: "c1", toolName: "probe", input: { value: "x" } }, { kind: "text", deltas: ["two"] }]), store: f.conversation, memory: f.memory, extraTools: { probe: tool({ description: "probe", inputSchema: z.object({ value: z.string() }), execute: async () => ({ ok: true }) }) }, effectLifecycle: lifecycle });
    await drain(agent.stream({ characterId: "taki", message: "hi" }, { runId: "run-1", attemptId: "attempt-1" }));
    expect(prepared).toEqual(["run-1/attempt-1", "run-1/attempt-1"]);
    expect(settled).toHaveLength(2);
  });

  it("reports the provider usage + our positive estimate, detached, after a committed turn", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const agent = createChatAgent({
      model: streamingMockModel(["ok"]),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
      requestEnvelopeReserve: () => 200,
    });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    // The mock's model-level usage maps to inputTokens 3 / outputTokens 5 at the result level.
    expect(reports[0]).toMatchObject({ inputTokens: 3, outputTokens: 5 });
    expect(reports[0]?.estimatedInput).toBeGreaterThan(0);
    expect(Number.isInteger(reports[0]?.estimatedInput)).toBe(true);
    expect(reports[0]?.measurement).toMatchObject({ accountingQuality: "estimated", sourceBackstopHit: false });
    expect(reports[0]!.measurement.summaryTokens).toBe(0);
    expect(reports[0]!.measurement.instructionTokens).toBeGreaterThan(0);
    expect(reports[0]!.measurement.toolSchemaTokens).toBeGreaterThan(0);
    expect(reports[0]!.measurement.responseReserveTokens).toBeGreaterThanOrEqual(0);
    expect(reports[0]!.measurement.projectedRequestTokens).toBe(
      reports[0]!.measurement.estimatedInputTokens + reports[0]!.measurement.responseReserveTokens,
    );
  });

  it("reports the ALL-STEPS usage sum on a multi-step tool turn (4b-verified result.usage semantics)", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const agent = createChatAgent({
      model: scriptedModel([
        { kind: "tool", toolCallId: "c1", toolName: "memory_search", input: { query: "面" } },
        { kind: "text", deltas: ["done"] },
      ]),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
    });

    await drain(agent.stream({ characterId: "taki", message: "还记得吗" }));
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    // Two steps at 3/5 each -> the sum, exactly what the calibrator must consume.
    expect(reports[0]).toMatchObject({ inputTokens: 6, outputTokens: 10 });
  });

  it("fires nothing without the dep (absent = byte-identical turn)", async () => {
    const f = fresh();
    const agent = createChatAgent({ model: streamingMockModel(["ok"]), store: f.conversation, memory: f.memory });

    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).resolves.toBe("ok");
    expect(f.conversation.history("taki")).toHaveLength(2);
  });

  it("fires nothing on a GRACEFUL-ending retract (abort before any delta, mock transport)", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const controller = new AbortController();
    controller.abort("cancelled before start");
    const agent = createChatAgent({
      model: slowStreamingModel(["never"], 50),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
    });

    await drain(agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller)));
    await flushDetached();

    expect(f.conversation.history("taki")).toEqual([]); // retracted
    expect(reports).toEqual([]);
  });

  it("fires nothing on a THROW-ending retract (transport rejects with the string reason before any delta)", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const controller = new AbortController();
    const agent = createChatAgent({
      model: abortRejectingModel(["a", "b"], 40),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
    });

    setTimeout(() => controller.abort("turn cancelled by operator"), 5);
    await drain(agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller)));
    await flushDetached();

    expect(f.conversation.history("taki")).toEqual([]); // retracted via the throw ending
    expect(reports).toEqual([]);
  });

  it("fires nothing on a cancelled stop when the SDK closes a rejecting provider gracefully", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const controller = new AbortController();
    const agent = createChatAgent({
      model: abortRejectingModel(["par", "tial", "more"], 40),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
    });

    const deltas: string[] = [];
    let threw: unknown = null;
    try {
      for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, cancellableTurn(controller))) {
        deltas.push(delta);
        if (deltas.length === 1) controller.abort("turn cancelled by operator");
      }
    } catch (error) {
      threw = error;
    }
    await flushDetached();

    // Owner-approved policy now uses Core cancellation, not a transport-dependent throw, to gate callbacks.
    expect(threw).toBeNull();
    expect(deltas).toEqual(["par"]); // the partial the user saw is kept (D1 #5) ...
    expect(reports).toEqual([]); // ... but a cancelled turn fires no post-turn usage report
  });
});
