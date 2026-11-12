import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { ChatActivitySchema, TimelineCommittedSchema, type ChatActivity, type TimelineCommitted } from "@taki/shared";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { midStreamErrorModel, scriptedModel, slowStreamingModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createChatTurnActivity } from "./chat-activity.ts";
import { createChatAgent } from "./chat-agent.ts";
import * as recordingModule from "./turn-recording.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.cleanup(); vi.restoreAllMocks(); });
function fixture() {
  const base = createCompanionFixture(); fixtures.push(base);
  const repo = createTimelineRepo(base.db);
  const commits: TimelineCommitted[] = [];
  const events: ChatActivity[] = [];
  const store = createConversationStore({ repo, onCommit: (batch) => commits.push(TimelineCommittedSchema.parse(batch)) });
  const activity = createChatTurnActivity({ identity: { characterId: "taki", messageId: "accepted-message" },
    publish: (event) => events.push(ChatActivitySchema.parse(event)) });
  activity.start();
  return { ...base, repo, store, commits, events, activity };
}
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

describe("SDK activity and exceptional turn persistence", () => {
  it("persists completed A/tool/B/tool steps once before a later provider error, preserving pre-conversion MCP failure", async () => {
    // The SDK's default error callback also writes to console; this fixture verifies the Core event/persistence boundary.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fixture();
    const scripted = scriptedModel([
      { kind: "textTool", deltas: ["A"], toolCallId: "call-a", toolName: "echo", input: {} },
      { kind: "textTool", deltas: ["B"], toolCallId: "call-b", toolName: "echo", input: {} },
    ]);
    const failing = midStreamErrorModel(["C"], new Error("PRIVATE_PROVIDER_PAYLOAD"));
    let requests = 0;
    const model = new MockLanguageModelV4({ doStream: (options) => ++requests <= 2 ? scripted.doStream(options) : failing.doStream(options) });
    let calls = 0;
    const execute = vi.fn(async () => ({ isError: ++calls === 1, content: [{ type: "text" as const, text: "useful result" }] }));
    const echo = tool({ inputSchema: z.object({}), execute,
      toModelOutput: ({ output }) => ({ type: "content" as const, value: output.content }) });
    const agent = createChatAgent({ model, store: f.store, memory: f.memory, extraTools: { echo } });
    await expect(drain(agent.stream({ characterId: "taki", message: "fixture" }, { activity: f.activity }))).rejects.toThrow("PRIVATE_PROVIDER_PAYLOAD");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(f.commits).toHaveLength(1);
    expect(f.repo.latestAscending("taki", 20).map((row) => row.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    const rows = f.commits[0]!.entries;
    expect(rows.at(-1)?.content).toBe("C");
    const results = rows.filter((row) => row.role === "tool");
    expect(results.map((row) => row.presentation?.references[0])).toMatchObject([{ outcome: "failed" }, { outcome: "completed" }]);
    expect(results.map((row) => row.presentation?.references[0]?.itemId)[0]).not.toBe(results[1]?.presentation?.references[0]?.itemId);
    expect(results[0]?.parts?.[0]).toMatchObject({ output: { type: "content", value: [{ type: "text", text: "useful result" }] } });
    expect(JSON.stringify(f.events)).not.toContain("PRIVATE_PROVIDER_PAYLOAD");
    expect(JSON.stringify(f.events)).not.toContain("useful result");
    expect(JSON.stringify(f.store.history("taki"))).toContain("useful result");
    expect(JSON.stringify(f.store.history("taki"))).not.toContain("accepted-message");
  });

  it("shows ordered text and receipt while the real tool is still pending, then commits with the same visible keys", async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const model = scriptedModel([
      { kind: "textTool", deltas: ["A"], toolCallId: "call", toolName: "echo", input: {} },
      { kind: "text", deltas: ["B"] },
    ]);
    const echo = tool({ inputSchema: z.object({}), execute: async () => { await pending; return { ok: true }; } });
    const agent = createChatAgent({ model, store: f.store, memory: f.memory, extraTools: { echo } });
    const running = drain(agent.stream({ characterId: "taki", message: "fixture" }, { activity: f.activity }));
    await vi.waitFor(() => expect(f.events.some((event) => event.kind === "tool.received")).toBe(true));
    expect(f.events.filter((event) => event.kind === "text.delta").map((event) => event.delta)).toEqual(["A"]);
    expect(f.events.some((event) => event.kind === "tool.terminal")).toBe(false);
    expect(f.commits).toEqual([]);
    release();
    await expect(running).resolves.toBe("AB");
    const liveKeys = f.events.flatMap((event) => event.kind === "text.delta" || event.kind === "tool.received" ? [event.itemId] : []);
    const persistedKeys = f.commits[0]?.entries.flatMap((row) => row.presentation?.references.map((ref) => ref.itemId) ?? []);
    expect(new Set(persistedKeys)).toEqual(new Set(liveKeys));
    expect(f.events.some((event) => event.kind === "tool.terminal" && event.outcome === "completed")).toBe(true);
  });

  it("commits delivered partial text when a direct iterator consumer returns early", async () => {
    const f = fixture();
    const agent = createChatAgent({ model: slowStreamingModel(["A", "B"], 10), store: f.store, memory: f.memory });
    const iterator = agent.stream({ characterId: "taki", message: "fixture" }, { activity: f.activity })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe("A");
    await iterator.return?.();
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]?.entries.map((row) => row.content)).toEqual(["A"]);
  });

  it.each([0, 1])("commits step %i once when onStepEnd precedes iterator.return and unread public finish-step", async (lastStep) => {
    const f = fixture();
    let stepCaptured!: () => void;
    const captured = new Promise<void>((resolve) => { stepCaptured = resolve; });
    const publicParts: string[] = [];
    const createRecording = recordingModule.createTurnRecording;
    vi.spyOn(recordingModule, "createTurnRecording").mockImplementation(() => {
      const recording = createRecording();
      return { ...recording,
        capture(stepNumber, messages) {
          recording.capture(stepNumber, messages);
          if (stepNumber === lastStep) stepCaptured();
        },
        observe(part) { publicParts.push(part.type); recording.observe(part); },
      };
    });
    // The second variant deliberately repeats the exact text in a different real SDK step. Equal content
    // must not be deduplicated; only the consumed partial belonging to an already captured step is covered.
    const model = lastStep === 0 ? streamingMockModel(["A"]) : scriptedModel([
      { kind: "textTool", deltas: ["A"], toolCallId: "call", toolName: "echo", input: {} },
      { kind: "text", deltas: ["A"] },
    ]);
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      extraTools: { echo: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true }) }) } });
    const iterator = agent.stream({ characterId: "taki", message: "fixture" }, { activity: f.activity })[Symbol.asyncIterator]();
    for (let step = 0; step <= lastStep; step += 1) expect((await iterator.next()).value).toBe("A");
    await captured;
    expect(publicParts.filter((part) => part === "finish-step")).toHaveLength(lastStep);
    await iterator.return?.();
    expect(f.commits).toHaveLength(1);
    const texts = f.commits[0]!.entries.filter((row) => row.role === "assistant");
    expect(texts.map((row) => row.parts?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? row.content))
      .toEqual(lastStep === 0 ? ["A"] : ["A", "A"]);
    expect(new Set(texts.flatMap((row) => row.presentation?.references.filter((ref) => ref.kind === "text").map((ref) => ref.itemId) ?? [])).size)
      .toBe(lastStep + 1);
  });

  it("keeps repeated SDK call IDs as distinct live/persisted invocations without rewriting canonical DB identity", async () => {
    const f = fixture();
    const model = scriptedModel([
      { kind: "textTool", deltas: ["A"], toolCallId: "same", toolName: "echo", input: {} },
      { kind: "textTool", deltas: ["B"], toolCallId: "same", toolName: "echo", input: {} },
      { kind: "text", deltas: ["C"] },
    ]);
    const execute = vi.fn(async () => ({ ok: true }));
    const agent = createChatAgent({ model, store: f.store, memory: f.memory,
      extraTools: { echo: tool({ inputSchema: z.object({}), execute }) } });
    await expect(drain(agent.stream({ characterId: "taki", message: "fixture" }, { activity: f.activity }))).resolves.toBe("ABC");
    expect(execute).toHaveBeenCalledTimes(2);
    const receipts = f.events.filter((event) => event.kind === "tool.received");
    expect(receipts.map((event) => event.toolCallId)).toEqual(["same", "same"]);
    expect(new Set(receipts.map((event) => event.itemId)).size).toBe(2);
    const rows = f.repo.latestAscending("taki", 20);
    const callRows = rows.filter((row) => row.parts?.some((part) => part.type === "tool-call"));
    expect(callRows.flatMap((row) => row.parts?.filter((part) => part.type === "tool-call").map((part) => part.toolCallId) ?? [])).toEqual(["same", "same"]);
    expect(callRows.flatMap((row) => row.presentation?.references.filter((ref) => ref.kind === "tool").map((ref) => ref.itemId) ?? []))
      .toEqual(receipts.map((event) => event.itemId));
  });
});
