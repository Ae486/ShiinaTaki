/**
 * INPUT:  a hindsightLifecycleView() projection, the card's lock flag and the useMemoryOperations() submit / busy state
 * OUTPUT: <HindsightLifecycleBlock> — connection and per-scope Bank readiness rows, the Core-listed 重新校验连接 / 创建 Bank
 *         buttons and the collapsed technical diagnostics
 * POS:    ui/windows/home/pages/operations — presentational child of the memory authority card; rendering never mutates
 */
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows } from "../../page-card.tsx";
import type { HindsightLifecycleView } from "./memory-hindsight-lifecycle-state.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

export function HindsightLifecycleBlock({ lifecycle, ops, locked }: { lifecycle: HindsightLifecycleView; ops: MemoryOperationsView; locked: boolean }) {
  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <p className="mb-2 text-xs font-semibold text-text-strong">Hindsight 连接与 Bank</p>
      <LabeledRows rows={lifecycle.connection} />
      <div className="mt-2"><LabeledRows rows={lifecycle.banks} empty="尚无 Bank 记录。" /></div>
      {lifecycle.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {lifecycle.actions.map((action) => (
            <ActionButton key={action.key} tone="secondary" busy={ops.busyKey === action.key} disabled={locked}
              onClick={() => void ops.submit(action.request, action.key)}>{action.label}</ActionButton>
          ))}
        </div>
      )}
      {lifecycle.diagnostics.length > 0 && (
        <details className="mt-3 text-xs text-text-secondary">
          <summary className="cursor-pointer">技术诊断</summary>
          <div className="mt-2 break-all"><LabeledRows rows={lifecycle.diagnostics} /></div>
        </details>
      )}
    </div>
  );
}
