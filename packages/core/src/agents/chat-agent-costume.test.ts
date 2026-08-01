import { afterEach, describe, expect, it } from "vitest";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
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

describe("chat-agent costume-change notice (1f)", () => {
  it("prefixes the one-shot notice onto the model-facing user message, once, and never persists it", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    // Mimics main.ts wiring: costumeChanged fires true once (a pending costume swap), then is consumed.
    let pending = true;
    const agent = createChatAgent({
      model,
      store: f.conversation,
      memory: f.memory,
      costumeChanged: () => {
        if (!pending) return false;
        pending = false;
        return true;
      },
    });

    await drain(agent.stream({ characterId: "taki", message: "hello there" }));

    // The model saw the notice prefixed onto the (still-present) user text.
    const prompt1 = JSON.stringify(model.doStreamCalls[0]?.prompt ?? []);
    expect(prompt1).toContain(COSTUME_CHANGE_NOTICE);
    expect(prompt1).toContain("hello there");
    // ...but the persisted timeline is the plain user message — the note is in-flight only.
    const persisted = JSON.stringify(f.conversation.history("taki"));
    expect(persisted).not.toContain(COSTUME_CHANGE_NOTICE);
    expect(persisted).toContain("hello there");

    // Next turn: the change was consumed → the model sees only the plain message (no stale re-fire).
    await drain(agent.stream({ characterId: "taki", message: "again" }));
    const prompt2 = JSON.stringify(model.doStreamCalls[1]?.prompt ?? []);
    expect(prompt2).not.toContain(COSTUME_CHANGE_NOTICE);
    expect(prompt2).toContain("again");
  });

  it("injects no notice when no costume change is pending (persisted history stays the plain turn)", async () => {
    const f = fresh();
    const model = streamingMockModel(["ok"]);
    const agent = createChatAgent({
      model,
      store: f.conversation,
      memory: f.memory,
      costumeChanged: () => false, // no change ever
    });

    await drain(agent.stream({ characterId: "taki", message: "plain" }));

    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt ?? []);
    expect(prompt).not.toContain(COSTUME_CHANGE_NOTICE);
    expect(prompt).toContain("plain");
    // The persisted projection is exactly the plain turn (the outgoing copy differs only by the in-flight
    // turn-context tail, which never persists — pinned in chat-agent-tail.test.ts).
    expect(f.conversation.history("taki")).toEqual([
      { role: "user", content: "plain" },
      { role: "assistant", content: "ok" },
    ]);
  });
});
