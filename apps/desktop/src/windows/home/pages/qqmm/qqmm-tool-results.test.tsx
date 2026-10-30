import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HistoryRecord, HistoryToolResult, ManagementController, ManagementState } from "@qqmm/management-client";
import { QqmmDetail } from "./qqmm-detail.tsx";
import { recordContext } from "./qqmm-labels.ts";
import { toolNotes, toolOutcome } from "./qqmm-tool-labels.ts";

const tool: HistoryToolResult = { operation: "read", scope: "reference", referenceTarget: "message", view: null,
  outcome: "constructed", delivery: "constructed_for_return", conversationCount: 2, itemCount: 4,
  messageCount: 4, summaryCount: 0, findingCount: 0, gapCount: 0, hasMore: null, progress: "unchanged" };
const record: HistoryRecord = { recordId: "private-row", sequence: 1, kind: "tool_result", severity: "info", occurredAt: 1800000000000,
  expiresAt: 1810000000000, conversationRef: null, conversationType: null, conversationId: null, conversationName: null,
  senderUin: null, senderName: null, direction: null, sourceTimestamp: null, preview: "保存结果", snapshotStatus: "captured", toolResult: tool };
const controller = new Proxy({}, { get: () => vi.fn() }) as ManagementController;
const state = { detail: { record, text: "原文😀\0deadbeef-v1.2.3 <script>literal</script>", offset: 0, totalCharacters: 43,
  section: { part: 2, type: "tool_result", title: "当时保存的分项", nextPart: 3 } }, detailMode: "record", detailLoading: false, sourceLoading: false } as ManagementState;

describe("QQ tool-result detail", () => {
  it("renders saved literal text, effective scope and actual occurrences with result-only navigation", () => {
    const html = renderToStaticMarkup(<QqmmDetail state={state} controller={controller} />);
    for (const text of ["工具结果详情", "读取会话内容", "指定消息及上下文", "返回条目 4 项", "消息 4", "返回结果开头", "下一部分", "当时保存的分项", "deadbeef-v1.2.3", "&lt;script&gt;"]) expect(html).toContain(text);
    for (const hidden of ["private-row", "返回摘要", "查看来源消息", "未命名私聊", "未命名成员", "constructed_for_return"]) expect(html).not.toContain(hidden);
    expect(html).toContain("原文😀\0deadbeef-v1.2.3");
    expect(recordContext(record)).toBe("涉及 2 个会话 · 读取会话内容");
  });
  it("distinguishes empty, sanitized failure, status and actual local progress", () => {
    expect(toolOutcome({ ...tool, outcome: "empty" })).toBe("无返回条目");
    expect(toolOutcome({ ...tool, outcome: "error" })).toBe("执行失败");
    expect(toolOutcome({ ...tool, operation: "mark_read", outcome: "empty" })).toBe("本次无需标记");
    expect(toolNotes({ ...tool, operation: "mark_read", scope: null, referenceTarget: null, progress: "read_advanced" })).toContain("本地会话已读进度已推进");
    expect(toolNotes({ ...tool, operation: "status", scope: null, referenceTarget: null })[0]).toBe("监控服务状态");
    const continued = toolNotes({ ...tool, scope: "after_cursor", referenceTarget: null, view: "messages", hasMore: false }).join(" · ");
    expect(continued).toContain("从指定位置继续");
    expect(continued).not.toContain("上次位置");
  });
  it("keeps all saved conversations in a result when the list is filtered to one conversation", () => {
    const fullResult = "甲会话：当时的返回😀\0\n乙会话：同次返回的另一部分";
    const filtered = { ...state, filters: { conversationRef: "private-first-conversation" },
      detail: { ...state.detail!, text: fullResult, totalCharacters: Array.from(fullResult).length } };
    const html = renderToStaticMarkup(<QqmmDetail state={filtered} controller={controller} />);
    expect(html).toContain(fullResult);
    expect(html).not.toContain("private-first-conversation");
    expect(html).not.toContain("查看来源消息");
  });
  it("retires all saved tool content and metadata when the parent is cleared", () => {
    expect(renderToStaticMarkup(<QqmmDetail state={{ ...state, detail: null }} controller={controller} />)).toBe("");
  });
});
