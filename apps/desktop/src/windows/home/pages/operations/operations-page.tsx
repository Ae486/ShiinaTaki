/**
 * INPUT:  none (page root); reads status/usage and drives the maintenance actions through useOperations.
 * OUTPUT: <OperationsPage> — memory maintenance (manual tidy + its defect counts), the memory/context status card,
 *         and the storage card with the D46 attachment purge.
 * POS:    ui/windows/home/pages/operations — presentational; every ws call goes through the hook.
 */

import { LabeledRows, PageCard } from "../../page-card.tsx";
import { statusRows, tidyDefectRows } from "./operations-state.ts";
import { StorageCard } from "./storage-card.tsx";
import { useOperations } from "./use-operations.ts";

export function OperationsPage() {
  const ops = useOperations();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h1 className="text-sm font-semibold text-slate-700">运维</h1>
      </header>
      {ops.error && <p className="bg-rose-50 px-4 py-2 text-xs text-rose-700">{ops.error}</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <PageCard title="记忆整理">
          <button
            type="button"
            onClick={() => void ops.runTidy()}
            disabled={ops.tidying}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {ops.tidying ? "整理中…" : "立即整理"}
          </button>
          {ops.tidy && (
            <div className="mt-2 flex flex-col gap-1">
              <p className="text-xs text-slate-600">
                {ops.tidy.status === "clean" ? "无需整理（未调用模型）" : `已整理：${ops.tidy.edits} 处改动 / ${ops.tidy.steps} 步`}
              </p>
              <LabeledRows rows={tidyDefectRows(ops.tidy)} />
            </div>
          )}
        </PageCard>

        <PageCard title="记忆 / 上下文状态">
          {ops.status ? <LabeledRows rows={statusRows(ops.status)} /> : <p className="text-xs text-slate-400">载入中…</p>}
        </PageCard>

        <StorageCard usage={ops.usage} clear={ops.clear} />
      </div>
    </div>
  );
}
