/**
 * INPUT:  Home's current authenticated client generation plus a lifecycle-derived refresh key
 * OUTPUT: useExtensionConvergence() and a compact availability, extension, and name-conflict status band
 * POS:    Home shared presentation; disposable read projection with no cache or mutation authority
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "./home-client-context.ts";
import {
  createExtensionConvergenceController,
  type ExtensionConvergenceState,
} from "./extension-convergence-controller.ts";

const INITIAL_STATE: ExtensionConvergenceState = { kind: "idle", previous: null };

export function useExtensionConvergence(refreshKey: string): ExtensionConvergenceState {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState<ExtensionConvergenceState>(INITIAL_STATE);
  const controller = useMemo(() => createExtensionConvergenceController(setState), []);
  useEffect(() => {
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready, refreshKey]);
  useEffect(() => () => controller.dispose(), [controller]);
  return state;
}

export function ExtensionConvergenceStrip({ state }: { state: ExtensionConvergenceState }) {
  const data = state.kind === "ready" ? state.data : state.previous;
  if (!data) {
    return state.kind === "failure"
      ? <p role="status" className="border-y border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-strong">扩展状态不可用：{state.message}</p>
      : <p role="status" className="border-y border-border px-3 py-2 text-xs text-text-secondary">{state.kind === "idle" ? "等待连接以读取扩展状态…" : "正在读取扩展状态…"}</p>;
  }
  const readyHosts = data.hosts.filter((host) => host.available).length;
  return (
    <section aria-label="扩展状态" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-surface px-3 py-2 text-xs text-text-body">
      <span>可用主机 {readyHosts}/{data.hosts.length}</span>
      <span>扩展 {data.entries.length}</span>
      <span className={data.collisions.length ? "text-warn-strong" : "text-text-secondary"}>名称冲突 {data.collisions.length}</span>
      {state.kind === "idle" && <span className="text-text-secondary">等待连接，显示上次结果</span>}
      {state.kind === "loading" && <span className="text-text-secondary">刷新中</span>}
      {state.kind === "failure" && <span className="text-warn-strong">刷新失败，显示上次结果</span>}
    </section>
  );
}
