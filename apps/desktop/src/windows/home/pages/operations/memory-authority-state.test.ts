import { describe, expect, it } from "vitest";
import { MemoryAuthorityStatusSchema, MemoryOperationSchema } from "@taki/shared";
import { bankStatus, hindsightStatus, localStatus, operation, policyReview } from "./memory-authority-fixtures.ts";
import { MEMORY_OPERATION_KIND_LABEL, memoryAuthorityView, memoryOperationAppError } from "./memory-authority-state.ts";

describe("memory authority view model", () => {
  it.each([true, false])("projects accepted waiting and real Pending counts with automatic=%s", (automatic) => {
    const due = "2026-09-19T02:00:00.000Z";
    const bank = bankStatus("global", { mode: "waiting", fullReconciliationState: "waiting", automatic,
      retryDueAt: automatic ? due : null, retryKind: automatic ? "full" : null,
      nextAction: automatic ? "automatic_retry_scheduled" : "explicit_retry_required", consecutiveFailures: 2 });
    const status = MemoryAuthorityStatusSchema.parse(hindsightStatus({ replica: [bank] }));
    const view = memoryAuthorityView(status);
    expect(view.banks[0]).toMatchObject({ state: "已受理，等待 Hindsight 处理", error: "无", lastSuccess: "未知",
      nextDue: automatic ? due : "手动模式", retryKind: automatic ? null : "full",
      nextAction: automatic ? "已排定自动检查处理结果" : "稍后手动同步以检查处理结果" });
    expect(view.pending).toEqual([{ bankId: "global", pending: 1, failed: 0, unknown: 1, parentWrites: 2 }]);
  });

  it("builds every fixture from the shared strict schemas", () => {
    const failed = bankStatus("character", { mode: "failed", automatic: false, errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "explicit_retry_required" });
    for (const status of [localStatus(), hindsightStatus(), hindsightStatus({ replica: [bankStatus("global"), failed] }),
      hindsightStatus({ runtime: { providerId: "hindsight", available: false, unavailableReason: "connection_unavailable" }, replica: null, pending: null })]) {
      expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    }
    expect(MemoryOperationSchema.parse(operation())).toEqual(operation());
  });

  it("renders Local mode without Bank rows and never invents replica evidence", () => {
    const view = memoryAuthorityView(localStatus());
    expect(view.headline).toBe("Local（canonical） · epoch epoch-1");
    expect(view.runtimeLine).toBe("运行时可用");
    expect(view.setupLine).toBe("compatible");
    expect(view.hindsight).toBe(false);
    expect(view.banks).toEqual([]);
    expect(view.pending).toEqual([]);
    expect(view.active).toEqual([]);
  });

  it("keeps unknown timestamps as 未知 and maps Pending counts verbatim", () => {
    const view = memoryAuthorityView(hindsightStatus());
    expect(view.hindsight).toBe(true);
    expect(view.banks).toMatchObject([{
      bankId: "global", label: "Global", lastSuccess: "未知", lastAttempt: "未知", nextDue: "未知", error: "无", nextAction: "无", retryKind: null,
      schedule: { automatic: true, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 },
    }]);
    expect(view.pending).toEqual([{ bankId: "global", pending: 1, failed: 0, unknown: 1, parentWrites: 2 }]);
  });

  it("joins review evidence by Bank identity and keeps review-only Banks when replica evidence is unavailable", () => {
    const review = [policyReview({ bankId: "character-taki", state: "paused", eligibleRemaining: null }),
      policyReview({ eligibleRemaining: 0, savedAwaitingPublication: 2 })];
    const live = memoryAuthorityView(hindsightStatus({ replica: [bankStatus("global"), bankStatus("character-taki")], review }));
    expect(live.banks[0]?.review.rows).toContainEqual({ label: "待巡检数量", value: "0" });
    expect(live.banks[1]?.review.rows).toContainEqual({ label: "巡检状态", value: "已暂停" });
    const unavailable = memoryAuthorityView(hindsightStatus({ review,
      runtime: { providerId: "hindsight", available: false, unavailableReason: "connection_unavailable" }, replica: null, pending: null }));
    expect(unavailable.banks.map((bank) => bank.bankId)).toEqual(["character-taki", "global"]);
    expect(unavailable.banks.every((bank) => bank.schedule === null && bank.retryKind === null)).toBe(true);
    expect(unavailable.banks[0]?.label).toBe("character-taki");
    expect(unavailable.banks[1]?.label).toBe("Global");
  });

  it("offers Retry with the Bank's retryKind only for explicit_retry_required", () => {
    const failed = bankStatus("character", {
      mode: "failed", automatic: false, errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "explicit_retry_required", retryKind: "full",
      lastAttemptAt: "2026-09-19T01:00:00.000Z",
    });
    const scheduled = bankStatus("global", { mode: "failed", errorCode: "HINDSIGHT_TIMEOUT", nextAction: "automatic_retry_scheduled", retryDueAt: "2026-09-19T02:00:00.000Z" });
    const [character, global] = memoryAuthorityView(hindsightStatus({ replica: [failed, scheduled] })).banks;
    expect(character).toMatchObject({ label: "Character · taki", retryKind: "full", nextAction: "需要显式重试", error: "HINDSIGHT_UNREACHABLE", nextDue: "手动模式" });
    expect(global).toMatchObject({ retryKind: null, nextAction: "已排定自动重试", nextDue: "2026-09-19T02:00:00.000Z" });
  });

  it("reports the runtime-unavailable reason and the setup error code", () => {
    const status = hindsightStatus({
      runtime: { providerId: "hindsight", available: false, unavailableReason: "authority_mismatch" }, replica: null, pending: null,
      setup: { ...localStatus().setup, phase: "failed", latestError: { code: "HINDSIGHT_SETUP_INTERRUPTED", retryable: true, nextAction: "重试" } },
    });
    const view = memoryAuthorityView(status);
    expect(view.hindsight).toBe(false);
    expect(view.runtimeLine).toBe("运行时不可用：运行时与权威标记不一致");
    expect(view.setupLine).toBe("failed · HINDSIGHT_SETUP_INTERRUPTED");
  });

  it("marks only an admitted replica.sync as cancellable", () => {
    const status = hindsightStatus({ operations: { active: [operation(), operation({ operationId: "33333333-3333-4333-8333-333333333333", state: "running" })], recent: [] } });
    const [admitted, running] = memoryAuthorityView(status).active;
    expect(admitted).toMatchObject({ cancellable: true, label: "同步副本 · global (incremental) · 已受理（未认领）" });
    expect(running).toMatchObject({ cancellable: false, state: "running" });
  });

  it.each(["authority_invalid", "evidence_invalid"] as const)("explains %s without presenting replica evidence", (reason) => {
    const view = memoryAuthorityView(hindsightStatus({ runtime: { providerId: "hindsight", available: false, unavailableReason: reason },
      replica: null, pending: null }));
    expect(view.runtimeLine).toContain(reason === "authority_invalid" ? "权威证据校验失败" : "本地记忆证据校验失败");
    expect(view.banks).toEqual([]); expect(view.pending).toEqual([]); expect(view.hindsight).toBe(false);
  });

  it("labels a running hindsight.activate without offering Cancel", () => {
    const activate = operation({ kind: "hindsight.activate", state: "running", authorityEpochId: "epoch-1", producer: null,
      request: { kind: "hindsight.activate", source: { mode: "new", setupRevision: 3, expectedEpochId: "epoch-1" } } });
    expect(MEMORY_OPERATION_KIND_LABEL["hindsight.activate"]).toBe("启用 Hindsight");
    expect(memoryAuthorityView(hindsightStatus({ operations: { active: [activate], recent: [] } })).active)
      .toEqual([{ operationId: activate.operationId, label: "启用 Hindsight · 执行中", state: "running", cancellable: false }]);
  });

  it("reads the closed refusal reason and active operation id from error.data", () => {
    const cause = { message: "refused", data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: "op-1" } };
    expect(memoryOperationAppError(cause)).toEqual({ code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: "op-1" });
    expect(memoryOperationAppError(new Error("socket closed"))).toEqual({ code: null, reason: null, activeOperationId: null });
  });
});
