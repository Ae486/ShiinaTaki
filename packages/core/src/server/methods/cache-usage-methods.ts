/**
 * INPUT: authenticated operator subscription requests and the computed cache-window projection.
 * OUTPUT: one replaceable membership per connection, initial snapshot, and post-commit updates.
 * POS: core/server/methods — independent of selected-Run trajectory subscriptions.
 */
import { CACHE_USAGE_METHODS, CacheUsageSubscribeParamsSchema, CacheUsageUnsubscribeParamsSchema,
  CacheUsageUnsubscribeResultSchema } from "@taki/shared";
import type { CacheUsageService } from "../../observability/cache-usage-service.ts";
import type { MethodRegistry } from "../method-registry.ts";

export function registerCacheUsageMethods(registry: MethodRegistry, service: CacheUsageService): void {
  registry.register({ method: CACHE_USAGE_METHODS.subscribe, roles: ["operator"],
    paramsSchema: CacheUsageSubscribeParamsSchema,
    handler: (params, ctx) => {
      const { added, update } = service.subscribe(ctx.connection, params.characterId,
        (snapshot) => ctx.notify(CACHE_USAGE_METHODS.changed, snapshot));
      if (added) ctx.onClose(() => service.unsubscribe(ctx.connection));
      return update;
    } });
  registry.register({ method: CACHE_USAGE_METHODS.unsubscribe, roles: ["operator"],
    paramsSchema: CacheUsageUnsubscribeParamsSchema,
    handler: (_params, ctx) => {
      service.unsubscribe(ctx.connection);
      return CacheUsageUnsubscribeResultSchema.parse({ status: "ok" });
    } });
}
