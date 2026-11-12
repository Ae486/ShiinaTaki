/**
 * INPUT:  none (page root); reads status/usage and drives the maintenance actions through useOperations.
 * OUTPUT: <OperationsPage> — Local onboarding, Hindsight activation, the memory authority / Hindsight card, memory maintenance
 *         (manual tidy + its defect counts), API configuration observation, template/user management, memory/context status and D46 attachment purge.
 * POS:    ui/windows/home/pages/operations — presentational; every ws call goes through a hook. Loading rides the
 *         shared Skeleton and the failed status/usage read carries a retry (batch-2 U5).
 */

import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import { HindsightActivationCard } from "./hindsight-activation-card.tsx";
import { MemoryTidyCard } from "./memory-tidy-card.tsx";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import { LocalOnboardingCard } from "./local-onboarding-card.tsx";
import { statusRows } from "./operations-state.ts";
import { StorageCard } from "./storage-card.tsx";
import { useHindsightActivation } from "./use-hindsight-activation.ts";
import { useMemoryOperations } from "./use-memory-operations.ts";
import { useLocalOnboarding } from "./use-local-onboarding.ts";
import { useOperations } from "./use-operations.ts";
import { useMemoryTransitions } from "./use-memory-transitions.ts";
import { MemoryTransitionsCard } from "./memory-transitions-card.tsx";
import { HindsightConfigurationSection } from "./hindsight-configuration-card.tsx";
import { HindsightTemplateSection } from "./hindsight-template-card.tsx";

export function OperationsPage() {
  const memoryOps = useMemoryOperations();
  const ops = useOperations(memoryOps.tidy);
  const onboarding = useLocalOnboarding();
  const activation = useHindsightActivation();
  const transitions = useMemoryTransitions();

  return (
    <>
      <PageHeader title="运维" hint="启用本地记忆或 Hindsight、手动整理记忆、查看状态与管理附件占用。"
        busy={ops.refreshing || (memoryOps.connectionReady && (memoryOps.loading || memoryOps.tidyLoading)) || onboarding.loading || onboarding.refreshing || (activation.loading && activation.connectionReady)} />
      <PageBody>

        <MemoryAuthorityCard ops={memoryOps} />
        <MemoryTransitionsCard view={transitions} />
        <LocalOnboardingCard onboarding={onboarding} />
        <HindsightActivationCard activation={activation} />
        <HindsightConfigurationSection />
        <HindsightTemplateSection />

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
