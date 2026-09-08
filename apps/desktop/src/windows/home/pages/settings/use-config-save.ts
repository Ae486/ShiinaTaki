/**
 * INPUT:  current config client and the guarded read view's entries/change epochs/local echo action.
 * OUTPUT: useConfigSave() — explicit per-field save outcomes and current-generation notices.
 * POS:    Home Settings — React adapter over config-save-controller; drafts belong to each field.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ConfigValue } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createConfigSaveController } from "./config-save-controller.ts";
import { applyStored } from "./config-state.ts";
import type { useConfigRead } from "./use-config-read.ts";

export function useConfigSave(client: WsClient | null, read: ReturnType<typeof useConfigRead>) {
  const [notices, setNotices] = useState<Record<string, { ok: boolean; message: string }>>({});
  const current = useRef(read);
  current.current = read;
  const controller = useMemo(() => createConfigSaveController({
    entry: (key) => current.current.data?.entries.find((entry) => entry.key === key),
    versionOf: (key) => current.current.versionOf(key),
    apply: (result) => current.current.mutate((previous) => ({ ...previous, entries: applyStored(previous.entries, result) })),
    notice: (key, notice) => setNotices((previous) => ({ ...previous, [key]: notice })),
  }), []);
  useLayoutEffect(() => {
    controller.replace(client);
    return () => controller.replace(null);
  }, [controller, client]);
  const save = useCallback((key: string, value: ConfigValue | null) => controller.save(key, value), [controller]);
  return { save, notices };
}
