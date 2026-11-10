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
import { MemoryTidyCard } from "./memory-tidy-card.tsx";
import { statusRows } from "./operations-state.ts";
import { StorageCard } from "./storage-card.tsx";
import { useMemoryOperations } from "./use-memory-operations.ts";
import { useOperations } from "./use-operations.ts";

export function OperationsPage() {
  const memoryOps = useMemoryOperations();
  const ops = useOperations(memoryOps.tidy);

  return (
    <>
      <PageHeader title="运维" hint="手动整理记忆、查看压缩与校准状态、管理附件占用。" busy={ops.refreshing || (memoryOps.connectionReady && (memoryOps.loading || memoryOps.tidyLoading))} />
      <PageBody>
        <MemoryAuthorityCard ops={memoryOps} />
        <MemoryTidyCard operation={memoryOps.tidy} loading={memoryOps.tidyLoading} error={memoryOps.tidyError}
          feedback={memoryOps.feedback?.scope === "tidy" ? memoryOps.feedback : null}
          submitting={memoryOps.busyKey === "tidy"} connectionReady={memoryOps.connectionReady}
          active={!memoryOps.error && (memoryOps.status?.operations.active.some((operation) => operation.kind === "tidy"
            && !(memoryOps.tidy?.terminalAt && memoryOps.tidy.operationId === operation.operationId)) ?? false)}
          runTidy={memoryOps.submitTidy} refresh={memoryOps.refresh} />

        <PageCard title="记忆 / 上下文状态">
          {ops.statusError && <PageAlert action={{ label: "重试", onClick: () => void ops.refreshStatus() }}>读取状态失败：{ops.statusError}</PageAlert>}
          {ops.status && <LabeledRows rows={statusRows(ops.status)} />}
          {!ops.status && ops.statusLoading && <Skeleton lines={4} />}
          {!ops.status && !ops.statusLoading && !ops.statusError && <p className="text-xs text-text-secondary">等待连接以读取状态。</p>}
        </PageCard>

        <StorageCard usage={ops.usage} clear={ops.clear} connectionReady={ops.connectionReady}
          read={{ loading: ops.usageLoading, error: ops.usageError, retry: ops.refreshUsage }} />
        <div className="flex justify-end"><ActionButton disabled={!ops.connectionReady} onClick={() => void Promise.all([ops.refresh(), memoryOps.refresh()])}>刷新状态</ActionButton></div>
      </PageBody>
    </>
  );
}
