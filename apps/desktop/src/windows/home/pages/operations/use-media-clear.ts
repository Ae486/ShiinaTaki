/**
 * INPUT:  the Home operator client and the storage read invalidation callback.
 * OUTPUT: confirmed purge actions, retained retryable errors and once-only floating outcomes.
 * POS:    Operations React adapter; the local controller owns the destructive two-step guard.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import type { ClearEvent, ClearPhase } from "./operations-state.ts";
import { createMediaClearController, type MediaClearState } from "./media-clear-controller.ts";
import { dismissToastGroup, pushToast } from "@/components/toast/toast-store.js";

const REPLACE_KEY = "media-clear";

export interface MediaClearControl {
  phase: ClearPhase;
  error: string | null;
  onEvent: (event: ClearEvent) => void;
}

export function useMediaClear(client: WsClient | null, onSettled: () => void): MediaClearControl {
  const [state, setState] = useState<MediaClearState>({ phase: "idle", error: null });
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const controller = useMemo(() => createMediaClearController({
    changed: setState,
    started: () => dismissToastGroup(REPLACE_KEY),
    succeeded: (result, eventKey) => pushToast(`已清除 ${result.removedCount} 个附件，释放 ${result.freedBytes} 字节`,
      "success", { eventKey, replaceKey: REPLACE_KEY }),
    failed: (eventKey) => pushToast("附件清除失败，请查看存储卡片中的说明。", "error", { eventKey, replaceKey: REPLACE_KEY }),
    settled: () => settled.current(),
  }), []);
  useLayoutEffect(() => controller.replace(client), [controller, client]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...state, onEvent: controller.onEvent };
}
