import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MemoryTidyFailureDetails, MemoryTidyResult } from "@taki/shared";
import { MemoryTidyCard, type MemoryTidyCardProps } from "./memory-tidy-card.tsx";

const RESULT: MemoryTidyResult = {
  status: "ran", defects: { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 0 },
  edits: 2, steps: 4, usage: { calls: 4, inputTokens: 120, outputTokens: 30, usageUnknown: 0 },
};
const PARTIAL: MemoryTidyFailureDetails = {
  ...RESULT, kind: "memory-tidy", status: "partial", reason: "tool-errors",
  issues: [{ toolName: "memory_reinforce", code: "MEMORY_REVISION_MISMATCH" }], issueCount: 1,
};
function markup(changes: Partial<MemoryTidyCardProps>) {
  return renderToStaticMarkup(<MemoryTidyCard tidy={null} tidyFailure={null} tidying={false} error={null} refreshError={null}
    connectionReady runTidy={vi.fn()} {...changes} />);
}

describe("Memory tidy card", () => {
  it("shows partial committed work and semantic reasons without presenting success or raw tool codes", () => {
    const html = markup({ tidyFailure: PARTIAL });
    expect(html).toContain("部分完成：已保留 2 处改动 / 已执行 4 步；本次整理未完成。");
    expect(html).toContain("仍有整理操作未能完成");
    expect(html).toContain("未解决工具操作：1 项");
    expect(html).toContain("强化记忆");
    expect(html).toContain("记忆版本已变化");
    expect(html).not.toMatch(/memory_reinforce|MEMORY_REVISION_MISMATCH|已整理：/u);
    expect(html).toContain("检查时发现的问题");
  });

  it("shows failed work with no committed changes and no invented tool error", () => {
    const html = markup({ tidyFailure: { ...PARTIAL, status: "failed", edits: 0, reason: "execution-failed", issues: [], issueCount: 0 } });
    expect(html).toContain("整理失败：未提交改动 / 已执行 4 步");
    expect(html).toContain("整理执行失败");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("记忆版本已变化");
    expect(html).not.toContain("已整理：");
  });

  it("retains the existing clean and successful presentations", () => {
    expect(markup({ tidy: RESULT })).toContain("已整理：2 处改动 / 4 步");
    expect(markup({ tidy: { ...RESULT, status: "clean", edits: 0, steps: 0 } })).toContain("无需整理（未调用模型）");
  });

  it("keeps request/transport errors outside the known failed result and refresh failures beside the original result", () => {
    const unknown = markup({ error: "等待整理结果超时，执行结果尚未确认" });
    expect(unknown).toContain("执行结果尚未确认");
    expect(unknown).not.toContain("未提交改动");
    const refresh = markup({ tidyFailure: PARTIAL, refreshError: "状态刷新失败；本次整理结果已保留" });
    expect(refresh).toContain("部分完成");
    expect(refresh).toContain("状态刷新失败");
  });

  it("disables requests while disconnected or an attempt remains pending", () => {
    expect(markup({ connectionReady: false })).toContain('disabled=""');
    expect(markup({ tidying: true })).toContain('disabled=""');
    expect(markup({})).not.toContain('disabled=""');
  });
});
