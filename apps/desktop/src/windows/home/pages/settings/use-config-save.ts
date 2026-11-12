/**
 * INPUT:  current config client and the guarded read view's entries/change epochs/local echo action.
 * OUTPUT: useConfigSave() — explicit per-field outcomes and once-only floating save feedback.
 * POS:    Home Settings — React adapter over config-save-controller; drafts belong to each field.
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ConfigValue } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createConfigSaveController } from "./config-save-controller.ts";
import { applyStored } from "./config-state.ts";
import { configLabelOf } from "./config-groups.ts";
import { dismissToastGroup, pushToast } from "@/components/toast/toast-store.js";
import type { useConfigRead } from "./use-config-read.ts";

export function useConfigSave(client: WsClient | null, read: ReturnType<typeof useConfigRead>) {
  const attempts = useRef(new Map<string, object>());
  const current = useRef(read);
  current.current = read;
  const controller = useMemo(() => createConfigSaveController({
    entry: (key) => current.current.data?.entries.find((entry) => entry.key === key),
    versionOf: (key) => current.current.versionOf(key),
    apply: (result) => current.current.mutate((previous) => ({ ...previous, entries: applyStored(previous.entries, result) })),
    started: (key) => { attempts.current.set(key, {}); },
    notice: (key, notice) => {
      const eventKey = attempts.current.get(key);
      if (!eventKey) return;
      attempts.current.delete(key);
      const label = configLabelOf(key) ?? key;
      pushToast(notice.ok ? `${label}的本次提交：${notice.message}` : `${label}保存失败，请检查字段错误。`,
        notice.ok ? "success" : "error", { eventKey, replaceKey: `config:${key}` });
    },
  }), []);
  useLayoutEffect(() => {
    attempts.current.clear();
    controller.replace(client);
    return () => controller.replace(null);
  }, [controller, client]);
  const save = useCallback((key: string, value: ConfigValue | null) => {
    dismissToastGroup(`config:${key}`);
    return controller.save(key, value);
  }, [controller]);
  return { save };
}
