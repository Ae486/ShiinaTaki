import { describe, expect, it } from "vitest";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokens,
  fitToBudget,
  IMAGE_TOKENS,
  MESSAGE_OVERHEAD,
} from "./token-estimator.ts";

describe("estimateTokens (research §2 regimes)", () => {
  it("counts CJK ~1 token/char", () => {
    expect(estimateTokens("一二三四五六七八九十一二三四五六七")).toBe(17); // 17 hanzi
  });

  it("counts non-CJK ~1 token / 4 chars (ceil)", () => {
    expect(estimateTokens("a".repeat(61))).toBe(16); // ceil(61/4)
  });

  it("adds the two regimes for mixed text", () => {
    // 2 CJK + 4 ASCII -> 2 + ceil(4/4) = 3
    expect(estimateTokens("拉面abcd")).toBe(3);
  });
});

describe("fitToBudget", () => {
  const items = ["aaaa", "bbbb", "cccc"]; // each ~1 token

  it("keeps items in order until the budget is reached", () => {
    expect(fitToBudget(items, 2, (s) => s)).toEqual(["aaaa", "bbbb"]);
  });

  it("always keeps the first item even if it alone exceeds the budget (soft)", () => {
    expect(fitToBudget(["一".repeat(50), "b"], 10, (s) => s)).toEqual(["一".repeat(50)]);
  });

  it("returns [] for no items", () => {
    expect(fitToBudget([], 100, (s) => s)).toEqual([]);
  });
});

describe("estimateMessageTokens (batch 6 R1 tier-3 estimator)", () => {
  it("string content = envelope + the two text regimes (CJK mix)", () => {
    // 2 CJK + 4 ASCII -> 2 + ceil(4/4) = 3, plus the per-message envelope.
    expect(estimateMessageTokens({ role: "user", content: "拉面abcd" })).toBe(MESSAGE_OVERHEAD + 3);
  });

  it("multi-part content sums text parts under ONE envelope", () => {
    const message = {
      role: "user" as const,
      content: [
        { type: "text" as const, text: "aaaa" }, // 1
        { type: "text" as const, text: "一二三" }, // 3
      ],
    };
    expect(estimateMessageTokens(message)).toBe(MESSAGE_OVERHEAD + 4);
  });

  it("file parts cost the flat image constant regardless of payload size", () => {
    const image = (data: string) => ({
      role: "user" as const,
      content: [{ type: "file" as const, mediaType: "image/png", data }],
    });
    expect(estimateMessageTokens(image("x"))).toBe(MESSAGE_OVERHEAD + IMAGE_TOKENS);
    expect(estimateMessageTokens(image("y".repeat(100_000)))).toBe(MESSAGE_OVERHEAD + IMAGE_TOKENS);
  });

  it("tool-call and tool-result parts estimate their JSON payloads", () => {
    const input = { command: "dir", timeoutMs: 5000 };
    const call = {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "exec", input }],
    };
    expect(estimateMessageTokens(call)).toBe(MESSAGE_OVERHEAD + estimateTokens(JSON.stringify(input)));

    const output = { type: "json" as const, value: { ok: true, stdout: "hello world" } };
    const result = {
      role: "tool" as const,
      content: [{ type: "tool-result" as const, toolCallId: "c1", toolName: "exec", output }],
    };
    expect(estimateMessageTokens(result)).toBe(MESSAGE_OVERHEAD + estimateTokens(JSON.stringify(output)));
  });

  it("estimateMessagesTokens sums the per-message estimates", () => {
    const messages = [
      { role: "user" as const, content: "aaaa" },
      { role: "assistant" as const, content: "一二三" },
    ];
    expect(estimateMessagesTokens(messages)).toBe(estimateMessageTokens(messages[0]!) + estimateMessageTokens(messages[1]!));
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
