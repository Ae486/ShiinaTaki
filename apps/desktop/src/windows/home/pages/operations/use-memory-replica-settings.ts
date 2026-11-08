/**
 * INPUT:  persisted Bank schedule, disposable form edits and serialized configureSync action
 * OUTPUT: complete draft, bounded validation and explicit save action without mode-toggle resets
 * POS:    ui/windows/home/pages/operations — form hook; requests pass through the common operations controller
 */
import { useState } from "react";
import type { MemoryReplicaScheduleConfig } from "@taki/shared";
import { replicaSettingsConfig, replicaSettingsDraft, type ReplicaIntervalDraft, type ReplicaSettingsDraft } from "./memory-replica-settings-state.ts";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

export function useMemoryReplicaSettings(input: { bankId: string; schedule: MemoryReplicaScheduleConfig; ops: MemoryOperationsView }) {
  const [draft, setDraft] = useState(() => replicaSettingsDraft(input.schedule));
  const config = replicaSettingsConfig(draft);
  return {
    draft,
    valid: config !== null,
    setAutomatic: (automatic: boolean) => setDraft((current) => ({ ...current, automatic })),
    setInterval: (field: "incremental" | "full", interval: ReplicaIntervalDraft) => setDraft((current: ReplicaSettingsDraft) => ({ ...current, [field]: interval })),
    save: () => config ? input.ops.configureSync(input.bankId, config) : Promise.resolve(),
  };
}
