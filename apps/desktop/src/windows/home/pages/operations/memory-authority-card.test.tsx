import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bankStatus, hindsightStatus, localStatus, operation } from "./memory-authority-fixtures.ts";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

const noop = async () => undefined;

function view(overrides: Partial<MemoryOperationsView> = {}): MemoryOperationsView {
  return { status: null, loading: false, error: null, busyKey: null, feedback: null, connectionReady: true, refresh: noop, submitSync: noop, cancel: noop, ...overrides };
}

function card(overrides: Partial<MemoryOperationsView> = {}): string {
  return renderToStaticMarkup(<MemoryAuthorityCard ops={view(overrides)} />);
}

describe("memory authority card", () => {
  it("renders the skeleton before the first read and the retry line after a failed one", () => {
    expect(card()).toContain("animate-pulse");
    const failed = card({ error: "deadline" });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("deadline");
    expect(failed).toContain("重试");
  });

  it("renders Local mode without Bank controls", () => {
    const markup = card({ status: localStatus() });
    expect(markup).toContain("Local（canonical） · epoch epoch-1");
    expect(markup).not.toContain("立即同步");
    expect(markup).toContain("无进行中的操作。");
  });

  it("renders an unavailable Hindsight runtime with its closed reason and no Bank controls", () => {
    const markup = card({ status: hindsightStatus({
      runtime: { providerId: "hindsight", available: false, unavailableReason: "not_installed" }, replica: null, pending: null,
    }) });
    expect(markup).toContain("运行时不可用：运行时未安装");
    expect(markup).not.toContain("立即同步");
    expect(markup).not.toContain("尚无 Bank。");
  });

  it("renders Hindsight Banks with sync controls, Pending counts and Retry only for explicit_retry_required", () => {
    const failed = bankStatus("character", { mode: "failed", automatic: false, errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "explicit_retry_required", retryKind: "full" });
    const markup = card({ status: hindsightStatus({ replica: [bankStatus("global"), failed] }) });
    expect(markup).toContain("Global");
    expect(markup).toContain("Character · taki");
    expect(markup).toContain("1 待写 / 0 失败 / 1 未知 / 2 父写");
    expect(markup).toContain("未知");
    expect(markup.match(/立即同步/g)).toHaveLength(2);
    expect(markup.match(/完整对账/g)).toHaveLength(2);
    expect(markup.match(/重试（full）/g)).toHaveLength(1);
    expect(markup).toContain("HINDSIGHT_UNREACHABLE");
  });

  it("offers Cancel for an admitted replica.sync only and locks controls while a mutation is in flight", () => {
    const active = [operation(), operation({ operationId: "33333333-3333-4333-8333-333333333333", state: "running" })];
    const markup = card({ status: hindsightStatus({ operations: { active, recent: [] } }) });
    expect(markup.match(/>取消</g)).toHaveLength(1);
    expect(markup).toContain("已受理（未认领）");
    expect(markup).toContain("执行中");
    const busy = card({ status: hindsightStatus({ operations: { active, recent: [] } }), busyKey: "sync:global" });
    expect(busy.match(/disabled=""/g)).toHaveLength(3);
    expect(busy.match(/aria-busy="true"/g)).toHaveLength(2);
  });

  it("shows the last mutation feedback line", () => {
    const markup = card({ status: localStatus(), feedback: { tone: "warn", message: "Core 拒绝了该操作：MEMORY_OPERATION_BUSY" } });
    expect(markup).toContain("Core 拒绝了该操作：MEMORY_OPERATION_BUSY");
  });
});
