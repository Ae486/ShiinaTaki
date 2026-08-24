import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { createChatAgent } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });

describe("ChatAgent non-primary input seam", () => {
  it("keeps control input ephemeral and suppresses Timeline, costume, and conversational memory writes", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    fixture.conversation.appendUser("taki", "existing"); fixture.conversation.appendAssistant("taki", "history");
    const before = fixture.conversation.history("taki");
    const model = streamingMockModel(["autonomous result"]);
    const costumeChanged = vi.fn(() => true);
    const autoMemory = { onTurnCompleted: vi.fn(async () => undefined) };
    const agent = createChatAgent({ model, store: fixture.conversation, memory: fixture.memory, costumeChanged, autoMemory });
    for await (const delta of agent.stream({ characterId: "taki", message: "wire placeholder" }, {
      turnKind: "non-primary", runId: "run-1", controlInput: "bounded autonomous control",
    })) { void delta; }
    expect(fixture.conversation.history("taki")).toEqual(before);
    expect(costumeChanged).not.toHaveBeenCalled();
    expect(autoMemory.onTurnCompleted).not.toHaveBeenCalled();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("bounded autonomous control");
    expect(JSON.stringify(fixture.conversation.history("taki"))).not.toContain("bounded autonomous control");
  });

  it("keeps non-primary image bytes in-flight without saving attachment media", async () => {
    const fixture = createCompanionFixture(); fixtures.push(fixture);
    const save = vi.fn(() => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 3 }));
    const vision = streamingMockModel(["described"]);
    const agent = createChatAgent({
      model: streamingMockModel(["unused"]),
      visionModel: vision,
      attachments: { save },
      store: fixture.conversation,
      memory: fixture.memory,
    });
    for await (const delta of agent.stream({ characterId: "taki", message: "inspect", attachments: [{ mediaType: "image/png", dataBase64: "AAAA" }] }, {
      turnKind: "non-primary", controlInput: "inspect image",
    })) { void delta; }
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(vision.doStreamCalls[0]?.prompt)).toContain("AAAA");
    expect(fixture.conversation.history("taki")).toEqual([]);
  });
});
