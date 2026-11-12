/**
 * INPUT:  Home's authenticated client, effective Settings visibility and current config snapshots.
 * OUTPUT: useConfig() — truthful read/observation state plus current-attempt save outcomes.
 * POS:    Home Settings composition hook; read observation, write lifetime and editable drafts have separate owners.
 */
import type { ConfigEntry, ConfigValue } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import type { ConfigSaveOutcome } from "./config-save-controller.ts";
import { useConfigRead } from "./use-config-read.ts";
import { useConfigSave } from "./use-config-save.ts";

export interface ConfigView {
  entries: ConfigEntry[];
  hasSnapshot: boolean;
  connectionReady: boolean;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  observationGap: boolean;
  save(key: string, value: ConfigValue | null): Promise<ConfigSaveOutcome>;
  refresh(): Promise<void>;
}

export function useConfig(): ConfigView {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const visible = usePageActive("settings");
  const list = useConfigRead(ready, visible);
  const writes = useConfigSave(ready, list);
  return {
    entries: list.data?.entries ?? [],
    hasSnapshot: list.data !== null,
    connectionReady: ready !== null,
    loading: list.loading,
    error: list.error,
    refreshing: list.refreshing,
    observationGap: list.observationGap,
    ...writes,
    refresh: list.refresh,
  };
}
