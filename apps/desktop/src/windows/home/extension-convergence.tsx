/**
 * INPUT:  Home's current authenticated client generation plus a lifecycle-derived refresh key
 * OUTPUT: useExtensionConvergence() and a compact owner/generation status band
 * POS:    Home shared presentation; disposable read projection with no cache or mutation authority
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "./home-client-context.ts";
import { CopyableRow } from "@/components/ui/copyable-row.js";
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
      ? <p role="status" className="border-y border-warn-border bg-warn-soft px-3 py-2 text-xs text-warn-strong">扩展收敛状态不可用：{state.message}</p>
      : <p role="status" className="border-y border-border px-3 py-2 text-xs text-text-secondary">正在读取扩展收敛状态…</p>;
  }
  const readyHosts = data.hosts.filter((host) => host.available).length;
  return (
    <section aria-label="扩展收敛状态" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-surface px-3 py-2 text-xs text-text-body">
      {/* U4: the Core host id is an opaque diagnostic identifier — the short form displays, the copy affordance
          writes the FULL id so it can be grepped in logs. */}
      <CopyableRow compact label="Core" value={shortId(data.coreHostId)} copyValue={data.coreHostId} mono />
      <span>Hosts {readyHosts}/{data.hosts.length}</span>
      <span>Extensions {data.entries.length}</span>
      <span className={data.collisions.length ? "text-warn-strong" : "text-text-secondary"}>Collisions {data.collisions.length}</span>
      {state.kind === "loading" && <span className="text-text-secondary">刷新中</span>}
      {state.kind === "failure" && <span className="text-warn-strong">刷新失败，显示上次结果</span>}
    </section>
  );
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
