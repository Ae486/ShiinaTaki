/**
 * INPUT:  the authenticated operator client's deadline-bound JSON-RPC request function
 * OUTPUT: typed Local onboarding reads, source exclusions and one subscription per physical client
 * POS:    ui/lib — Shared schemas own every wire shape; durable work uses memory.operations
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  MEMORY_ONBOARDING_METHODS,
  MemoryOnboardingPreviewResultSchema,
  MemoryOnboardingStatusSchema,
  MemoryOnboardingExceptionsResultSchema,
  MemoryOnboardingExcludeParamsSchema,
  MemoryOnboardingExcludeResultSchema,
  MemoryOnboardingSubscribeResultSchema,
  type MemoryOnboardingPreviewResult,
  type MemoryOnboardingStatus,
  type MemoryOnboardingExceptionsParams,
  type MemoryOnboardingExceptionsResult,
  type MemoryOnboardingExcludeParams,
} from "@taki/shared";

export interface MemoryOnboardingMethods {
  memoryOnboardingPreview(): Promise<MemoryOnboardingPreviewResult>;
  memoryOnboardingStatus(): Promise<MemoryOnboardingStatus>;
  memoryOnboardingExceptions(params: MemoryOnboardingExceptionsParams): Promise<MemoryOnboardingExceptionsResult>;
  memoryOnboardingExclude(params: MemoryOnboardingExcludeParams): Promise<MemoryOnboardingStatus>;
  subscribeMemoryOnboarding(): Promise<void>;
}

export function memoryOnboardingMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>): MemoryOnboardingMethods {
  let subscription: Promise<void> | null = null;
  return {
    memoryOnboardingPreview: async () => MemoryOnboardingPreviewResultSchema.parse(await request(MEMORY_ONBOARDING_METHODS.preview, {})),
    memoryOnboardingStatus: async () => MemoryOnboardingStatusSchema.parse(await request(MEMORY_ONBOARDING_METHODS.status, {})),
    memoryOnboardingExceptions: async (params) => MemoryOnboardingExceptionsResultSchema.parse(await request(MEMORY_ONBOARDING_METHODS.exceptions, params)),
    memoryOnboardingExclude: async (params) => MemoryOnboardingExcludeResultSchema.parse(
      await request(MEMORY_ONBOARDING_METHODS.exclude, MemoryOnboardingExcludeParamsSchema.parse(params)),
    ),
    subscribeMemoryOnboarding: () => {
      subscription ??= request<unknown>(MEMORY_ONBOARDING_METHODS.subscribe, {}).then((result) => {
        MemoryOnboardingSubscribeResultSchema.parse(result);
      }).catch((cause: unknown) => {
        // A failed subscription is retryable by an explicit refresh; successful subscriptions stay memoized.
        subscription = null;
        throw cause;
      });
      return subscription;
    },
  };
}
