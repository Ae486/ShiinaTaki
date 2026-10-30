import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

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

const BASE64 = Buffer.from("taki-image-bytes").toString("base64");
const PNG = { mediaType: "image/png" as const, dataBase64: BASE64 };

// A narrow fake matching ChatAgentDeps.attachments — records saves, returns a deterministic content-addressed ref.
function fakeAttachments() {
  const save = vi.fn((_dataBase64: string, mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif") => ({
    ref: `attachments/${"a".repeat(64)}.${mediaType === "image/png" ? "png" : "jpg"}`,
    bytes: 16,
  }));
  return { save };
}

describe("chat-agent image attachments (T8)", () => {
  it("routes an image turn to the vision slot and leaves the text slot untouched", async () => {
    const f = fresh();
    const textModel = streamingMockModel(["text"]);
    const visionModel = streamingMockModel(["seen"]);
    const agent = createChatAgent({ model: textModel, visionModel, attachments: fakeAttachments(), store: f.conversation, memory: f.memory });

    const out = await drain(agent.stream({ characterId: "taki", message: "look", attachments: [PNG] }));

    expect(out).toBe("seen");
    expect(visionModel.doStreamCalls).toHaveLength(1);
    expect(textModel.doStreamCalls).toHaveLength(0);
  });

  it("keeps a text-only turn on the text slot (vision slot never called)", async () => {
    const f = fresh();
    const textModel = streamingMockModel(["text"]);
    const visionModel = streamingMockModel(["seen"]);
    const agent = createChatAgent({ model: textModel, visionModel, attachments: fakeAttachments(), store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "just text" }));

    expect(textModel.doStreamCalls).toHaveLength(1);
    expect(visionModel.doStreamCalls).toHaveLength(0);
  });

  it("carries the in-flight attachment as a FilePart with raw base64 (never the deprecated ImagePart)", async () => {
    const f = fresh();
    const visionModel = streamingMockModel(["seen"]);
    const agent = createChatAgent({ model: streamingMockModel(["x"]), visionModel, attachments: fakeAttachments(), store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "what is this", attachments: [PNG] }));

    const serialized = JSON.stringify(visionModel.doStreamCalls[0]?.prompt ?? []);
    expect(serialized).toContain('"type":"file"'); // FilePart, not the deprecated {type:"image"}
    expect(serialized).toContain("image/png");
    expect(serialized).toContain(BASE64); // the raw base64 survived (a data: URL would have thrown — research r1)
  });

  it("rejects an image turn with no vision slot and persists NOTHING (structured error path)", async () => {
    const f = fresh();
    // No visionModel / no attachments store configured — the text model must never receive an image.
    const agent = createChatAgent({ model: streamingMockModel(["never"]), store: f.conversation, memory: f.memory });

    const caught = await drain(agent.stream({ characterId: "taki", message: "look", attachments: [PNG] })).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/vision model/i);
    // Nothing was appended — the guard threw before store.appendUser.
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("persists the image turn as a text-projection row (ref stored, bytes never in the DB) and replays text only", async () => {
    const f = fresh();
    const agent = createChatAgent({ model: streamingMockModel(["x"]), visionModel: streamingMockModel(["seen"]), attachments: fakeAttachments(), store: f.conversation, memory: f.memory });

    await drain(agent.stream({ characterId: "taki", message: "caption", attachments: [PNG] }));

    // History replay is text only — no base64, no ref (decision 6).
    const replayed = JSON.stringify(f.conversation.history("taki"));
    expect(replayed).toContain("caption");
    expect(replayed).not.toContain(BASE64);
    expect(replayed).not.toContain("attachments/");
  });

  it("fires imageMemory.onImageTurn detached with the saved refs + caption (only on image turns)", async () => {
    const f = fresh();
    const onImageTurn = vi.fn();
    const agent = createChatAgent({
      model: streamingMockModel(["x"]),
      visionModel: streamingMockModel(["seen"]),
      attachments: fakeAttachments(),
      imageMemory: { onImageTurn },
      store: f.conversation,
      memory: f.memory,
    });

    await drain(agent.stream({ characterId: "taki", message: "remember this", attachments: [PNG] }));
    expect(onImageTurn).toHaveBeenCalledWith({
      characterId: "taki",
      refs: [`attachments/${"a".repeat(64)}.png`],
      caption: "remember this",
    });

    // A subsequent text turn must NOT fire the image hook.
    onImageTurn.mockClear();
    await drain(agent.stream({ characterId: "taki", message: "text only" }));
    expect(onImageTurn).not.toHaveBeenCalled();
  });
});
