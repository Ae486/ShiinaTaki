import { afterEach, describe, expect, it } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import type { Connection } from "../server/connection-registry.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import { createChatAgent, type TurnContext } from "./chat-agent.ts";

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

describe("chat-agent turn lifecycle (D1)", () => {
  it("persists the FULL turn — tool-call + tool-result + final text — and replays it next turn (#1)", async () => {
    const f = fresh();
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "memory_write", input: { type: "relationship", content: "每周五看电影", importance: 9 } },
      { kind: "text", deltas: ["记住了"] },
      { kind: "text", deltas: ["是的"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "记住我们的约定" }));

    // The persisted transcript now shows the tool actually ran — the anti-hallucination ground truth.
    expect(f.conversation.history("taki").map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    // Turn 2's model prompt replays the tool-call AND its result (this is what the model reads truth from).
    await drain(agent.stream({ characterId: "taki", message: "你调用过工具吗?" }));
    const prompt = JSON.stringify(model.doStreamCalls[2]?.prompt ?? []);
    expect(prompt).toContain('"tool-call"');
    expect(prompt).toContain('"tool-result"');
    expect(prompt).toContain("memory_write");
  });

  it("prepends the base system prompt with the truthfulness floor before the memory context (#2)", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, instructionsExtra: () => "SKILLS" });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));

    const system = model.doStreamCalls[0]?.prompt?.[0];
    expect(system?.role).toBe("system");
    const text = JSON.stringify(system);
    expect(text).toContain("Never claim you personally ran a tool");
    // Base prompt leads; the extra (skills) section follows it.
    expect(text.indexOf("Never claim")).toBeLessThan(text.indexOf("SKILLS"));
    expect(BASE_SYSTEM_PROMPT).toContain("tool-result");
  });

  it("ends gracefully on abort and persists the partial text the user already saw (#4/#5)", async () => {
    const f = fresh();
    const model = slowStreamingModel(["Hel", "lo ", "you"], 40);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });
    const controller = new AbortController();
    const turn: TurnContext = {
      connection: TEST_CONNECTION, notify: () => undefined, onClose: () => undefined, signal: controller.signal,
    };

    const seen: string[] = [];
    // No throw expected: the SDK converts the abort into a graceful stream end (an `abort` part, then close).
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, turn)) {
      seen.push(delta);
      controller.abort("user interrupted");
    }

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.length).toBeLessThan(3); // the abort landed mid-stream, not after completion
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: seen.join("") },
    ]);
  });

  it("retracts the user row when an abort lands before any delta (cancel-before-reply leaves no trace)", async () => {
    const f = fresh();
    const model = slowStreamingModel(["never"], 50);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });
    const controller = new AbortController();
    controller.abort("cancelled before start");
    let retracted = false;
    const turn: TurnContext = {
      connection: TEST_CONNECTION,
      notify: () => undefined,
      onClose: () => undefined,
      signal: controller.signal,
      onRetract: () => (retracted = true),
    };

    const text = await drain(agent.stream({ characterId: "taki", message: "hi" }, turn));

    expect(text).toBe("");
    expect(retracted).toBe(true);
    // The turn produced nothing, so the just-appended user row is retracted — the timeline is left empty.
    expect(f.conversation.history("taki")).toEqual([]);
  });
});
