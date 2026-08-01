import { afterEach, describe, expect, it } from "vitest";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { abortRejectingModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent, type TurnContext } from "./chat-agent.ts";

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

type PromptMessage = { role: string; content: unknown };
type MockWithCalls = { doStreamCalls: Array<{ prompt?: PromptMessage[] }> };

// The raw text of the LAST user message the model saw (provider-level user content is text parts; join them).
function lastUserText(model: MockWithCalls, call: number): string {
  const prompt = model.doStreamCalls[call]?.prompt ?? [];
  const last = [...prompt].reverse().find((m) => m.role === "user");
  const content = last?.content;
  if (typeof content === "string") return content;
  const parts = (Array.isArray(content) ? content : []) as Array<{ type?: string; text?: unknown }>;
  return parts.map((part) => (part.type === "text" ? String(part.text) : "")).join("");
}

const BASE64 = Buffer.from("taki-image-bytes").toString("base64");
const PNG = { mediaType: "image/png" as const, dataBase64: BASE64 };
// Fewer declared params than ChatAgentDeps.attachments.save is fine (TS width rule); the fake ignores its inputs.
function fakeAttachments() {
  return { save: () => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 16 }) };
}

describe("chat-agent turn-context tail (Q4)", () => {
  it("appends the tail to the outgoing user message — time line first, volatile content inside — never persisted", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({
      model,
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
    });

    await drain(agent.stream({ characterId: "taki", message: "hi" }));

    // Suffix on the current message: ONE tail block ends the message; the time line is its first line.
    expect(lastUserText(model, 0)).toMatch(
      /^hi\n\n<turn-context>\nCurrent local time: \d{2}:\d{2}\.\n\nVOLATILE_CARD\n<\/turn-context>$/,
    );
    // In-flight only: the persisted projection carries neither the wrapper nor the volatile payload (ADR 0008).
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("degrades to a time-only tail when volatileContext is absent or returns blank", async () => {
    const timeOnly = /^hi\n\n<turn-context>\nCurrent local time: \d{2}:\d{2}\.\n<\/turn-context>$/;

    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });
    await drain(agent.stream({ characterId: "taki", message: "hi" }));
    expect(lastUserText(model, 0)).toMatch(timeOnly);

    // A wired-but-blank provider contributes nothing either (no stray blank lines inside the block).
    const f2 = fresh();
    const model2 = streamingMockModel(["ok"]);
    const agent2 = createChatAgent({ model: model2, store: f2.conversation, memory: f2.memory, volatileContext: () => "" });
    await drain(agent2.stream({ characterId: "taki", message: "hi" }));
    expect(lastUserText(model2, 0)).toMatch(timeOnly);
  });

  it("coexists with the costume notice: notice prefix, message, tail suffix", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    let pending = true;
    const agent = createChatAgent({
      model,
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
      costumeChanged: () => {
        const fire = pending;
        pending = false;
        return fire;
      },
    });

    await drain(agent.stream({ characterId: "taki", message: "hello there" }));

    const outgoing = lastUserText(model, 0);
    expect(outgoing.startsWith(COSTUME_CHANGE_NOTICE)).toBe(true);
    expect(outgoing).toMatch(/<\/turn-context>$/);
    expect(outgoing.indexOf(COSTUME_CHANGE_NOTICE)).toBeLessThan(outgoing.indexOf("hello there"));
    expect(outgoing.indexOf("hello there")).toBeLessThan(outgoing.indexOf("<turn-context>"));
    // Neither in-flight seam reaches the persisted projection.
    const persisted = JSON.stringify(f.conversation.history("taki"));
    expect(persisted).not.toContain(COSTUME_CHANGE_NOTICE);
    expect(persisted).not.toContain("turn-context");
  });

  it("rides an image turn inside the text part, before the FileParts", async () => {
    const f = fresh();
    const visionModel = streamingMockModel(["seen"]);
    const agent = createChatAgent({
      model: streamingMockModel(["x"]),
      visionModel,
      attachments: fakeAttachments(),
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
    });

    await drain(agent.stream({ characterId: "taki", message: "look", attachments: [PNG] }));

    const prompt = (visionModel as unknown as MockWithCalls).doStreamCalls[0]?.prompt ?? [];
    const last = [...prompt].reverse().find((m) => m.role === "user");
    const parts = (Array.isArray(last?.content) ? last.content : []) as Array<{ type?: string; text?: unknown }>;
    expect(parts[0]?.type).toBe("text");
    expect(String(parts[0]?.text)).toMatch(/^look\n\n<turn-context>\n/);
    expect(String(parts[0]?.text)).toMatch(/VOLATILE_CARD\n<\/turn-context>$/);
    expect(parts[1]?.type).toBe("file");
    // The persisted projection stays clean of the tail.
    expect(JSON.stringify(f.conversation.history("taki"))).not.toContain("turn-context");
  });

  // Row 7 — the tail must not disturb the cancel-retract seam on EITHER stream ending (D1 seam law).
  it("graceful abort ending: retract still deletes exactly the user row with the tail wired", async () => {
    const f = fresh();
    const controller = new AbortController();
    controller.abort("cancelled before start");
    let retracted = false;
    const agent = createChatAgent({
      model: slowStreamingModel(["never"], 50),
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
    });
    const turn: TurnContext = {
      notify: () => undefined,
      onClose: () => undefined,
      signal: controller.signal,
      onRetract: () => (retracted = true),
    };

    const text = await drain(agent.stream({ characterId: "taki", message: "hi" }, turn));

    expect(text).toBe("");
    expect(retracted).toBe(true);
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("throw ending (transport rejects with the string reason): retract intact with the tail wired", async () => {
    const f = fresh();
    const controller = new AbortController();
    let retracted = false;
    const agent = createChatAgent({
      model: abortRejectingModel(["a", "b"], 40),
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
    });
    const turn: TurnContext = {
      notify: () => undefined,
      onClose: () => undefined,
      signal: controller.signal,
      onRetract: () => (retracted = true),
    };

    setTimeout(() => controller.abort("turn cancelled by operator"), 5);
    const deltas: string[] = [];
    let threw = false;
    try {
      for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, turn)) deltas.push(delta);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false); // the cancel echo is swallowed by the retract, tail or no tail
    expect(deltas).toEqual([]);
    expect(retracted).toBe(true);
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("stop path after partial text: the persisted user row stays the PLAIN message (no tail)", async () => {
    const f = fresh();
    const controller = new AbortController();
    const agent = createChatAgent({
      model: slowStreamingModel(["par", "tial", "more"], 30),
      store: f.conversation,
      memory: f.memory,
      volatileContext: () => "VOLATILE_CARD",
    });
    const turn: TurnContext = { notify: () => undefined, onClose: () => undefined, signal: controller.signal };

    const deltas: string[] = [];
    for await (const delta of agent.stream({ characterId: "taki", message: "hi" }, turn)) {
      deltas.push(delta);
      if (deltas.length === 1) controller.abort("turn cancelled by operator");
    }

    expect(deltas).toEqual(["par"]);
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "par" },
    ]);
  });
});
