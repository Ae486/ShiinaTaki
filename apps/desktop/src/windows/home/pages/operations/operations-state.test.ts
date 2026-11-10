/**
 * INPUT:  tidy/status/usage result fixtures + the clear interaction events (no DOM, no socket).
 * OUTPUT: assertions for the rendered view models and for the destructive-purge guard: `confirm` can only reach
 *         "clearing" from the confirm step, so one stray click can never purge attachments.
 * POS:    unit test for windows/home/pages/operations/operations-state. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { MemoryStatusResult, MemoryTidyFailureDetails, MemoryTidyResult } from "@taki/shared";
import { clearPhaseAfter, formatBytes, statusRows, tidyDefectRows, tidyFailureView } from "./operations-state.ts";

const TIDY: MemoryTidyResult = {
  status: "ran",
  defects: { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 3 },
  edits: 2,
  steps: 4,
  usage: { calls: 1, inputTokens: 120, outputTokens: 30, usageUnknown: 0 },
};

const STATUS: MemoryStatusResult = {
  windowSlots: [{ slot: "main", effectiveWindow: 120_000, factor: 1.08, updatedAt: "2026-08-03T10:00:00.000Z" }],
  summary: { throughSeq: 42, textChars: 900, updatedAt: "2026-08-03T10:01:00.000Z" },
  auto: { lastEpisodicSeq: 40, lastFlushSeq: 38, lastTidyAt: null },
};

describe("operations view models", () => {
  it.each([
    ["tool-errors", "仍有整理操作未能完成"], ["execution-failed", "整理执行失败"],
    ["review-stale", "整理依据已发生变化"], ["unfinished", "未完成最终确认"],
  ] as const)("explains %s without rendering an internal reason code", (reason, message) => {
    const failure: MemoryTidyFailureDetails = { ...TIDY, kind: "memory-tidy", status: "partial", reason, issues: [], issueCount: 0 };
    const view = tidyFailureView(failure);
    expect(view.reason).toContain(message);
    expect(view.reason).not.toContain(reason);
  });

  it("shows a bounded issue list without presenting the listed count as the total", () => {
    const failure: MemoryTidyFailureDetails = { ...TIDY, kind: "memory-tidy", status: "partial", reason: "tool-errors",
      issues: Array.from({ length: 20 }, () => ({ toolName: "unknown", code: "MEMORY_INTERNAL_ERROR" })), issueCount: 23 };
    const view = tidyFailureView(failure);
    expect(view.issueSummary).toBe("未完成的整理操作：23 项（显示 20 项）");
    expect(view.issues).toHaveLength(20);
    expect(view.issues[0]).toMatchObject({ label: "整理操作", value: "内部处理失败" });
  });

  it("renders one row per defect class with its count", () => {
    const rows = tidyDefectRows(TIDY);

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.value)).toEqual(["1", "0", "2", "0", "3"]);
  });

  it("maps the status card, naming each calibrated slot and the summary coverage", () => {
    const rows = statusRows(STATUS);

    expect(rows[0]).toEqual({ label: "窗口校准 · main", value: "120000 tokens（系数 1.08）" });
    expect(rows.find((row) => row.label === "对话摘要")?.value).toContain("seq 42");
    expect(rows.find((row) => row.label === "上次整理")?.value).toBe("从未");
  });

  it("says so plainly when a character has never been compacted", () => {
    const rows = statusRows({ ...STATUS, summary: null });

    expect(rows.find((row) => row.label === "对话摘要")?.value).toBe("尚未压缩");
  });

  it("formats byte counts up the unit scale", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("media.clear confirm guard", () => {
  it("requires the confirm step before a purge can be issued", () => {
    expect(clearPhaseAfter("idle", "request")).toBe("confirming");
    expect(clearPhaseAfter("confirming", "confirm")).toBe("clearing");
  });

  it("refuses a confirm that did not pass through the confirm step", () => {
    expect(clearPhaseAfter("idle", "confirm")).toBe("idle");
    expect(clearPhaseAfter("clearing", "confirm")).toBe("clearing");
  });

  it("cancels only before execution and settles back to idle after the call", () => {
    expect(clearPhaseAfter("confirming", "cancel")).toBe("idle");
    expect(clearPhaseAfter("clearing", "cancel")).toBe("clearing");
    expect(clearPhaseAfter("clearing", "settled")).toBe("idle");
  });

  it("ignores a repeated request while a purge is already confirming or running", () => {
    expect(clearPhaseAfter("confirming", "request")).toBe("confirming");
    expect(clearPhaseAfter("clearing", "request")).toBe("clearing");
  });
});
