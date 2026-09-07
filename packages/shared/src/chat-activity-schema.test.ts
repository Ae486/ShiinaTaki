import { describe, expect, it } from "vitest";
import {
  CHAT_ACTIVITY_MAX_ITEMS, CHAT_ACTIVITY_MAX_TEXT_BYTES, ChatActivitySchema, ChatActivityReadParamsSchema,
  ChatActivityReadResultSchema, appendedUtf8TextBytes, utf8TextBytes,
} from "./chat-activity-schema.ts";

const identity = { characterId: "taki", messageId: "message", runId: "run", attemptId: "attempt", seq: 1 };
const tool = { itemId: "invocation", order: 1, toolCallId: "provider-call", toolName: "route", displayName: "检索" };

describe("ordered chat activity wire", () => {
  it("round-trips every fact without requiring invented Run identities for legacy callers", () => {
    const facts = [
      { kind: "turn.started" }, { kind: "text.delta", itemId: "segment", order: 0, delta: "你好" },
      { kind: "tool.received", ...tool }, { kind: "tool.phase", itemId: tool.itemId, phase: "approval" },
      { kind: "tool.terminal", itemId: tool.itemId, outcome: "failed", durationMs: 12, message: "工具返回了错误" },
      { kind: "turn.terminal", outcome: "completed" },
    ];
    for (const fact of facts) {
      const event = { ...identity, ...fact };
      expect(ChatActivitySchema.parse(event)).toEqual(event);
      const legacy = { characterId: identity.characterId, messageId: identity.messageId, seq: identity.seq, ...fact };
      expect(ChatActivitySchema.parse(legacy)).toEqual(legacy);
    }
  });

  it("rejects raw payloads, unknown phases and non-monotonic-domain sequence numbers", () => {
    expect(ChatActivitySchema.safeParse({ ...identity, kind: "tool.received", ...tool, input: { secret: "secret" } }).success).toBe(false);
    expect(ChatActivitySchema.safeParse({ ...identity, kind: "tool.terminal", itemId: tool.itemId, outcome: "success", output: {} }).success).toBe(false);
    expect(ChatActivitySchema.safeParse({ ...identity, kind: "tool.phase", itemId: tool.itemId, phase: "running" }).success).toBe(false);
    expect(ChatActivitySchema.safeParse({ ...identity, kind: "turn.started", seq: 0 }).success).toBe(false);
    expect(ChatActivityReadParamsSchema.safeParse({ characterId: "taki", resend: true }).success).toBe(false);
  });

  it("retains valid captured labels and omits invalid optional ones", () => {
    const event = { ...identity, kind: "tool.received", ...tool, displayName: "x".repeat(241) };
    expect(ChatActivitySchema.parse(event)).not.toHaveProperty("displayName", event.displayName);
    expect(ChatActivitySchema.parse({ ...event, displayName: "名".repeat(240) })).toHaveProperty("displayName", "名".repeat(240));
  });

  it("keeps complete, idle and unavailable snapshots distinct and rejects duplicate identities", () => {
    const item = { kind: "text", itemId: "segment", order: 0, text: "A" };
    const snapshot = { ...identity, status: "terminal", outcome: "completed", items: [item] };
    expect(ChatActivityReadResultSchema.parse(snapshot)).toEqual(snapshot);
    expect(ChatActivityReadResultSchema.parse({ status: "idle", characterId: "taki" })).toEqual({ status: "idle", characterId: "taki" });
    const unavailable = { ...identity, status: "unavailable", reason: "capacity", terminal: { outcome: "completed" } };
    expect(ChatActivityReadResultSchema.parse(unavailable)).toEqual(unavailable);
    expect(ChatActivityReadResultSchema.safeParse({ ...unavailable, items: [item] }).success).toBe(false);
    expect(ChatActivityReadResultSchema.safeParse({ ...snapshot, items: [item, item] }).success).toBe(false);
  });

  it("enforces item and UTF-8 display-text limits on incoming snapshots", () => {
    const item = { kind: "text", itemId: "segment", order: 0, text: "x".repeat(CHAT_ACTIVITY_MAX_TEXT_BYTES) };
    const snapshot = { ...identity, status: "active", items: [item] };
    expect(ChatActivityReadResultSchema.safeParse(snapshot).success).toBe(true);
    expect(ChatActivityReadResultSchema.safeParse({ ...snapshot, items: [{ ...item, text: item.text + "汉" }] }).success).toBe(false);
    const items = Array.from({ length: CHAT_ACTIVITY_MAX_ITEMS + 1 }, (_, order) => ({ ...item, itemId: String(order), order, text: "" }));
    expect(ChatActivityReadResultSchema.safeParse({ ...snapshot, items }).success).toBe(false);
  });

  it("counts a Unicode pair split across deltas exactly without re-encoding the reply", () => {
    const a = "A\uD83D";
    const b = "\uDE42B";
    expect(utf8TextBytes(a) + appendedUtf8TextBytes(a, b)).toBe(utf8TextBytes(a + b));
    expect(appendedUtf8TextBytes("汉", "字")).toBe(3);
  });
});
