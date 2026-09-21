/**
 * INPUT:  the Home authenticated client generation and Operations page visibility
 * OUTPUT: useLocalOnboarding() — ephemeral Core snapshots and explicit preview/prepare/recovery/exclusion actions
 * POS:    ui/windows/home/pages/operations — React lifecycle bridge; the controller owns asynchronous guards
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { LocalOnboardingController } from "./local-onboarding-controller.ts";
import type { OnboardingAction } from "./local-onboarding-actions.ts";
import { initialOnboardingState, type LocalOnboardingState } from "./local-onboarding-state.ts";

export interface LocalOnboardingView extends LocalOnboardingState {
  connectionReady: boolean;
  refresh(): Promise<void>;
  execute(action: OnboardingAction): Promise<void>;
  exclude(sourceId: string, reason: string): Promise<void>;
  loadMore(): Promise<void>;
}

export function useLocalOnboarding(): LocalOnboardingView {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageVisible("operations");
  const [state, setState] = useState(initialOnboardingState);
  const controller = useMemo(() => new LocalOnboardingController(setState), []);
  useEffect(() => controller.setVisible(visible), [controller, visible]);
  useEffect(() => {
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...state, connectionReady: ready !== null && controller.matches(ready),
    refresh: () => controller.refresh(), execute: (action) => controller.execute(action),
    exclude: (sourceId, reason) => controller.exclude(sourceId, reason), loadMore: () => controller.loadMore() };
}
