/**
 * INPUT:  authenticated Home client and Operations visibility
 * OUTPUT: disposable template controller state plus explicit draft/preview/application/read actions
 * POS:    ui/operations — hides retire generations; Core owns every durable plan and result
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { INITIAL_TEMPLATES, TemplatesController } from "./hindsight-template-controller.ts";

export function useHindsightTemplates() {
  const { client, status } = useHomeClient();
  const visible = usePageVisible("operations");
  const ready = visible && status.kind === "connected" ? client : null;
  const [state, setState] = useState(INITIAL_TEMPLATES);
  const controller = useMemo(() => new TemplatesController(setState), []);
  useEffect(() => { controller.replace(ready); return () => controller.dispose(); }, [controller, ready]);
  useEffect(() => {
    if (!ready) return;
    const refresh = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [controller, ready]);
  return { state, controller, connectionReady: ready !== null };
}
