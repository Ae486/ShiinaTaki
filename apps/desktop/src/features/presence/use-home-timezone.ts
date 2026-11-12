/**
 * INPUT: the authenticated Home client generation and existing operator credential identity
 * OUTPUT: one Home-owned timezone controller with event-driven device-zone revalidation
 * POS: ui/presence — no recurring settings polling and no report-source claims from other windows
 */
import { useLayoutEffect, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { authenticatedOperatorDeviceId } from "@/lib/operator-auth.js";
import { createUserTimezoneController, type UserTimezoneController } from "./user-timezone-controller.ts";

export function useHomeTimezone(client: WsClient | null) {
  const [binding, setBinding] = useState<{ client: WsClient; controller: UserTimezoneController } | null>(null);
  useLayoutEffect(() => {
    if (!client) return;
    const deviceId = authenticatedOperatorDeviceId(client);
    if (!deviceId) return;
    const controller = createUserTimezoneController({ client, deviceId,
      timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone });
    setBinding({ client, controller });
    const refresh = () => { if (!document.hidden) void controller.refresh(); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    client.onClose(controller.dispose);
    return () => { controller.dispose(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [client]);
  return binding?.client === client ? binding.controller : null;
}
