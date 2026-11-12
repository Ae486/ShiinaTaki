import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HindsightActivationCard } from "./hindsight-activation-card.tsx";
import { activatedStatus, activationStatus, admittedStatus, blockedStatus, committedUnavailableStatus, interruptedStatus, legacyStatus, missingBankStatus,
  runningStatus, unconfiguredStatus, unknownStatus } from "./hindsight-activation-fixtures.ts";
import { initialActivationState } from "./hindsight-activation-state.ts";
import type { HindsightActivationView } from "./use-hindsight-activation.ts";

const noop = async () => undefined;
function card(patch: Partial<HindsightActivationView> = {}): string {
  const activation: HindsightActivationView = { ...initialActivationState(), loading: false, connectionReady: true, refresh: noop, execute: noop, ...patch };
  return renderToStaticMarkup(<HindsightActivationCard activation={activation} />);
}
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1]?.replace(/<[^>]*>/g, ""));
const disabled = (markup: string) => markup.match(/disabled=""/g)?.length ?? 0;

describe("Hindsight activation card", () => {
  it("renders loading, read failure with retry, and last-good stale content with locked actions", () => {
    expect(card({ loading: true })).toContain("animate-pulse");
    expect(card({ loading: true, connectionReady: false })).not.toContain("animate-pulse");
    const failed = card({ error: "read timeout" });
    expect(failed).toContain("状态读取失败：read timeout");
    expect(failed).toContain("重试");
    expect(failed).toContain("暂无可用的启用状态");
    const stale = card({ status: activationStatus(), loading: true });
    expect(stale).toContain("可以启用 Hindsight");
    expect(stale).toContain("操作暂不可用");
    expect(disabled(stale)).toBe(2);
    const staleError = card({ status: activationStatus(), error: "read timeout" });
    expect(buttons(staleError)).toEqual(["刷新状态", "重试", "启用 Hindsight"]);
    expect(disabled(staleError)).toBe(1);
  });

  it("points a Legacy instance at the Local guide and offers nothing", () => {
    const markup = card({ status: legacyStatus() });
    expect(markup).toContain("需要先启用本地记忆");
    expect(markup).toContain("本地记忆引导");
    expect(markup).toContain("尚无本地 Bank 记录");
    expect(buttons(markup)).toEqual(["刷新状态"]);
  });

  it("walks setup through validate and apply while unconfigured, naming the missing Banks", () => {
    const validate = card({ status: unconfiguredStatus() });
    expect(validate).toContain("先完成 Hindsight 连接配置");
    expect(validate).toContain("待校验连接");
    expect(validate).toContain("Global：缺少已校验的 Hindsight Bank");
    expect(validate).toContain("Character · taki：缺少已校验的 Hindsight Bank");
    expect(buttons(validate)).toEqual(["刷新状态", "校验连接"]);
    expect(validate).not.toContain("disabled=");
    const apply = card({ status: unconfiguredStatus("compatible") });
    expect(buttons(apply)).toEqual(["刷新状态", "校验连接", "应用配置"]);
    expect(apply).toContain("请应用配置");
    const busyPhase = card({ status: unconfiguredStatus("applying-templates") });
    expect(busyPhase).toContain("配置进行中");
    expect(buttons(busyPhase)).toEqual(["刷新状态"]);
    const fresh = card({ status: unconfiguredStatus("unconfigured") });
    expect(buttons(fresh)).toEqual(["刷新状态", "校验连接"]);
    expect(fresh).not.toContain("disabled=");
  });

  it("blocks on an extra Hindsight Bank without an activate button", () => {
    const markup = card({ status: blockedStatus() });
    expect(markup).toContain("Bank 前置条件未满足");
    expect(markup).toContain("Character · taki：Hindsight 配置多出的 Bank");
    expect(buttons(markup)).toEqual(["刷新状态"]);
    expect(markup.split("<details")[0]).not.toContain("native-");
  });

  it("offers 应用配置 for a Local Bank created after setup instead of leaving the block without a remedy", () => {
    const markup = card({ status: missingBankStatus() });
    expect(markup).toContain("Character · taki：缺少已校验的 Hindsight Bank");
    expect(markup).toContain("请应用配置");
    expect(buttons(markup)).toEqual(["刷新状态", "应用配置"]);
  });

  it("offers the single 启用 Hindsight action once Core derives it", () => {
    const markup = card({ status: activationStatus() });
    expect(markup).toContain("可以启用 Hindsight");
    expect(markup).toContain("提交前本地记忆保持可用");
    expect(buttons(markup)).toEqual(["刷新状态", "启用 Hindsight"]);
    expect(markup).not.toContain("disabled=");
    expect(markup).not.toContain("校验连接");
  });

  it("distinguishes admitted from running and completed, and renders producer counts as reported", () => {
    const admitted = card({ status: admittedStatus() });
    expect(admitted).toContain("操作已受理，等待开始");
    expect(admitted).toContain("已受理，等待开始");
    expect(admitted).toContain("已准备 0 / 已导入 0 / 已校验 0 / 共 2");
    expect(buttons(admitted)).toEqual(["刷新状态", "取消"]);
    const running = card({ status: runningStatus("verifying") });
    expect(running).toContain("正在启用 Hindsight");
    expect(running).toContain("校验导入结果");
    expect(running).toContain("已准备 2 / 已导入 1 / 已校验 0 / 共 2");
    expect(running).toContain("不支持取消");
    expect(buttons(running)).toEqual(["刷新状态"]);
    const activated = card({ status: activatedStatus() });
    expect(activated).toContain("Hindsight 已启用");
    expect(activated).toContain("启用 Hindsight · 已完成");
    expect(activated).toContain("已提交 · 已完成");
    expect(buttons(activated)).toEqual(["刷新状态"]);
  });

  it("offers 继续 after an interruption or unknown outcome without inventing success", () => {
    const interrupted = card({ status: interruptedStatus() });
    expect(interrupted).toContain("启用未完成，可继续");
    expect(interrupted).toContain("不会重复导入");
    expect(interrupted).toContain("HINDSIGHT_CUTOVER_LEASE_LOST");
    expect(buttons(interrupted)).toEqual(["刷新状态", "继续"]);
    const unknown = card({ status: unknownStatus() });
    expect(unknown).toContain("操作结果未知");
    expect(unknown).toContain('role="status"');
    expect(unknown).toContain("执行结果尚未确认");
    expect(buttons(unknown)).toEqual(["刷新状态", "继续"]);
    expect(unknown).not.toContain("Hindsight 已启用");
  });

  it("separates committed Hindsight authority from an unavailable runtime and offers same-run binding repair", () => {
    const markup = card({ status: committedUnavailableStatus() });
    expect(markup).toContain("Hindsight 权威已提交，运行时不可用");
    expect(markup).toContain("不可用：连接不可用");
    expect(markup).toContain("不会重新导入");
    expect(markup).toContain("1 个来源组 / 2 条未消费见证 / 0 段未完成写入");
    expect(buttons(markup)).toEqual(["刷新状态", "恢复运行时"]);
    expect(markup).not.toContain("Hindsight 已启用");
  });

  it("locks server-offered controls while disconnected or awaiting a mutation reply", () => {
    const status = activationStatus();
    const disconnected = card({ status, connectionReady: false });
    expect(disconnected).toContain("连接恢复后将重新读取");
    expect(disabled(disconnected)).toBe(2);
    const busy = card({ status, busyKey: "hindsight:activate" });
    expect(busy).toContain('aria-busy="true"');
    expect(disabled(busy)).toBe(1);
    const cancelling = card({ status: admittedStatus(), busyKey: `cancel:${admittedStatus().actions.cancelOperationId}` });
    expect(cancelling).toContain('aria-busy="true"');
    expect(disabled(cancelling)).toBe(1);
    const feedback = card({ status, feedback: { tone: "warn", message: "请求超时，操作结果未知。" } });
    expect(feedback).toContain("请求超时，操作结果未知。");
  });

  it("keeps ids, receipts and fingerprints inside the diagnostics block only", () => {
    const markup = card({ status: activatedStatus() });
    const [body, diagnostics] = markup.split("<details");
    expect(diagnostics).toContain("transaction-hindsight-1");
    expect(diagnostics).toContain("ab".repeat(32));
    expect(diagnostics).toContain("native-global / native-taki");
    expect(body).not.toContain("transaction-hindsight-1");
    expect(body).not.toContain("native-global");
    expect(body).not.toContain("epoch-hindsight-1");
  });
});
