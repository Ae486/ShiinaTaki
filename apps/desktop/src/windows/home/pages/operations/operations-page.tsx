/**
 * INPUT:  none (page root); reads status/usage and drives the maintenance actions through useOperations.
 * OUTPUT: <OperationsPage> — Local onboarding, Hindsight activation, the memory authority / Hindsight card, memory maintenance
 *         (manual tidy + its defect counts), the memory/context status card, and the storage card with the D46 attachment purge.
 * POS:    ui/windows/home/pages/operations — presentational; every ws call goes through a hook. Loading rides the
 *         shared Skeleton and the failed status/usage read carries a retry (batch-2 U5).
 */

import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import { HindsightActivationCard } from "./hindsight-activation-card.tsx";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import { LocalOnboardingCard } from "./local-onboarding-card.tsx";
import { statusRows, tidyDefectRows } from "./operations-state.ts";
import { StorageCard } from "./storage-card.tsx";
import { useHindsightActivation } from "./use-hindsight-activation.ts";
import { useMemoryOperations } from "./use-memory-operations.ts";
import { useLocalOnboarding } from "./use-local-onboarding.ts";
import { useOperations } from "./use-operations.ts";
import { useMemoryTransitions } from "./use-memory-transitions.ts";
import { MemoryTransitionsCard } from "./memory-transitions-card.tsx";

export function OperationsPage() {
  const ops = useOperations();
  const memoryOps = useMemoryOperations();
  const onboarding = useLocalOnboarding();
  const activation = useHindsightActivation();
  const transitions = useMemoryTransitions();

  return (
    <>
      <PageHeader title="运维" hint="启用本地记忆或 Hindsight、手动整理记忆、查看状态与管理附件占用。"
        busy={ops.refreshing || memoryOps.loading || onboarding.loading || onboarding.refreshing || (activation.loading && activation.connectionReady)} />
      <PageBody>
        {ops.error && (
          <PageAlert action={{ label: "重试", onClick: () => void ops.refresh() }}>{ops.error}</PageAlert>
        )}

        <MemoryAuthorityCard ops={memoryOps} />
        <MemoryTransitionsCard view={transitions} />
        <LocalOnboardingCard onboarding={onboarding} />
        <HindsightActivationCard activation={activation} />

        <PageCard title="记忆整理">
          <ActionButton
            tone="primary"
            busy={ops.tidying}
            onClick={() => void ops.runTidy()}
            disabled={!ops.connectionReady || ops.tidying}
          >
            {ops.tidying ? "整理中…" : "立即整理"}
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
          {ops.status ? <LabeledRows rows={statusRows(ops.status)} /> : <Skeleton lines={4} />}
        </PageCard>

        <StorageCard usage={ops.usage} clear={ops.clear} connectionReady={ops.connectionReady} />
      </PageBody>
    </>
  );
}
