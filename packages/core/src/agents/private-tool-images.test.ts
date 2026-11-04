import { describe, expect, it, vi } from "vitest";
import type { ToolModelMessage } from "ai";
import type { RunMessage } from "@taki/shared";
import { withNativeToolImages } from "./native-tool-images.ts";
import { createPrivateToolImages } from "./private-tool-images.ts";

function capture(bytes: string) {
  const images = [{ mediaType: "image/png" as const, dataBase64: bytes }];
  const release = vi.fn(() => { images.length = 0; });
  const output = withNativeToolImages({ type: "json" as const, value: { ok: true } }, { images, refs: [], context: "screen", release });
  const message: ToolModelMessage = { role: "tool", content: [{ type: "tool-result", toolCallId: "same-id", toolName: "capture", output }] };
  return { message, release };
}

function row(seq: number, stepNumber: number): RunMessage {
  return { runId: "run", attemptId: "attempt", stepNumber, seq, messageIndex: 1, entryKind: "output", role: "tool", content: "capture",
    parts: [{ type: "tool-result", toolCallId: "same-id", toolName: "capture", output: { type: "json", value: { ok: true } } }],
    inputId: null, modelEffectId: null, modelInputDigest: null, createdAt: "2026-11-02T00:00:00Z" };
}

describe("temporary private native evidence lifetime", () => {
  it("keeps only unretained images from a mixed native result beside the separately hydrated retained refs", () => {
    const output = withNativeToolImages({ type: "json" as const, value: { ok: true } }, {
      images: [{ mediaType: "image/png", dataBase64: "retained-frame" }, { mediaType: "image/bmp", dataBase64: "temporary-frame" }],
      refs: [{ mediaType: "image/png", ref: `attachments/${"a".repeat(64)}.png` }],
      refsByImageIndex: [{ mediaType: "image/png", ref: `attachments/${"a".repeat(64)}.png` }, undefined], context: "MCP frames",
    });
    const bridge = createPrivateToolImages("run");
    bridge.capture({ attemptId: "attempt", stepNumber: 1, messages: [{ role: "tool", content: [
      { type: "tool-result", toolCallId: "same-id", toolName: "capture", output },
    ] }] });
    const projected = JSON.stringify(bridge.messages(row(2, 1)));
    expect(projected).toContain("temporary-frame");
    expect(projected).not.toContain("retained-frame");
  });

  it("matches reused call ids to exact rounds and releases only evidence retired by a committed summary", () => {
    const first = capture("first-frame"); const second = capture("second-frame");
    const bridge = createPrivateToolImages("run");
    bridge.capture({ attemptId: "attempt", stepNumber: 1, messages: [first.message] });
    bridge.capture({ attemptId: "attempt", stepNumber: 2, messages: [second.message] });
    expect(JSON.stringify(bridge.messages(row(2, 1)))).toContain("first-frame");
    expect(JSON.stringify(bridge.messages(row(4, 2)))).toContain("second-frame");
    expect(bridge.messages({ ...row(2, 1), runId: "another-run" })).toEqual([]);
    expect(bridge.messages({ ...row(2, 1), attemptId: "another-attempt" })).toEqual([]);
    bridge.retireThrough(2);
    expect(first.release).toHaveBeenCalledOnce(); expect(second.release).not.toHaveBeenCalled();
    expect(bridge.messages(row(2, 1))).toEqual([]);
    expect(JSON.stringify(bridge.messages(row(4, 2)))).toContain("second-frame");
    bridge.reset();
    expect(bridge.messages(row(4, 2))).toEqual([]);
  });
});
