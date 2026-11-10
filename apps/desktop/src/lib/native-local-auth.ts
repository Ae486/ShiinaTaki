/**
 * INPUT: native operator windows, a fresh Core socket challenge, and selected-profile endpoint discovery.
 * OUTPUT: validated public identity/endpoint and one-use operator proof; deferred browser transport for reconnect.
 * POS: ui/lib — Tauri admission boundary; no bootstrap credentials enter renderer storage.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LocalAuthChallengeSchema, type LocalAuthChallenge } from "@taki/shared";
import { createBrowserTransport, type WsTransport } from "./ws-transport.ts";

export interface NativeLocalAuth {
  identity(): Promise<string>;
  proof(challenge: LocalAuthChallenge): Promise<string>;
}

export function nativeLocalAuth(): NativeLocalAuth | undefined {
  if (!isTauri()) return undefined;
  return {
    identity: async () => LocalAuthChallengeSchema.shape.deviceId.parse(await invoke("local_operator_identity")),
    proof: async (challenge) => LocalAuthChallengeSchema.shape.serverProof.parse(await invoke("local_operator_proof", { challenge })),
  };
}

/** Endpoint lookup belongs to each fresh generation, so Desktop-first and listener replacement recover alike. */
export function createLocalOperatorTransport(fallback: string): WsTransport {
  if (!isTauri()) return createBrowserTransport(fallback);
  let inner: WsTransport | null = null;
  let closed = false;
  const messages = new Set<(data: string) => void>();
  const opens = new Set<() => void>();
  const closes = new Set<() => void>();
  void invoke("local_core_endpoint").then((value) => {
    const endpoint = LocalAuthChallengeSchema.shape.endpoint.parse(value);
    if (closed) return;
    inner = createBrowserTransport(endpoint);
    inner.onMessage((data) => messages.forEach((handler) => handler(data)));
    inner.onOpen(() => opens.forEach((handler) => handler()));
    inner.onClose(() => closes.forEach((handler) => handler()));
  }).catch(() => { if (!closed) closes.forEach((handler) => handler()); });
  return {
    send(data) {
      if (!inner || closed) throw new Error("本地服务尚未连接");
      inner.send(data);
    },
    close() { closed = true; inner?.close(); messages.clear(); opens.clear(); closes.clear(); },
    onMessage: (handler) => { messages.add(handler); },
    onOpen: (handler) => { opens.add(handler); },
    onClose: (handler) => { closes.add(handler); },
  };
}
