import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { createChatAgent } from "./chat-agent.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { midStreamErrorModel, scriptedModel, slowStreamingModel } from "../testing/mock-language-model.ts";
import type { PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); });
function fresh() { const f = createCompanionFixture(); fixtures.push(f); return f; }
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

describe("positive primary commit witnesses", () => {
  it("reports only actual primary commit receipts, excluding interleaved autonomous speech", async () => {
    const f = fresh(); const order: string[] = []; const commits: PrimaryConversationCommit[] = [];
    const model = scriptedModel([{ kind: "tool", toolCallId: "c", toolName: "probe", input: {} }, { kind: "text", deltas: ["primary response"] }]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory,
      extraTools: { probe: tool({ inputSchema: z.object({}), execute: async () => {
        f.conversation.appendAssistant("taki", "interleaved autonomous speech"); return { safe: true };
      } }) },
      onPrimaryCommitted: (input) => { order.push("committed"); commits.push(input); },
      autoMemory: { onTurnCompleted: async () => { order.push("maintenance"); } } });
    await drain(agent.stream({ characterId: "taki", message: "primary user" }, { runId: "primary-run" }));
    expect(order).toEqual(["committed", "maintenance"]);
    expect(commits).toHaveLength(1); expect(commits[0]?.runId).toBe("primary-run");
    expect(commits[0]?.entries.map((entry) => entry.seq)).toEqual([1, 3, 4, 5]);
    expect(commits[0]?.entries.map((entry) => entry.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    const rows = createTimelineRepo(f.db).latestAscending("taki", 20);
    for (const entry of commits[0]!.entries) expect(rows.find((row) => row.id === entry.id)).toEqual(entry);
    expect(JSON.stringify(commits)).not.toContain("interleaved autonomous speech");
    expect(JSON.stringify(rows)).toContain("interleaved autonomous speech");
  });

  it("does not prove rows from a silent cancelled/retracted turn", async () => {
    const f = fresh(); const callback = vi.fn(); const controller = new AbortController(); controller.abort();
    const agent = createChatAgent({ model: slowStreamingModel(["never"], 20), store: f.conversation, memory: f.memory, onPrimaryCommitted: callback });
    expect(await drain(agent.stream({ characterId: "taki", message: "cancel me" }, { signal: controller.signal }))).toBe("");
    expect(f.conversation.history("taki")).toEqual([]); expect(callback).not.toHaveBeenCalled();
  });

  it("records actual partial primary text on a thrown ending without changing the original failure", async () => {
    const f = fresh(); const error = new Error("stream failed"); const commits: PrimaryConversationCommit[] = [];
    const maintenance = vi.fn(async () => undefined);
    const agent = createChatAgent({ model: midStreamErrorModel(["visible partial"], error), store: f.conversation, memory: f.memory,
      onPrimaryCommitted: (input) => commits.push(input), autoMemory: { onTurnCompleted: maintenance } });
    await expect(drain(agent.stream({ characterId: "taki", message: "hi" }))).rejects.toBe(error);
    expect(commits[0]?.entries.map((entry) => entry.content)).toEqual(["hi", "visible partial"]);
    expect(maintenance).not.toHaveBeenCalled();
  });
});
