/**
 * INPUT:  frozen Shared tracked commands and authenticated bounded HTTP transport
 * OUTPUT: native admission/status and immutable historical result pages
 * POS:    core/memory/hindsight — wire adapter only; GET never dispatches memory work
 */
import {
  HindsightNativeResultPageSchema, HindsightNativeResultStatusSchema, HindsightNativeWriteResponseSchema,
  type HindsightNativeIdentity, type HindsightNativeOperationKind, type HindsightNativeResultPage,
  type HindsightNativeResultStatus, type HindsightNativeWriteResponse, type PendingMemoryDispatch,
} from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";

export type TrackedMemoryDispatch = Extract<PendingMemoryDispatch, { protocol: "tracked_native_v1" }>;
interface NativeReadInput {
  bankId: string; kind: HindsightNativeOperationKind; identity: HindsightNativeIdentity; context: HindsightCallContext;
}
export interface HindsightNativeResultClient {
  trackedNativeWrite(input: { bankId: string; dispatch: TrackedMemoryDispatch; context: HindsightCallContext }): Promise<HindsightNativeWriteResponse>;
  nativeResult(input: NativeReadInput): Promise<HindsightNativeResultStatus>;
  nativeResultPage(input: NativeReadInput & { resultHash: string; pageNumber: number }): Promise<HindsightNativeResultPage>;
}

export function createHindsightNativeResultMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightNativeResultClient {
  return {
    trackedNativeWrite: (input) => {
      const command = input.dispatch.command;
      const bankPath = `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}`;
      return request<HindsightNativeWriteResponse>({
        path: command.kind === "retain" ? `${bankPath}/retains` : `${bankPath}/memories/${encodeURIComponent(command.memoryId)}`,
        init: { method: command.kind === "retain" ? "POST" : "PATCH", body: JSON.stringify(command.request) },
        context: input.context, schema: HindsightNativeWriteResponseSchema,
        responses: { 404: HindsightNativeWriteResponseSchema, 409: HindsightNativeWriteResponseSchema, 412: HindsightNativeWriteResponseSchema },
      });
    },
    nativeResult: (input) => request({ path: `${resultPath(input)}?${identityQuery(input.identity)}`,
      context: input.context, schema: HindsightNativeResultStatusSchema }),
    nativeResultPage: (input) => request({
      path: `${resultPath(input)}/results/${encodeURIComponent(input.resultHash)}/pages/${input.pageNumber}?${identityQuery(input.identity)}`,
      context: input.context, schema: HindsightNativeResultPageSchema,
    }),
  };
}

function resultPath(input: NativeReadInput): string {
  return `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}/native-results/${input.kind}/${encodeURIComponent(input.identity.operation_id)}`;
}

function identityQuery(identity: HindsightNativeIdentity): URLSearchParams {
  return new URLSearchParams({ provider_lineage: identity.provider_lineage, bank_generation: identity.bank_generation });
}
