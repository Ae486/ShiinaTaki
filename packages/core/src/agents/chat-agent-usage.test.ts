import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { abortRejectingModel, scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent, type TurnContext, type TurnUsageReport } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
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
  return { notify: () => undefined, onClose: () => undefined, signal: controller.signal, onRetract };
}

describe("chat-agent usage-capture seam (batch 6, R1 tier 2)", () => {
  it("reports the provider usage + our positive estimate, detached, after a committed turn", async () => {
    const f = fresh();
    const reports: TurnUsageReport[] = [];
    const agent = createChatAgent({
      model: streamingMockModel(["ok"]),
      store: f.conversation,
      memory: f.memory,
      onUsage: (report) => reports.push(report),
    });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    // The mock's model-level usage maps to inputTokens 3 / outputTokens 5 at the result level.
    expect(reports[0]).toMatchObject({ inputTokens: 3, outputTokens: 5 });
    expect(reports[0]?.estimatedInput).toBeGreaterThan(0);
    expect(Number.isInteger(reports[0]?.estimatedInput)).toBe(true);
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

  it("fires nothing on a THROW-ending stop (partial text persisted, but the committed tail is never reached)", async () => {
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

    expect(String(threw)).toContain("turn cancelled by operator");
    expect(deltas).toEqual(["par"]); // the partial the user saw is kept (D1 #5) ...
    expect(reports).toEqual([]); // ... but a thrown ending fires no usage report
  });
});
