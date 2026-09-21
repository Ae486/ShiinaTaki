import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryOnboardingActions, MemoryOnboardingStatus } from "@taki/shared";
import { LocalOnboardingCard } from "./local-onboarding-card.tsx";
import { onboardingOperation, onboardingPreview, onboardingRun, onboardingStatus, ONBOARDING_AT, ONBOARDING_OPERATION_ID } from "./local-onboarding-fixtures.ts";
import { initialOnboardingState } from "./local-onboarding-state.ts";
import type { LocalOnboardingView } from "./use-local-onboarding.ts";

const noop = async () => undefined;
function actions(patch: Partial<MemoryOnboardingActions> = {}): MemoryOnboardingActions {
  return { ...onboardingStatus().actions, preview: false, prepare: false, ...patch };
}
function card(patch: Partial<LocalOnboardingView> = {}): string {
  const onboarding: LocalOnboardingView = { ...initialOnboardingState(), loading: false, stale: false,
    connectionReady: true, refresh: noop, execute: noop, exclude: noop, loadMore: noop, ...patch };
  return renderToStaticMarkup(<LocalOnboardingCard onboarding={onboarding} />);
}
function local(available: boolean): MemoryOnboardingStatus {
  return onboardingStatus({ authority: { mode: "canonical-local", epochId: "epoch-local-1" },
    runtime: { available, unavailableReason: available ? null : "stopped" },
    actions: actions({ recoverBinding: !available }),
    run: onboardingRun({ status: "completed", progress: { phase: "completed", sourceCount: 2, resolvedCount: 2, blockingCount: 0 },
      receipt: { runId: "run-local-1", snapshotId: "snapshot-local-1", epochId: "epoch-local-1", transactionId: "transaction-1", activatedAt: ONBOARDING_AT } }),
  });
}

describe("Local onboarding card", () => {
  it("renders loading, read failure and last-good stale content with locked actions", () => {
    expect(card({ loading: true })).toContain("animate-pulse");
    const failed = card({ error: "read timeout", stale: true });
    expect(failed).toContain("状态读取失败：read timeout");
    expect(failed).toContain("暂无可用的引导状态");
    const stale = card({ status: onboardingStatus(), stale: true });
    expect(stale).toContain("Legacy Markdown");
    expect(stale).toContain("操作暂不可用");
    expect(stale.match(/disabled=""/g)).toHaveLength(2);
  });

  it("guides an empty workspace through explicit preview and preparation without promising activation", () => {
    const before = card({ status: onboardingStatus() });
    expect(before).toContain("开始使用本地记忆");
    expect(before).toContain("原始文件与快照证据会保留");
    expect(before.match(/disabled=""/g)).toHaveLength(1);
    const previewed = card({ status: onboardingStatus(), preview: onboardingPreview(0) });
    expect(previewed).toContain("工作区为空，可准备本地记忆");
    expect(previewed).not.toContain("disabled=");
    expect(previewed).not.toContain("本地记忆已启用");
  });

  it("renders Legacy counts, exceptions and source-specific exclusion permission without raw memory", () => {
    const status = onboardingStatus({ run: onboardingRun({ status: "failed", progress: { phase: "blocked", sourceCount: 3, resolvedCount: 1, blockingCount: 2 } }),
      actions: actions({ resume: true, preview: true, replace: true }) });
    const markup = card({ status, exceptions: { items: [
      { sourceId: "source-1", code: "UNSUPPORTED_FORMAT", relativePath: "memory/old.txt", canExclude: true },
      { sourceId: "source-2", code: "IMPORT_CONFLICT", relativePath: "memory/imported.md", canExclude: false },
    ], nextCursor: "next" } });
    expect(markup).toContain("有来源需要处理");
    expect(markup).toContain("1 已处理 / 3 总计 / 2 攻塞".replace("攻", "阻"));
    expect(markup).toContain("memory/old.txt");
    expect(markup).toContain("排除此来源的理由");
    expect(markup.match(/>排除此来源</g)).toHaveLength(1);
    expect(markup).toContain("Core 当前不允许排除此来源");
    expect(markup).toContain("加载更多来源");
    expect(markup).toContain('maxLength="512"');
  });

  it("shows source-replacement intent only after a fresh preview", () => {
    const status = onboardingStatus({ run: onboardingRun({ status: "failed" }), actions: actions({ replace: true, preview: true }) });
    const markup = card({ status, preview: onboardingPreview() });
    expect(markup).toContain("按新预览重新准备");
    expect(markup).toContain("替换当前待启用记录");
    expect(markup).not.toContain("disabled=");
  });

  it("distinguishes admitted, running and ready; never invents missing progress counts", () => {
    const admitted = card({ status: onboardingStatus({ operation: onboardingOperation(), actions: actions({ cancelOperationId: ONBOARDING_OPERATION_ID }) }) });
    expect(admitted).toContain("已受理，尚未开始");
    expect(admitted).toContain("取消待开始操作");
    expect(admitted).toContain("未知 已处理 / 未知 总计 / 未知 阻塞");
    const running = card({ status: onboardingStatus({ operation: onboardingOperation({ state: "running" }), actions: actions() }) });
    expect(running).toContain("正在准备本地记忆");
    expect(running).toContain("开始执行后不支持取消");
    expect(running).not.toContain("取消待开始操作");
    const ready = card({ status: onboardingStatus({ run: onboardingRun(), actions: actions({ activate: true }) }) });
    expect(ready).toContain("准备就绪，等待启用");
    expect(ready).toContain("准备完成尚未切换权威");
    expect(ready).toContain("启用本地记忆</button>");
  });

  it("renders activating, unknown and failed outcomes with server-offered recovery", () => {
    const activating = onboardingOperation({ kind: "local.onboard.activate", state: "running", request: { kind: "local.onboard.activate", runId: "run-local-1" } });
    expect(card({ status: onboardingStatus({ operation: activating, actions: actions() }) })).toContain("正在启用本地记忆");
    const unknown = onboardingOperation({ state: "outcome_unknown", reason: "commitment_unknown", terminalAt: ONBOARDING_AT });
    const markup = card({ status: onboardingStatus({ operation: unknown, actions: actions({ retryOperationId: ONBOARDING_OPERATION_ID }) }) });
    expect(markup).toContain("操作结果未知");
    expect(markup).toContain("恢复未完成操作");
    expect(markup).not.toContain("本地记忆已启用");
    const failure = onboardingOperation({ state: "failed", reason: "producer_failed", errorCode: "INTEGRITY_MISMATCH", terminalAt: ONBOARDING_AT });
    const failed = card({ status: onboardingStatus({ operation: failure, actions: actions() }) });
    expect(failed).toContain("准备或启用失败");
    expect(failed).toContain("INTEGRITY_MISMATCH");
  });

  it("separates committed authority from unavailable runtime and offers same-run binding repair", () => {
    const unavailable = card({ status: local(false) });
    expect(unavailable).toContain("本地权威已启用，运行时不可用");
    expect(unavailable).toContain("恢复本地运行时");
    expect(unavailable).toContain("已提交的同一份记录");
    expect(unavailable).not.toContain("本地记忆已启用");
    expect(unavailable).not.toContain("预览本地来源");
    const active = card({ status: local(true) });
    expect(active).toContain("本地记忆已启用");
    expect(active).toContain("本地记忆运行时可用");
    expect(active).not.toContain("恢复本地运行时");
  });

  it("offers custody reconciliation from Core even when the Local runtime is already healthy", () => {
    const status = { ...local(true), custody: { openGroups: 2, recoverableGroups: 1 }, actions: actions({ reconcileSources: true }) };
    const markup = card({ status });
    expect(markup).toContain("待恢复来源组");
    expect(markup).toContain("恢复未完成来源</button>");
    expect(markup).toContain("本地记忆已启用");
  });

  it("locks server-offered controls while disconnected or awaiting a mutation reply", () => {
    const status = onboardingStatus({ run: onboardingRun(), actions: actions({ activate: true }) });
    const disconnected = card({ status, connectionReady: false });
    expect(disconnected.match(/disabled=""/g)).toHaveLength(2);
    expect(disconnected).toContain("连接恢复后将重新读取");
    const busy = card({ status, busyKey: "activate" });
    expect(busy).toContain('aria-busy="true"');
    expect(busy.match(/disabled=""/g)).toHaveLength(1);
  });

  it("preserves existing Hindsight authority without fresh-onboarding controls", () => {
    const status = onboardingStatus({ authority: { mode: "hindsight", epochId: "hindsight-1" }, actions: actions() });
    const markup = card({ status });
    expect(markup).toContain("当前使用 Hindsight");
    expect(markup).not.toContain("预览本地来源");
    expect(markup).not.toContain("准备本地记忆</button>");
  });
});
