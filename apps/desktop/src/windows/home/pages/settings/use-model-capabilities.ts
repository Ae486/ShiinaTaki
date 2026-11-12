/**
 * INPUT:  current Home client, Settings visibility and the active MAIN model/base URL.
 * OUTPUT: useModelCapabilities() — demand reads fenced by both physical client and safe configuration identity.
 * POS:    Home Settings metadata seam — uses existing disposable reads; no polling or persistent capability authority.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { ConfigEntry, ModelCapabilitiesResult, ModelProfileStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";

export type ModelCapabilitiesViewState =
  | { phase: "idle" }
  | { phase: "pending"; data: ModelCapabilitiesResult | null }
  | { phase: "ready"; data: ModelCapabilitiesResult }
  | { phase: "error"; message: string; data: ModelCapabilitiesResult | null };

export function createModelCapabilitiesLoad(input: {
  client: Pick<WsClient, "configModelCapabilities">;
  model: string | null;
  baseURL: string;
}) {
  return async (): Promise<ModelCapabilitiesResult> => {
    const result = await input.client.configModelCapabilities();
    const bytes = new TextEncoder().encode(JSON.stringify([input.baseURL, input.model]));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const identity = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (result.configured.identity !== identity) throw new Error("模型配置已变化，请刷新配置后重试。");
    return result;
  };
}

export function useModelCapabilities(entries: ConfigEntry[], activeProfile?: ModelProfileStatus["active"]) {
  const { client, status } = useHomeClient();
  const active = usePageActive("settings");
  const modelValue = activeProfile === undefined ? entries.find((entry) => entry.key === "TAKI_PROVIDER_MODEL")?.value : activeProfile?.model;
  const baseValue = activeProfile === undefined ? entries.find((entry) => entry.key === "TAKI_PROVIDER_BASE_URL")?.value : activeProfile?.baseUrl;
  const model = typeof modelValue === "string" && modelValue.length > 0 ? modelValue : null;
  const baseURL = typeof baseValue === "string" ? baseValue : "";
  const ready = client && status.kind === "connected" ? client : null;
  const [state, setState] = useState<ModelCapabilitiesViewState>({ phase: "idle" });
  const reads = useMemo(() => createReadCoordinator<ModelCapabilitiesResult>({
    started: () => setState((previous) => ({ phase: "pending", data: previous.phase === "idle" ? null : previous.data })),
    loaded: (data) => setState({ phase: "ready", data }),
    failed: () => setState((previous) => ({ phase: "error", data: previous.phase === "idle" ? null : previous.data,
      message: "能力声明读取失败，模型配置仍可使用。" })),
    retired: () => undefined,
  }), []);
  const load = useMemo(() => ready ? createModelCapabilitiesLoad({ client: ready, model, baseURL }) : null,
    [ready, model, baseURL]);
  useLayoutEffect(() => {
    setState({ phase: "idle" });
    reads.replace(load);
    return () => reads.replace(null);
  }, [reads, load]);
  useLayoutEffect(() => {
    reads.setActive(active);
    void reads.demand();
    return () => reads.setActive(false);
  }, [reads, load, active]);
  return { state, model, connected: ready !== null, refresh: () => reads.demand() };
}
