/**
 * INPUT:  one native Bank read request and the existing authenticated, deadline-bound requester
 * OUTPUT: recallNative/reflectNative methods returning validated native responses
 * POS:    core/memory/hindsight — transport-only reads; no retrieval, policy, replica, or MemoryProvider wiring
 */
import type { z } from "zod";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { HindsightBankWireSchema } from "./hindsight-contracts.ts";
import { hindsightError } from "./hindsight-errors.ts";
import {
  HindsightNativeRecallRequestSchema, HindsightNativeRecallResponseSchema,
  HindsightNativeReflectRequestSchema, HindsightNativeReflectResponseSchema,
  type HindsightNativeRecallRequest, type HindsightNativeRecallResponse,
  type HindsightNativeReflectRequest, type HindsightNativeReflectResponse,
} from "@taki/shared";

interface NativeReadInput<T> { bankId: string; request: T; context: HindsightCallContext }
export interface HindsightRuntimeClient {
  recallNative(input: NativeReadInput<HindsightNativeRecallRequest>): Promise<HindsightNativeRecallResponse>;
  reflectNative(input: NativeReadInput<HindsightNativeReflectRequest>): Promise<HindsightNativeReflectResponse>;
}

export function createHindsightRuntimeMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightRuntimeClient {
  return {
    recallNative: async (input) => request({
      path: `${bankPath(input.bankId)}/memories/recall`,
      init: { method: "POST", body: requestBody(input.request, HindsightNativeRecallRequestSchema) },
      context: input.context, schema: HindsightNativeRecallResponseSchema,
    }),
    reflectNative: async (input) => request({
      path: `${bankPath(input.bankId)}/reflect`,
      init: { method: "POST", body: requestBody(input.request, HindsightNativeReflectRequestSchema) },
      context: input.context, schema: HindsightNativeReflectResponseSchema,
    }),
  };
}

function bankPath(bankId: string): string {
  try {
    const id = HindsightBankWireSchema.shape.bank_id.parse(bankId);
    if (id === "." || id === "..") throw hindsightError("HINDSIGHT_RESPONSE_INVALID");
    return `/v1/default/banks/${encodeURIComponent(id)}`;
  } catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
}

function requestBody<T>(value: T, schema: z.ZodType<T>): string {
  try { return JSON.stringify(schema.parse(value)); }
  catch { throw hindsightError("HINDSIGHT_RESPONSE_INVALID"); }
}
