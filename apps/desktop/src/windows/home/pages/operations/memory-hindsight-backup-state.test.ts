import { describe, expect, it, vi } from "vitest";
import { MemoryAuthorityStatusSchema, type MemoryAuthorityStatus } from "@taki/shared";
import { AT, lifecycleBank, localStatus, operation } from "./memory-authority-fixtures.ts";
import { createMemoryOperationsController, type MemoryOperationsClient } from "./memory-operations-controller.ts";
import { BACKUP_ID, BACKUP_STATES, NO_BACKUP, STAGED_BACKUP, STAGED_ID, backupOperation, backupSection, backupStatus, failedCapture,
  stagedCapture } from "./memory-hindsight-backup-fixtures.ts";
import { BACKUP_ERROR_LABEL, ROLLBACK_WARNING, backupAdmitAction, hindsightBackupView } from "./memory-hindsight-backup-state.ts";

const view = (status: MemoryAuthorityStatus) => {
  const projected = hindsightBackupView(status);
  if (!projected) throw new Error("fixture must carry a Hindsight section");
  return projected;
};
const CAPTURE = { key: "backup:capture", label: "创建备份", request: { kind: "backup.capture", expectedEpochId: "epoch-2", route: "native-endpoint" } };
const VERIFY = { key: "backup:verify", label: "校验备份", request: { kind: "backup.verify", backupId: BACKUP_ID } };
const OPERATOR = { key: "backup:capture-operator", label: "创建备份（手动导出原生数据）",
  request: { kind: "backup.capture", expectedEpochId: "epoch-2", route: "operator-artifact" } };
const LATER = "2026-09-19T02:00:00.000Z";

describe("Hindsight backup view model", () => {
  it("builds every backup fixture from the shared strict schema, with and without a backup section", () => {
    for (const status of Object.values(BACKUP_STATES)) expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
  });

  it("projects nothing when the marker is not Hindsight", () => {
    expect(hindsightBackupView(localStatus())).toBeNull();
  });

  it("keeps an unread section unknown and states a missing backup plainly, capture only", () => {
    expect(view(BACKUP_STATES.unknown)).toMatchObject({ rows: [{ label: "备份状态", value: "未知" }], intervals: [], actions: [CAPTURE] });
    const none = view(BACKUP_STATES.none);
    expect(none.rows).toEqual([{ label: "备份状态", value: "尚无已校验的备份" }]);
    expect(none.intervals).toEqual([{ label: "Global 未备份区间", value: "游标 未知 → 52 · 未落定写入 0 · 远端未同步写入未知" }]);
    expect(none).toMatchObject({ rollback: null, inFlight: null, failure: null, staged: null, pending: false, actions: [CAPTURE], diagnostics: [] });
  });

  it("shows the last verified backup with a human age and per-Bank missing intervals, unknown never zero", () => {
    const verified = view(BACKUP_STATES.verified);
    expect(verified.rows).toEqual([
      { label: "备份状态", value: "已有已校验的备份" }, { label: "上次备份", value: `${AT}（2 小时前）` }, { label: "校验时间", value: AT },
    ]);
    expect(verified.intervals).toEqual([
      { label: "Global 未备份区间", value: "游标 40 → 52 · 未落定写入 1 · 远端未同步写入未知" },
      { label: "Character · taki 未备份区间", value: "游标 未知 → 未知 · 未落定写入 未知 · 远端未同步写入未知" },
    ]);
    expect(verified.actions).toEqual([CAPTURE, VERIFY]);
    expect(verified.diagnostics).toEqual([{ label: "已校验备份", value: BACKUP_ID }]);
    expect(JSON.stringify([verified.rows, verified.intervals])).not.toMatch(/character-|4444/);
  });

  it("formats every age unit and falls back to the native id for a Bank the section does not map", () => {
    const ages = [30, 60, 3_599, 86_400 * 3 + 5].map((ageSeconds) => view(backupStatus(backupSection({ ageSeconds }))).rows[1]?.value);
    expect(ages).toEqual([`${AT}（不到 1 分钟前）`, `${AT}（1 分钟前）`, `${AT}（59 分钟前）`, `${AT}（3 天前）`]);
    const ghost = backupSection({ missingInterval: [{ bankId: "character-ghost", fromNativeCursor: 1, toReplicaCursor: 2, pendingCount: 0 }] });
    expect(view(backupStatus(ghost)).intervals[0]?.label).toBe("Bank character-ghost 未备份区间");
  });

  it("shows the running phase and marks every action pending while a backup operation is open", () => {
    const capturing = view(BACKUP_STATES.capturing);
    expect(capturing).toMatchObject({ inFlight: "创建备份 · 生成原生快照", failure: null, pending: true });
    const admitted = view(backupStatus(backupSection(), [backupOperation({ kind: "backup.verify", state: "admitted", producer: null,
      request: { kind: "backup.verify", backupId: BACKUP_ID } }), failedCapture("HINDSIGHT_BACKUP_NATIVE_FAILED")]));
    expect(admitted).toMatchObject({ inFlight: "校验备份 · 已受理（未认领）", failure: null, pending: true });
  });

  it("maps a failed operation's closed code to its message and keeps ids, codes and mismatch detail in diagnostics", () => {
    const failed = view(BACKUP_STATES.failed);
    expect(failed.failure).toBe("创建备份失败：Core 与原生快照不一致");
    expect(failed.diagnostics[1]).toEqual({ label: "最近备份操作",
      value: `77777777-7777-4777-8777-777777777777 · ${BACKUP_ID} · HINDSIGHT_BACKUP_PAIR_MISMATCH · receipt_missing@global` });
    expect(failed.actions).toEqual([CAPTURE, VERIFY]);
    for (const [code, message] of Object.entries(BACKUP_ERROR_LABEL)) {
      const status = backupStatus(backupSection(), [failedCapture(code as keyof typeof BACKUP_ERROR_LABEL)]);
      expect(view(status).failure).toBe(`创建备份失败：${message}`);
    }
    const restarted = backupOperation({ state: "outcome_unknown", reason: "core_restart", terminalAt: AT });
    expect(view(backupStatus(backupSection(), [restarted])).failure).toBe("创建备份结果未知（Core 重启），未完成的备份不会列出");
  });

  it("offers the operator-artifact route only after the last capture failed with ROUTE_UNAVAILABLE", () => {
    expect(view(BACKUP_STATES.routeUnavailable).actions).toEqual([CAPTURE, OPERATOR]);
    const recovered = backupStatus(NO_BACKUP, [failedCapture("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE"), failedCapture("HINDSIGHT_BACKUP_NATIVE_FAILED", LATER)]);
    expect(view(recovered).actions).toEqual([CAPTURE]);
  });

  it.each(["HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN", "HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED", "HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED"] as const)(
    "discloses %s without treating manual export as a way around missing template evidence", (code) => {
      const failed = view(backupStatus(NO_BACKUP, [failedCapture(code)]));
      expect(failed.failure).toMatch(/^创建备份失败：/);
      expect(failed.failure).not.toMatch(/未分类|undefined|HINDSIGHT_/);
      expect(failed.actions).toEqual([CAPTURE]);
    });

  it("offers the newest capture Core lists as staged, whatever the operations window holds, also across a failed admit", () => {
    expect(view(BACKUP_STATES.staged).staged).toEqual({ backupId: STAGED_ID, expectedEpochId: "epoch-2" });
    expect(view(backupStatus(STAGED_BACKUP)).staged).toEqual({ backupId: STAGED_ID, expectedEpochId: "epoch-2" });
    expect(view(backupStatus(NO_BACKUP, [stagedCapture()])).staged).toBeNull();
    const admit = (state: "failed" | "completed") => backupOperation({
      operationId: "99999999-9999-4999-8999-999999999999", kind: "backup.admit", state, createdAt: LATER, updatedAt: LATER, terminalAt: LATER,
      reason: state === "failed" ? "producer_failed" : null, errorCode: state === "failed" ? "HINDSIGHT_BACKUP_PROOF_MISSING" : null,
      request: { kind: "backup.admit", expectedEpochId: "epoch-2", backupId: STAGED_ID, fileName: "native.zip" },
      producer: { kind: "backup", backupId: STAGED_ID, phase: state === "failed" ? "verifying" : "completed" },
      result: state === "failed" ? null : { kind: "backup", backupId: STAGED_ID, verifiedAt: LATER, mismatch: null },
    });
    const refused = view(backupStatus(STAGED_BACKUP, [stagedCapture(), admit("failed")]));
    expect(refused).toMatchObject({ staged: { backupId: STAGED_ID }, failure: "导入备份失败：原生备份缺少校验证明" });
    expect(view(backupStatus(NO_BACKUP, [stagedCapture(), admit("completed")])).staged).toBeNull();
  });

  it("keeps a newest backup whose verify failed on Home and re-verifiable, beside or without a verified one", () => {
    const failedVerify = { backupId: STAGED_ID, createdAt: LATER, verifiedAt: null };
    const reverify = { ...VERIFY, request: { kind: "backup.verify", backupId: STAGED_ID } };
    const beside = view(backupStatus(backupSection({ latest: failedVerify })));
    expect(beside.rows.at(-1)).toEqual({ label: "最新备份", value: `${LATER}（未通过校验）` });
    expect(beside.actions).toEqual([CAPTURE, reverify]);
    expect(beside.diagnostics).toEqual([{ label: "已校验备份", value: BACKUP_ID }, { label: "最新备份", value: STAGED_ID }]);
    const alone = view(backupStatus({ ...NO_BACKUP, latest: failedVerify }));
    expect(alone.rows).toEqual([{ label: "备份状态", value: "尚无已校验的备份" }, { label: "最新备份", value: `${LATER}（未通过校验）` }]);
    expect(alone.actions).toEqual([CAPTURE, reverify]);
  });

  it("builds the admit request only for a plain inbox file name", () => {
    const staged = { backupId: STAGED_ID, expectedEpochId: "epoch-2" };
    expect(backupAdmitAction(staged, " native-backup.zip ")).toEqual({ key: "backup:admit", label: "导入备份",
      request: { kind: "backup.admit", expectedEpochId: "epoch-2", backupId: STAGED_ID, fileName: "native-backup.zip" } });
    for (const name of ["", "../native.zip", "C:\\inbox\\native.zip", ".hidden.zip", "native.tar", "con.zip", `${"a".repeat(125)}.zip`]) {
      expect(backupAdmitAction(staged, name)).toBeNull();
    }
  });

  it("raises the rollback warning from a replica or a lifecycle Bank error code", () => {
    expect(view(BACKUP_STATES.rollback).rollback).toBe(ROLLBACK_WARNING);
    const bank = { ...lifecycleBank(null, "failed"), errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" as const };
    const status = BACKUP_STATES.verified;
    const fromBank = { ...status, hindsight: status.hindsight && { ...status.hindsight, banks: [bank] } };
    expect(view(fromBank).rollback).toBe(ROLLBACK_WARNING);
    expect(view(BACKUP_STATES.verified).rollback).toBeNull();
  });

  it("submits each descriptor's request through the generic controller unchanged", async () => {
    const submitted = vi.fn<MemoryOperationsClient["memoryOperationSubmit"]>(async () => operation());
    const client: MemoryOperationsClient = {
      memoryAuthorityStatus: async () => BACKUP_STATES.staged, memoryActivationStatus: async () => { throw new Error("unused"); },
      memoryOperationSubmit: submitted, memoryOperationCancel: async () => operation(),
      subscribeMemoryOperations: async () => undefined, onMemoryOperationChanged: () => () => undefined,
    };
    const started = vi.fn();
    const controller = createMemoryOperationsController<MemoryAuthorityStatus>({
      loading: () => undefined, loaded: () => undefined, loadFailed: () => undefined, mutationStarted: started, mutationSettled: () => undefined,
    }, (target) => target.memoryAuthorityStatus());
    controller.replace(client);
    const staged = view(BACKUP_STATES.staged);
    const admit = staged.staged && backupAdmitAction(staged.staged, "native.zip");
    for (const action of [...view(BACKUP_STATES.verified).actions, ...(admit ? [admit] : [])]) await controller.submit(action.request, action.key);
    expect(submitted.mock.calls.map(([request]) => request)).toEqual([CAPTURE.request, VERIFY.request,
      { kind: "backup.admit", expectedEpochId: "epoch-2", backupId: STAGED_ID, fileName: "native.zip" }]);
    expect(started.mock.calls.map(([key]) => key)).toEqual(["backup:capture", "backup:verify", "backup:admit"]);
    controller.dispose();
  });
});
