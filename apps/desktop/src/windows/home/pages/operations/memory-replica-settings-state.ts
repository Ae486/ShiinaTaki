/**
 * INPUT:  Core schedule values and disposable operator mode/interval drafts
 * OUTPUT: lossless interval/unit presentation and complete validated schedule configuration
 * POS:    ui/windows/home/pages/operations — pure form conversion; SQLite remains the configuration authority
 */
import { MemoryReplicaConfigureParamsSchema, type MemoryReplicaScheduleConfig } from "@taki/shared";

export const REPLICA_INTERVAL_UNITS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
export type ReplicaIntervalUnit = keyof typeof REPLICA_INTERVAL_UNITS;
export interface ReplicaIntervalDraft { value: string; unit: ReplicaIntervalUnit }
export interface ReplicaSettingsDraft {
  automatic: boolean;
  incremental: ReplicaIntervalDraft;
  full: ReplicaIntervalDraft;
}

function intervalDraft(ms: number): ReplicaIntervalDraft {
  const unit = ms % REPLICA_INTERVAL_UNITS.days === 0 ? "days" : ms % REPLICA_INTERVAL_UNITS.hours === 0 ? "hours" : "minutes";
  return { value: String(ms / REPLICA_INTERVAL_UNITS[unit]), unit };
}

export function replicaSettingsDraft(config: MemoryReplicaScheduleConfig): ReplicaSettingsDraft {
  return { automatic: config.automatic, incremental: intervalDraft(config.autoIntervalMs), full: intervalDraft(config.fullReconciliationIntervalMs) };
}

export function replicaSettingsConfig(draft: ReplicaSettingsDraft): MemoryReplicaScheduleConfig | null {
  if (!draft.incremental.value.trim() || !draft.full.value.trim()) return null;
  const parsed = MemoryReplicaConfigureParamsSchema.safeParse({ bankId: "draft", config: {
    automatic: draft.automatic,
    autoIntervalMs: Math.round(Number(draft.incremental.value) * REPLICA_INTERVAL_UNITS[draft.incremental.unit]),
    fullReconciliationIntervalMs: Math.round(Number(draft.full.value) * REPLICA_INTERVAL_UNITS[draft.full.unit]),
  } });
  return parsed.success ? parsed.data.config : null;
}
