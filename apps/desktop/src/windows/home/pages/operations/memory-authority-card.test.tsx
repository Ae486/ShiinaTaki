import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bankStatus, degradedStatus, disabledSection, hindsightStatus, localStatus, operation, provisioningSection, unreviewedSection } from "./memory-authority-fixtures.ts";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

const noop = async () => undefined;

function view(overrides: Partial<MemoryOperationsView> = {}): MemoryOperationsView {
  return { status: null, loading: false, error: null, busyKey: null, feedback: null, connectionReady: true, refresh: noop, submit: noop, submitSync: noop, cancel: noop, ...overrides };
}

function card(overrides: Partial<MemoryOperationsView> = {}): string {
  return renderToStaticMarkup(<MemoryAuthorityCard ops={view(overrides)} />);
}

const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
const LIFECYCLE_BUTTONS = ["重新校验连接", "创建 Bank（nana）", "创建 Bank（yui）"];
/** The lifecycle block's own markup up to its diagnostics, so replica Bank controls below it are not counted. */
const lifecycleBlock = (markup: string) => markup.split("Hindsight 连接与 Bank")[1]!.split("技术诊断")[0]!;
const unreviewed = hindsightStatus({ hindsight: unreviewedSection() });

describe("memory authority card", () => {
  it("renders no Hindsight lifecycle block outside Hindsight authority", () => {
    expect(card({ status: localStatus() })).not.toContain("Hindsight 连接与 Bank");
  });

  it("renders connection, readiness rows and the Core-listed lifecycle actions while the runtime is degraded", () => {
    const markup = card({ status: degradedStatus() });
    expect(markup).toContain("运行时不可用：连接配置已变更，需要重新校验");
    expect(markup).toContain("Hindsight 连接与 Bank");
    expect(buttons(markup)).toEqual(["重新校验连接"]);
    const [primary, diagnostics] = markup.split("技术诊断");
    expect(primary).not.toContain("HINDSIGHT_TEMPLATE_INVALID");
    expect(diagnostics).toContain("character-nana · HINDSIGHT_TEMPLATE_INVALID");
    const provisioning = card({ status: hindsightStatus({ hindsight: provisioningSection() }) });
    for (const label of ["可用", "同步中", "创建中", "失败", "未创建"]) expect(lifecycleBlock(provisioning)).toContain(`>${label}<`);
    expect(buttons(lifecycleBlock(provisioning))).toEqual([]);
    expect(card({ status: degradedStatus(disabledSection(), "connection_disabled") })).toContain("Hindsight 连接已关闭");
  });

  it("locks the lifecycle actions while a submission is pending or the connection is down", () => {
    expect(buttons(lifecycleBlock(card({ status: unreviewed })))).toEqual(LIFECYCLE_BUTTONS);
    const busy = lifecycleBlock(card({ status: unreviewed, busyKey: "provision:nana" }));
    expect(busy.match(/disabled=""/g)).toHaveLength(LIFECYCLE_BUTTONS.length);
    expect([...busy.matchAll(/<button[^>]*aria-busy="true"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["创建 Bank（nana）"]);
    const offline = lifecycleBlock(card({ status: unreviewed, connectionReady: false }));
    expect(offline.match(/disabled=""/g)).toHaveLength(LIFECYCLE_BUTTONS.length);
    expect(lifecycleBlock(card({ status: unreviewed }))).not.toContain("disabled=");
  });

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
