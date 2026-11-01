/**
 * INPUT: the operator request/deadline seam and Shared cache subscription contracts.
 * OUTPUT: validated cache-window subscribe/unsubscribe methods.
 * POS: ui/lib — read-only aggregate membership, independent of selected-Run subscriptions.
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  CACHE_USAGE_METHODS, CacheUsageSubscribeParamsSchema, CacheUsageUpdateSchema,
  CacheUsageUnsubscribeResultSchema, type CacheUsageSubscribeParams,
} from "@taki/shared";

export function cacheUsageMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    subscribeCacheUsage: async (params: CacheUsageSubscribeParams) =>
      CacheUsageUpdateSchema.parse(await request(CACHE_USAGE_METHODS.subscribe, CacheUsageSubscribeParamsSchema.parse(params))),
    unsubscribeCacheUsage: async (): Promise<void> =>
      void CacheUsageUnsubscribeResultSchema.parse(await request(CACHE_USAGE_METHODS.unsubscribe, {})),
  };
}

export type CacheUsageMethods = ReturnType<typeof cacheUsageMethods>;
