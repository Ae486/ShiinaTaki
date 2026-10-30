/**
 * INPUT:  the useMemoryOperations() view (composite memory.authority.status + serialized actions).
 * OUTPUT: <MemoryAuthorityCard> — authority/runtime/setup lines, one block per Bank (replica status, Pending counts,
 *         Sync now / Full reconcile / Retry), and the active operations with Cancel for admitted replica.sync only.
 * POS:    ui/windows/home/pages/operations — presentational; every number is a Core read and unknown renders as
 *         "未知". Stage 1 offers no setup.validate / setup.apply controls from this card.
 */

import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { memoryAuthorityView, type ActiveOperationRow, type BankRow, type MemoryAuthorityView, type PendingRow } from "./memory-authority-state.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

export function MemoryAuthorityCard({ ops }: { ops: MemoryOperationsView }) {
  const view = ops.status ? memoryAuthorityView(ops.status) : null;
  return (
    <PageCard title="记忆权威 / Hindsight 运维">
      {ops.error && (
        <div className="mb-3"><FeedbackLine tone="danger" action={{ label: "重试", onClick: () => void ops.refresh() }}>{ops.error}</FeedbackLine></div>
      )}
      {view ? <CardBody view={view} ops={ops} /> : ops.connectionReady && ops.loading && !ops.error ? <Skeleton lines={4} />
        : !ops.error && <p className="text-xs text-text-secondary">{ops.connectionReady ? "等待状态读取。" : "等待连接以读取状态。"}</p>}
      {ops.feedback && <div className="mt-3"><FeedbackLine tone={ops.feedback.tone}>{ops.feedback.message}</FeedbackLine></div>}
    </PageCard>
  );
}

function CardBody({ view, ops }: { view: MemoryAuthorityView; ops: MemoryOperationsView }) {
  const locked = !ops.connectionReady || ops.busyKey !== null;
  return (
    <div className="flex flex-col gap-4">
      <LabeledRows rows={[{ label: "权威", value: view.headline }, { label: "运行时", value: view.runtimeLine }, { label: "Setup", value: view.setupLine }]} />
      {view.hindsight && view.banks.length === 0 && <p className="text-xs text-text-secondary">尚无 Bank。</p>}
      {view.banks.map((bank) => (
        <BankBlock key={bank.bankId} bank={bank} pending={view.pending.find((row) => row.bankId === bank.bankId) ?? null} ops={ops} locked={locked} />
      ))}
      <ActiveOperations rows={view.active} ops={ops} locked={locked} />
    </div>
  );
}

function BankBlock({ bank, pending, ops, locked }: { bank: BankRow; pending: PendingRow | null; ops: MemoryOperationsView; locked: boolean }) {
  const busy = ops.busyKey === `sync:${bank.bankId}`;
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <p className="mb-2 text-xs font-semibold text-text-strong">{bank.label}</p>
      <LabeledRows rows={[
        { label: "上次成功", value: bank.lastSuccess },
        { label: "上次尝试", value: bank.lastAttempt },
        { label: "下次到期", value: bank.nextDue },
        { label: "错误", value: bank.error },
        { label: "下一步", value: bank.nextAction },
        ...(pending ? [{ label: "Pending", value: `${pending.pending} 待写 / ${pending.failed} 失败 / ${pending.unknown} 未知 / ${pending.parentWrites} 父写` }] : []),
      ]} />
      <div className="mt-3 flex flex-wrap gap-2">
        {bank.retryKind && (
          <ActionButton tone="primary" busy={busy} disabled={locked} onClick={() => void ops.submitSync(bank.bankId, bank.retryKind ?? "incremental")}>
            重试（{bank.retryKind}）
          </ActionButton>
        )}
        <ActionButton tone="secondary" busy={busy} disabled={locked} onClick={() => void ops.submitSync(bank.bankId, "incremental")}>立即同步</ActionButton>
        <ActionButton tone="secondary" busy={busy} disabled={locked} onClick={() => void ops.submitSync(bank.bankId, "full")}>完整对账</ActionButton>
      </div>
    </div>
  );
}

function ActiveOperations({ rows, ops, locked }: { rows: ActiveOperationRow[]; ops: MemoryOperationsView; locked: boolean }) {
  if (rows.length === 0) return <p className="text-xs text-text-secondary">无进行中的操作。</p>;
  return (
    <ul className="flex flex-col gap-2 text-xs">
      {rows.map((row) => (
        <li key={row.operationId} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-text-body">{row.label}</span>
          {row.cancellable && (
            <ActionButton tone="ghost" busy={ops.busyKey === `cancel:${row.operationId}`} disabled={locked} onClick={() => void ops.cancel(row.operationId)}>
              取消
            </ActionButton>
          )}
        </li>
      ))}
    </ul>
  );
}
