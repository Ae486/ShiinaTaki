import { describe, expect, it } from "vitest";
import { CHAT_ACTIVITY_MAX_ITEMS, CHAT_ACTIVITY_MAX_TEXT_BYTES, ChatActivityReadResultSchema } from "@taki/shared";
import { createChatActivityProjection } from "./chat-activity-projection.ts";

const identity = { characterId: "taki", messageId: "message", runId: "run", attemptId: "attempt" };

describe("bounded Character activity recovery", () => {
  it("owns a complete immutable read projection and rejects older sequence/retired messages", () => {
    const projection = createChatActivityProjection();
    projection.start(identity);
    projection.apply({ ...identity, seq: 1, kind: "turn.started" });
    projection.apply({ ...identity, seq: 2, kind: "text.delta", itemId: "text", order: 0, delta: "A" });
    expect(projection.apply({ ...identity, seq: 2, kind: "text.delta", itemId: "text", order: 0, delta: "duplicate" })).toBe(false);
    const snapshot = ChatActivityReadResultSchema.parse(projection.read("taki"));
    if (snapshot.status !== "active") throw new Error("missing active snapshot");
    snapshot.items[0]!.itemId = "mutated";
    expect(projection.read("taki")).toMatchObject({ items: [{ itemId: "text", text: "A" }] });
    expect(projection.read("other")).toEqual({ status: "idle", characterId: "other" });
    projection.start({ ...identity, messageId: "new" });
    expect(projection.apply({ ...identity, seq: 3, kind: "turn.terminal", outcome: "completed" })).toBe(false);
    expect(projection.read("taki")).toMatchObject({ messageId: "new", seq: 0, items: [] });
  });

  it("returns explicit unavailability after 512 items and never rebuilds a suffix as a complete reply", () => {
    const projection = createChatActivityProjection();
    projection.start(identity);
    for (let index = 0; index <= CHAT_ACTIVITY_MAX_ITEMS; index += 1) {
      projection.apply({ ...identity, seq: index + 1, kind: "text.delta", itemId: String(index), order: index, delta: "x" });
    }
    expect(projection.read("taki")).toMatchObject({ status: "unavailable", reason: "capacity" });
    projection.apply({ ...identity, seq: CHAT_ACTIVITY_MAX_ITEMS + 2, kind: "text.delta", itemId: "suffix", order: 900, delta: "suffix" });
    projection.apply({ ...identity, seq: CHAT_ACTIVITY_MAX_ITEMS + 3, kind: "turn.terminal", outcome: "completed" });
    expect(projection.read("taki")).toMatchObject({ status: "unavailable", terminal: { outcome: "completed" } });
    expect(projection.read("taki")).not.toHaveProperty("items");
  });

  it("uses exact incremental UTF-8 bytes, including a surrogate split at the capacity boundary", () => {
    const projection = createChatActivityProjection();
    projection.start(identity);
    let seq = 0;
    for (const delta of ["x".repeat(CHAT_ACTIVITY_MAX_TEXT_BYTES - 4), "\uD83D", "\uDE42"]) {
      projection.apply({ ...identity, seq: ++seq, kind: "text.delta", itemId: "text", order: 0, delta });
    }
    expect(ChatActivityReadResultSchema.safeParse(projection.read("taki")).success).toBe(true);
    expect(projection.read("taki").status).toBe("active");
    projection.apply({ ...identity, seq: seq + 1, kind: "text.delta", itemId: "text", order: 0, delta: "a" });
    expect(projection.read("taki").status).toBe("unavailable");
  });

  it("retains truthful terminal state and disposes with the runtime rather than a UI subscription", () => {
    const projection = createChatActivityProjection();
    projection.start(identity);
    projection.apply({ ...identity, seq: 1, kind: "tool.received", itemId: "tool", order: 0, toolCallId: "call", toolName: "echo" });
    projection.apply({ ...identity, seq: 2, kind: "tool.terminal", itemId: "tool", outcome: "failed", message: "失败" });
    projection.apply({ ...identity, seq: 3, kind: "tool.phase", itemId: "tool", phase: "executing" });
    expect(projection.read("taki")).toMatchObject({ items: [{ status: { phase: "settled", outcome: "failed" } }] });
    projection.apply({ ...identity, seq: 4, kind: "turn.terminal", outcome: "failed", message: "Agent turn failed" });
    expect(projection.read("taki").status).toBe("terminal");
    projection.dispose();
    projection.start(identity);
    expect(projection.read("taki")).toEqual({ status: "idle", characterId: "taki" });
  });
});
