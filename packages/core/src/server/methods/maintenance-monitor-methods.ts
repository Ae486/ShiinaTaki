/**
 * INPUT: authenticated operator membership requests and the background Monitor projection
 * OUTPUT: bounded subscription snapshots and committed change notifications
 * POS: core/server/methods — separate from selected-Run streams and execution commands
 */
import { MAINTENANCE_MONITOR_METHODS, MaintenanceMonitorParamsSchema,
  MaintenanceMonitorUnsubscribeParamsSchema, MaintenanceMonitorUnsubscribeResultSchema } from "@taki/shared";
import type { MaintenanceMonitorService } from "../../observability/maintenance-monitor-service.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerMaintenanceMonitorMethods(registry: MethodRegistry, service: MaintenanceMonitorService): void {
  registry.register({ method: MAINTENANCE_MONITOR_METHODS.subscribe, roles: ["operator"], paramsSchema: MaintenanceMonitorParamsSchema,
    handler: (params, ctx) => {
      const { added, update } = service.subscribe(ctx.connection, params, (value) => ctx.notify(MAINTENANCE_MONITOR_METHODS.changed, value));
      if (added) ctx.onClose(() => service.unsubscribe(ctx.connection));
      return update;
    } });
  registry.register({ method: MAINTENANCE_MONITOR_METHODS.unsubscribe, roles: ["operator"], paramsSchema: MaintenanceMonitorUnsubscribeParamsSchema,
    handler: (_params, ctx) => { service.unsubscribe(ctx.connection); return MaintenanceMonitorUnsubscribeResultSchema.parse({ status: "ok" }); } });
}
