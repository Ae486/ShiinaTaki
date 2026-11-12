/**
 * INPUT:  an owner device name, optional lifecycle key/readiness, and its required per-generation restoration callback.
 * OUTPUT: useOperatorConnection() — one window-owned timing store plus a fresh authenticated/restored WsClient generation.
 * POS:    ui/hooks — shared React adapter over the framework-free D59 controller; each caller owns an independent socket.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";
import type { TimingPolicy } from "@taki/shared";
import {
  createConnectionGenerationController,
  type ConnectionGenerationContext,
  type ConnectionSnapshot,
} from "@/lib/connection-generation-controller.js";
import { authenticateOperator, recoverOperatorAuth } from "@/lib/operator-auth.js";
import { createTimingPolicyStore } from "@/lib/timing-policy.js";
import { createWsClient, type WsClient } from "@/lib/ws-client.js";
import { createLocalOperatorTransport, nativeLocalAuth } from "@/lib/native-local-auth.js";

const WS_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;

export interface OperatorConnectionOptions {
  deviceName: string;
  enabled?: boolean;
  lifecycleKey?: object | string | null;
  restore?: (client: WsClient, context: ConnectionGenerationContext) => Promise<void>;
}

export interface OperatorConnection extends ConnectionSnapshot<WsClient> {
  currentTimingPolicy: () => TimingPolicy;
}

export function useOperatorConnection(options: OperatorConnectionOptions): OperatorConnection {
  const timingPolicy = useMemo(() => createTimingPolicyStore(), []);
  const restoreRef = useRef(options.restore);
  const [connection, setConnection] = useState<ConnectionSnapshot<WsClient>>({
    client: null,
    status: { kind: "connecting" },
  });
  restoreRef.current = options.restore;

  useEffect(() => {
    if (options.enabled === false) {
      setConnection({ client: null, status: { kind: "connecting" } });
      return;
    }
    const controller = createConnectionGenerationController<WsClient>({
      timingPolicy,
      transportFactory: () => createLocalOperatorTransport(WS_URL),
      clientFactory: ({ transport }) =>
        createWsClient({
          transport,
          timingPolicy,
          onTimingPolicyDiagnostic: (message) => console.warn(`[${options.deviceName}] ${message}`),
        }),
      authenticate: (client) => authenticateOperator({ client, deviceName: options.deviceName, storage: localStorage }),
      recoverAuthFailure: () => nativeLocalAuth() ? false : recoverOperatorAuth(localStorage),
      restore: (client, context) => restoreRef.current?.(client, context) ?? Promise.resolve(),
    });
    const unsubscribe = controller.subscribe(setConnection);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [options.deviceName, options.enabled, options.lifecycleKey, timingPolicy]);

  return useMemo(
    () => ({ ...connection, currentTimingPolicy: timingPolicy.current }),
    [connection, timingPolicy],
  );
}
