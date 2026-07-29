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
    // Step 1: the extractor reaches for `relationship` (the always-visible rung) to keep a promise — the background
    // tool's schema rejects it. Step 2: it retries in a permitted layer. Step 3: DONE. The promise is still SAVED,
    // which was this test's original point; only the rung it lands on changed (Q11-1 covers every automatic path).
    const model = scriptedGenerateModel([
      { kind: "tool", toolCallId: "c1", toolName: "memory_write", input: { type: "relationship", content: "答应帮她搬家", importance: 10 } },
      { kind: "tool", toolCallId: "c2", toolName: "memory_write", input: { type: "episodes", content: "答应帮她搬家", importance: 10 } },
      { kind: "text", deltas: ["DONE"] },
    ]);
    const writer = createFlushWriter({ model, createTools: (id) => f.memory.createBackgroundTools(id) });

    const { writes } = await writer.run({ characterId: "taki", segment: seg("下周要搬家好烦", "我来帮你") });

    // The rejected call never reached the store, and it did NOT inflate the write count (a rejection is not a write).
    expect(writes).toBe(1);
    const files = memoryFiles(f.root);
    expect(files.some((p) => p.includes("relationship"))).toBe(false);

    // The retry reached the store (file + index) with its importance clamped below the pin line.
    const episode = files.find((p) => p.includes("episodes")) ?? "";
    expect(episode).not.toBe("");
    const body = readFileSync(join(f.root, "memory", episode), "utf8");
    expect(body).toContain("答应帮她搬家");
    expect(body).toContain("importance: 7");

    // The model saw exactly the leaving segment as its prompt (a background turn, not the whole history).
    expect(model.doGenerateCalls).toHaveLength(3);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? []);
    expect(prompt).toContain("下周要搬家好烦");
    expect(prompt).toContain("我来帮你");

    // Silent turn: NOTHING was written to the timeline (no user/assistant rows), so no WS event could fire.
    expect(f.conversation.history("taki")).toEqual([]);
  });

  it("discards the model's text output (no timeline rows) even when it writes nothing", async () => {
    const f = fresh();
    const model = scriptedGenerateModel([{ kind: "text", deltas: ["nothing durable here, DONE"] }]);
    const writer = createFlushWriter({ model, createTools: (id) => f.memory.createBackgroundTools(id) });

    const { writes } = await writer.run({ characterId: "taki", segment: seg("闲聊", "嗯嗯") });

    // Zero writes is the T5-R15 normal outcome, and the count is what lets the caller log it as a skip.
    expect(writes).toBe(0);
    expect(memoryFiles(f.root)).toEqual([]);
    expect(f.conversation.history("taki")).toEqual([]);
  });
});
