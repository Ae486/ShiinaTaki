import { describe, expect, it } from "vitest";
import { MemoryActivationStatusSchema } from "@taki/shared";
import { activatedStatus, activationBank, activationStatus, admittedStatus, blockedStatus, committedUnavailableStatus, interruptedStatus, legacyStatus, missingBankStatus,
  runningStatus, unconfiguredStatus, unknownStatus } from "./hindsight-activation-fixtures.ts";
import { activationBankRows, activationBlockingLines, activationDiagnostics, activationFacts, activationGuidance, activationHeadline,
  activationProgress, initialActivationState, openOperation } from "./hindsight-activation-state.ts";

const STATES = {
  legacy: legacyStatus, unconfigured: unconfiguredStatus, blocked: blockedStatus, missingBank: missingBankStatus, ready: activationStatus, admitted: admittedStatus,
  running: runningStatus, interrupted: interruptedStatus, unknown: unknownStatus, committedUnavailable: committedUnavailableStatus, activated: activatedStatus,
};

describe("Hindsight activation view model", () => {
  it("builds every fixture state from the strict shared schema", () => {
    for (const build of Object.values(STATES)) expect(MemoryActivationStatusSchema.parse(build())).toEqual(build());
    expect(initialActivationState()).toEqual({ status: null, loading: true, error: null, busyKey: null, feedback: null });
  });

  it("headlines each state truthfully and never promises activation early", () => {
    expect(Object.fromEntries(Object.entries(STATES).map(([name, build]) => [name, activationHeadline(build())]))).toEqual({
      legacy: "需要先启用本地记忆", unconfigured: "先完成 Hindsight 连接配置", blocked: "Bank 前置条件未满足", missingBank: "Bank 前置条件未满足", ready: "可以启用 Hindsight",
      admitted: "操作已受理，等待开始", running: "正在启用 Hindsight", interrupted: "启用未完成，可继续", unknown: "操作结果未知",
      committedUnavailable: "Hindsight 权威已提交，运行时不可用", activated: "Hindsight 已启用",
    });
    expect(activationHeadline({ ...activationStatus(), actions: { ...activationStatus().actions, activate: false } })).toBe("等待 Core 提供下一步");
  });

  it("guides setup by phase and separates committed authority from an unavailable runtime", () => {
    expect(activationGuidance(unconfiguredStatus("unconfigured"))).toContain("设置（高级）");
    expect(activationGuidance(unconfiguredStatus("disabled"))).toContain("已在设置中停用");
    expect(activationGuidance(unconfiguredStatus("compatible"))).toContain("应用配置");
    expect(activationGuidance(unconfiguredStatus("applying-templates"))).toContain("配置进行中");
    expect(activationGuidance(blockedStatus())).toContain("多出的 Hindsight 配置");
    expect(activationGuidance(committedUnavailableStatus())).toContain("不会重新导入");
    expect(activationGuidance(interruptedStatus())).toContain("不会重复导入");
    expect(activationGuidance(runningStatus())).toContain("不支持取消");
    expect(activationGuidance(legacyStatus())).toContain("本地记忆引导");
  });

  it("reports producer progress only for an open operation and the run record otherwise", () => {
    expect(openOperation(runningStatus())?.state).toBe("running");
    expect(openOperation(interruptedStatus())).toBeNull();
    expect(activationProgress(runningStatus("verifying"))).toMatchObject({ phase: "verifying", importedBankCount: 1 });
    expect(activationProgress(interruptedStatus())).toBeNull();
    const running = activationFacts(runningStatus());
    expect(running).toContainEqual({ label: "启用阶段", value: "导入到 Hindsight" });
    expect(running).toContainEqual({ label: "Bank 进度", value: "已准备 2 / 已导入 1 / 已校验 0 / 共 2" });
    expect(running).toContainEqual({ label: "携带的写入见证", value: "1" });
    expect(running).toContainEqual({ label: "最近操作", value: "启用 Hindsight · 执行中" });
    expect(running.map((row) => row.label)).not.toContain("启用记录");
    const admitted = activationFacts(admittedStatus());
    expect(admitted).toContainEqual({ label: "启用阶段", value: "已受理，等待开始" });
    expect(admitted).toContainEqual({ label: "最近操作", value: "启用 Hindsight · 已受理（未认领）" });
    expect(admitted.map((row) => row.label)).not.toContain("携带的写入见证");
    const interrupted = activationFacts(interruptedStatus());
    expect(interrupted).toContainEqual({ label: "启用记录", value: "失败 · 失败" });
    expect(interrupted).toContainEqual({ label: "最近操作", value: "启用 Hindsight · 失败" });
    expect(activationFacts(activatedStatus())).toContainEqual({ label: "启用记录", value: "已提交 · 已完成" });
  });

  it("shows authority, runtime and custody facts only as Core reported them", () => {
    const ready = activationFacts(activationStatus());
    expect(ready.slice(0, 3)).toEqual([{ label: "当前权威", value: "本地记忆（Canonical Local）" }, { label: "当前运行时", value: "可用" }, { label: "连接配置", value: "已完成" }]);
    expect(ready.map((row) => row.label)).not.toContain("未完成的本地写入");
    const unavailable = activationFacts(committedUnavailableStatus());
    expect(unavailable).toContainEqual({ label: "当前权威", value: "Hindsight" });
    expect(unavailable).toContainEqual({ label: "当前运行时", value: "不可用：连接不可用" });
    expect(unavailable).toContainEqual({ label: "未完成的本地写入", value: "1 个来源组 / 2 条未消费见证 / 0 段未完成写入" });
    expect(activationFacts(unconfiguredStatus())).toContainEqual({ label: "连接配置", value: "待校验连接" });
  });

  it("lists Bank prerequisites with missing and extra scopes without native ids", () => {
    expect(activationBankRows(activationStatus())).toEqual([{ label: "Global", value: "已校验" }, { label: "Character · taki", value: "已校验" }]);
    expect(activationBankRows(unconfiguredStatus())).toEqual([{ label: "Global", value: "未配置 Hindsight Bank" }, { label: "Character · taki", value: "未配置 Hindsight Bank" }]);
    const configuredUnverified = { ...activationStatus(), prerequisites: { banks: [activationBank("global", { verified: false })], blocking: [] } };
    expect(activationBankRows(configuredUnverified)).toEqual([{ label: "Global", value: "已配置，未校验" }]);
    expect(activationBankRows(legacyStatus())).toEqual([]);
    expect(activationBlockingLines(unconfiguredStatus())).toEqual(["Global：缺少已校验的 Hindsight Bank", "Character · taki：缺少已校验的 Hindsight Bank"]);
    expect(activationBlockingLines(blockedStatus())).toEqual(["Character · taki：Hindsight 配置多出的 Bank（本地没有对应 Bank）"]);
    const other = { ...blockedStatus(), prerequisites: { banks: [], blocking: [{ scope: "global" as const, characterId: null, localBankId: null, code: "HINDSIGHT_PREDECESSOR_STALE" as const }] } };
    expect(activationBlockingLines(other)).toEqual(["Global：HINDSIGHT_PREDECESSOR_STALE"]);
    expect(JSON.stringify([activationBankRows(activationStatus()), activationBlockingLines(unconfiguredStatus())])).not.toContain("native-");
  });

  it("keeps ids, receipts, fingerprints and lease details in diagnostics with 无 for absent values", () => {
    const rows = Object.fromEntries(activationDiagnostics(activatedStatus()).map((row) => [row.label, row.value]));
    expect(rows).toMatchObject({ Epoch: "epoch-hindsight-1", Run: "run-hindsight-1", 租约: "已释放 · fence 2", 配置版本: "3",
      提交回执: "transaction-hindsight-1 · epoch-hindsight-1 · 2026-09-23T00:00:00.000Z", "Hindsight Bank": "native-global / native-taki",
      配置指纹: "ab".repeat(32), 结果: "activated", 原因: "无", 错误: "无" });
    const bare = Object.fromEntries(activationDiagnostics(legacyStatus()).map((row) => [row.label, row.value]));
    expect(bare).toMatchObject({ Epoch: "无", Run: "无", 租约: "无", 提交回执: "无", "Hindsight Bank": "无", 配置指纹: "无", 操作: "无", 结果: "无" });
    expect(Object.fromEntries(activationDiagnostics(interruptedStatus()).map((row) => [row.label, row.value])))
      .toMatchObject({ 租约: "已释放 · fence 2", 原因: "producer_failed", 错误: "HINDSIGHT_CUTOVER_LEASE_LOST", 结果: "无" });
  });
});
