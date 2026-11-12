import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
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

function relationshipFiles(root: string): string[] {
  const dir = join(root, "memory");
  return readdirSync(dir, { recursive: true }).filter(
    (p): p is string => typeof p === "string" && p.includes("relationship") && p.endsWith(".md"),
  );
}

describe("chat-agent memory tool loop (T13)", () => {
  it("runs memory_write mid-turn, keeps the stream clean, and pins the promise into the NEXT turn's context", async () => {
    const f = fresh();
    const promise = "每周五一起看电影";
    // Turn 1: the model calls memory_write, then answers. Turn 2: the model answers once.
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "memory_write", input: { type: "relationship", content: promise, importance: 10 } },
      { kind: "text", deltas: ["好的，", "记住了"] },
      { kind: "text", deltas: ["我们约定了每周五看电影"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory });

    // Turn 1 — the pump must yield ONLY the continuation text, never the tool call.
    const turn1 = await drain(agent.stream({ characterId: "taki", message: "记住我们的约定：每周五一起看电影" }));
    expect(turn1).toBe("好的，记住了");

    // The tool actually wrote the file (importance 10, relationship) and indexed it.
    const files = relationshipFiles(f.root);
    expect(files).toHaveLength(1);
    const onDisk = readFileSync(join(f.root, "memory", files[0] as string), "utf8");
    expect(onDisk).toContain(promise);
    expect(onDisk).toContain("importance: 10");

    // Turn 2 — the assembled system prompt (call #3) must contain the pinned promise.
    await drain(agent.stream({ characterId: "taki", message: "我们有什么约定?" }));
    expect(model.doStreamCalls).toHaveLength(3);
    const turn2System = model.doStreamCalls[2]?.prompt?.[0];
    expect(turn2System?.role).toBe("system");
    expect(JSON.stringify(turn2System)).toContain(promise);
  });
});
