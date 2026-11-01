import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentProgress } from "./subagent-progress.tsx";
import { SubagentComposer } from "./subagent-composer.tsx";
import { SubagentController } from "./subagent-controller.ts";
import { summary, CHILD_A, WORK_A } from "../../../test/s7-subagent-data.ts";

function checkedChild() {
  const child = summary(); child.state = "needs_input"; child.activeRunId = null;
  child.progress = { workInputId: WORK_A, completedSteps: 50, intervalStartSteps: 0, intervalSteps: 50,
    parentApprovalLimit: 3, consecutiveParentApprovals: 3, tracking: "work_start" };
  child.pendingRequest = { eventId: "checkin-a", workInputId: WORK_A, state: "open", answerInputId: null,
    reason: "check_in", checkIn: { completedSteps: 50, intervalStartSteps: 0, intervalSteps: 50,
      parentApprovalLimit: 3, consecutiveParentApprovals: 3, requiredActor: "user", reportKind: "core_snapshot" } };
  return child;
}

describe("truthful child progress and continuation", () => {
  it("distinguishes unknown, no calls, reported zero and incomplete known subtotals", () => {
    const child = summary(); child.tokenUsage = null;
    expect(renderToStaticMarkup(<SubagentProgress child={child} workId={WORK_A} />)).toContain("累计 token 用量未知");
    child.tokenUsage = { modelEffects: 0, inflightEffects: 0, missingUsageEffects: 0,
      inputTokens: null, outputTokens: null, totalTokens: null, knownTotalTokens: null, complete: true };
    expect(renderToStaticMarkup(<SubagentProgress child={child} workId={WORK_A} />)).toContain("尚无模型调用");
    child.tokenUsage = { ...child.tokenUsage, modelEffects: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0, knownTotalTokens: 0 };
    expect(renderToStaticMarkup(<SubagentProgress child={child} workId={WORK_A} />)).toContain("累计 0 token");
    child.tokenUsage = { ...child.tokenUsage, modelEffects: 3, inflightEffects: 1, missingUsageEffects: 1,
      complete: false, inputTokens: null, outputTokens: null, totalTokens: null, knownTotalTokens: 100 };
    const html = renderToStaticMarkup(<SubagentProgress child={child} workId={WORK_A} />);
    expect(html).toContain("已知累计 100 token（统计不完整）"); expect(html).toContain("输入 未知 / 输出 未知");
    expect(html).toContain("1 次调用尚未结算"); expect(html).toContain("1 次调用缺少完整用量");
  });

  it("shows the captured interval, user-only decision and honest post-upgrade baseline", () => {
    const child = checkedChild(); child.progress!.tracking = "post_upgrade"; child.stopOrigin = "user";
    const html = renderToStaticMarkup(<SubagentProgress child={child} workId={WORK_A} />);
    expect(html).toContain("50/50"); expect(html).toContain("主助手连续放行 3/3");
    expect(html).toContain("升级后已记录 50"); expect(html).not.toContain("已完成 50");
    expect(html).toContain("必须由你明确继续"); expect(html).toContain("你的停止仍然生效");
    expect(html).toContain("更早的步骤数未知");
    expect(renderToStaticMarkup(<SubagentProgress child={child} workId="historical-other" />)).not.toContain("50/50");
  });

  it("offers empty-draft exact Continue at check-in without requiring a Stop latch", () => {
    const child = checkedChild();
    const html = renderToStaticMarkup(<SubagentComposer child={child}
      target={{ subagentId: CHILD_A, workInputId: WORK_A, expectedRunId: null, expectedControlVersion: 2 }}
      controller={new SubagentController(vi.fn())} available pending={null} />);
    expect(html).toContain("继续此工作"); expect(html).toContain("只有你能放行此检查点");
    expect(html).not.toContain("发送输入");
  });
});
