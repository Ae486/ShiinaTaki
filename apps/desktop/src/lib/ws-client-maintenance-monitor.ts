/**
 * INPUT: operator RPC requests and Shared background Monitor contracts
 * OUTPUT: validated read-only subscription methods
 * POS: ui/lib — separate membership from normal Run and cache streams
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { MAINTENANCE_MONITOR_METHODS, MaintenanceMonitorParamsSchema, MaintenanceMonitorUpdateSchema,
  MaintenanceMonitorUnsubscribeResultSchema, type MaintenanceMonitorParams } from "@taki/shared";

export function maintenanceMonitorMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    subscribeMaintenanceMonitor: async (params: MaintenanceMonitorParams) => MaintenanceMonitorUpdateSchema.parse(
      await request(MAINTENANCE_MONITOR_METHODS.subscribe, MaintenanceMonitorParamsSchema.parse(params))),
    unsubscribeMaintenanceMonitor: async (): Promise<void> => {
      MaintenanceMonitorUnsubscribeResultSchema.parse(await request(MAINTENANCE_MONITOR_METHODS.unsubscribe, {}));
    },
  };
}
export type MaintenanceMonitorMethods = ReturnType<typeof maintenanceMonitorMethods>;
