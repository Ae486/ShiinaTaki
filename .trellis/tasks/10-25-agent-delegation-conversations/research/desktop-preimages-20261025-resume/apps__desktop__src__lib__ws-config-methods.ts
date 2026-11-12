/**
 * INPUT:  the physical WsClient's deadline-bound request function and Shared config schemas.
 * OUTPUT: config requests with concurrent-list sharing and retryable, recovery-observable subscription setup.
 * POS:    ui/lib — connection-local outbound config seam; no cache lifetime, retry loop or second timing owner.
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  CONFIG_METHODS, ConfigListResultSchema, ConfigSetResultSchema, ConfigSubscribeResultSchema,
  type ConfigListResult, type ConfigSetParams,
} from "@taki/shared";

export function configMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  let subscription: Promise<void> | null = null;
  let listed: Promise<ConfigListResult> | null = null;
  let failedSetup = false;
  const recovered = new Set<() => void>();
  return {
    // Stop new consumers joining a snapshot started before a verified change. Existing consumers retain
    // their promise and use their own update epochs; its finalizer must not clear a newer shared flight.
    invalidateConfigList() { listed = null; },
    configList() {
      if (listed) return listed;
      const attempt = request(CONFIG_METHODS.list, {}).then((value) => ConfigListResultSchema.parse(value)).finally(() => {
        if (listed === attempt) listed = null;
      });
      listed = attempt;
      return attempt;
    },
    async configSet(params: ConfigSetParams) {
      const result = ConfigSetResultSchema.parse(await request(CONFIG_METHODS.set, params));
      listed = null;
      return result;
    },
    subscribeConfig() {
      if (subscription) return subscription;
      const attempt = request(CONFIG_METHODS.subscribe, {}).then((value) => {
        ConfigSubscribeResultSchema.parse(value);
        if (failedSetup) {
          // A pre-recovery read cannot cover the period whose subscription was missing.
          listed = null;
          notifyRecovery(recovered);
        }
        failedSetup = false;
      }).catch((cause: unknown) => {
        if (subscription === attempt) subscription = null;
        failedSetup = true;
        throw cause;
      });
      subscription = attempt;
      return attempt;
    },
    onConfigSubscriptionRecovered(handler: () => void) {
      recovered.add(handler);
      return () => { recovered.delete(handler); };
    },
  };
}

function notifyRecovery(handlers: Set<() => void>): void {
  for (const handler of handlers) {
    try { handler(); }
    catch { console.warn("[config] subscription recovery observer failed"); }
  }
}
