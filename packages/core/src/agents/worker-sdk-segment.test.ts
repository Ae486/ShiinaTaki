import { describe, expect, it } from "vitest";
import { completedWorkerFrontier } from "./worker-sdk-segment.ts";

type Frontier = Parameters<typeof completedWorkerFrontier>[0];
const call = { type: "tool-call" as const, toolCallId: "read", toolName: "read", input: {} };
const result = { type: "tool-result" as const, toolCallId: "read", toolName: "read", input: {}, output: { ok: true } };
const complete: Frontier = { finishReason: "tool-calls", toolCalls: [call], content: [call, result] };

describe("same-Attempt worker frontier", () => {
  it("admits settled local success and explicit error pairs", () => {
    expect(completedWorkerFrontier(complete)).toBe(true);
    expect(completedWorkerFrontier({ ...complete, content: [call,
      { type: "tool-error", toolCallId: "read", toolName: "read", input: {}, error: "Failed read" }] })).toBe(true);
  });
  it("refuses incomplete, deferred, mismatched, provider and approval frontiers", () => {
    const unsafe: Frontier[] = [
      { ...complete, content: [call] },
      { ...complete, content: [call, { ...result, preliminary: true }] },
      { ...complete, content: [call, { ...result, toolName: "different" }] },
      { ...complete, toolCalls: [{ ...call, providerExecuted: true }] },
      { ...complete, content: [call, { ...result, providerExecuted: true }] },
      { ...complete, content: [call, result, { type: "tool-approval-request", approvalId: "ask", toolCall: call }] },
      { ...complete, toolCalls: [{ ...call, invalid: true, dynamic: true, error: "Invalid arguments" }] },
      { ...complete, finishReason: "error" },
    ];
    for (const frontier of unsafe) expect(completedWorkerFrontier(frontier)).toBe(false);
  });
});
