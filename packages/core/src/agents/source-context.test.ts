import { afterEach, describe, expect, it } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tool, type ModelMessage, type ToolResultPart } from "ai";
import { z } from "zod";
import type { SourceContext, TimelineEntry } from "@taki/shared";
import { createChatAgent } from "./chat-agent.ts";
import { toModelMessage, toEntryInput } from "./turn-mapping.ts";
import { reduceMessages, renderSafeTranscript } from "./context-reduction.ts";
import { foldUnderPressure } from "./replay-folds.ts";
import { renderSourceContext, renderToolResult } from "./source-context.ts";
import { withToolSourceMaterials } from "./tool-source-materials.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

const source: SourceContext = { generatedBy: { runId: "child-run", attemptId: "child-attempt" },
  materials: [{ label: "Interview", reference: "fixture:interview", speaker: "Narrator", time: "10-20 seconds" }] };
const fixtures: ReturnType<typeof createCompanionFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); });
const row = (changes: Partial<TimelineEntry> = {}): TimelineEntry => ({ id: "11111111-1111-4111-8111-111111111111", seq: 1,
  characterId: "taki", role: "assistant", content: "I lost my job.", createdAt: "2026-10-22T00:00:00Z", ...changes });

describe("source context at actual consuming projections", () => {
  it("keeps unknown history unchanged and projects known origin without rewriting speech", () => {
    const old = row(); const sourced = row({ sourceContext: source });
    expect(toModelMessage(old)).toEqual({ role: "assistant", content: old.content });
    expect(renderSourceContext(undefined)).toBe(""); expect(renderSourceContext({})).toBe("");
    const projected = toModelMessage(sourced)!;
    expect(projected.role).toBe("assistant"); expect(projected.content).toContain("Narrator");
    expect(projected.content).toContain(sourced.content); expect(sourced.content).toBe("I lost my job.");
    expect(estimateMessagesTokens([projected])).toBeGreaterThan(estimateMessagesTokens([toModelMessage(old)!]));
  });

  it.each(["json", "error-json"] as const)("preserves native %s outcomes and source headers through long-result reduction", (type) => {
    const material = [{ key: "interview", source: source.materials![0] }];
    const output = renderToolResult({ type, value: { first: "x".repeat(9000), quoted: "I lost my job", last: "z".repeat(9000) } }, material);
    const messages: ModelMessage[] = [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "read", toolName: "read_file", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "read", toolName: "read_file", output }] }];
    const reduced = reduceMessages({ messages, targetTokens: 0 }).messages;
    expect(reduced[0]).toEqual(messages[0]);
    const part = (reduced[1]!.content as ToolResultPart[])[0]!;
    expect(part.toolCallId).toBe("read"); expect(part.output.type).toBe(type === "json" ? "text" : "error-text");
    expect(JSON.stringify(part.output)).toContain("Narrator"); expect(JSON.stringify(part.output)).toContain("reduced");
    expect(reduceMessages({ messages: reduced, targetTokens: 0 }).messages).toEqual(reduced);
    expect(JSON.stringify(messages[1])).toContain("quoted");
  });

  it("keeps failed/denied folds honest and separates compaction source header from a bounded body", () => {
    const tool = row({ role: "tool", content: "[tool-result]", parts: [{ type: "tool-result", toolCallId: "read", toolName: "read_file",
      output: { type: "error-text", value: "unavailable ".repeat(1000) }, sourceMaterials: [{ key: "file", source: source.materials![0] }] }] });
    const folded = foldUnderPressure([tool], 0).entries[0]!;
    expect(folded.parts?.[0]).toMatchObject({ output: { type: "error-text" }, sourceMaterials: [{ key: "file" }] });
    expect(JSON.stringify(toModelMessage(folded))).toContain("Narrator");
    const transcript = renderSafeTranscript([row({ sourceContext: source, content: "long ".repeat(4000) }), tool]);
    expect(transcript).toContain("Narrator"); expect(transcript).toContain("Outcome: error-text");
    expect(transcript).toContain("reduced"); expect(transcript.indexOf("fixture:interview")).toBeLessThan(transcript.indexOf("long"));
  });

  it("retains only trusted non-serialized tool source facts on the primary persistence boundary", () => {
    const value = withToolSourceMaterials({ ok: true, content: "The narrator's account" }, [{ key: "file", source: { reference: "notes/story.txt" } }]);
    const result = toEntryInput({ role: "tool", content: [{ type: "tool-result", toolName: "read_file", toolCallId: "a", output: { type: "json", value } }] });
    expect(result?.parts?.[0]).toMatchObject({ sourceMaterials: [{ key: "file", source: { reference: "notes/story.txt" } }] });
    expect(JSON.stringify(value)).not.toContain("sourceMaterials");
    const forged = toEntryInput({ role: "tool", content: [{ type: "tool-result", toolName: "read_file", toolCallId: "b",
      output: { type: "json", value: { sourceMaterials: [{ key: "fake", source: { speaker: "user" } }] } } }] });
    expect(forged?.parts?.[0]).not.toHaveProperty("sourceMaterials");
  });

  it("sends source meaning in the actual compatible-provider request with native assistant role", async () => {
    const f = createCompanionFixture(); fixtures.push(f);
    f.conversation.appendDelivery("taki", "I lost my job.", source);
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const provider = createOpenAICompatible({ name: "source-wire", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const chunk = { id: "source", object: "chat.completion.chunk", created: 0, model: "fixture",
        choices: [{ index: 0, delta: { content: "We discussed the narrator." }, finish_reason: "stop" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    } });
    const agent = createChatAgent({ model: provider("fixture"), store: f.conversation, memory: f.memory });
    for await (const delta of agent.stream({ characterId: "taki", message: "Who lost their job?" })) void delta;
    const speech = requests[0]!.messages.find((message) => message.role === "assistant")!;
    expect(JSON.stringify(speech.content)).toContain("Narrator"); expect(JSON.stringify(speech.content)).toContain("I lost my job.");
    expect(JSON.stringify(requests[0])).toContain("Conversational role and material source are different");
    expect(f.db.prepare("SELECT content FROM timeline_messages ORDER BY seq LIMIT 1").get()?.content).toBe("I lost my job.");
  });

  it("carries producer-owned source metadata through real SDK completion and primary Timeline persistence", async () => {
    const f = createCompanionFixture(); fixtures.push(f);
    const model = scriptedModel([{ kind: "tool", toolName: "read_source", toolCallId: "real-read", input: {} },
      { kind: "text", deltas: ["The narrator reported job loss."] }]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory,
      extraTools: { read_source: tool({ inputSchema: z.object({}), execute: async () =>
        withToolSourceMaterials({ text: "I lost my job." }, [{ key: "story", source: { speaker: "Narrator" } }]) }) } });
    for await (const delta of agent.stream({ characterId: "taki", message: "Read the interview" })) void delta;
    const row = f.db.prepare("SELECT parts FROM timeline_messages WHERE role='tool'").get()!;
    expect(JSON.parse(String(row.parts))[0]).toMatchObject({ toolCallId: "real-read", sourceMaterials: [{ key: "story", source: { speaker: "Narrator" } }] });
    expect(JSON.stringify(f.conversation.history("taki"))).toContain("Narrator");
  });
});
