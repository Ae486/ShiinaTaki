/**
 * INPUT:  Home's current authenticated client, effective page visibility and targeted producer invalidations
 * OUTPUT: useExtensionConvergence() and a compact availability, extension, and name-conflict status band
 * POS:    Home shared presentation; disposable read projection with no cache or mutation authority
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useHomeClient } from "./home-client-context.ts";
import {
  type ExtensionConvergenceState,
} from "./extension-convergence-controller.ts";
import { extensionResource } from "./extension-convergence-resource.ts";
import { usePageActive } from "./page-visibility-store.ts";
import { ActionButton } from "./action-button.tsx";
import { ReadObservationNotice } from "./read-observation-notice.tsx";

const INITIAL_STATE: ExtensionConvergenceState = { kind: "idle", previous: null, observation: "idle" };

export function useExtensionConvergence(page: "mcp" | "skills", refreshKey: string | null) {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState<ExtensionConvergenceState>(INITIAL_STATE);
  const visible = usePageActive(page);
  const resource = useMemo(() => ready ? extensionResource(ready) : null, [ready]);
  const previousKey = useRef(refreshKey);
  const receive = useCallback((next: ExtensionConvergenceState) => setState((previous) => {
    if (next.kind === "ready" || next.previous !== null) return next;
    return { ...next, previous: previous.kind === "ready" ? previous.data : previous.previous };
  }), []);
  useLayoutEffect(() => {
    if (!resource) { receive(INITIAL_STATE); return; }
    return resource.observe(receive);
  }, [resource, receive]);
  useLayoutEffect(() => resource?.setVisible(receive, visible), [resource, receive, visible]);
  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = refreshKey;
    // Current Core targets the strip directly. The previous list-key bridge remains bounded to the
    // explicitly unsupported legacy path so an unrelated modern list refresh cannot fetch the strip.
    if (previous !== null && refreshKey !== null && previous !== refreshKey) void resource?.invalidateLegacy();
  }, [resource, refreshKey]);
  const refresh = useCallback(() => resource?.refresh() ?? Promise.resolve(), [resource]);
  return { state, refresh, connectionReady: ready !== null };
}

export function ExtensionConvergenceStrip({ state, onRefresh, connectionReady }: {
  state: ExtensionConvergenceState;
  onRefresh(): Promise<void>;
  connectionReady: boolean;
}) {
  const data = state.kind === "ready" ? state.data : state.previous;
  if (!data) {
    return <>{state.kind === "failure"
      ? <div role="status" className="border-y border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-strong">
          扩展状态不可用：{state.message}<ActionButton disabled={!connectionReady} onClick={() => void onRefresh()}>重试</ActionButton>
        </div>
      : <p role="status" className="border-y border-border px-3 py-2 text-xs text-text-secondary">{state.kind === "idle" ? "等待连接以读取扩展状态…" : "正在读取扩展状态…"}</p>}
      <ReadObservationNotice observation={state.observation} onRefresh={onRefresh} disabled={!connectionReady} />
    </>;
  }
  const readyHosts = data.hosts.filter((host) => host.available).length;
  return (
    <section aria-label="扩展状态" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-surface px-3 py-2 text-xs text-text-body">
      <span>可用主机 {readyHosts}/{data.hosts.length}</span>
      <span>扩展 {data.entries.length}</span>
      <span className={data.collisions.length ? "text-warn-strong" : "text-text-secondary"}>名称冲突 {data.collisions.length}</span>
      {state.kind === "idle" && <span className="text-text-secondary">等待连接，显示上次结果</span>}
      {state.kind === "loading" && <span className="text-text-secondary">刷新中</span>}
      {state.kind === "failure" && <><span className="text-warn-strong">刷新失败，显示上次结果</span>
        <ActionButton disabled={!connectionReady} onClick={() => void onRefresh()}>重试</ActionButton></>}
      <ReadObservationNotice observation={state.observation} onRefresh={onRefresh} disabled={!connectionReady} />
    </section>
  );
}
