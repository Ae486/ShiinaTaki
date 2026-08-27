/**
 * INPUT: operator observability requests, Core query projection, and post-commit Run event bus
 * OUTPUT: operator-only read methods plus connection-scoped backfill/live subscription
 * POS:    core/server/methods — narrow WS composition seam for the optional read-only monitor
 */
import {
  OBSERVABILITY_METHODS, MonitorStateParamsSchema, MonitorStateResultSchema, RunMonitorListParamsSchema,
  RunMonitorSubscribeParamsSchema, RunMonitorSubscribeResultSchema, TrajectoryInspectParamsSchema,
  RunMonitorUnsubscribeParamsSchema, RunMonitorUnsubscribeResultSchema,
  TrajectoryParamsSchema, type RunMonitorListParams, type RunMonitorSubscribeParams, type TrajectoryInspectParams,
  type TrajectoryParams,
} from "@taki/shared";
import type { RunEventLiveBus, RunEventSubscription } from "../../db/run-event-live.ts";
import type { ObservabilityQueryService } from "../../observability/observability-query-service.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export function registerObservabilityMethods(registry: MethodRegistry, input: { service: ObservabilityQueryService; live: RunEventLiveBus }): void {
  const subscriptions = new WeakMap<Connection, RunEventSubscription>();
  registry.register(state(input.service)); registry.register(list(input.service)); registry.register(trajectory(input.service));
  registry.register(inspect(input.service)); registry.register(subscribe(input, subscriptions)); registry.register(unsubscribe(subscriptions));
}

function unsubscribe(subscriptions: WeakMap<Connection, RunEventSubscription>): MethodDefinition<Record<string, never>> {
  return { method: OBSERVABILITY_METHODS.unsubscribe, roles: ["operator"], paramsSchema: RunMonitorUnsubscribeParamsSchema,
    handler: (_params, ctx) => {
      subscriptions.get(ctx.connection)?.close();
      subscriptions.delete(ctx.connection);
      return RunMonitorUnsubscribeResultSchema.parse({ status: "ok" });
    } };
}

function state(service: ObservabilityQueryService): MethodDefinition<Record<string, never>> { return { method: OBSERVABILITY_METHODS.state, roles: ["operator"], paramsSchema: MonitorStateParamsSchema, handler: () => { const mode = service.mode(); return MonitorStateResultSchema.parse({ mode, enabled: mode !== "DISABLED", detail: mode === "DISABLED" ? "none" : mode === "FULL_LOCAL" ? "safe-local" : "lifecycle" }); } }; }
function list(service: ObservabilityQueryService): MethodDefinition<RunMonitorListParams> { return { method: OBSERVABILITY_METHODS.list, roles: ["operator"], paramsSchema: RunMonitorListParamsSchema, handler: (params) => service.list(params) }; }
function trajectory(service: ObservabilityQueryService): MethodDefinition<TrajectoryParams> { return { method: OBSERVABILITY_METHODS.trajectory, roles: ["operator"], paramsSchema: TrajectoryParamsSchema, handler: (params) => service.trajectory(params) }; }
function inspect(service: ObservabilityQueryService): MethodDefinition<TrajectoryInspectParams> { return { method: OBSERVABILITY_METHODS.inspect, roles: ["operator"], paramsSchema: TrajectoryInspectParamsSchema, handler: (params) => service.inspect(params) }; }
function subscribe(input: { service: ObservabilityQueryService; live: RunEventLiveBus }, subscriptions: WeakMap<Connection, RunEventSubscription>): MethodDefinition<RunMonitorSubscribeParams> {
  return { method: OBSERVABILITY_METHODS.subscribe, roles: ["operator"], paramsSchema: RunMonitorSubscribeParamsSchema, handler: (params, ctx) => {
    if (input.service.mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
    const backfill = input.service.trajectory({ characterId: params.characterId, runKey: params.runKey, afterSeq: params.afterSeq, limit: 200 });
    for (const row of backfill.rows) ctx.notify(OBSERVABILITY_METHODS.event, { runKey: params.runKey, cursor: row.seq, row, invalidated: false });
    subscriptions.get(ctx.connection)?.close();
    const holder: { current: RunEventSubscription | null } = { current: null };
    const subscription = input.live.subscribe(params.runKey, (event) => {
      if (input.service.mode() === "DISABLED") {
        ctx.notify(OBSERVABILITY_METHODS.event, { runKey: params.runKey, cursor: holder.current?.cursor ?? backfill.cursor.seq, invalidated: true, reason: "mode-disabled" });
        holder.current?.close();
        return;
      }
      ctx.notify(OBSERVABILITY_METHODS.event, { runKey: params.runKey, cursor: event.seq, row: input.service.project(event), invalidated: false });
    }, { afterSeq: backfill.cursor.seq, onOverflow: () => ctx.notify(OBSERVABILITY_METHODS.event, { runKey: params.runKey, cursor: holder.current?.cursor ?? backfill.cursor.seq, invalidated: true, reason: "overflow" }) });
    holder.current = subscription;
    subscriptions.set(ctx.connection, subscription);
    ctx.onClose(() => { if (subscriptions.get(ctx.connection) === subscription) subscriptions.delete(ctx.connection); subscription.close(); });
    return RunMonitorSubscribeResultSchema.parse({ status: "ok", cursor: backfill.cursor.seq });
  } };
}
