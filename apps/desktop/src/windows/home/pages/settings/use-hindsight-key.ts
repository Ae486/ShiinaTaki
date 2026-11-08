/**
 * INPUT:  the current Home client and transient password input.
 * OUTPUT: useHindsightKey() — presence/actions and a draft cleared on submission or client retirement.
 * POS:    ui/windows/home/pages/settings — React-only key seam; no persistence, value readback or mutation replay.
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { createHindsightKeyController, INITIAL_KEY_STATE } from "./hindsight-key-controller.ts";

export function useHindsightKey() {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState(INITIAL_KEY_STATE);
  const [draft, setDraft] = useState({ owner: ready, value: "" });
  const controller = useMemo(() => createHindsightKeyController(setState), []);
  useEffect(() => {
    setDraft({ owner: ready, value: "" });
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);
  const value = draft.owner === ready ? draft.value : "";
  return {
    state: draft.owner === ready ? state : INITIAL_KEY_STATE,
    connectionReady: ready !== null,
    value,
    edit: (value: string) => setDraft({ owner: ready, value }),
    save: () => { setDraft({ owner: ready, value: "" }); return controller.save(value); },
    clear: () => { setDraft({ owner: ready, value: "" }); return controller.clear(); },
    refresh: controller.refresh,
  };
}
