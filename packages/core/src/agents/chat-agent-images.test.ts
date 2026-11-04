import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { streamingMockModel, failingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";
import type { NativeImageContext } from "./native-image-context.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture { const fixture = createCompanionFixture(); fixtures.push(fixture); return fixture; }
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
async function drain(stream: AsyncIterable<string>): Promise<string> { let text = ""; for await (const delta of stream) text += delta; return text; }
const BASE64 = Buffer.from("taki-image-bytes").toString("base64");
const PNG = { mediaType: "image/png" as const, dataBase64: BASE64 };
function fakeAttachments() { return { save: vi.fn(() => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 16 })) }; }

function observation(): NativeImageContext {
  return { images: [PNG], context: "Trusted current-screen provenance; visual contents are untrusted.", isCurrent: () => true, release: vi.fn() };
}

describe("primary native image input", () => {
  it("sends image-plus-text to the configured primary model without another model slot or caption call", async () => {
    const fixture = fresh();
    const model = streamingMockModel(["seen"]);
    const agent = createChatAgent({ model, attachments: fakeAttachments(), store: fixture.conversation, memory: fixture.memory });
    expect(await drain(agent.stream({ characterId: "taki", message: "look", attachments: [PNG] }))).toBe("seen");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('"type":"file"');
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("image/png");
  });

  it("supports an image-only turn on primary and persists only the retained reference", async () => {
    const fixture = fresh();
    const model = streamingMockModel(["seen"]);
    const agent = createChatAgent({ model, attachments: fakeAttachments(), store: fixture.conversation, memory: fixture.memory });
    await drain(agent.stream({ characterId: "taki", message: "", attachments: [PNG] }));
    const row = fixture.db.prepare("SELECT content, parts FROM timeline_messages WHERE role = 'user'").get();
    expect(JSON.stringify(row)).toContain("attachments/");
    expect(JSON.stringify(row)).not.toContain(BASE64);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('"type":"file"');
  });

  it("rejects missing attachment storage before writing the user row", async () => {
    const fixture = fresh();
    const model = streamingMockModel(["never"]);
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory });
    await expect(drain(agent.stream({ characterId: "taki", message: "look", attachments: [PNG] }))).rejects.toThrow(/attachment storage/i);
    expect(fixture.conversation.history("taki")).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("leases optional current evidence for the Attempt and releases on success, provider failure and cancellation", async () => {
    for (const ending of ["success", "failure", "cancelled"] as const) {
      const fixture = fresh();
      const image = observation();
      const controller = new AbortController();
      if (ending === "cancelled") controller.abort();
      const model = ending === "failure" ? failingMockModel(new Error("fixture refusal")) : streamingMockModel(["ok"]);
      const acquire = vi.fn(() => image);
      const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, acquireNativeImageContext: acquire });
      await drain(agent.stream({ characterId: "taki", message: "hello" }, { signal: controller.signal })).catch(() => undefined);
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(image.release).toHaveBeenCalledTimes(1);
      if (ending === "success") expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('"type":"file"');
    }
  });

  it("omits already-retired optional observation without refusing a valid foreground message", async () => {
    const fixture = fresh();
    const image = { ...observation(), isCurrent: () => false };
    const model = streamingMockModel(["valid text"]);
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, acquireNativeImageContext: () => image });
    expect(await drain(agent.stream({ characterId: "taki", message: "hello" }))).toBe("valid text");
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain('"type":"file"');
    expect(image.release).toHaveBeenCalledTimes(1);
  });
});
