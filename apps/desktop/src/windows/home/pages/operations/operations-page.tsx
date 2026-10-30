/**
 * INPUT:  independent Operations read states and explicit maintenance actions from useOperations.
 * OUTPUT: retained memory/storage cards and durable Memory operations with distinct loading, error/retry and unavailable presentation.
 * POS:    Home Operations — presentation only; Core counters and actual mutation outcomes supply every claim.
 */

import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import { statusRows, tidyDefectRows } from "./operations-state.ts";
import { StorageCard } from "./storage-card.tsx";
import { useMemoryOperations } from "./use-memory-operations.ts";
import { useOperations } from "./use-operations.ts";

export function OperationsPage() {
  const ops = useOperations();
  const memoryOps = useMemoryOperations();

  return (
    <>
      <PageHeader title="运维" hint="手动整理记忆、查看压缩与校准状态、管理附件占用。" busy={ops.refreshing || (memoryOps.connectionReady && memoryOps.loading)} />
      <PageBody>
        {ops.error && (
          <PageAlert>{ops.error}</PageAlert>
        )}

        <MemoryAuthorityCard ops={memoryOps} />

        <PageCard title="记忆整理">
          <ActionButton
            tone="primary"
            busy={ops.tidying}
            onClick={() => void ops.runTidy()}
            disabled={!ops.connectionReady || ops.tidying}
          >
            立即整理
          </ActionButton>
          {ops.tidy && (
            <div className="mt-3 flex flex-col gap-1.5">
              <p className="text-xs text-text-body">
                {ops.tidy.status === "clean" ? "无需整理（未调用模型）" : `已整理：${ops.tidy.edits} 处改动 / ${ops.tidy.steps} 步`}
              </p>
              <LabeledRows rows={tidyDefectRows(ops.tidy)} />
            </div>
          )}
        </PageCard>

        <PageCard title="记忆 / 上下文状态">
          {ops.statusError && <PageAlert action={{ label: "重试", onClick: () => void ops.refreshStatus() }}>读取状态失败：{ops.statusError}</PageAlert>}
          {ops.status && <LabeledRows rows={statusRows(ops.status)} />}
          {!ops.status && ops.statusLoading && <Skeleton lines={4} />}
          {!ops.status && !ops.statusLoading && !ops.statusError && <p className="text-xs text-text-secondary">等待连接以读取状态。</p>}
        </PageCard>

        <StorageCard usage={ops.usage} clear={ops.clear} connectionReady={ops.connectionReady}
          read={{ loading: ops.usageLoading, error: ops.usageError, retry: ops.refreshUsage }} />
        <div className="flex justify-end"><ActionButton disabled={!ops.connectionReady} onClick={() => void ops.refresh()}>刷新状态</ActionButton></div>
      </PageBody>
    </>
  );
}
