import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TimelineEntry } from "@taki/shared";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { createFlushWriter } from "./flush-writer.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function seg(...contents: string[]): TimelineEntry[] {
  return contents.map((content, i) => ({
    seq: i + 1,
    id: `id-${i}`,
    characterId: "taki",
    role: i % 2 === 0 ? "user" : "assistant",
    content,
    createdAt: new Date().toISOString(),
  }));
}

function memoryFiles(root: string): string[] {
  try {
    return readdirSync(join(root, "memory"), { recursive: true }).filter(
      (p): p is string => typeof p === "string" && p.endsWith(".md"),
    );
  } catch {
    return [];
  }
}

describe("createFlushWriter (T6)", () => {
  it("runs ONE silent tool turn over the leaving segment, its memory_write landing on disk + index", async () => {
    const f = fresh();
    // Step 1: the extractor calls memory_write for a durable promise. Step 2: it replies DONE (loop ends).
    const model = scriptedGenerateModel([
      { kind: "tool", toolCallId: "c1", toolName: "memory_write", input: { type: "relationship", content: "答应帮她搬家", importance: 10 } },
      { kind: "text", deltas: ["DONE"] },
    ]);
    const writer = createFlushWriter({ model, createTools: (id) => f.memory.createTools(id) });

    await writer.run({ characterId: "taki", segment: seg("下周要搬家好烦", "我来帮你") });

    // The tool write reached the store (file + index): a relationship file with the promise exists.
    const files = memoryFiles(f.root);
    const rel = files.find((p) => p.includes("relationship")) ?? "";
    expect(rel).not.toBe("");
    expect(readFileSync(join(f.root, "memory", rel), "utf8")).toContain("答应帮她搬家");

    // The model saw exactly the leaving segment as its prompt (a background turn, not the whole history).
    expect(model.doGenerateCalls).toHaveLength(2); // tool step + DONE step
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? []);
    expect(prompt).toContain("下周要搬家好烦");
    expect(prompt).toContain("我来帮你");

    // Silent turn: NOTHING was written to the timeline (no user/assistant rows), so no WS event could fire.
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("discards the model's text output (no timeline rows) even when it writes nothing", async () => {
    const f = fresh();
    const model = scriptedGenerateModel([{ kind: "text", deltas: ["nothing durable here, DONE"] }]);
    const writer = createFlushWriter({ model, createTools: (id) => f.memory.createTools(id) });

    await writer.run({ characterId: "taki", segment: seg("闲聊", "嗯嗯") });

    expect(memoryFiles(f.root)).toEqual([]);
    expect(f.conversation.history("taki")).toEqual([]);
  });
});
