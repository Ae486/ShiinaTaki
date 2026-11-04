import { describe, expect, it } from "vitest";
import { TimelineEntrySchema } from "@taki/shared";
import { contentOrigin, retainContentOrigin } from "./context-attribution.ts";
import { toEntryInput, toModelMessage } from "./turn-mapping.ts";
import { reduceMessages } from "./context-reduction.ts";
import { nativeReplayMessages } from "./native-image-replay.ts";
import { nativeImageSource } from "./native-image-projection.ts";

describe("retained context origin", () => {
  it.each(["builtin", "mcp", "skill", "unknown"] as const)("preserves %s origin through safe persistence, SDK replay and private reduction", (origin) => {
    const message = { role: "tool" as const, content: [retainContentOrigin({ type: "tool-result" as const, toolCallId: "call", toolName: "bridge",
      output: { type: "text" as const, value: "Retained result ".repeat(2000) } }, origin)] };
    const input = toEntryInput(message);
    const entry = TimelineEntrySchema.parse({ ...input, seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki", createdAt: "2026-11-02T00:00:00Z" });
    const replay = toModelMessage(entry);
    expect(replay?.role).toBe("tool");
    if (replay?.role !== "tool") throw new Error("expected tool replay");
    expect(contentOrigin(replay.content[0])).toBe(origin);
    expect(JSON.stringify(replay)).not.toContain("contextOrigin");
    const reduced = reduceMessages({ messages: [replay], recentMessages: 0 }).messages[0];
    if (reduced?.role !== "tool") throw new Error("expected reduced tool replay");
    expect(contentOrigin(reduced.content[0])).toBe(origin);
    expect(JSON.stringify(reduced).length).toBeLessThan(JSON.stringify(replay).length);
  });

  it("leaves old absence unknown and retains native screenshot origin after replay in a user role", () => {
    const entry = TimelineEntrySchema.parse({ seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki", createdAt: "2026-11-02T00:00:00Z",
      role: "tool", content: "Tool result", parts: [{ type: "tool-result", toolCallId: "old", toolName: "old", output: { type: "text", value: "old result" } },
        { type: "tool-result", toolCallId: "image", toolName: "capture", contextOrigin: "mcp", output: { type: "text", value: "evidence" },
          imageRefs: [{ mediaType: "image/png", ref: "attachments/evidence.png" }] }] });
    const replay = nativeReplayMessages(entry, { read: () => ({ ok: true, mediaType: "image/png", dataBase64: "AA==" }) });
    if (replay[0]?.role !== "tool") throw new Error("expected tool replay");
    expect(contentOrigin(replay[0].content[0])).toBe("unknown");
    expect(replay[1]?.role).toBe("user");
    expect(nativeImageSource(replay[1]!)?.kind).toBe("tool");
    expect(nativeImageSource(replay[1]!)?.kind === "tool" ? nativeImageSource(replay[1]!) : undefined).toMatchObject({ contextOrigin: "mcp" });
  });
});
