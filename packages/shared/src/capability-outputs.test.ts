import { describe, expect, it } from "vitest";
import {
  ClipboardReadOutputSchema,
  ClipboardWriteOutputSchema,
  ProcessListOutputSchema,
  ScreenshotOutputSchema,
  ShellOpenOutputSchema,
} from "./capability-outputs.ts";

describe("per-capability output schemas (T2)", () => {
  it("screenshot: accepts a PNG payload, rejects a non-PNG media type", () => {
    expect(
      ScreenshotOutputSchema.safeParse({ mediaType: "image/png", dataBase64: "AAAA", width: 1, height: 1 }).success,
    ).toBe(true);
    expect(
      ScreenshotOutputSchema.safeParse({ mediaType: "image/jpeg", dataBase64: "AAAA", width: 1, height: 1 }).success,
    ).toBe(false);
  });

  it("process-list: accepts a snapshot (nullable parentPid, large memoryBytes), rejects a bad memory type", () => {
    expect(
      ProcessListOutputSchema.safeParse({
        processes: [
          { pid: 1, name: "init", parentPid: null, memoryBytes: 5_000_000_000, startTime: 1_720_000_000 },
          { pid: 88, name: "chrome.exe", parentPid: 1, memoryBytes: 154_820_608, startTime: 1_720_000_001 },
        ],
        count: 2,
      }).success,
    ).toBe(true);
    // memoryBytes must be a number, not a string (it is a u64 on the wire).
    expect(
      ProcessListOutputSchema.safeParse({
        processes: [{ pid: 1, name: "init", parentPid: null, memoryBytes: "big", startTime: 0 }],
        count: 1,
      }).success,
    ).toBe(false);
  });

  it("process-list: rejects a leaked cmd/argv field (excluded in v1)", () => {
    expect(
      ProcessListOutputSchema.safeParse({
        processes: [{ pid: 1, name: "init", parentPid: null, memoryBytes: 0, startTime: 0, cmd: ["init"] }],
        count: 1,
      }).success,
    ).toBe(false);
  });

  it("clipboard-read: accepts any text including an empty string", () => {
    expect(ClipboardReadOutputSchema.safeParse({ text: "" }).success).toBe(true);
    expect(ClipboardReadOutputSchema.safeParse({ text: "hello" }).success).toBe(true);
    expect(ClipboardReadOutputSchema.safeParse({}).success).toBe(false);
  });

  it("clipboard-write / shell-open acks require ok:true; shell-open echoes the opened target", () => {
    expect(ClipboardWriteOutputSchema.safeParse({ ok: true }).success).toBe(true);
    expect(ClipboardWriteOutputSchema.safeParse({ ok: false }).success).toBe(false);
    expect(ShellOpenOutputSchema.safeParse({ ok: true, opened: "https://example.com" }).success).toBe(true);
    expect(ShellOpenOutputSchema.safeParse({ ok: true }).success).toBe(false);
  });
});
