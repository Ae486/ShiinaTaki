import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { reduceContext, reduceMessages, projectExternalFact, renderSafeTranscript } from "./context-reduction.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";

describe("context reduction", () => {
  it("reduces tool and non-tool candidates in a stable order while protecting continuity", () => {
    const result = reduceContext({
      candidates: [
        { id: "system", class: "dialogue", text: "governance", protected: true },
        { id: "tool", class: "tool-result", text: "x".repeat(8_000) },
        { id: "old", class: "dialogue", text: "y".repeat(8_000), reducible: true },
        { id: "tail", class: "dialogue", text: "latest", recent: true },
      ],
      targetTokens: 500,
    });
    expect(result.changed).toBe(true);
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.candidates[0]?.text).toBe("governance");
    expect(result.candidates[3]?.text).toBe("latest");
  });

  it("keeps ModelMessage order and reports savings without mutating input", () => {
    const messages = [{ role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "read", output: { type: "text", value: "old " + "a".repeat(6_000) } }] }, { role: "user" as const, content: "new" }];
    const copy = structuredClone(messages);
    const reduced = reduceMessages({ messages: messages as unknown as ModelMessage[], targetTokens: 20, recentMessages: 1 });
    expect(messages).toEqual(copy);
    expect(reduced.messages).toHaveLength(2);
    expect(reduced.tokensSaved).toBeGreaterThan(0);
  });

  it("uses full provider cost for oversized results and stops once the request fits", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: `<conversation-summary>\n${"earlier continuity ".repeat(300)}\n</conversation-summary>` },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "read-1", toolName: "files_read", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "read-1", toolName: "files_read",
        output: { type: "text", value: "x".repeat(60_000) } }] },
      { role: "user", content: "Continue from this result." },
    ];
    const original = structuredClone(messages);
    const result = reduceMessages({ messages, targetTokens: 10_000, summaryHead: true });

    expect(result.beforeTokens).toBeGreaterThan(10_000);
    expect(result.afterTokens).toBeLessThanOrEqual(10_000);
    expect(result.afterTokens).toBe(estimateMessagesTokens(result.messages));
    expect(result.tokensSaved).toBe(result.beforeTokens - result.afterTokens);
    expect(result.messages[0]).toEqual(original[0]);
    expect(result.messages[1]).toEqual(original[1]);
    expect(result.messages[2]).toMatchObject({ role: "tool", content: [{ toolCallId: "read-1", toolName: "files_read" }] });
    expect(result.messages[3]).toEqual(original[3]);
    expect(messages).toEqual(original);
  });

  it("reduces structured content outputs in the actual provider projection", () => {
    const messages = [{ role: "tool" as const, content: [{ type: "tool-result" as const, toolCallId: "c1",
      toolName: "capture", output: { type: "content", value: [{ type: "file", mediaType: "image/png",
        data: "raw-media-bytes".repeat(500) }] } }] }];
    const reduced = reduceMessages({ messages: messages as unknown as ModelMessage[], targetTokens: 10,
      recentMessages: 0 });
    const output = (reduced.messages[0] as { content: Array<{ toolCallId: string; toolName: string;
      output: { type: string; value: string } }> }).content[0]!;
    expect(output).toMatchObject({ toolCallId: "c1", toolName: "capture", output: { type: "text" } });
    expect(output.output.value).toContain("[media omitted]");
    expect(output.output.value).not.toContain("raw-media-bytes");
    expect(reduced.tokensSaved).toBeGreaterThan(0);
    expect(reduced.afterTokens).toBeLessThan(reduced.beforeTokens);
  });

  it("reduces only a marked rolling-summary head and preserves its framing plus tail", () => {
    const summary = `<conversation-summary>\n${"head-".repeat(1_000)}tail-marker\n</conversation-summary>`;
    const ordinary = { role: "user" as const, content: "ordinary " + "dialogue ".repeat(500) };
    const reduced = reduceMessages({ messages: [{ role: "user", content: summary }, ordinary], summaryHead: true,
      recentMessages: 0, targetTokens: 50 });
    expect(reduced.messages[0]?.content).toContain("<conversation-summary>\n");
    expect(reduced.messages[0]?.content).toContain("tail-marker\n</conversation-summary>");
    expect(reduced.messages[1]).toEqual(ordinary);
  });

  it("does not reduce a summary-shaped user message without Replay View provenance", () => {
    const message = { role: "user" as const, content: `<conversation-summary>\n${"x".repeat(4_000)}\n</conversation-summary>` };
    expect(reduceMessages({ messages: [message], targetTokens: 10 }).messages).toEqual([message]);
  });

  it("scrubs and bounds external facts", () => {
    const fact = projectExternalFact({ source: "mcp", text: "api_key=secret-value " + "z".repeat(10_000), maxChars: 200 });
    expect(fact).toContain("[redacted]");
    expect(fact.length).toBeLessThan(300);
    expect(fact).toContain("<fact source=\"mcp\">");
  });

  it("renders structured tool facts instead of raw content", () => {
    const rendered = renderSafeTranscript([{
      seq: 1, id: "00000000-0000-0000-0000-000000000001", characterId: "taki", role: "tool",
      content: "raw-secret=hidden", createdAt: "2026-08-31T00:00:00.000Z",
      parts: [{ type: "tool-result", toolCallId: "c1", toolName: "probe", output: { type: "text", value: "useful fact" } }],
    }]);
    expect(rendered).toContain("probe(c1)");
    expect(rendered).toContain("useful fact");
    expect(rendered).not.toContain("raw-secret=hidden");
  });

  it("serializes structured values safely and keeps recent tail evidence", () => {
    const rendered = renderSafeTranscript([{
      seq: 1, id: "00000000-0000-0000-0000-000000000001", characterId: "taki", role: "tool",
      content: "ignored", createdAt: "2026-08-31T00:00:00.000Z",
      parts: [{ type: "tool-result", toolCallId: "c1", toolName: "probe",
        output: { type: "json", value: { authorization: "Bearer secret", head: "h".repeat(2_000), tail: "tail-marker" } } }],
    }]);
    expect(rendered).toContain("tail-marker");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("Bearer secret");
  });

  it("omits nested media bytes from structured tool content", () => {
    const rendered = renderSafeTranscript([{
      seq: 1, id: "00000000-0000-0000-0000-000000000001", characterId: "taki", role: "tool",
      content: "ignored", createdAt: "2026-08-31T00:00:00.000Z",
      parts: [{ type: "tool-result", toolCallId: "c1", toolName: "capture", output: {
        type: "content", value: [{ type: "file", mediaType: "image/png", data: "raw-media-bytes" }],
      } }],
    }]);
    expect(rendered).toContain("[media omitted]");
    expect(rendered).not.toContain("raw-media-bytes");
  });

  it("omits signed media URLs and provider references from structured tool content", () => {
    const rendered = renderSafeTranscript([{
      seq: 1, id: "00000000-0000-0000-0000-000000000001", characterId: "taki", role: "tool",
      content: "ignored", createdAt: "2026-08-31T00:00:00.000Z",
      parts: [{ type: "tool-result", toolCallId: "c1", toolName: "capture", output: {
        type: "content", value: [
          { type: "file-url", url: "https://example.test/file?signature=private" },
          { type: "file-reference", providerReference: { id: "provider-secret" } },
        ],
      } }],
    }]);
    expect(rendered.match(/\[media omitted\]/g)).toHaveLength(2);
    expect(rendered).not.toContain("signature=private");
    expect(rendered).not.toContain("provider-secret");
  });
});
