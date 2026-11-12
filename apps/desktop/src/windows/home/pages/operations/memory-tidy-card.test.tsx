import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemoryTidyCard, type MemoryTidyCardProps } from "./memory-tidy-card.tsx";
import { tidyOperation, settledTidy, TIDY_OUTCOME } from "./memory-tidy-fixtures.ts";

function markup(changes: Partial<MemoryTidyCardProps> = {}) {
  return renderToStaticMarkup(<MemoryTidyCard operation={null} loading={false} error={null} submitting={false}
    active={false} feedback={null} connectionReady runTidy={vi.fn()} refresh={vi.fn()} {...changes} />);
}

describe("Memory tidy durable card", () => {
  it("offers continuation for later block changes even with no remaining row candidates", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, remaining: 0, nextAction: "continue" }) });
    expect(html).toContain("本轮整理完成");
    expect(html).toContain("继续整理");
  });
  it("explains an input budget failure without treating unseen memories as reviewed", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "failed", reason: "input-too-large",
      edits: 0, reviewed: 0, remaining: 100, nextAction: "check-settings" }) });
    expect(html).toContain("超过本批输入预算");
    expect(html).toContain("后台模型上下文容量");
    expect(html).toContain("未截断内容");
    expect(html).not.toContain("整理完成：");
  });
  it("shows running progress and an unknown candidate count without declaring success", () => {
    const html = markup({ operation: tidyOperation({ producer: { kind: "tidy", characterId: "taki", authorityEpochId: "epoch-1",
      progress: { edits: 1, steps: 2, reviewed: 0, remaining: null } } }) });
    expect(html).toContain("正在整理记忆");
    expect(html).toContain("1 处改动");
    expect(html).toContain("尚未确定");
    expect(html).not.toContain("整理完成");
    expect(html).toContain('disabled=""');
  });

  it("shows partial committed work, actionable recovery and semantic diagnostics", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "partial", reason: "tool-errors",
      remaining: 21, nextAction: "continue", issues: [{ toolName: "memory_reinforce", code: "MEMORY_REVISION_MISMATCH" }], issueCount: 1 }) });
    expect(html).toContain("部分完成：已检查 31 条记忆，已保留 2 处改动");
    expect(html).toContain("仍有整理操作未能完成");
    expect(html).toContain("强化记忆");
    expect(html).toContain("记忆版本已变化");
    expect(html).toContain("继续整理");
    expect(html).toContain("已完成的检查进度会保留");
    expect(html).not.toMatch(/memory_reinforce|MEMORY_REVISION_MISMATCH|整理完成：/u);
  });

  it("recovers interrupted progress without claiming the operation failed before writing", () => {
    const operation = tidyOperation({ state: "outcome_unknown", reason: "core_restart", terminalAt: "2026-11-06T00:00:00Z" });
    const html = markup({ operation, feedback: { scope: "tidy", operationId: operation.operationId, tone: "ok", message: "整理已受理，关闭此页面不会中断执行。" } });
    expect(html).toContain("整理已中断，完整结果尚未确认");
    expect(html).toContain("已确认保存");
    expect(html).toContain("2 处改动");
    expect(html).not.toContain("未提交改动");
    expect(html).not.toContain("整理完成：");
    expect(html).toContain("重新整理");
    expect(html).not.toContain("关闭此页面不会中断执行");
  });

  it("shows clean and complete results from the Core record", () => {
    expect(markup({ operation: settledTidy() })).toContain("整理完成：已保存 2 处改动 / 已执行 4 步");
    expect(markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "clean", edits: 0, steps: 0 }) })).toContain("无需整理（未调用模型）");
  });

  it("uses final producer counts for providers without incremental progress and does not invent coverage", () => {
    const legacy = { ...TIDY_OUTCOME };
    delete legacy.reviewed;
    delete legacy.remaining;
    const html = markup({ operation: settledTidy(legacy) });
    expect(html).toContain("已确认保存");
    expect(html).toContain("2 处改动");
    expect(html).toContain("未提供");
    expect(html).not.toContain("10 条记忆");
    expect(html).not.toContain("21 条记忆");
  });

  it("does not turn initial zero counters into an interrupted provider's known result", () => {
    const html = markup({ operation: tidyOperation({ state: "outcome_unknown", reason: "core_restart", terminalAt: "2026-11-06T00:00:00Z",
      producer: { kind: "tidy", characterId: "taki", authorityEpochId: "epoch-1", progress: { edits: 0, steps: 0, reviewed: 0, remaining: null } } }) });
    expect(html).toContain("不能确定本次完成了多少工作");
    expect(html).not.toContain("0 处改动");
  });

  it("shows unfinished review coverage even when no memory edit was needed", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "partial", edits: 0, reviewed: 10, remaining: 21, nextAction: "continue" }) });
    expect(html).toContain("部分完成：已检查 10 条记忆，已保留 0 处改动");
    expect(html).not.toContain("整理失败");
  });

  it("distinguishes fresh candidates and potential issues from confirmed wrong memories", () => {
    const html = markup({ operation: settledTidy() });
    expect(html).toContain("新增待检查记忆");
    expect(html).toContain("待确认是否过时");
    expect(html).toContain("待确认是否重复");
    expect(html).toContain("不代表已确认错误");
    expect(html).not.toContain("归档错层");
  });

  it("keeps a retained result beside read failure and offers a distinct refresh action", () => {
    const html = markup({ operation: settledTidy(), error: "状态读取失败，请刷新" });
    expect(html).toContain("整理完成：");
    expect(html).toContain("状态读取失败");
    expect(html).toContain("刷新整理状态");
    expect(html).toContain('disabled=""');
  });

  it("makes backoff and model-configuration intervention understandable", () => {
    const failure = { ...TIDY_OUTCOME, status: "failed" as const, edits: 0, reason: "timeout" as const };
    const backedOff = markup({ operation: settledTidy({ ...failure, nextAction: "retry", retryAt: "2026-11-06T00:30:00Z" }) });
    expect(backedOff).toContain("后台维护中重试");
    expect(backedOff).toContain("整理等待超时");
    const blocked = markup({ operation: settledTidy({ ...failure, nextAction: "check-settings" }) });
    expect(blocked).toContain("检查后台模型配置与连接");
  });

  it("renders safe reference and field diagnostics as corrective guidance", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "partial", reason: "tool-errors", issueCount: 2,
      issues: [{ toolName: "memory_refile", code: "MEMORY_INVALID_REQUEST", stage: "reference", field: "id", issueId: "private-issue-id" },
        { toolName: "memory_refile", code: "MEMORY_INVALID_REQUEST", stage: "input", field: "layer" }] }) });
    expect(html).toContain("未能识别目标记忆，需要重新读取后整理");
    expect(html).toContain("记忆分类不受支持，需要重新选择分类");
    expect(html).toContain("未完成的整理操作：2 项");
    expect(html).not.toContain("private-issue-id");
    expect(html).not.toContain("未解决工具操作");
  });

  it("explicitly reports exhausted automatic retries even when candidates remain", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, status: "failed", edits: 0, remaining: 7,
      reason: "tool-errors", nextAction: "manual-retry", retryAt: null }) });
    expect(html).toContain("自动重试已暂停");
    expect(html).toContain("处理后可手动重新整理");
    expect(html).not.toContain("后台维护中重试");
    expect(html).not.toContain("可以继续整理");
  });

  it("shows correction count without relabeling rejected calls as saved edits", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, recoveredIssues: 3, skippedIssues: 4 }) });
    expect(html).toContain("已纠正 3 次调用；另有 4 项经检查无需执行");
    expect(html).toContain("已保存 2 处改动");
    expect(html).not.toContain("未完成的整理操作");
  });

  it("does not display zero correction or not-needed counts", () => {
    const html = markup({ operation: settledTidy({ ...TIDY_OUTCOME, recoveredIssues: 0, skippedIssues: 0 }) });
    expect(html).not.toContain("已纠正");
    expect(html).not.toContain("经检查无需执行");
  });

  it("blocks another submission while disconnected, refreshing, submitting or another tidy is active", () => {
    for (const changes of [{ connectionReady: false }, { loading: true }, { submitting: true }, { active: true }]) {
      expect(markup(changes)).toContain('disabled=""');
    }
    expect(markup()).not.toContain('disabled=""');
  });
});
