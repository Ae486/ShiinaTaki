/**
 * INPUT:  visible Operations page, authenticated Home connection and selected Global/Character scope
 * OUTPUT: configuration view/actions backed by disposable current-generation Core reads
 * POS:    ui/windows/home/pages/operations — the React WS seam; no browser evidence cache
 */
import { useEffect, useMemo, useState } from "react";
import type { HindsightConfigurationScope } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { createConfigurationController, INITIAL_CONFIGURATION, type ConfigurationViewState } from "./hindsight-configuration-controller.ts";

export interface HindsightConfigurationView {
  state: ConfigurationViewState;
  connectionReady: boolean;
  refresh(): Promise<void>;
  observe(): Promise<void>;
}

export function useHindsightConfiguration(scope: HindsightConfigurationScope): HindsightConfigurationView {
  const { client, status } = useHomeClient();
  const visible = usePageVisible("operations");
  const ready = visible && status.kind === "connected" ? client : null;
  const [state, setState] = useState<ConfigurationViewState>(INITIAL_CONFIGURATION);
  const controller = useMemo(() => createConfigurationController(setState), []);
  const characterId = scope.kind === "character" ? scope.characterId : null;
  useEffect(() => {
    controller.replace(ready, characterId === null ? { kind: "global" } : { kind: "character", characterId });
    return () => controller.dispose();
  }, [controller, ready, characterId]);
  useEffect(() => {
    if (!ready) return;
    const refresh = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [controller, ready]);
  return { state, connectionReady: ready !== null, refresh: () => controller.refresh(), observe: () => controller.observe() };
}
