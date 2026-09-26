/**
 * INPUT:  a hindsightBackupView() projection, the card's lock flag and the useMemoryOperations() submit / busy state
 * OUTPUT: <HindsightBackupBlock> — the rollback warning, backup state / age / per-Bank missing interval rows, the in-flight
 *         or failure line, the route-b 导入备份 form for a staged capture, 创建备份 / 校验备份 buttons and collapsed diagnostics
 * POS:    ui/windows/home/pages/operations — presentational child of the memory authority card; every action goes through
 *         the generic submit and is disabled while locked or while a backup operation is open
 */
import { useState } from "react";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows } from "../../page-card.tsx";
import { backupAdmitAction, type HindsightBackupView, type StagedCapture } from "./memory-hindsight-backup-state.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

interface BlockProps { backup: HindsightBackupView; ops: MemoryOperationsView; locked: boolean }

export function HindsightBackupBlock({ backup, ops, locked }: BlockProps) {
  const disabled = locked || backup.pending;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <p className="text-xs font-semibold text-text-strong">Hindsight 备份</p>
      {backup.rollback && <FeedbackLine tone="danger">{backup.rollback}</FeedbackLine>}
      <LabeledRows rows={backup.rows} />
      <LabeledRows rows={backup.intervals} />
      {backup.inFlight && <FeedbackLine tone="info">进行中：{backup.inFlight}</FeedbackLine>}
      {backup.failure && <FeedbackLine tone="warn">{backup.failure}</FeedbackLine>}
      {backup.staged && <AdmitForm key={backup.staged.backupId} staged={backup.staged} ops={ops} disabled={disabled} />}
      <div className="mt-1 flex flex-wrap gap-2">
        {backup.actions.map((action) => (
          <ActionButton key={action.key} tone="secondary" busy={ops.busyKey === action.key} disabled={disabled}
            onClick={() => void ops.submit(action.request, action.key)}>{action.label}</ActionButton>
        ))}
      </div>
      {backup.diagnostics.length > 0 && (
        <details className="text-xs text-text-secondary">
          <summary className="cursor-pointer">备份诊断</summary>
          <div className="mt-2 break-all"><LabeledRows rows={backup.diagnostics} /></div>
        </details>
      )}
    </div>
  );
}

function AdmitForm({ staged, ops, disabled }: { staged: StagedCapture; ops: MemoryOperationsView; disabled: boolean }) {
  const [fileName, setFileName] = useState("");
  const action = backupAdmitAction(staged, fileName);
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3 text-xs text-text-body">
      <p>等待原生备份 ZIP：备份 <span className="break-all font-medium">{staged.backupId}</span> 的 Core 数据已暂存。</p>
      <p className="break-all text-text-secondary">
        用 backups/{staged.backupId}.staged/native-request.json 运行原生备份命令，把生成的 ZIP 放进数据目录的 backups/inbox，再填写文件名导入。
      </p>
      <Field label="ZIP 文件名" hint="只填文件名（例如 native-backup.zip），不要填路径" invalid={fileName !== "" && action === null}>
        <input value={fileName} maxLength={128} disabled={disabled} onChange={(event) => setFileName(event.target.value)} className={FIELD_CONTROL} />
      </Field>
      <div>
        <ActionButton tone="primary" busy={ops.busyKey === "backup:admit"} disabled={disabled || action === null}
          onClick={() => { if (action) void ops.submit(action.request, action.key); }}>导入备份</ActionButton>
      </div>
    </div>
  );
}
