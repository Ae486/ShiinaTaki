/**
 * INPUT:  one authenticated WsClient's config list/subscribe callbacks and a window-owned TimingPolicyStore.
 * OUTPUT: createTimingPolicySync() - exact-once subscription plus serialized, last-good full-policy refresh.
 * POS:    ui/lib - per-connection config observer; no persistence and no React ownership.
 */
import { isTimingConfigKey, type ConfigChanged, type ConfigListResult } from "@taki/shared";
import type { TimingPolicyStore } from "./timing-policy.ts";

export interface TimingPolicySyncDeps {
  store: TimingPolicyStore;
  list: () => Promise<ConfigListResult>;
  subscribe: () => Promise<void>;
  onConfigChanged: (handler: (change: ConfigChanged) => void) => () => void;
  onDiagnostic: (message: string) => void;
}

export interface TimingPolicySync {
  start(): void;
  dispose(): void;
}

export function createTimingPolicySync(deps: TimingPolicySyncDeps): TimingPolicySync {
  let disposed = false;
  let started = false;
  let running: Promise<void> | null = null;
  let rerun = false;

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        try {
          const listed = await deps.list();
          if (disposed) return;
          const update = deps.store.apply(listed.entries);
          if (!update.ok) deps.onDiagnostic(`invalid config refresh; keeping last-good timing policy: ${update.diagnostic}`);
        } catch (cause) {
          deps.onDiagnostic(`config.list refresh failed; keeping last-good timing policy: ${String(cause)}`);
        }
      } while (rerun && !disposed);
    })().finally(() => {
      running = null;
      if (rerun && !disposed) void refresh();
    });
    return running;
  };

  const unsubscribe = deps.onConfigChanged((change) => {
    if (isTimingConfigKey(change.key)) void refresh();
  });

  return {
    start() {
      if (started || disposed) return;
      started = true;
      void deps
        .subscribe()
        .catch((cause: unknown) => deps.onDiagnostic(`config.subscribe failed; live timing refresh is unavailable: ${String(cause)}`))
        .then(refresh);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rerun = false;
      unsubscribe();
    },
  };
}
