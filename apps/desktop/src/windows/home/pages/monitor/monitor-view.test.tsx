import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrajectoryInspector, TrajectoryRow } from "@taki/shared";
import { InspectorFields } from "./monitor-view.tsx";
import { inspectorSections } from "./trajectory-inspector-model.ts";
import { projectTrajectoryRecords } from "./trajectory-records.ts";

const inspector: TrajectoryInspector = {
  mode: "FULL_LOCAL", title: "模型请求", detail: [{ label: "状态", value: "运行中" }],
  sections: [{ key: "event", fields: [{ label: "状态", value: "运行中" }] },
    { key: "model", fields: [{ label: "模型", value: "actual-model/v1" }] }],
  technical: [{ label: "Event ID", value: "private-event" }, { label: "请求摘要哈希", value: "private-hash" }],
  technicalCollapsed: true, redactionNotice: "仅展示已记录的语义信息。",
};

describe("semantic Monitor Inspector", () => {
  it.each(["FEEDBACK_ONLY", "FULL_LOCAL"] as const)("excludes technical fields and unsupported tabs in %s", (mode) => {
    const html = renderToStaticMarkup(<InspectorFields inspector={{ ...inspector, mode }} />);
    expect(html).toContain("actual-model/v1");
    expect(html).toContain('aria-label="记录详情"');
    expect(html).toContain('aria-expanded="true"');
    for (const hidden of ["Event ID", "private-event", "private-hash", "请求摘要哈希", "技术关联", "复制", "工具定义", "输入摘要", "输出摘要", "差异"]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("renders only populated typed sections and no detail in disabled mode", () => {
    const toolOnly: TrajectoryInspector = { ...inspector,
      sections: [{ key: "tool", fields: [{ label: "工具", value: "Search · lookup" }] }],
    };
    expect(inspectorSections(toolOnly).map((section) => section.key)).toEqual(["tool"]);
    const html = renderToStaticMarkup(<InspectorFields inspector={toolOnly} />);
    expect(html).toContain("Search · lookup");
    expect(html).not.toContain("模型与耗时");
    expect(html).not.toContain("上下文");
    expect(inspectorSections({ ...toolOnly, mode: "DISABLED" })).toEqual([]);
  });

  it("updates an inspected start from the same exact record's terminal facts and preserves unknown usage", () => {
    const base = { groupKey: "private-attempt", modelEffectId: "private-effect", occurredAt: "2026-09-06T01:00:00.000Z",
      phase: "model" as const, category: "model" as const, categoryLabel: "模型请求", surface: "current" as const, surfaceLabel: "当前" };
    const rows: TrajectoryRow[] = [
      { ...base, rowKey: "start", seq: 1, kind: "model", eventKind: "model.request.started", label: "模型请求开始", status: "运行中", modelId: "actual-model/v1" },
      { ...base, rowKey: "end", seq: 2, kind: "model", eventKind: "model.response.settled", label: "模型响应结束",
        status: "已完成", outcome: "已完成", modelId: "actual-model/v1", durationMs: 50, timeToFirstOutputMs: 10 },
      { ...base, rowKey: "usage", seq: 3, kind: "usage", eventKind: "usage.settled", label: "模型用量", status: "已记录",
        phase: "usage", category: "usage", categoryLabel: "用量", quality: "上游报告", outputTokens: 0 },
    ];
    const record = projectTrajectoryRecords(rows)[0]!;
    const fields = inspectorSections(inspector, record).flatMap((section) => section.fields);
    expect(fields).toContainEqual({ label: "状态", value: "已完成" });
    expect(fields).not.toContainEqual({ label: "状态", value: "运行中" });
    expect(fields).toContainEqual({ label: "响应耗时", value: "50 毫秒" });
    expect(fields).toContainEqual({ label: "首次输出耗时", value: "10 毫秒" });
    expect(fields).toContainEqual({ label: "输出令牌", value: "0" });
    expect(fields).toContainEqual({ label: "缓存信息", value: "缓存信息未提供" });
    expect(fields.some((field) => field.label === "输入令牌" || field.label === "缓存读取")).toBe(false);
  });

  it("keeps captured tool names and explains that processing duration can include Approval waiting", () => {
    const [record] = projectTrajectoryRecords([{
      kind: "tool", rowKey: "private-call", seq: 1, toolName: "private-route", displayName: "名".repeat(240),
      phase: "tool", category: "tool", categoryLabel: "工具", label: "工具结果", status: "已记录", outcome: "失败",
      errorClass: "执行错误", durationMs: 42, occurredAt: "2026-09-06T01:00:00.000Z", surface: "current", surfaceLabel: "当前",
    }]);
    const fields = inspectorSections({ ...inspector, sections: [], detail: [] }, record).flatMap((section) => section.fields);
    expect(fields).toContainEqual({ label: "工具", value: "名".repeat(240) });
    expect(fields).toContainEqual({ label: "处理耗时", value: "42 毫秒（含审批等待）" });
    expect(fields.some((field) => field.value.includes("private-"))).toBe(false);
  });
});
