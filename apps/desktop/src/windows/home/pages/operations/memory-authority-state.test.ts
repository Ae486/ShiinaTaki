import { describe, expect, it } from "vitest";
import { MemoryAuthorityStatusSchema, MemoryOperationSchema } from "@taki/shared";
import { bankStatus, hindsightStatus, localStatus, operation } from "./memory-authority-fixtures.ts";
import { memoryAuthorityView, memoryOperationAppError } from "./memory-authority-state.ts";

describe("memory authority view model", () => {
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
    expect(view.headline).toBe("Local（canonical）");
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
    expect(view.banks).toEqual([{
      bankId: "global", label: "Global", lastSuccess: "未知", lastAttempt: "未知", nextDue: "未知", error: "无", nextAction: "无", retryKind: null,
    }]);
    expect(view.pending).toEqual([{ bankId: "global", pending: 1, failed: 0, unknown: 1, parentWrites: 2 }]);
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
    expect(admitted).toMatchObject({ cancellable: true, label: "同步副本 · 共享记忆（增量同步） · 已受理（未认领）" });
    expect(running).toMatchObject({ cancellable: false, state: "running" });
  });

  it("reads the closed refusal reason and active operation id from error.data", () => {
    const cause = { message: "refused", data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: "op-1" } };
    expect(memoryOperationAppError(cause)).toEqual({ code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: "op-1" });
    expect(memoryOperationAppError(new Error("socket closed"))).toEqual({ code: null, reason: null, activeOperationId: null });
  });
});
