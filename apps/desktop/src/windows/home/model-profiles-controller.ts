/**
 * INPUT: authenticated operator generations, visible demand and profile invalidations.
 * OUTPUT: retained presence-only profile snapshots with bounded, generation-safe refreshes.
 * POS: Home shared read model for Chat and Settings; Core owns all durable configuration.
 */
import type { ModelProfilesResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";

export type ModelProfilesClient = Pick<WsClient, "modelProfiles" | "subscribeModelProfiles" | "onModelProfilesChanged">;
export interface ModelProfilesView {
  data: ModelProfilesResult | null;
  pending: boolean;
  fresh: boolean;
  error: string | null;
  observation: number;
}
export const INITIAL_MODEL_PROFILES: ModelProfilesView = {
  data: null, pending: false, fresh: false, error: null, observation: 0,
};

export function createModelProfilesController(publish: (view: ModelProfilesView) => void) {
  let state = INITIAL_MODEL_PROFILES;
  let client: ModelProfilesClient | null = null;
  let visible = false;
  let unsubscribe: (() => void) | undefined;
  const update = (patch: Partial<ModelProfilesView>) => { state = { ...state, ...patch }; publish(state); };
  const reads = createReadCoordinator<ModelProfilesResult>({
    started: () => update({ pending: true }),
    loaded: (data) => update({ data, pending: false, fresh: true, error: null, observation: state.observation + 1 }),
    failed: () => update({ pending: false, fresh: false, error: "模型配置读取失败，保留上次结果。" }),
    retired: () => update({ pending: false }),
  });
  return {
    replace(next: ModelProfilesClient | null) {
      if (client === next) return;
      unsubscribe?.();
      client = next;
      update({ fresh: false });
      unsubscribe = next?.onModelProfilesChanged(() => { update({ fresh: false }); void reads.invalidate(); });
      reads.replace(next ? async () => {
        await next.subscribeModelProfiles();
        if (client !== next || !visible) throw new Error("Model profile read retired");
        return next.modelProfiles();
      } : null);
      if (visible) void reads.demand();
    },
    setVisible(active: boolean) {
      visible = active;
      reads.setActive(active);
      if (active) { update({ fresh: false }); void reads.demand(); }
    },
    refresh: () => reads.invalidate(),
    accept(data: ModelProfilesResult) {
      if (state.data?.profiles.some((current) => data.profiles.some((incoming) =>
        incoming.slot === current.slot && incoming.revision < current.revision))) {
        void reads.invalidate();
        return;
      }
      reads.acceptUpdate();
      update({ data, fresh: true, error: null, observation: state.observation + 1 });
    },
  };
}
